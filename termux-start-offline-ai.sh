#!/data/data/com.termux/files/usr/bin/bash
set -u

ROOT="$HOME/llama.cpp"
SERVER="$ROOT/build/bin/llama-server"
MODEL="$ROOT/models/Qwen3-0.6B-Q4_K_M.gguf"
HOST="127.0.0.1"
PORT="8080"
BRIDGE_PORT="8081"
BRIDGE_SCRIPT="$HOME/termux-offline-ai-bridge.js"
LOG="$HOME/thinkora-offline-ai.log"
BRIDGE_LOG="$HOME/thinkora-offline-ai-bridge.log"
PIDFILE="$HOME/thinkora-offline-ai.pid"
BRIDGE_PIDFILE="$HOME/thinkora-offline-ai-bridge.pid"

if [ ! -x "$SERVER" ]; then
  echo "ERROR: llama-server not found or not executable: $SERVER"
  exit 1
fi

if [ ! -f "$MODEL" ]; then
  echo "ERROR: Qwen model not found: $MODEL"
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: Node.js is required for the Offline AI browser bridge. Install it with: pkg install nodejs"
  exit 1
fi

if [ ! -f "$BRIDGE_SCRIPT" ]; then
  echo "ERROR: Offline AI bridge script not found: $BRIDGE_SCRIPT"
  exit 1
fi

if ! curl -fsS --max-time 2 "http://$HOST:$PORT/health" >/dev/null 2>&1; then
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

  READY=0
  for _ in $(seq 1 30); do
    if curl -fsS --max-time 2 "http://$HOST:$PORT/health" >/dev/null 2>&1; then
      READY=1
      break
    fi
    sleep 1
  done

  if [ "$READY" -ne 1 ]; then
    echo "ERROR: Offline AI did not become ready within 30 seconds."
    echo "Last log lines:"
    tail -n 30 "$LOG" 2>/dev/null || true
    exit 1
  fi
fi

if curl -fsS --max-time 2 "http://$HOST:$BRIDGE_PORT/health" >/dev/null 2>&1; then
  echo "Thinkora Offline AI browser bridge is already running on http://$HOST:$BRIDGE_PORT"
  echo "READY: Thinkora Offline AI is running on http://$HOST:$PORT with bridge http://$HOST:$BRIDGE_PORT"
  exit 0
fi

if [ -f "$BRIDGE_PIDFILE" ]; then
  OLD_BRIDGE_PID="$(cat "$BRIDGE_PIDFILE" 2>/dev/null || true)"
  if [ -n "$OLD_BRIDGE_PID" ] && kill -0 "$OLD_BRIDGE_PID" 2>/dev/null; then
    echo "Offline AI bridge is already running (PID $OLD_BRIDGE_PID), but health proxy is not responding yet."
    echo "Check: tail -f $BRIDGE_LOG"
    exit 0
  fi
  rm -f "$BRIDGE_PIDFILE"
fi

echo "Starting Thinkora Offline AI browser bridge..."
nohup node "$BRIDGE_SCRIPT" >"$BRIDGE_LOG" 2>&1 &
BRIDGE_PID=$!
echo "$BRIDGE_PID" > "$BRIDGE_PIDFILE"
echo "Started Offline AI bridge (PID $BRIDGE_PID)."
echo "Bridge log: $BRIDGE_LOG"

for _ in $(seq 1 10); do
  if curl -fsS --max-time 2 "http://$HOST:$BRIDGE_PORT/health" >/dev/null 2>&1; then
    echo "READY: Thinkora Offline AI is running on http://$HOST:$PORT with browser bridge http://$HOST:$BRIDGE_PORT"
    exit 0
  fi
  sleep 1
done

echo "ERROR: Offline AI browser bridge did not become ready within 10 seconds."
echo "Last bridge log lines:"
tail -n 30 "$BRIDGE_LOG" 2>/dev/null || true
exit 1
