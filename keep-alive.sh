#!/bin/bash
# Auto-restart both the keep-alive watcher and the server
# This script is designed to be called from multiple layers

LOG=/tmp/quiz-keepalive.log

while true; do
  # Check if server is alive
  if ! lsof -ti:8000 >/dev/null 2>&1; then
    echo "[$(date)] Server down, starting..." >> $LOG
    cd /workspace/quiz-app && nohup python3 -m uvicorn server:app --host 0.0.0.0 --port 8000 >> /tmp/quiz-server.log 2>&1 &
    sleep 5
    if lsof -ti:8000 >/dev/null 2>&1; then
      echo "[$(date)] Server started OK" >> $LOG
    else
      echo "[$(date)] Server failed to start!" >> $LOG
    fi
  fi
  sleep 15
done
