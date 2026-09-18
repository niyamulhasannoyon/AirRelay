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
