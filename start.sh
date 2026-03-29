#!/bin/bash
cd /home/juhe0092/clawd/projects/moltspay-discordbot
export NODE_OPTIONS=""
export PATH="/home/juhe0092/.nvm/versions/node/v22.22.0/bin:$PATH"
echo "" > bot.log
nohup npx tsx src/index.ts >> bot.log 2>&1 &
echo "Started with PID $!"
