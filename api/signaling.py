import os
import re
import time
import json
import uuid
import socket
import asyncio
import logging
import platform
import resource
import ipaddress
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict, List, Optional, Set, Any
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status

logger = logging.getLogger("filesync.signaling")


# =========================================================================================
# WebRTC signaling
#
# A thin WebSocket relay between peers. Each connected client claims a peer id and can ask
# the server to forward arbitrary "signal" payloads (SDP offers/answers, ICE candidates)
# to another peer by id. The server treats payloads as opaque JSON.
#
# Scope: single-worker, in-memory. Horizontal scaling would need cross-worker pub/sub (e.g.
# Redis) so a 'signal' message landing on worker A can find its target peer on worker B.
# The current FileSync Dockerfile starts a single uvicorn worker, so in-memory is sufficient.
# =========================================================================================

# id charset matches what /api/uuid produces (UUIDv4 with dashes) plus generic alphanumeric
# ids so manually-chosen ids also work. Length-bounded to make the registry cheap.
_PEER_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")

# Hard limits
_MAX_PAYLOAD_BYTES = 32 * 1024           # 32 KiB per incoming message
_MAX_MSG_PER_SECOND = 100                # per-connection rate limit (all message types)
_PAIR_WINDOW_SECONDS = 10.0              # sliding-window length for per-target rate limit
_PAIR_MAX_PER_WINDOW = 50                # max signal msgs from one source to one target per window
_REGISTER_TIMEOUT_SECONDS = 10.0         # first message must arrive within this window
_IDLE_TIMEOUT_SECONDS = 30.0             # close if no message at all (clients ping every 10s)
_MAX_CONNECTIONS = int(os.getenv("FILESYNC_MAX_WS", "10000"))

# Custom WebSocket close codes (1000-2999 reserved by RFC; 4000-4999 free for app use)
_CLOSE_INVALID_REGISTER = 4400
_CLOSE_UNAVAILABLE_ID   = 4409
_CLOSE_INVALID_MESSAGE  = 4401
_CLOSE_RATE_LIMITED     = 4429
_CLOSE_IDLE             = 4408
_CLOSE_OVERLOADED       = 4503
_CLOSE_ADMIN_KICK       = 4403


# =========================================================================================
# Client Metadata & Device Inspection Helpers
# =========================================================================================

def _extract_client_ip(ws: WebSocket) -> str:
    """Extract real client IP address resolving reverse proxy headers."""
    if ws and ws.headers:
        xff = ws.headers.get("x-forwarded-for")
        if xff:
            return xff.split(",")[0].strip()
        x_real = ws.headers.get("x-real-ip")
        if x_real:
            return x_real.strip()
    if ws and ws.client and ws.client.host:
        return ws.client.host
    return "127.0.0.1"


def _classify_ip_network(ip_str: str) -> str:
    """Classify IP address into Loopback, LAN / Private, or Public / WAN."""
    try:
        ip_obj = ipaddress.ip_address(ip_str)
        if ip_obj.is_loopback:
            return "Loopback"
        if ip_obj.is_private or ip_obj.is_link_local:
            return "LAN / Private"
        return "Public / WAN"
    except Exception:
        return "Unknown"


def _parse_client_environment(user_agent: str, client_meta: dict) -> Dict[str, str]:
    """Parse User-Agent string and client metadata to detect OS, browser, and device."""
    ua = (user_agent or "").lower()

    # Detected OS
    meta_os = client_meta.get("os")
    if meta_os:
        meta_os_str = str(meta_os).lower()
        if meta_os_str == "apple":
            os_name = "macOS / iOS"
        elif meta_os_str in ("windows", "android", "linux"):
            os_name = meta_os_str.capitalize()
        else:
            os_name = str(meta_os).capitalize()
    elif "iphone" in ua or "ipad" in ua or "ipod" in ua:
        os_name = "iOS"
    elif "macintosh" in ua or "mac os x" in ua:
        os_name = "macOS"
    elif "windows" in ua or "win64" in ua or "win32" in ua:
        os_name = "Windows"
    elif "android" in ua:
        os_name = "Android"
    elif "cros" in ua:
        os_name = "ChromeOS"
    elif "linux" in ua:
        os_name = "Linux"
    else:
        os_name = "Unknown"

    # Browser
    if "edg/" in ua or "edge/" in ua:
        browser = "Edge"
    elif "opr/" in ua or "opera" in ua:
        browser = "Opera"
    elif "firefox/" in ua or "fxios" in ua:
        browser = "Firefox"
    elif "chrome/" in ua or "crios" in ua:
        browser = "Chrome"
    elif "safari/" in ua and "version/" in ua:
        browser = "Safari"
    else:
        browser = "Other"

    # Device type
    if "mobile" in ua or "iphone" in ua or ("android" in ua and "tablet" not in ua):
        device = "Mobile"
    elif "ipad" in ua or "tablet" in ua:
        device = "Tablet"
    else:
        device = "Desktop"

    return {"os": os_name, "browser": browser, "device": device}


@dataclass
class PeerSession:
    """Detailed connection state and metadata for a peer."""
    peer_id: str
    session_id: str
    ip: str
    ip_type: str
    user_agent: str
    os: str
    browser: str
    device: str
    name: str = ""
    role: str = "guest"         # "host", "guest", or "unknown"
    room_id: str = ""
    connected_at: float = field(default_factory=time.time)
    last_seen: float = field(default_factory=time.monotonic)
    signals_sent: int = 0
    signals_received: int = 0
    bytes_relayed: int = 0
    targets: Set[str] = field(default_factory=set)
    headers: Dict[str, str] = field(default_factory=dict)
    disconnected_at: Optional[float] = None
    disconnect_reason: Optional[str] = None
    close_code: Optional[int] = None

    def to_dict(self) -> Dict[str, Any]:
        now_mono = time.monotonic()
        now_wall = time.time()
        is_active = self.disconnected_at is None
        idle_seconds = round(now_mono - self.last_seen, 1) if is_active else 0.0

        if not is_active:
            conn_status = "disconnected"
            duration = round(self.disconnected_at - self.connected_at, 1)
        elif idle_seconds >= 25.0:
            conn_status = "stale"
            duration = round(now_wall - self.connected_at, 1)
        elif idle_seconds >= 12.0:
            conn_status = "idle"
            duration = round(now_wall - self.connected_at, 1)
        else:
            conn_status = "active"
            duration = round(now_wall - self.connected_at, 1)

        display_name = self.name.strip() if self.name else f"Peer {self.peer_id[:6]}"
        effective_room = self.room_id or (self.peer_id if self.role == "host" else "")

        return {
            "peer_id": self.peer_id,
            "session_id": self.session_id,
            "name": display_name,
            "role": self.role,
            "room_id": effective_room,
            "ip": self.ip,
            "ip_type": self.ip_type,
            "os": self.os,
            "browser": self.browser,
            "device": self.device,
            "user_agent": self.user_agent,
            "connected_at": datetime.fromtimestamp(self.connected_at, tz=timezone.utc).isoformat(),
            "connected_at_timestamp": self.connected_at,
            "duration_seconds": max(0.0, duration),
            "idle_seconds": max(0.0, idle_seconds),
            "status": conn_status,
            "signals_sent": self.signals_sent,
            "signals_received": self.signals_received,
            "bytes_relayed": self.bytes_relayed,
            "targets_count": len(self.targets),
            "targets": sorted(list(self.targets)),
            "headers": self.headers,
            "disconnected_at": datetime.fromtimestamp(self.disconnected_at, tz=timezone.utc).isoformat() if self.disconnected_at else None,
            "disconnect_reason": self.disconnect_reason,
            "close_code": self.close_code,
        }


class _PeerRegistry:
    """In-memory map peer_id -> WebSocket, with session telemetry and administration."""

    def __init__(self) -> None:
        self._peers: Dict[str, WebSocket] = {}
        self._sessions: Dict[str, PeerSession] = {}
        self._history: deque[PeerSession] = deque(maxlen=500)
        self._events: deque[Dict[str, Any]] = deque(maxlen=300)
        self._event_counter: int = 0
        self._total_connections_count: int = 0
        self._total_signals_relayed: int = 0
        self._total_bytes_relayed: int = 0
        self._peak_concurrent_connections: int = 0
        self._server_start_time: float = time.time()
        self._lock = asyncio.Lock()

    def add_event(self, event_type: str, message: str, peer_id: Optional[str] = None, room_id: Optional[str] = None, severity: str = "info") -> Dict[str, Any]:
        """Record an event into the audit feed."""
        self._event_counter += 1
        ev = {
            "id": self._event_counter,
            "timestamp": datetime.now(tz=timezone.utc).isoformat(),
            "epoch": time.time(),
            "type": event_type,
            "message": message,
            "peer_id": peer_id,
            "room_id": room_id,
            "severity": severity,
        }
        self._events.appendleft(ev)
        return ev

    async def register(self, peer_id: str, ws: WebSocket, session: Optional[PeerSession] = None) -> Optional[WebSocket]:
        """Atomically claim a peer id. The new ws always wins — if an entry already
        exists, the displaced WebSocket is returned to the caller for cleanup."""
        async with self._lock:
            displaced = self._peers.get(peer_id)
            old_session = self._sessions.get(peer_id)
            if old_session:
                old_session.disconnected_at = time.time()
                old_session.disconnect_reason = "Replaced by a new registration"
                old_session.close_code = _CLOSE_UNAVAILABLE_ID
                self._history.appendleft(old_session)

            self._peers[peer_id] = ws
            if session:
                self._sessions[peer_id] = session
            self._total_connections_count += 1
            if len(self._peers) > self._peak_concurrent_connections:
                self._peak_concurrent_connections = len(self._peers)

            pname = session.name if session and session.name else f"Peer {peer_id[:6]}"
            pip = session.ip if session else "127.0.0.1"
            proom = session.room_id if session and session.room_id else ""
            pos = session.os if session else "Unknown"
            pbr = session.browser if session else "Unknown"

            self.add_event("connect", f"Peer {peer_id[:8]} ({pname}) connected from {pip} [{pos} / {pbr}]", peer_id=peer_id, room_id=proom, severity="info")
            return displaced

    async def unregister(self, peer_id: str, ws: WebSocket, reason: str = "Client disconnected", close_code: Optional[int] = None) -> None:
        """Remove the entry only if it still points at this websocket."""
        async with self._lock:
            if self._peers.get(peer_id) is ws:
                del self._peers[peer_id]
                session = self._sessions.pop(peer_id, None)
                if session:
                    session.disconnected_at = time.time()
                    session.disconnect_reason = reason
                    session.close_code = close_code
                    self._history.appendleft(session)
                    self.add_event("disconnect", f"Peer {peer_id[:8]} disconnected: {reason}", peer_id=peer_id, room_id=session.room_id, severity="warning" if close_code and close_code >= 4400 else "info")

    def lookup(self, peer_id: str) -> Optional[WebSocket]:
        return self._peers.get(peer_id)

    def get_session(self, peer_id: str) -> Optional[PeerSession]:
        return self._sessions.get(peer_id)

    def size(self) -> int:
        return len(self._peers)

    def record_signal_traffic(self, source_id: str, target_id: str, byte_count: int) -> None:
        """Record bandwidth and signal counters for active sessions."""
        self._total_signals_relayed += 1
        self._total_bytes_relayed += byte_count

        src = self._sessions.get(source_id)
        if src:
            src.signals_sent += 1
            src.bytes_relayed += byte_count
            src.targets.add(target_id)
            src.last_seen = time.monotonic()

        tgt = self._sessions.get(target_id)
        if tgt:
            tgt.signals_received += 1
            tgt.bytes_relayed += byte_count

    def update_session_metadata(self, peer_id: str, metadata: dict) -> None:
        """Dynamically update metadata sent by the peer."""
        session = self._sessions.get(peer_id)
        if not session or not isinstance(metadata, dict):
            return

        if "name" in metadata and isinstance(metadata["name"], str):
            session.name = metadata["name"][:100]
        if "os" in metadata and isinstance(metadata["os"], str):
            env = _parse_client_environment("", {"os": metadata["os"]})
            session.os = env["os"]
        if "isHost" in metadata:
            session.role = "host" if metadata["isHost"] else "guest"
        if "roomId" in metadata and isinstance(metadata["roomId"], str):
            session.room_id = metadata["roomId"][:64]
        session.last_seen = time.monotonic()

    def get_active_peers(self) -> List[Dict[str, Any]]:
        """Return list of active peer session dictionaries."""
        return [sess.to_dict() for sess in self._sessions.values()]

    def get_session_history(self, limit: int = 100) -> List[Dict[str, Any]]:
        """Return list of recent disconnected sessions."""
        res = []
        for sess in list(self._history)[:limit]:
            res.append(sess.to_dict())
        return res

    def get_peer_details(self, peer_id: str) -> Optional[Dict[str, Any]]:
        """Find details for a peer in active sessions or history."""
        sess = self._sessions.get(peer_id)
        if sess:
            return sess.to_dict()
        for h in self._history:
            if h.peer_id == peer_id:
                return h.to_dict()
        return None

    async def kick_peer(self, peer_id: str, reason: str = "Disconnected by administrator") -> bool:
        """Disconnect an active peer and notify it."""
        async with self._lock:
            ws = self._peers.get(peer_id)
            session = self._sessions.get(peer_id)
            if ws is None:
                return False

            # Send kick payload
            try:
                await ws.send_json({
                    "type": "signal",
                    "from": "system",
                    "payload": {"kind": "admin-kick", "reason": reason}
                })
            except Exception:
                pass

            try:
                await ws.close(code=_CLOSE_ADMIN_KICK, reason=reason)
            except Exception:
                pass

            if session:
                session.disconnect_reason = f"Kicked: {reason}"
                session.close_code = _CLOSE_ADMIN_KICK

            self.add_event("kick", f"Peer {peer_id[:8]} was kicked by admin ({reason})", peer_id=peer_id, room_id=session.room_id if session else None, severity="danger")
            return True

    async def broadcast_message(self, message: str, room_id: Optional[str] = None, level: str = "info") -> int:
        """Broadcast system alert to all active peers or a specific room."""
        targets = []
        async with self._lock:
            for pid, sess in self._sessions.items():
                if room_id and sess.room_id != room_id and pid != room_id:
                    continue
                ws = self._peers.get(pid)
                if ws:
                    targets.append((pid, ws))

        sent_count = 0
        payload = {
            "type": "signal",
            "from": "system",
            "payload": {
                "kind": "admin-broadcast",
                "message": message,
                "level": level,
                "timestamp": time.time(),
            }
        }
        for _pid, ws in targets:
            if await _send_json_safe(ws, payload):
                sent_count += 1

        scope = f"room {room_id}" if room_id else "all peers"
        self.add_event("broadcast", f"Admin broadcast to {sent_count} peers in {scope} ({level}): '{message[:50]}'", room_id=room_id, severity="warning" if level in ("warning", "danger") else "info")
        return sent_count

    def get_rooms_summary(self) -> List[Dict[str, Any]]:
        """Return list of active rooms with host and participant details."""
        rooms_map: Dict[str, Dict[str, Any]] = {}

        # First pass: map hosts
        for sess in self._sessions.values():
            r_id = sess.room_id or (sess.peer_id if sess.role == "host" else "")
            if not r_id:
                continue

            if r_id not in rooms_map:
                rooms_map[r_id] = {
                    "room_id": r_id,
                    "host": None,
                    "participants": [],
                    "created_at": sess.connected_at,
                    "status": "active",
                }

            if sess.role == "host" or sess.peer_id == r_id:
                rooms_map[r_id]["host"] = sess.to_dict()
                rooms_map[r_id]["created_at"] = min(rooms_map[r_id]["created_at"], sess.connected_at)
            else:
                rooms_map[r_id]["participants"].append(sess.to_dict())

        # Second pass: compute stats
        result = []
        now = time.time()
        for r_id, r_data in rooms_map.items():
            active_count = (1 if r_data["host"] else 0) + len(r_data["participants"])
            result.append({
                "room_id": r_id,
                "host_id": r_data["host"]["peer_id"] if r_data["host"] else None,
                "host_name": r_data["host"]["name"] if r_data["host"] else "Unknown Host",
                "host_os": r_data["host"]["os"] if r_data["host"] else None,
                "host_ip": r_data["host"]["ip"] if r_data["host"] else None,
                "total_members": active_count,
                "participants": r_data["participants"],
                "created_at": datetime.fromtimestamp(r_data["created_at"], tz=timezone.utc).isoformat(),
                "duration_seconds": round(now - r_data["created_at"], 1),
                "status": "active" if active_count > 0 else "empty",
            })

        result.sort(key=lambda r: r["total_members"], reverse=True)
        return result

    async def close_room(self, room_id: str, reason: str = "Room closed by administrator") -> int:
        """Kick all participants belonging to a specific room."""
        peers_to_kick = []
        async with self._lock:
            for pid, sess in self._sessions.items():
                if sess.room_id == room_id or pid == room_id:
                    peers_to_kick.append(pid)

        count = 0
        for pid in peers_to_kick:
            if await self.kick_peer(pid, reason=reason):
                count += 1

        self.add_event("room_close", f"Room {room_id} closed by admin ({count} peers disconnected)", room_id=room_id, severity="danger")
        return count

    def get_audit_events(self, limit: int = 150) -> List[Dict[str, Any]]:
        return list(self._events)[:limit]

    def get_server_metrics(self) -> Dict[str, Any]:
        """Collect real-time system and signaling telemetry."""
        now = time.time()
        uptime_seconds = round(now - self._server_start_time, 1)

        # Memory usage via resource module
        try:
            raw_rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
            # On macOS ru_maxrss is bytes; on Linux it is KiB
            if platform.system() == "Darwin":
                mem_mb = round(raw_rss / (1024 * 1024), 1)
            else:
                mem_mb = round(raw_rss / 1024, 1)
        except Exception:
            mem_mb = 0.0

        # CPU load
        try:
            load_1, load_5, load_15 = os.getloadavg()
            cpu_load = [round(load_1, 2), round(load_5, 2), round(load_15, 2)]
        except Exception:
            cpu_load = [0.0, 0.0, 0.0]

        # Active rooms count
        rooms = self.get_rooms_summary()

        # OS and Browser distributions
        os_distribution: Dict[str, int] = {}
        browser_distribution: Dict[str, int] = {}
        for sess in self._sessions.values():
            os_distribution[sess.os] = os_distribution.get(sess.os, 0) + 1
            browser_distribution[sess.browser] = browser_distribution.get(sess.browser, 0) + 1

        return {
            "uptime_seconds": uptime_seconds,
            "server_start_time": datetime.fromtimestamp(self._server_start_time, tz=timezone.utc).isoformat(),
            "active_connections": len(self._peers),
            "peak_concurrent_connections": self._peak_concurrent_connections,
            "total_connections_served": self._total_connections_count,
            "total_signals_relayed": self._total_signals_relayed,
            "total_bytes_relayed": self._total_bytes_relayed,
            "active_rooms_count": len(rooms),
            "memory_usage_mb": mem_mb,
            "cpu_load": cpu_load,
            "os_distribution": os_distribution,
            "browser_distribution": browser_distribution,
            "system_info": {
                "os": f"{platform.system()} {platform.release()}",
                "python": platform.python_version(),
                "node": platform.node(),
            }
        }


_REGISTRY = _PeerRegistry()


def _is_valid_peer_id(value) -> bool:
    return isinstance(value, str) and bool(_PEER_ID_RE.match(value))


async def _send_json_safe(ws: WebSocket, payload: dict) -> bool:
    """Send a JSON message, swallowing connection errors."""
    try:
        await ws.send_json(payload)
        return True
    except Exception:
        return False


async def _receive_text_with_timeout(ws: WebSocket, timeout: float) -> Optional[str]:
    try:
        return await asyncio.wait_for(ws.receive_text(), timeout=timeout)
    except asyncio.TimeoutError:
        return None
    except (WebSocketDisconnect, RuntimeError):
        return None


# =========================================================================================
# ICE candidate rewriting
#
# coturn runs in a Docker bridge network and so advertises its bridge IP (typically
# 172.x.x.x or 10.x.x.x) as the relay address in TURN allocation responses. Clients
# outside Docker cannot route to that IP, so any transfer that needs to fall back to
# TURN relay would silently fail.
#
# The fix lives at the signaling layer: when relaying a 'candidate' signal of type
# 'relay' whose address is a private/loopback IP, substitute the address that the
# *receiving* client used to reach this server. Because rewriting happens per-recipient,
# a LAN client and an Internet client connected to the same server will each see a
# relay candidate pointing at the IP that works for them — something a static
# --external-ip on coturn could never achieve.
#
# Only relay candidates with private/loopback addresses are touched. Host candidates
# (peer's local IP) and srflx candidates (STUN-reflexive public IP) are independently
# correct; we forward them verbatim. If coturn one day advertises a public IP directly
# (e.g. host networking, manual --external-ip), we don't second-guess it.
# =========================================================================================

# Strict parse of an SDP candidate line. Capture groups, in order:
#   1: foundation+component+protocol+priority (everything up to the address)
#   2: connection-address
#   3: port
#   4: candidate type
#   5: optional trailing attributes (may include raddr/rport which we also rewrite)
_CANDIDATE_RE = re.compile(
    r"^(candidate:\S+\s+\d+\s+\S+\s+\d+)\s+(\S+)\s+(\d+)\s+typ\s+(\S+)\s*(.*)$"
)
_RADDR_RE = re.compile(r"\braddr\s+(\S+)")


def _is_private_or_loopback(addr: str) -> bool:
    """True if `addr` is an IPv4/IPv6 literal in a private, loopback, or link-local range
    that an external client cannot route to. mDNS .local hostnames also count — they're
    intentionally unresolvable across networks and only ever appear in host candidates,
    not relay candidates, so we treat them as 'not reachable from outside' just in case."""
    if not addr:
        return False
    if addr.endswith('.local'):
        return True
    try:
        ip = ipaddress.ip_address(addr)
    except ValueError:
        return False
    return ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_unspecified


def _client_host_hint(ws: WebSocket) -> Optional[str]:
    """Return the hostname/IP this client used to reach the server, derived from the
    Host header it sent on the WebSocket upgrade. This is the IP the client knows the
    server by — which by definition is the IP coturn-on-this-server should be reachable
    at from this client's vantage point.

    Strips port (we keep the relay port from coturn unchanged) and an optional IPv6
    bracket. Returns None on malformed input."""
    host = ws.headers.get('host') if ws and ws.headers else None
    if not host:
        return None
    # Strip [ipv6]:port or host:port -> hostname/IP only
    if host.startswith('['):
        end = host.find(']')
        if end < 0:
            return None
        inner = host[1:end]
        try:
            ipaddress.ip_address(inner)  # must be a bare IPv6 literal, reject '[:]' etc.
        except ValueError:
            return None
        return inner
    if ':' in host:
        host = host.split(':', 1)[0]
    return host or None


# Resolution cache for client host headers (hostname -> IPv4). Single-worker event
# loop, few relay candidates per connection: a plain dict is enough.
_host_resolutions: Dict[str, Optional[str]] = {}


def _resolve_host(host: str) -> Optional[str]:
    """Resolve a hostname to an IPv4 literal for ICE candidate rewriting. Returns None
    when the host is already an IP literal or cannot be resolved."""
    if host in _host_resolutions:
        return _host_resolutions[host]
    result: Optional[str] = None
    try:
        infos = socket.getaddrinfo(host, None, family=socket.AF_INET, type=socket.SOCK_DGRAM)
        if infos:
            result = infos[0][4][0]
    except OSError:
        result = None
    _host_resolutions[host] = result
    return result


def _candidate_target_address(ws: WebSocket) -> Optional[str]:
    """The relay address the target client can route to: the IP it used to reach this
    server. Chrome rejects ICE candidates whose connection-address is a hostname, so
    the Host header must be resolved to a literal before substitution."""
    host = _client_host_hint(ws)
    if not host:
        return None
    try:
        ipaddress.ip_address(host)
        return host  # already an IP literal
    except ValueError:
        return _resolve_host(host)


def _rewrite_candidate_line(line: str, new_addr: str) -> str:
    """Substitute the connection-address and any raddr in a candidate line."""
    m = _CANDIDATE_RE.match(line)
    if not m:
        return line  # unparseable — pass through unchanged
    prefix, _addr, port, ctype, tail = m.groups()
    tail = _RADDR_RE.sub(f'raddr {new_addr}', tail) if tail else tail
    rebuilt = f"{prefix} {new_addr} {port} typ {ctype}"
    if tail:
        rebuilt = f"{rebuilt} {tail}"
    return rebuilt


def _maybe_rewrite_signal_payload(payload, target_ws: WebSocket):
    """If payload is an ICE candidate of type 'relay' with a private/loopback address,
    return a shallow-copied payload with the address rewritten to the host the target
    client used. Otherwise return the original payload unchanged.

    Safety: if anything is shaped unexpectedly, return the original payload. This must
    never reject a signal — at worst it passes through with the original (broken) IP,
    same behavior as before this function existed."""
    if not isinstance(payload, dict):
        return payload
    if payload.get('kind') != 'candidate':
        return payload
    cand = payload.get('candidate')
    if not isinstance(cand, dict):
        return payload
    line = cand.get('candidate')
    if not isinstance(line, str) or 'typ relay' not in line:
        return payload

    m = _CANDIDATE_RE.match(line)
    if not m:
        return payload
    current_addr = m.group(2)
    if not _is_private_or_loopback(current_addr):
        return payload  # already a routable address; trust it

    new_host = _candidate_target_address(target_ws)
    if not new_host or new_host == current_addr:
        return payload

    rewritten_line = _rewrite_candidate_line(line, new_host)
    if rewritten_line == line:
        return payload

    # Shallow-clone the payload so we don't mutate the sender's view. The cand object
    # itself we clone too because both senders and other receivers of this signal could
    # still hold references (none do today, but cheap insurance).
    new_cand = dict(cand)
    new_cand['candidate'] = rewritten_line
    if isinstance(new_cand.get('address'), str) and _is_private_or_loopback(new_cand['address']):
        new_cand['address'] = new_host
    new_payload = dict(payload)
    new_payload['candidate'] = new_cand
    return new_payload


router = APIRouter()


@router.websocket("/ws")
async def signaling(websocket: WebSocket):
    # Capacity check before accept — refuse early under overload.
    if _REGISTRY.size() >= _MAX_CONNECTIONS:
        await websocket.close(code=_CLOSE_OVERLOADED, reason="Server at capacity.")
        return

    await websocket.accept()

    peer_id: Optional[str] = None
    session_id = f"sess_{uuid.uuid4().hex[:12]}"
    client_ip = _extract_client_ip(websocket)
    ip_type = _classify_ip_network(client_ip)
    ua_str = websocket.headers.get("user-agent", "") if websocket.headers else ""
    headers_snapshot = dict(websocket.headers) if websocket.headers else {}

    # Global per-connection rate limit: timestamps of recent messages (any type).
    msg_timestamps: list[float] = []
    # Per-target rate limit: target_peer_id -> recent signal timestamps.
    pair_timestamps: Dict[str, list[float]] = {}

    disconnect_reason = "Client disconnected"
    close_code: Optional[int] = None

    try:
        # ---- Phase 1: register -----------------------------------------------------------
        raw = await _receive_text_with_timeout(websocket, _REGISTER_TIMEOUT_SECONDS)
        if raw is None:
            disconnect_reason = "Register timeout"
            close_code = _CLOSE_INVALID_REGISTER
            await websocket.close(code=_CLOSE_INVALID_REGISTER, reason="Register timeout.")
            return
        if len(raw) > _MAX_PAYLOAD_BYTES:
            disconnect_reason = "Register message too large"
            close_code = _CLOSE_INVALID_REGISTER
            await websocket.close(code=_CLOSE_INVALID_REGISTER, reason="Register too large.")
            return
        try:
            first = json.loads(raw)
        except (json.JSONDecodeError, ValueError):
            disconnect_reason = "Malformed JSON on register"
            close_code = _CLOSE_INVALID_REGISTER
            await _send_json_safe(websocket, {"type": "error", "code": "invalid-message", "message": "Malformed JSON."})
            await websocket.close(code=_CLOSE_INVALID_REGISTER)
            return
        if not isinstance(first, dict) or first.get("type") != "register":
            disconnect_reason = "First message was not 'register'"
            close_code = _CLOSE_INVALID_REGISTER
            await _send_json_safe(websocket, {"type": "error", "code": "invalid-message", "message": "First message must be 'register'."})
            await websocket.close(code=_CLOSE_INVALID_REGISTER)
            return

        candidate_id = first.get("id")
        if not _is_valid_peer_id(candidate_id):
            disconnect_reason = "Invalid peer id format"
            close_code = _CLOSE_INVALID_REGISTER
            await _send_json_safe(websocket, {"type": "error", "code": "invalid-id", "message": "Peer id format is invalid."})
            await websocket.close(code=_CLOSE_INVALID_REGISTER)
            return

        # Parse optional client metadata
        metadata = first.get("metadata") or {}
        if not isinstance(metadata, dict):
            metadata = {}

        parsed_env = _parse_client_environment(ua_str, metadata)
        role = "host" if metadata.get("isHost") else ("guest" if metadata.get("roomId") else "unknown")
        room_id = metadata.get("roomId") or (candidate_id if metadata.get("isHost") else "")
        display_name = str(metadata.get("name", "")).strip()

        # Construct session tracker
        session = PeerSession(
            peer_id=candidate_id,
            session_id=session_id,
            ip=client_ip,
            ip_type=ip_type,
            user_agent=ua_str,
            os=parsed_env["os"],
            browser=parsed_env["browser"],
            device=parsed_env["device"],
            name=display_name,
            role=role,
            room_id=room_id,
            headers=headers_snapshot,
        )

        displaced = await _REGISTRY.register(candidate_id, websocket, session=session)
        if displaced is not None:
            try:
                await displaced.close(code=_CLOSE_UNAVAILABLE_ID, reason="Replaced by a new registration.")
            except Exception:
                pass
        peer_id = candidate_id
        await _send_json_safe(websocket, {"type": "registered", "id": peer_id})

        # ---- Phase 2: relay loop ---------------------------------------------------------
        while True:
            raw = await _receive_text_with_timeout(websocket, _IDLE_TIMEOUT_SECONDS)
            if raw is None:
                # Idle — clean shutdown
                disconnect_reason = "Idle timeout (30s)"
                close_code = _CLOSE_IDLE
                try:
                    await websocket.close(code=_CLOSE_IDLE, reason="Idle timeout.")
                except Exception:
                    pass
                return

            now = time.monotonic()
            msg_timestamps.append(now)
            window_start = now - 1.0
            msg_timestamps[:] = [t for t in msg_timestamps if t >= window_start]
            if len(msg_timestamps) > _MAX_MSG_PER_SECOND:
                disconnect_reason = "Rate limited (too many messages)"
                close_code = _CLOSE_RATE_LIMITED
                _REGISTRY.add_event("rate_limit", f"Peer {peer_id[:8]} was rate limited and disconnected", peer_id=peer_id, severity="warning")
                await _send_json_safe(websocket, {"type": "error", "code": "rate-limited", "message": "Too many messages."})
                await websocket.close(code=_CLOSE_RATE_LIMITED)
                return

            if len(raw) > _MAX_PAYLOAD_BYTES:
                await _send_json_safe(websocket, {"type": "error", "code": "invalid-message", "message": "Message too large."})
                continue

            try:
                msg = json.loads(raw)
            except (json.JSONDecodeError, ValueError):
                await _send_json_safe(websocket, {"type": "error", "code": "invalid-message", "message": "Malformed JSON."})
                continue
            if not isinstance(msg, dict):
                await _send_json_safe(websocket, {"type": "error", "code": "invalid-message", "message": "Message must be an object."})
                continue

            mtype = msg.get("type")
            if mtype == "signal":
                target_id = msg.get("to")
                payload = msg.get("payload")
                if not _is_valid_peer_id(target_id):
                    await _send_json_safe(websocket, {"type": "error", "code": "invalid-message", "message": "'to' must be a valid peer id."})
                    continue

                pair_window_start = now - _PAIR_WINDOW_SECONDS
                pair_recent = pair_timestamps.setdefault(target_id, [])
                pair_recent[:] = [t for t in pair_recent if t >= pair_window_start]
                if len(pair_recent) >= _PAIR_MAX_PER_WINDOW:
                    await _send_json_safe(websocket, {"type": "error", "code": "rate-limited", "message": f"Too many signals to peer {target_id!r}."})
                    continue
                pair_recent.append(now)
                if len(pair_timestamps) > 256:
                    pair_timestamps = {k: v for k, v in pair_timestamps.items() if v}

                target_ws = _REGISTRY.lookup(target_id)
                if target_ws is None:
                    await _send_json_safe(websocket, {"type": "peer-unavailable", "id": target_id})
                    continue

                # Record traffic telemetry
                _REGISTRY.record_signal_traffic(peer_id, target_id, len(raw))

                outbound_payload = _maybe_rewrite_signal_payload(payload, target_ws)
                await _send_json_safe(target_ws, {"type": "signal", "from": peer_id, "payload": outbound_payload})

            elif mtype == "meta":
                # Peer updating its metadata (name, room, etc.)
                meta_payload = msg.get("metadata")
                if isinstance(meta_payload, dict):
                    _REGISTRY.update_session_metadata(peer_id, meta_payload)

            elif mtype == "ping":
                session = _REGISTRY.get_session(peer_id)
                if session:
                    session.last_seen = time.monotonic()
                await _send_json_safe(websocket, {"type": "pong"})

            else:
                await _send_json_safe(websocket, {"type": "error", "code": "invalid-message", "message": f"Unknown type: {mtype!r}."})

    except WebSocketDisconnect as e:
        disconnect_reason = "Client connection closed"
        close_code = e.code if hasattr(e, "code") else 1000
    except Exception:
        disconnect_reason = "Internal server error"
        close_code = status.WS_1011_INTERNAL_ERROR
        try:
            await websocket.close(code=status.WS_1011_INTERNAL_ERROR, reason="Server error.")
        except Exception:
            pass
        logger.exception("signaling: unhandled error for peer %r", peer_id)
    finally:
        if peer_id is not None:
            await _REGISTRY.unregister(peer_id, websocket, reason=disconnect_reason, close_code=close_code)
