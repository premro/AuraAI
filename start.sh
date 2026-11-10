#!/bin/bash
# LocalAI ChatBot Startup Script
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$PATH:/usr/local/bin:/opt/homebrew/bin"

echo "🚀 Starting LocalAI ChatBot..."
cd "$DIR" || exit 1
node server.js
