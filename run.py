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
from fastapi.responses import FileResponse, RedirectResponse, Response
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

@server.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self'; "
        "connect-src 'self' ws: wss: stun: turn: turns:; worker-src 'self' blob:; "
        "frame-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; "
        "frame-ancestors 'self'"
    )
    response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "same-origin")
    return response

# Mount API sub-application at /api
server.mount("/api", api_app)

# Include WebSocket signaling at /ws
server.include_router(signaling_router)

STATIC_EXTENSIONS = {
    ".js", ".css", ".png", ".jpg", ".jpeg", ".svg", ".ico",
    ".woff", ".woff2", ".ttf", ".json", ".map", ".webmanifest"
}


def _serve_file(target: Path) -> FileResponse:
    media_type = None
    if target.name.endswith(".webmanifest"):
        media_type = "application/manifest+json"
    elif target.name.endswith(".js"):
        media_type = "application/javascript"
    elif target.name.endswith(".css"):
        media_type = "text/css"
    elif target.name.endswith(".svg"):
        media_type = "image/svg+xml"
    elif target.name.endswith(".json") or target.name.endswith(".map"):
        media_type = "application/json"
    elif target.name.endswith(".png"):
        media_type = "image/png"
    elif target.name.endswith(".ico"):
        media_type = "image/x-icon"
    elif target.name.endswith(".jpg") or target.name.endswith(".jpeg"):
        media_type = "image/jpeg"
    elif target.name.endswith(".woff2"):
        media_type = "font/woff2"
    elif target.name.endswith(".woff"):
        media_type = "font/woff"
    elif target.name.endswith(".ttf"):
        media_type = "font/ttf"
    return FileResponse(target, media_type=media_type)


# Serve web frontend files and SPA room routes
@server.api_route("/{full_path:path}", methods=["GET", "HEAD"])
async def serve_frontend(full_path: str):
    # Strip leading and trailing slashes for routing checks
    clean_path = full_path.strip("/")
    target = WEB_DIR / clean_path

    # Route /admin or /admin/ to web/admin/index.html
    if clean_path == "admin":
        if not full_path.endswith("/"):
            return RedirectResponse(url="/admin/", status_code=301)
        admin_index = WEB_DIR / "admin" / "index.html"
        if admin_index.is_file():
            return FileResponse(admin_index, media_type="text/html")

    # If it is a directory containing an index.html, serve that index
    if clean_path and target.is_dir() and (target / "index.html").is_file():
        if not full_path.endswith("/"):
            return RedirectResponse(url=f"/{clean_path}/", status_code=301)
        return FileResponse(target / "index.html", media_type="text/html")

    # If it is a real static file in web/, serve it directly
    if clean_path and target.is_file():
        return _serve_file(target)

    # Defensive asset resolution: if path contains static asset directories (/css/, /js/, /assets/),
    # resolve from WEB_DIR regardless of any room route prefix (e.g. /<room_id>/js/modules/script.js).
    for asset_prefix in ("css", "js", "assets"):
        marker = f"/{asset_prefix}/"
        if marker in f"/{clean_path}/":
            parts = clean_path.split("/")
            if asset_prefix in parts:
                idx = parts.index(asset_prefix)
                sub_path = "/".join(parts[idx:])
                fallback_target = WEB_DIR / sub_path
                if fallback_target.is_file():
                    return _serve_file(fallback_target)

    # If sw.js was requested under any sub-path, serve the root sw.js
    if clean_path.endswith("sw.js"):
        sw_file = WEB_DIR / "sw.js"
        if sw_file.is_file():
            return _serve_file(sw_file)

    # For known static asset extensions that do not exist, return 404 instead of
    # falling through to index.html (which breaks browser script/CSS MIME loading).
    if target.suffix in STATIC_EXTENSIONS:
        return Response(status_code=404)

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
