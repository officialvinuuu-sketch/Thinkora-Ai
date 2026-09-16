#!/data/data/com.termux/files/usr/bin/bash
set -u

ROOT="$HOME/llama.cpp"
SERVER="$ROOT/build/bin/llama-server"
MODEL="$ROOT/models/Qwen3-0.6B-Q4_K_M.gguf"
HOST="127.0.0.1"
PORT="8080"
LOG="$HOME/thinkora-offline-ai.log"
PIDFILE="$HOME/thinkora-offline-ai.pid"

if [ ! -x "$SERVER" ]; then
  echo "ERROR: llama-server not found or not executable: $SERVER"
  exit 1
fi

if [ ! -f "$MODEL" ]; then
  echo "ERROR: Qwen model not found: $MODEL"
  exit 1
fi

if curl -fsS --max-time 2 "http://$HOST:$PORT/health" >/dev/null 2>&1; then
  echo "Thinkora Offline AI is already running on http://$HOST:$PORT"
  exit 0
fi

if [ -f "$PIDFILE" ]; then
  OLD_PID="$(cat "$PIDFILE" 2>/dev/null || true)"
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    echo "Offline AI process is already running (PID $OLD_PID), but health check is not ready yet."
    echo "Check: tail -f $LOG"
    exit 0
  fi
  rm -f "$PIDFILE"
fi

echo "Starting Thinkora Offline AI..."
nohup "$SERVER" \
  -m "$MODEL" \
  --host "$HOST" \
  --port "$PORT" \
  -c 2048 \
  >"$LOG" 2>&1 &

PID=$!
echo "$PID" > "$PIDFILE"

echo "Started llama-server (PID $PID)."
echo "Log: $LOG"
echo "Waiting for health endpoint..."

for _ in $(seq 1 30); do
  if curl -fsS --max-time 2 "http://$HOST:$PORT/health" >/dev/null 2>&1; then
    echo "READY: Thinkora Offline AI is running on http://$HOST:$PORT"
    exit 0
  fi
  sleep 1
done

echo "ERROR: Offline AI did not become ready within 30 seconds."
echo "Last log lines:"
tail -n 30 "$LOG" 2>/dev/null || true
exit 1
