import pytest
from starlette.testclient import TestClient
from api.main import app
from api.signaling import _REGISTRY, PeerSession


@pytest.fixture
def client():
    return TestClient(app)


@pytest.mark.asyncio
async def test_resolve_room_by_code_and_slug():
    host_session = PeerSession(
        peer_id="test-host-peer-id",
        session_id="sess_123",
        ip="192.168.1.50",
        ip_type="LAN / Private",
        user_agent="Mozilla/5.0",
        os="macOS",
        browser="Chrome",
        device="Desktop",
        name="Niyamul Mac",
        role="host",
        room_id="room-blue-ocean",
        code="582914",
    )

    class MockWS:
        pass

    ws = MockWS()
    await _REGISTRY.register("test-host-peer-id", ws, session=host_session)

    try:
        # Resolve by exact 6-digit code
        res1 = _REGISTRY.resolve_room("582914")
        assert res1 is not None
        assert res1["found"] is True
        assert res1["room_id"] == "room-blue-ocean"
        assert res1["code"] == "582914"
        assert res1["formatted_code"] == "582-914"
        assert res1["host_name"] == "Niyamul Mac"

        # Resolve by formatted code with hyphen
        res2 = _REGISTRY.resolve_room("582-914")
        assert res2 is not None
        assert res2["room_id"] == "room-blue-ocean"

        # Resolve by room slug
        res3 = _REGISTRY.resolve_room("room-blue-ocean")
        assert res3 is not None
        assert res3["room_id"] == "room-blue-ocean"

        # Resolve by full URL paste
        res4 = _REGISTRY.resolve_room("http://192.168.1.50:8080/room-blue-ocean")
        assert res4 is not None
        assert res4["room_id"] == "room-blue-ocean"

        # Resolve non-existent room
        res_none = _REGISTRY.resolve_room("999999")
        assert res_none is None
    finally:
        await _REGISTRY.unregister("test-host-peer-id", ws)


@pytest.mark.asyncio
async def test_nearby_rooms_lookup():
    class MockWS:
        pass

    ws = MockWS()
    host_session = PeerSession(
        peer_id="host-lan-1",
        session_id="sess_lan_1",
        ip="192.168.1.100",
        ip_type="LAN / Private",
        user_agent="Mozilla/5.0",
        os="Windows",
        browser="Edge",
        device="Desktop",
        name="Office PC",
        role="host",
        room_id="room-fast-share",
        code="123456",
    )
    await _REGISTRY.register("host-lan-1", ws, session=host_session)

    try:
        # Same exact IP
        nearby_exact = _REGISTRY.get_nearby_rooms("192.168.1.100")
        assert any(r["room_id"] == "room-fast-share" for r in nearby_exact)

        # Same /24 subnet (e.g. 192.168.1.105)
        nearby_subnet = _REGISTRY.get_nearby_rooms("192.168.1.105")
        assert any(r["room_id"] == "room-fast-share" for r in nearby_subnet)

        # Different subnet (e.g. 10.0.0.5)
        nearby_diff = _REGISTRY.get_nearby_rooms("10.0.0.5")
        assert not any(r["room_id"] == "room-fast-share" for r in nearby_diff)
    finally:
        await _REGISTRY.unregister("host-lan-1", ws)


def test_api_resolve_and_nearby_endpoints(client):
    resp = client.get("/rooms/resolve/000000")
    assert resp.status_code == 200
    assert resp.json()["found"] is False

    resp_nearby = client.get("/rooms/nearby")
    assert resp_nearby.status_code == 200
    assert "nearby_rooms" in resp_nearby.json()
