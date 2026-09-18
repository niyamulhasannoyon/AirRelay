#!/usr/bin/env bash
set -e

# Determine target listening port (Render, Heroku, Cloud Run set $PORT; default to 80)
TARGET_PORT="${PORT:-80}"

echo "============================================================"
echo " 🚀 Starting AirRelay Containerized Stack"
echo " 🌐 Target External Port: ${TARGET_PORT}"
echo "============================================================"

# Dynamically bind Nginx to the expected container port
if [ -f /etc/nginx/http.d/default.conf ]; then
  echo "==> Configuring Nginx to listen on port ${TARGET_PORT}..."
  sed -i "s/listen [0-9]*;/listen ${TARGET_PORT};/g" /etc/nginx/http.d/default.conf
fi

# Ensure SECRET_KEY is set (auto-generate ephemeral if not provided)
if [ -z "$SECRET_KEY" ] && [ -z "$SECRET_FILE" ]; then
  echo "==> SECRET_KEY not provided. Generating secure ephemeral key..."
  export SECRET_KEY=$(python3 -c 'import secrets; print(secrets.token_hex(32))')
fi

# Handle graceful shutdown on container stop
cleanup() {
  echo "==> Container stopping: terminating Uvicorn and Nginx..."
  kill -TERM "$UVICORN_PID" "$NGINX_PID" 2>/dev/null || true
  wait "$UVICORN_PID" 2>/dev/null || true
  wait "$NGINX_PID" 2>/dev/null || true
  exit 0
}
trap cleanup SIGTERM SIGINT SIGHUP

# Start FastAPI / Uvicorn backend on internal loopback port 8000
echo "==> Starting FastAPI signaling backend on 127.0.0.1:8000..."
python3 -m uvicorn api.main:app --host 127.0.0.1 --port 8000 --ws-max-size 65536 &
UVICORN_PID=$!

# Start Nginx reverse proxy on 0.0.0.0:TARGET_PORT
echo "==> Starting Nginx frontend on 0.0.0.0:${TARGET_PORT}..."
nginx -g "daemon off;" &
NGINX_PID=$!

# Wait for either process to exit. If either fails, container terminates cleanly.
wait -n "$UVICORN_PID" "$NGINX_PID"
