import os
import csv
import io
import json
import time
import hmac
import jwt
from datetime import datetime, timezone
from typing import Optional, Dict, Any
from fastapi import APIRouter, Header, HTTPException, Query, status, Depends
from fastapi.responses import Response
from pydantic import BaseModel

from api.signaling import _REGISTRY


# Admin Security Configuration
ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "airrelay_admin")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "AirRelay@Admin#2026!Secure")
ADMIN_JWT_SECRET = os.getenv("ADMIN_JWT_SECRET") or os.getenv("SECRET_KEY", "airrelay_admin_insecure_default_secret_key_change_in_prod")
JWT_ALGORITHM = "HS256"
JWT_EXPIRATION_SECONDS = 86400  # 24 hours


router = APIRouter()


# -----------------------------------------------------------------------------------------
# Request Models
# -----------------------------------------------------------------------------------------

class LoginRequest(BaseModel):
    username: str
    password: str


class KickRequest(BaseModel):
    reason: Optional[str] = "Disconnected by administrator"


class CloseRoomRequest(BaseModel):
    reason: Optional[str] = "Room terminated by administrator"


class BroadcastRequest(BaseModel):
    message: str
    room_id: Optional[str] = None
    level: Optional[str] = "info"  # "info", "warning", "danger"


# -----------------------------------------------------------------------------------------
# Authentication Helpers
# -----------------------------------------------------------------------------------------

def create_admin_token() -> str:
    payload = {
        "sub": "admin",
        "role": "admin",
        "exp": int(time.time()) + JWT_EXPIRATION_SECONDS,
        "iat": int(time.time()),
    }
    return jwt.encode(payload, ADMIN_JWT_SECRET, algorithm=JWT_ALGORITHM)


def require_admin(authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
    """Dependency ensuring caller possesses a valid admin JWT."""
    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Authorization header",
            headers={"WWW-Authenticate": "Bearer"},
        )

    parts = authorization.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authorization header format. Expected 'Bearer <token>'",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = parts[1]
    try:
        payload = jwt.decode(token, ADMIN_JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if payload.get("role") != "admin":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions",
            )
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Admin session expired. Please log in again.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except jwt.PyJWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid admin token",
            headers={"WWW-Authenticate": "Bearer"},
        )


# -----------------------------------------------------------------------------------------
# Admin Auth Routes
# -----------------------------------------------------------------------------------------

@router.post("/login")
async def admin_login(req: LoginRequest):
    """Authenticate administrator with username and password, and mint session JWT."""
    user_ok = hmac.compare_digest(req.username.strip().encode(), ADMIN_USERNAME.encode())
    pass_ok = hmac.compare_digest(req.password.encode(), ADMIN_PASSWORD.encode())
    if not (user_ok and pass_ok):
        _REGISTRY.add_event(
            "auth_fail",
            f"Failed admin login attempt for user '{req.username.strip()[:32]}'",
            severity="warning"
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
        )

    token = create_admin_token()
    is_default = (ADMIN_PASSWORD == "AirRelay@Admin#2026!Secure" and ADMIN_USERNAME == "airrelay_admin")

    _REGISTRY.add_event(
        "auth_success",
        f"Administrator '{ADMIN_USERNAME}' logged in successfully",
        severity="info"
    )

    return {
        "token": token,
        "token_type": "bearer",
        "expires_in": JWT_EXPIRATION_SECONDS,
        "username": ADMIN_USERNAME,
        "is_default_password": is_default,
    }


@router.get("/verify")
async def admin_verify(user: Dict[str, Any] = Depends(require_admin)):
    """Verify validity of current admin token."""
    is_default = (ADMIN_PASSWORD == "AirRelay@Admin#2026!Secure" and ADMIN_USERNAME == "airrelay_admin")
    return {
        "valid": True,
        "role": user.get("role", "admin"),
        "username": ADMIN_USERNAME,
        "is_default_password": is_default,
    }


# -----------------------------------------------------------------------------------------
# Telemetry & Overview Routes
# -----------------------------------------------------------------------------------------

@router.get("/overview")
async def admin_overview(_user: Dict[str, Any] = Depends(require_admin)):
    """Get high-level system telemetry, active counts, resource usage, and charts."""
    metrics = _REGISTRY.get_server_metrics()
    metrics["is_default_password"] = (ADMIN_PASSWORD == "AirRelay@Admin#2026!Secure" and ADMIN_USERNAME == "airrelay_admin")
    metrics["admin_username"] = ADMIN_USERNAME
    return metrics


# -----------------------------------------------------------------------------------------
# Peer Inspection & Management
# -----------------------------------------------------------------------------------------

@router.get("/peers")
async def admin_list_peers(
    search: Optional[str] = Query(None, description="Search by peer ID, name, IP, or room"),
    status_filter: Optional[str] = Query(None, alias="status", description="Filter: all, active, idle, stale, disconnected"),
    role_filter: Optional[str] = Query(None, alias="role", description="Filter: all, host, guest"),
    os_filter: Optional[str] = Query(None, alias="os", description="Filter by OS name"),
    scope: str = Query("all", description="Scope: active, history, or all"),
    limit: int = Query(200, ge=1, le=1000),
    _user: Dict[str, Any] = Depends(require_admin),
):
    """List peers with comprehensive filtering, search, and activity state."""
    active_peers = _REGISTRY.get_active_peers()
    history_peers = _REGISTRY.get_session_history(limit=limit)

    if scope == "active":
        combined = active_peers
    elif scope == "history":
        combined = history_peers
    else:
        # 'all': active peers first, then history (dedup by session_id)
        seen_sessions = set()
        combined = []
        for p in active_peers:
            seen_sessions.add(p["session_id"])
            combined.append(p)
        for p in history_peers:
            if p["session_id"] not in seen_sessions:
                combined.append(p)

    # Filtering
    filtered = []
    search_lower = search.lower().strip() if search else None

    for p in combined:
        if status_filter and status_filter != "all" and p["status"] != status_filter:
            continue
        if role_filter and role_filter != "all" and p["role"] != role_filter:
            continue
        if os_filter and os_filter != "all":
            if os_filter.lower() not in p["os"].lower():
                continue

        if search_lower:
            text_corpus = f"{p['peer_id']} {p['name']} {p['ip']} {p['room_id']} {p['os']} {p['browser']}".lower()
            if search_lower not in text_corpus:
                continue

        filtered.append(p)

    return {
        "total": len(filtered),
        "active_count": len(active_peers),
        "history_count": len(history_peers),
        "peers": filtered[:limit],
    }


@router.get("/peers/{peer_id}")
async def admin_get_peer(
    peer_id: str,
    _user: Dict[str, Any] = Depends(require_admin),
):
    """Retrieve detailed diagnostic record for a specific peer."""
    details = _REGISTRY.get_peer_details(peer_id)
    if not details:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Peer with id '{peer_id}' not found in active sessions or recent history",
        )
    return details


@router.post("/peers/{peer_id}/kick")
async def admin_kick_peer(
    peer_id: str,
    req: Optional[KickRequest] = None,
    _user: Dict[str, Any] = Depends(require_admin),
):
    """Force-disconnect a peer."""
    reason = req.reason if req and req.reason else "Disconnected by administrator"
    success = await _REGISTRY.kick_peer(peer_id, reason=reason)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Peer '{peer_id}' is not currently connected",
        )
    return {"success": True, "peer_id": peer_id, "message": f"Peer kicked: {reason}"}


# -----------------------------------------------------------------------------------------
# Rooms Management
# -----------------------------------------------------------------------------------------

@router.get("/rooms")
async def admin_list_rooms(_user: Dict[str, Any] = Depends(require_admin)):
    """List active rooms with host details and participant rosters."""
    rooms = _REGISTRY.get_rooms_summary()
    return {
        "total_rooms": len(rooms),
        "rooms": rooms,
    }


@router.post("/rooms/{room_id}/close")
async def admin_close_room(
    room_id: str,
    req: Optional[CloseRoomRequest] = None,
    _user: Dict[str, Any] = Depends(require_admin),
):
    """Terminate all active connections belonging to a room."""
    reason = req.reason if req and req.reason else "Room terminated by administrator"
    kicked_count = await _REGISTRY.close_room(room_id, reason=reason)
    return {
        "success": True,
        "room_id": room_id,
        "kicked_count": kicked_count,
        "message": f"Room '{room_id}' closed. {kicked_count} participant(s) disconnected.",
    }


# -----------------------------------------------------------------------------------------
# System Broadcast & Audit Events
# -----------------------------------------------------------------------------------------

@router.post("/broadcast")
async def admin_broadcast(
    req: BroadcastRequest,
    _user: Dict[str, Any] = Depends(require_admin),
):
    """Broadcast an administrative banner notification to peers."""
    if not req.message.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Broadcast message cannot be empty",
        )
    recipients = await _REGISTRY.broadcast_message(
        message=req.message.strip(),
        room_id=req.room_id,
        level=req.level or "info",
    )
    return {
        "success": True,
        "recipients_count": recipients,
        "message": f"Broadcast delivered to {recipients} peer(s).",
    }


@router.get("/events")
async def admin_get_events(
    limit: int = Query(100, ge=1, le=500),
    _user: Dict[str, Any] = Depends(require_admin),
):
    """Retrieve recent chronological audit event log."""
    return {
        "events": _REGISTRY.get_audit_events(limit=limit),
    }


# -----------------------------------------------------------------------------------------
# Data Export (JSON & CSV)
# -----------------------------------------------------------------------------------------

@router.get("/export")
async def admin_export(
    export_format: str = Query("json", alias="format", pattern="^(json|csv)$"),
    scope: str = Query("all", pattern="^(active|history|all)$"),
    _user: Dict[str, Any] = Depends(require_admin),
):
    """Export peer connection records as JSON or CSV."""
    active_peers = _REGISTRY.get_active_peers()
    history_peers = _REGISTRY.get_session_history(limit=500)

    if scope == "active":
        data = active_peers
    elif scope == "history":
        data = history_peers
    else:
        seen = set()
        data = []
        for p in active_peers:
            seen.add(p["session_id"])
            data.append(p)
        for p in history_peers:
            if p["session_id"] not in seen:
                data.append(p)

    timestamp_slug = datetime.now(tz=timezone.utc).strftime("%Y%m%d_%H%M%S")

    if export_format == "csv":
        output = io.StringIO()
        fieldnames = [
            "session_id", "peer_id", "name", "role", "room_id",
            "ip", "ip_type", "os", "browser", "device", "status",
            "connected_at", "duration_seconds", "signals_sent",
            "signals_received", "bytes_relayed", "disconnect_reason", "close_code"
        ]
        writer = csv.DictWriter(output, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        for row in data:
            writer.writerow(row)

        csv_content = output.getvalue()
        return Response(
            content=csv_content,
            media_type="text/csv",
            headers={
                "Content-Disposition": f"attachment; filename=airrelay_peers_{timestamp_slug}.csv"
            }
        )

    # JSON export
    export_payload = {
        "generated_at": datetime.now(tz=timezone.utc).isoformat(),
        "total_records": len(data),
        "server_metrics": _REGISTRY.get_server_metrics(),
        "sessions": data,
    }
    return Response(
        content=json.dumps(export_payload, indent=2),
        media_type="application/json",
        headers={
            "Content-Disposition": f"attachment; filename=airrelay_peers_{timestamp_slug}.json"
        }
    )
