#!/bin/bash
cd /home/juhe0092/clawd/projects/moltspay-discordbot
export PATH="/home/juhe0092/.nvm/versions/node/v22.22.0/bin:$PATH"
# 512MB heap limit to catch leaks early instead of ballooning to 4GB and OOMing
export NODE_OPTIONS="--max-old-space-size=512"

# Kill existing processes
pkill -9 -f "moltspay-discordbot/dist" 2>/dev/null
fuser -k 3402/tcp 2>/dev/null
sleep 5

# Start bot
echo "" > bot.log
nohup node dist/index.js >> bot.log 2>&1 &
echo "Started with PID $!"
sleep 4
cat bot.log
