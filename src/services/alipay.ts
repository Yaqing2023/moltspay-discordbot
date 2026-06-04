/**
 * Alipay Payment Service - handles Alipay AI 收 via alipay-bot CLI
 * 
 * Flow:
 * 1. Get 402 Payment-Needed from server
 * 2. alipay-bot payment-intent → session handshake
 * 3. alipay-bot check-wallet → verify wallet opened
 * 4. Save Payment-Needed to temp file
 * 5. alipay-bot 402-buyer-pay → get payment URL + tradeNo
 * 6. Poll payment status until paid/timeout
 * 7. Return result
 */

import { spawn } from 'child_process';
import QRCode from 'qrcode';
import { mkdir, writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { createPayment, updatePayment, getPayment } from './database';
import { generateId } from '../utils/crypto';
import type { PaymentSession, Product } from '../types';

const ALIPAY_POLL_INTERVAL_MS = 5000; // 5 seconds
const ALIPAY_MAX_POLL_MS = 30 * 60 * 1000; // 30 minutes (matches pay_before)
// Hard cap on poll iterations as a safety net against runaway recursion
// (e.g. if the elapsed-time guard ever fails or the CLI keeps erroring).
const ALIPAY_MAX_POLLS = Math.ceil(ALIPAY_MAX_POLL_MS / ALIPAY_POLL_INTERVAL_MS); // 360

// Allowed env vars for alipay-bot
const ALLOWED_ENV = new Set([
  'AIPAY_OUTPUT_CHANNEL',
  'AIPAY_SESSION_ID',
  'AIPAY_FRAMEWORK',
  'AIPAY_MODEL',
  'AIPAY_OS',
  'PATH',
  'HOME',
]);

function filterEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(env).filter(([k]) => ALLOWED_ENV.has(k)),
  ) as NodeJS.ProcessEnv;
}

export interface AlipayPaymentResult {
  paymentId: string;
  tradeNo: string;
  paymentUrl?: string;
  shortenUrl?: string;
  qrcodePath?: string;
  expiresAt: Date;
}

interface CliResult {
  exitCode: number;
  lines: string[];
}

/**
 * Run alipay-bot CLI command
 */
function runCli(args: string[], opts?: { env?: NodeJS.ProcessEnv }): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const lines: string[] = [];
    const child = spawn('alipay-bot', args, {
      env: { ...filterEnv(process.env), ...(opts?.env ?? {}) },
    });

    let stdoutBuf = '';
    let stderrBuf = '';

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString('utf-8');
      let nl: number;
      while ((nl = stdoutBuf.indexOf('\n')) !== -1) {
        const line = stdoutBuf.slice(0, nl).trim();
        if (line) lines.push(line);
        stdoutBuf = stdoutBuf.slice(nl + 1);
      }
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString('utf-8');
      let nl: number;
      while ((nl = stderrBuf.indexOf('\n')) !== -1) {
        const line = stderrBuf.slice(0, nl).trim();
        if (line) lines.push(line);
        stdoutBuf = stderrBuf.slice(nl + 1);
      }
    });

    child.on('error', reject);
    child.on('close', (code) => resolve({ exitCode: code ?? 1, lines }));
  });
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Markers that mean the wallet genuinely needs setup (user action required).
 * Anything else with code !== 200 is treated as a transient gateway hiccup.
 */
const WALLET_SETUP_NEEDED = /未开通|未开启|未授权|等待授权|NOT[_\s-]*(OPEN|BOUND|SET)|NEEDS?[_\s-]*SETUP/i;

/**
 * Verify the Alipay wallet is opened & ready, with retry on transient failures.
 *
 * The Alipay gateway (aigw.alipay.com) intermittently returns
 * `{code:500, message:"查询失败"}` (~1 in 4 calls). The wallet itself is fine —
 * it's a flaky network query — so we retry with backoff. Only a genuine
 * "未开通/未授权" response (real user setup needed) fails fast without retry.
 */
async function checkWalletReady(maxRetries = 3): Promise<void> {
  let lastMsg = 'no output';
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) await sleep(800 * attempt); // backoff: 0.8s, 1.6s, 2.4s

    const walletCheck = await runCli(['check-wallet']);
    const walletText = walletCheck.lines.join('\n').trim();

    let walletJson: { code?: number; message?: string; reason?: string };
    try {
      walletJson = JSON.parse(walletText);
    } catch {
      lastMsg = walletText || 'unparseable output';
      continue; // unparseable → treat as transient, retry
    }

    if (walletJson.code === 200) return; // ready

    lastMsg = walletJson.message || walletText;
    // Genuine setup-needed → no point retrying, surface actionable error.
    if (WALLET_SETUP_NEEDED.test(lastMsg)) {
      throw new Error(`Alipay wallet not ready: ${lastMsg}`);
    }
    // Otherwise transient ("查询失败" / gateway error) → loop & retry.
  }
  throw new Error(`Alipay wallet check failed after ${maxRetries + 1} attempts: ${lastMsg}`);
}

/**
 * Parse tradeNo from CLI output (32-digit number)
 */
function parseTradeNo(lines: string[]): string | null {
  for (const line of lines) {
    const labeled = line.match(/trade[_-]?no["'\s:=]+(\d{32})/i);
    if (labeled) return labeled[1];
    const bare = line.match(/\b(\d{32})\b/);
    if (bare) return bare[1];
  }
  return null;
}

/**
 * Parse qrcode image path from CLI output (MEDIA: line)
 */
function parseQrcodePath(lines: string[]): string | null {
  for (const line of lines) {
    // Format 1: MEDIA: /path/to/xxx.png
    const m1 = line.match(/^MEDIA:\s*(.+\.png)$/i);
    if (m1) return m1[1].trim();
    // Format 2: ![图片](/path/to/xxx.png) - Markdown image
    const m2 = line.match(/^!\[.*?\]\((.+\.png)\)$/i);
    if (m2) return m2[1].trim();
  }
  return null;
}

/**
 * Parse payment URL from CLI output
 */
function parsePaymentUrl(lines: string[]): { paymentUrl?: string; shortenUrl?: string } {
  let paymentUrl: string | undefined;
  let shortenUrl: string | undefined;
  for (const line of lines) {
    // Skip markdown image lines - those are qrcode paths, not payment URLs
    if (/^!\[.*?\]\(/.test(line)) continue;
    const m = line.match(/(alipays?:\/\/\S+|https?:\/\/\S+)/i);
    if (!m) continue;
    const url = m[1].replace(/[`)\]]+$/, ''); // strip trailing markdown/closing chars
    // Skip 404/invalid URLs
    if (/render\.alipay\.com/.test(url)) continue;
    if (/short|qr\.alipay|surl|\/s\//i.test(line) && !shortenUrl) shortenUrl = url;
    else if (!paymentUrl) paymentUrl = url;
  }
  if (!paymentUrl && shortenUrl) paymentUrl = shortenUrl;
  return { paymentUrl, shortenUrl };
}

/**
 * Create alipay payment session and get payment URL
 */
export async function createAlipayPayment(
  userId: string,
  serverId: string,
  product: Product,
  serviceEndpoint: string,
  priceCny: string,
): Promise<AlipayPaymentResult> {
  const paymentId = generateId();
  const expiresAt = new Date(Date.now() + ALIPAY_MAX_POLL_MS);
  const sessionId = `discord-${paymentId}`;

  // Step 0: Trigger 402 to get Payment-Needed header
  const res = await fetch(serviceEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept-Payment-Rail': 'alipay',
    },
    body: JSON.stringify({ service: product.name, params: {} }),
  });

  if (res.status !== 402) {
    throw new Error(`Expected 402, got ${res.status}`);
  }

  // Get Payment-Needed header
  const paymentNeeded = res.headers.get('payment-needed');
  if (!paymentNeeded) {
    throw new Error('Server did not return Payment-Needed header for alipay');
  }

  // Create payment session in DB
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

  // Step 1: payment-intent
  await runCli([
    'payment-intent',
    '--session-id', sessionId,
    '--intent-summary', `购买 ${product.name}`,
    '--framework', 'openclaw',
  ]);

  // Step 2: check-wallet (retries transient "查询失败" gateway errors)
  await checkWalletReady();

  // Step 3: Save Payment-Needed to temp file
  const dir = join(homedir(), '.moltspay', 'alipay');
  await mkdir(dir, { recursive: true });
  const challengeFile = join(dir, `402_${paymentId}.txt`);
  await writeFile(challengeFile, paymentNeeded, 'utf-8');

  // Step 4: 402-buyer-pay
  const payResult = await runCli([
    '402-buyer-pay',
    '-f', challengeFile,
    '-r', serviceEndpoint,
    '-s', sessionId,
    '-i', `购买 ${product.name}`,
    '-w', 'openclaw',
  ]);

  // Parse tradeNo and paymentUrl
  const tradeNo = parseTradeNo(payResult.lines);
  if (!tradeNo) {
    // Clean up
    await unlink(challengeFile).catch(() => {});
    throw new Error(`alipay-bot did not return tradeNo. Output: ${payResult.lines.join('\n')}`);
  }

  const { paymentUrl, shortenUrl } = parsePaymentUrl(payResult.lines);
  let qrcodePath = parseQrcodePath(payResult.lines);

  // Clean up challenge file
  await unlink(challengeFile).catch(() => {});

  if (!paymentUrl && !qrcodePath) {
    throw new Error(`alipay-bot did not return payment URL or qrcode. Output: ${payResult.lines.join('\n')}`);
  }

  // This alipay-bot version no longer emits a MEDIA: qrcode path, so render the
  // QR ourselves from the payment URL (prefer the scannable https cashier link).
  if (!qrcodePath && paymentUrl) {
    const qrUrl = [shortenUrl, paymentUrl].find((u) => u && /^https?:/i.test(u)) || paymentUrl;
    const qrFile = join(dir, `qr_${paymentId}.png`);
    try {
      await QRCode.toFile(qrFile, qrUrl, { width: 360, margin: 2 });
      qrcodePath = qrFile;
    } catch (e) {
      console.error('[Alipay] QR generation failed:', e);
    }
  }

  return {
    paymentId,
    tradeNo,
    paymentUrl,
    shortenUrl,
    qrcodePath: qrcodePath || undefined,
    expiresAt,
  };
}

/**
 * Poll alipay payment status until confirmed or timeout
 */
export function startAlipayPolling(
  paymentId: string,
  tradeNo: string,
  serviceEndpoint: string,
  onPaid: (paymentId: string, tradeNo: string) => void,
  onExpired: (paymentId: string) => void,
): void {
  const startTime = Date.now();
  let pollCount = 0;

  const poll = async () => {
    pollCount++;
    // Stop on timeout OR hard poll-count cap, whichever comes first.
    if (Date.now() - startTime > ALIPAY_MAX_POLL_MS || pollCount > ALIPAY_MAX_POLLS) {
      updatePayment(paymentId, { status: 'expired' });
      onExpired(paymentId);
      return;
    }

    // Check if still pending
    const payment = getPayment(paymentId);
    if (!payment || payment.status !== 'pending') {
      return; // Already handled
    }

    try {
      const result = await runCli([
        '402-query-payment-status',
        '-t', tradeNo,
        '-r', serviceEndpoint,
      ]);

      const text = result.lines.join('\n').trim();

      // Check for success markers
      if (text.includes('支付状态成功') || text.includes('SUCCESS') || text.includes('"status": 200')) {
        updatePayment(paymentId, {
          status: 'paid',
          txHash: tradeNo,
          paidAt: new Date(),
        });
        onPaid(paymentId, tradeNo);
        return;
      }

      // Check for rejection
      if (text.includes('支付已取消') || text.includes('REJECTED') || text.includes('CANCELLED')) {
        updatePayment(paymentId, { status: 'failed' });
        onExpired(paymentId);
        return;
      }

      // Still pending, continue polling
      setTimeout(poll, ALIPAY_POLL_INTERVAL_MS);
    } catch (error) {
      console.error(`[AlipayPoller] Error for ${paymentId}:`, error);
      // Retry on error
      setTimeout(poll, ALIPAY_POLL_INTERVAL_MS);
    }
  };

  // Start polling after a short delay
  setTimeout(poll, 5000);
}
