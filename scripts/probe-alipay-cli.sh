#!/bin/bash
# probe-alipay-cli.sh — measure where alipay-bot's per-call latency goes.
#
# The pay402 timing log showed each `alipay-bot <step>` subprocess taking
# seconds–tens-of-seconds. This isolates the FIXED CLI cold-start cost (pure,
# local `--version`) from the per-step WORK (gateway/agent round-trips), so we
# know how much is "the CLI is just slow to boot" vs "the step itself is slow".
#
# It mirrors the SDK's invocation environment (moltspay/src/client/alipay/cli.ts
# filterEnv): only AIPAY_* + PATH/HOME are passed through.
#
# SAFE probes only: --version, check-wallet, payment-intent. It NEVER runs
# 402-buyer-pay (that creates a real Alipay trade/charge).
#
# Usage: bash scripts/probe-alipay-cli.sh [runs]   (default 3 runs per step)

set -u
RUNS="${1:-3}"
BIN="$(command -v alipay-bot || echo "$HOME/.local/bin/alipay-bot")"
FRAMEWORK="${AIPAY_FRAMEWORK:-openclaw}"
SESSION="probe-$$"

if [ ! -x "$BIN" ]; then
  echo "alipay-bot not found (looked at: $BIN)"; exit 1
fi
echo "binary : $BIN"
echo "version: $("$BIN" --version 2>&1 | head -1)"
echo "runs   : $RUNS per step"
echo "env    : PATH/HOME + AIPAY_SESSION_ID=$SESSION AIPAY_FRAMEWORK=$FRAMEWORK"
echo

# Run argv under the SDK's filtered env; print wall-clock ms. Captures the
# child's output to a temp file (we only care about timing + exit code here).
time_call() {
  local label="$1"; shift
  local out; out="$(mktemp)"
  local min=-1 sum=0 ms
  printf '%-22s' "$label"
  for _ in $(seq 1 "$RUNS"); do
    local s e
    s=$(date +%s%3N)
    env -i PATH="$PATH" HOME="$HOME" \
        AIPAY_SESSION_ID="$SESSION" AIPAY_FRAMEWORK="$FRAMEWORK" \
        "$BIN" "$@" >"$out" 2>&1
    local code=$?
    e=$(date +%s%3N)
    ms=$((e - s))
    printf ' %6dms(rc=%d)' "$ms" "$code"
    sum=$((sum + ms))
    if [ "$min" -lt 0 ] || [ "$ms" -lt "$min" ]; then min=$ms; fi
  done
  printf '   | min=%dms avg=%dms\n' "$min" $((sum / RUNS))
  rm -f "$out"
}

echo "=== FIXED cold-start (pure local, no network) ==="
time_call "--version" --version
time_call "--help" --help

echo
echo "=== step WORK = cold-start + gateway/agent round-trip ==="
# check-wallet: read-only wallet status (the SDK runs it with no extra args).
time_call "check-wallet" check-wallet
# payment-intent: session handshake; --intent-summary is mandatory. No charge.
time_call "payment-intent" payment-intent \
  --session-id "$SESSION" --intent-summary "probe 1 CNY" --framework "$FRAMEWORK"

echo
echo "NOTE: 402-buyer-pay is intentionally NOT probed (it creates a real trade)."
echo "Interpretation: (step WORK avg) - (--version avg) ≈ the gateway/agent time;"
echo "the --version avg itself is the unavoidable per-spawn cold start."
