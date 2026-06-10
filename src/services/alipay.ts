/**
 * Alipay Payment Service — handles Alipay AI 收 via the moltspay SDK.
 *
 * Integration (1.7.0+): uses `MoltsPayClient.pay(endpoint, service, params,
 * { rail: 'alipay', ... })` from the official `moltspay` SDK instead of
 * hand-rolling the 402 fetch + alipay-bot CLI orchestration. The SDK runs the
 * whole alipay state machine internally (hit resource → 402 challenge →
 * selectRail → alipay-bot → poll) and resolves with the resource body once paid.
 *
 * Control flow:
 *   client.pay() is a single long-lived promise. It fires `onPaymentPending`
 *   mid-flight (once the payment URL + tradeNo are known) and resolves only
 *   after settlement. We therefore:
 *     - render the QR + create the DB record inside onPaymentPending, then
 *       resolve `startAlipayPayment` so the Discord handler can return;
 *     - deliver paid / failed asynchronously via the onPaid / onFailed handlers;
 *     - reject (before onPending fires) if the link could not be created, so the
 *       caller can show "创建失败".
 */

import QRCode from 'qrcode';
import { mkdir } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { MoltsPayClient } from 'moltspay';
import { createPayment, updatePayment } from './database';
import { generateId } from '../utils/crypto';
import type { Product } from '../types';

// Overall budget for an alipay payment. Mirrors the alipay challenge's
// pay_before window; the SDK polls until paid or this timeout elapses.
const ALIPAY_MAX_POLL_MS = 30 * 60 * 1000; // 30 minutes

/** Info surfaced once the payment link/QR is ready (before settlement). */
export interface AlipayPendingInfo {
  paymentId: string;
  tradeNo: string;
  paymentUrl?: string;
  shortenUrl?: string;
  qrcodePath?: string;
  expiresAt: Date;
}

export interface AlipayHandlers {
  /** Fired once the QR/link is ready. Resolving startAlipayPayment waits on this. */
  onPending: (info: AlipayPendingInfo) => void | Promise<void>;
  /** Fired async when payment succeeds. */
  onPaid: (paymentId: string, tradeNo: string) => void | Promise<void>;
  /** Fired async when payment fails / times out / is cancelled (after onPending). */
  onFailed: (paymentId: string, reason: string) => void | Promise<void>;
}

/**
 * Start an Alipay payment via the moltspay SDK.
 *
 * Resolves once the payment link/QR has been surfaced via `handlers.onPending`
 * (the caller can then return). Settlement is delivered asynchronously through
 * `handlers.onPaid` / `handlers.onFailed`. Rejects — WITHOUT firing onPending —
 * if the payment link could not be created (e.g. the 402 endpoint is
 * unreachable, the service is not offered, or the alipay rail isn't available).
 */
export async function startAlipayPayment(
  userId: string,
  serverId: string,
  product: Product,
  serviceEndpoint: string,
  priceCny: string,
  handlers: AlipayHandlers,
): Promise<void> {
  const paymentId = generateId();
  const expiresAt = new Date(Date.now() + ALIPAY_MAX_POLL_MS);
  // Service id the 402 server registered for this product. Falls back to the
  // product name for older configs that never set alipay_service_id.
  const service = product.alipay?.serviceId ?? product.name;
  const dir = join(homedir(), '.moltspay', 'alipay');

  // MoltsPayClient.pay() takes the server BASE url and appends `/execute`
  // itself. Strip any trailing `/execute` so a stored endpoint like
  // `http://host:8412/execute` doesn't become `/execute/execute` → 404.
  const serverUrl = serviceEndpoint.replace(/\/+execute\/?$/i, '');

  // Fresh client per payment so each gets a stable, unique alipay session id.
  const client = new MoltsPayClient({ alipaySessionId: `discord-${paymentId}` });

  let tradeNo = '';

  await new Promise<void>((resolve, reject) => {
    let pendingFired = false;

    client
      .pay(serverUrl, service, {}, {
        rail: 'alipay',
        timeoutMs: ALIPAY_MAX_POLL_MS,
        onPaymentPending: async (info) => {
          try {
            pendingFired = true;
            tradeNo = info.tradeNo;

            // Persist the payment record now that we have a tradeNo.
            createPayment({
              paymentId,
              discordUserId: userId,
              discordServerId: serverId,
              productId: product.id,
              amount: parseFloat(priceCny),
              currency: 'CNY',
              chain: 'alipay',
              status: 'pending',
              createdAt: new Date(),
              expiresAt,
            });

            // alipay-bot prints the link inside a markdown `[文字](url)`, and the
            // SDK's URL regex greedily captures the trailing `)` → the QR/link
            // 404s. Strip trailing markdown/punctuation before use.
            const cleanUrl = (u?: string): string | undefined =>
              u ? u.replace(/[)\]`>，。、\s]+$/u, '').trim() : undefined;
            const paymentUrl = cleanUrl(info.paymentUrl);
            const shortenUrl = cleanUrl(info.shortenUrl);

            // Render a QR from the scannable cashier URL (prefer https).
            let qrcodePath: string | undefined;
            const qrUrl = [shortenUrl, paymentUrl].find(
              (u) => u && /^https?:/i.test(u),
            ) || paymentUrl;
            if (qrUrl) {
              await mkdir(dir, { recursive: true });
              const qrFile = join(dir, `qr_${paymentId}.png`);
              try {
                await QRCode.toFile(qrFile, qrUrl, { width: 360, margin: 2 });
                qrcodePath = qrFile;
              } catch (e) {
                console.error('[Alipay] QR generation failed:', e);
              }
            }

            await handlers.onPending({
              paymentId,
              tradeNo,
              paymentUrl,
              shortenUrl,
              qrcodePath,
              expiresAt,
            });

            // Link is ready — let the caller return. Settlement continues in
            // the .then()/.catch() below.
            resolve();
          } catch (e) {
            // onPending machinery failed before we surfaced the link → treat as
            // a creation failure so the caller shows "创建失败".
            if (!pendingFired) reject(e as Error);
            else console.error('[Alipay] onPending handler error:', e);
          }
        },
      })
      .then(async () => {
        // pay() resolved → server returned the resource → payment succeeded.
        updatePayment(paymentId, { status: 'paid', txHash: tradeNo, paidAt: new Date() });
        await handlers.onPaid(paymentId, tradeNo);
      })
      .catch(async (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (!pendingFired) {
          // Failed before the link was ready → creation failure.
          reject(err instanceof Error ? err : new Error(msg));
        } else {
          // Failed after the QR was shown → timeout / cancel / settlement error.
          updatePayment(paymentId, { status: 'expired' });
          await handlers.onFailed(paymentId, msg);
        }
      });
  });
}
