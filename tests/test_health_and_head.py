import unittest
from fastapi.testclient import TestClient

from api.main import app as api_app
from run import server


class TestHealthAndHeadMethods(unittest.TestCase):
    def test_api_head_and_get_methods(self):
        client = TestClient(api_app)

        # GET and HEAD on API root
        res_get_root = client.get("/")
        self.assertEqual(res_get_root.status_code, 200)
        self.assertIn("Welcome to AirRelay API!", res_get_root.json()["message"])

        res_head_root = client.head("/")
        self.assertEqual(res_head_root.status_code, 200)
        self.assertEqual(res_head_root.text, "")

        # GET and HEAD on API /health
        res_get_health = client.get("/health")
        self.assertEqual(res_get_health.status_code, 200)
        self.assertEqual(res_get_health.json()["status"], "ok")

        res_head_health = client.head("/health")
        self.assertEqual(res_head_health.status_code, 200)
        self.assertEqual(res_head_health.text, "")

    def test_server_head_and_get_methods(self):
        client = TestClient(server)

        # Frontend root
        res_get_root = client.get("/")
        self.assertEqual(res_get_root.status_code, 200)

        res_head_root = client.head("/")
        self.assertEqual(res_head_root.status_code, 200)
        self.assertEqual(res_head_root.text, "")

        # Mounted API health
        res_get_api_health = client.get("/api/health")
        self.assertEqual(res_get_api_health.status_code, 200)
        self.assertEqual(res_get_api_health.json()["status"], "ok")

        res_head_api_health = client.head("/api/health")
        self.assertEqual(res_head_api_health.status_code, 200)
        self.assertEqual(res_head_api_health.text, "")

    def test_spa_room_routing_and_asset_resolution(self):
        client = TestClient(server)

        # 1. Root returns index.html containing <base href="/">
        res_root = client.get("/")
        self.assertEqual(res_root.status_code, 200)
        self.assertIn('<base href="/">', res_root.text)
        self.assertIn('/css/style.css', res_root.text)
        self.assertIn('/js/modules/script.js', res_root.text)

        # 2. SPA Room slug returns index.html
        res_room = client.get("/test-room-uuid-1234")
        self.assertEqual(res_room.status_code, 200)
        self.assertIn('<base href="/">', res_room.text)

        # 3. Static assets served correctly from root
        res_js = client.get("/js/modules/script.js")
        self.assertEqual(res_js.status_code, 200)
        self.assertIn("javascript", res_js.headers.get("content-type", ""))

        res_css = client.get("/css/style.css")
        self.assertEqual(res_css.status_code, 200)
        self.assertIn("text/css", res_css.headers.get("content-type", ""))

        # 4. Defensive resolution: asset requested with room prefix still serves the real asset
        res_prefixed_js = client.get("/test-room-uuid-1234/js/modules/script.js")
        self.assertEqual(res_prefixed_js.status_code, 200)
        self.assertIn("javascript", res_prefixed_js.headers.get("content-type", ""))

        res_prefixed_css = client.get("/test-room-uuid-1234/css/style.css")
        self.assertEqual(res_prefixed_css.status_code, 200)
        self.assertIn("text/css", res_prefixed_css.headers.get("content-type", ""))

        # 5. Non-existent static files return 404 instead of index.html
        res_404_js = client.get("/test-room-uuid-1234/js/does-not-exist.js")
        self.assertEqual(res_404_js.status_code, 404)

