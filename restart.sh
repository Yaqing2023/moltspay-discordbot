#!/bin/bash
cd /home/juhe0092/clawd/projects/moltspay-discordbot
export PATH="/home/juhe0092/.nvm/versions/node/v22.22.0/bin:$PATH"
export NODE_OPTIONS=""

# Kill existing processes
pkill -9 -f "moltspay-discordbot/dist" 2>/dev/null
fuser -k 3402/tcp 2>/dev/null
sleep 5

# Start bot
# --max-old-space-size caps the V8 heap as a safety net: if a leak ever returns
# the process dies fast (and can be auto-restarted) instead of ballooning to 4GB+.
echo "" > bot.log
nohup node --max-old-space-size=512 dist/index.js >> bot.log 2>&1 &
echo "Started with PID $!"
sleep 4
cat bot.log
