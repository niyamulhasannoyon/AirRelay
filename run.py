#!/usr/bin/env python3
import os
import sys
import secrets
import socket
from pathlib import Path

# Ensure virtual environment is used if present
VENV_PYTHON = Path(__file__).resolve().parent / ".venv" / "bin" / "python3"
if VENV_PYTHON.exists() and sys.executable != str(VENV_PYTHON):
    os.execv(str(VENV_PYTHON), [str(VENV_PYTHON)] + sys.argv)

# Ensure signing secret is available
if not os.getenv("SECRET_KEY") and not os.getenv("SECRET_FILE"):
    os.environ["SECRET_KEY"] = secrets.token_hex(32)

import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware

from api.main import app as api_app
from api.signaling import router as signaling_router

BASE_DIR = Path(__file__).resolve().parent
WEB_DIR = BASE_DIR / "web"

server = FastAPI(title="AirRelay Server", docs_url=None, redoc_url=None)

# CORS middleware for local development flexibility
server.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount API sub-application at /api
server.mount("/api", api_app)

# Include WebSocket signaling at /ws
server.include_router(signaling_router)

# Serve web frontend files and SPA room routes
@server.api_route("/{full_path:path}", methods=["GET", "HEAD"])
async def serve_frontend(full_path: str):
    # Strip leading slash
    clean_path = full_path.lstrip("/")
    target = WEB_DIR / clean_path

    # If it is a real static file in web/, serve it directly
    if clean_path and target.is_file():
        # Correct content-type for web manifest and service worker
        media_type = None
        if target.name.endswith(".webmanifest"):
            media_type = "application/manifest+json"
        elif target.name.endswith(".js"):
            media_type = "application/javascript"
        elif target.name.endswith(".css"):
            media_type = "text/css"
        return FileResponse(target, media_type=media_type)

    # For root `/` and any SPA room paths (e.g. `/abc-def-ghi`), serve index.html
    index_file = WEB_DIR / "index.html"
    return FileResponse(index_file, media_type="text/html")


def get_local_ip() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.5)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


def main():
    port = int(os.getenv("PORT", "8080"))
    local_ip = get_local_ip()

    print("\n" + "=" * 62)
    print(" 🚀 AirRelay P2P File Sharing Server is running!")
    print("=" * 62)
    print(f" 💻 Local:    http://localhost:{port}")
    print(f" 📱 Network:  http://{local_ip}:{port}")
    print("-" * 62)
    print(" Open the link on any device or scan the QR code to connect.")
    print(" Press Ctrl+C to stop the server.")
    print("=" * 62 + "\n")

    uvicorn.run(server, host="0.0.0.0", port=port, ws_max_size=65536, log_level="info")


if __name__ == "__main__":
    main()
