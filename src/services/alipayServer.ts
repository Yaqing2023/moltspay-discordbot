/**
 * Alipay Cashier Server (in-process) — Option B of the 1.7.0 alipay rail.
 *
 * The bot hosts its OWN moltspay server (the "seller" side that holds the RSA2
 * merchant key and signs the 402 challenge). The bot's buyer side
 * (`alipay.ts` → MoltsPayClient.pay) then hits this local endpoint. Keeping
 * both sides in one process is the simplest deployable shape.
 *
 * This server is a pure cashier: the skill handlers are no-ops. Actual
 * fulfillment (assigning the Discord role) happens in the bot's onPaid
 * callback, not here.
 *
 * Config: `alipay/moltspay.services.json` (provider.alipay merchant block +
 * one service per alipay-priced product). Merchant cert paths are absolute.
 */

import { MoltsPayServer } from 'moltspay';
import { readFileSync } from 'fs';
import { join } from 'path';

// alipay/ lives at the project root (sibling of src/ and dist/). __dirname is
// src/services (tsx) or dist/services (built) — both resolve via ../../alipay.
const MANIFEST_PATH = join(__dirname, '..', '..', 'alipay', 'moltspay.services.json');
const DEFAULT_PORT = 8412;

let started = false;
let endpoint: string | null = null;

/** The local /execute endpoint of the in-process cashier (null until started). */
export function getAlipayEndpoint(): string | null {
  return endpoint;
}

/**
 * Start the in-process alipay cashier server. Idempotent. Returns the local
 * /execute endpoint, or null if startup failed (e.g. missing merchant cert) —
 * in which case the bot falls back to the per-server configured endpoint.
 */
export function startAlipayServer(): string | null {
  if (started) return endpoint;
  started = true;

  const port = parseInt(process.env.ALIPAY_SERVER_PORT || String(DEFAULT_PORT), 10);

  try {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8')) as {
      services: { id: string }[];
    };

    const server = new MoltsPayServer(MANIFEST_PATH, { port });
    for (const svc of manifest.services) {
      // No-op cashier handler — fulfillment is the bot's job (onPaid → role).
      server.skill(svc.id, async () => ({ ok: true }));
    }
    server.listen(port);

    endpoint = `http://127.0.0.1:${port}/execute`;
    console.log(
      `[AlipayServer] cashier listening on http://127.0.0.1:${port} ` +
        `(${manifest.services.length} services: ${manifest.services.map((s) => s.id).join(', ')})`,
    );
    return endpoint;
  } catch (e) {
    console.error('[AlipayServer] failed to start in-process cashier:', e);
    endpoint = null;
    return null;
  }
}
