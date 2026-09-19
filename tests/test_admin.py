import unittest
from fastapi.testclient import TestClient

from run import server
from api.signaling import _REGISTRY, PeerSession


class TestAdminAPI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(server)

    def setUp(self):
        # Authenticate and obtain JWT
        res = self.client.post(
            "/api/admin/login",
            json={"username": "airrelay_admin", "password": "AirRelay@Admin#2026!Secure"},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("token", data)
        self.token = data["token"]
        self.auth_headers = {"Authorization": f"Bearer {self.token}"}

    def test_login_invalid_credentials(self):
        res = self.client.post(
            "/api/admin/login",
            json={"username": "airrelay_admin", "password": "wrong_password_xyz"},
        )
        self.assertEqual(res.status_code, 401)
        self.assertIn("detail", res.json())

        res_wrong_user = self.client.post(
            "/api/admin/login",
            json={"username": "unknown_admin", "password": "AirRelay@Admin#2026!Secure"},
        )
        self.assertEqual(res_wrong_user.status_code, 401)

    def test_verify_token(self):
        res = self.client.get("/api/admin/verify", headers=self.auth_headers)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data.get("valid"))
        self.assertEqual(data.get("role"), "admin")

    def test_unauthorized_access_rejected(self):
        # Test that protected endpoints reject requests without token
        endpoints = [
            ("/api/admin/overview", "GET"),
            ("/api/admin/peers", "GET"),
            ("/api/admin/rooms", "GET"),
            ("/api/admin/events", "GET"),
            ("/api/admin/export", "GET"),
            ("/api/admin/broadcast", "POST"),
        ]
        for url, method in endpoints:
            if method == "GET":
                res = self.client.get(url)
            else:
                res = self.client.post(url, json={"message": "test"})
            self.assertEqual(res.status_code, 401, f"{method} {url} should require authorization")

    def test_overview_metrics(self):
        res = self.client.get("/api/admin/overview", headers=self.auth_headers)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("active_connections", data)
        self.assertIn("uptime_seconds", data)
        self.assertIn("total_signals_relayed", data)
        self.assertIn("total_bytes_relayed", data)
        self.assertIn("memory_usage_mb", data)
        self.assertIn("system_info", data)

    def test_peer_telemetry_and_filtering(self):
        # Register simulated sessions into registry
        sess1 = PeerSession(
            peer_id="test-peer-host-1",
            session_id="sess_host1",
            ip="192.168.1.50",
            ip_type="LAN / Private",
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
            os="macOS",
            browser="Safari",
            device="Desktop",
            name="Alpha Host",
            role="host",
            room_id="test-peer-host-1",
        )
        sess2 = PeerSession(
            peer_id="test-peer-guest-2",
            session_id="sess_guest2",
            ip="10.0.0.8",
            ip_type="LAN / Private",
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
            os="Windows",
            browser="Chrome",
            device="Desktop",
            name="Beta Guest",
            role="guest",
            room_id="test-peer-host-1",
        )
        _REGISTRY._sessions["test-peer-host-1"] = sess1
        _REGISTRY._sessions["test-peer-guest-2"] = sess2

        try:
            # 1. List all peers
            res = self.client.get("/api/admin/peers", headers=self.auth_headers)
            self.assertEqual(res.status_code, 200)
            data = res.json()
            self.assertGreaterEqual(data["total"], 2)

            # 2. Search filter
            res_search = self.client.get("/api/admin/peers?search=Alpha", headers=self.auth_headers)
            self.assertEqual(res_search.status_code, 200)
            search_peers = res_search.json()["peers"]
            self.assertTrue(any(p["peer_id"] == "test-peer-host-1" for p in search_peers))
            self.assertFalse(any(p["peer_id"] == "test-peer-guest-2" for p in search_peers))

            # 3. Role filter
            res_host = self.client.get("/api/admin/peers?role=host", headers=self.auth_headers)
            self.assertEqual(res_host.status_code, 200)
            host_peers = res_host.json()["peers"]
            self.assertTrue(all(p["role"] == "host" for p in host_peers))

            # 4. Deep peer details
            res_detail = self.client.get("/api/admin/peers/test-peer-host-1", headers=self.auth_headers)
            self.assertEqual(res_detail.status_code, 200)
            detail = res_detail.json()
            self.assertEqual(detail["peer_id"], "test-peer-host-1")
            self.assertEqual(detail["os"], "macOS")
            self.assertEqual(detail["browser"], "Safari")

        finally:
            _REGISTRY._sessions.pop("test-peer-host-1", None)
            _REGISTRY._sessions.pop("test-peer-guest-2", None)

    def test_peer_details_not_found(self):
        res = self.client.get("/api/admin/peers/non-existent-id-999", headers=self.auth_headers)
        self.assertEqual(res.status_code, 404)

    def test_rooms_summary(self):
        sess = PeerSession(
            peer_id="room-host-peer",
            session_id="sess_rh",
            ip="127.0.0.1",
            ip_type="Loopback",
            user_agent="TestAgent",
            os="Linux",
            browser="Firefox",
            device="Desktop",
            name="Room Host",
            role="host",
            room_id="room-host-peer",
        )
        _REGISTRY._sessions["room-host-peer"] = sess
        try:
            res = self.client.get("/api/admin/rooms", headers=self.auth_headers)
            self.assertEqual(res.status_code, 200)
            data = res.json()
            self.assertIn("rooms", data)
            room_ids = [r["room_id"] for r in data["rooms"]]
            self.assertIn("room-host-peer", room_ids)
        finally:
            _REGISTRY._sessions.pop("room-host-peer", None)

    def test_broadcast(self):
        res = self.client.post(
            "/api/admin/broadcast",
            headers=self.auth_headers,
            json={"message": "Maintenance starting in 5 minutes", "level": "warning"}
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data.get("success"))
        self.assertIn("recipients_count", data)

    def test_events_feed(self):
        _REGISTRY.add_event("test_event", "Admin test event executed", severity="info")
        res = self.client.get("/api/admin/events?limit=10", headers=self.auth_headers)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("events", data)
        self.assertTrue(any(ev["type"] == "test_event" for ev in data["events"]))

    def test_export_json_and_csv(self):
        # JSON Export
        res_json = self.client.get("/api/admin/export?format=json", headers=self.auth_headers)
        self.assertEqual(res_json.status_code, 200)
        self.assertIn("application/json", res_json.headers.get("content-type", ""))
        self.assertIn("sessions", res_json.json())

        # CSV Export
        res_csv = self.client.get("/api/admin/export?format=csv", headers=self.auth_headers)
        self.assertEqual(res_csv.status_code, 200)
        self.assertIn("text/csv", res_csv.headers.get("content-type", ""))
        self.assertIn("session_id,peer_id", res_csv.text)

    def test_admin_frontend_routes(self):
        # 1. /admin redirect without following redirects
        res_admin_raw = self.client.get("/admin", follow_redirects=False)
        self.assertEqual(res_admin_raw.status_code, 301)
        self.assertEqual(res_admin_raw.headers.get("location"), "/admin/")

        # 2. /admin following redirects
        res_admin = self.client.get("/admin")
        self.assertEqual(res_admin.status_code, 200)
        self.assertIn("Admin Console", res_admin.text)
        self.assertIn('href="/admin/css/admin.css"', res_admin.text)
        self.assertIn('src="/admin/js/admin.js"', res_admin.text)

        # 3. /admin/
        res_admin_slash = self.client.get("/admin/")
        self.assertEqual(res_admin_slash.status_code, 200)
        self.assertIn("Admin Console", res_admin_slash.text)

        # 4. /admin/css/admin.css
        res_css = self.client.get("/admin/css/admin.css")
        self.assertEqual(res_css.status_code, 200)
        self.assertIn("text/css", res_css.headers.get("content-type", ""))

        # 5. /admin/js/admin.js
        res_js = self.client.get("/admin/js/admin.js")
        self.assertEqual(res_js.status_code, 200)
        self.assertIn("application/javascript", res_js.headers.get("content-type", ""))

        # 6. Global CSS and icon
        res_global_css = self.client.get("/css/style.css")
        self.assertEqual(res_global_css.status_code, 200)
        self.assertIn("text/css", res_global_css.headers.get("content-type", ""))

        # 7. Root page has admin link with trailing slash
        res_root = self.client.get("/")
        self.assertEqual(res_root.status_code, 200)
        self.assertIn('href="/admin/"', res_root.text)


if __name__ == "__main__":
    unittest.main()
