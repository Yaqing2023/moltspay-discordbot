#!/bin/bash
cd /home/juhe0092/clawd/projects/moltspay-discordbot
export NODE_OPTIONS=""
export PATH="/home/juhe0092/.nvm/versions/node/v22.22.0/bin:$PATH"
echo "Node version: $(node -v)"
npm rebuild better-sqlite3
