"""Tests sin red ni base real. Ejecutar desde worker/:  python -m unittest discover -s tests -v"""
import asyncio
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from collector import IncompleteData, build_metrics  # noqa: E402
import main  # noqa: E402

RAW_OK = {
    "uptime_ticks": 8_640_000,      # 86400 s = 1 día
    "cpu_idle": 70,
    "mem_total": 4_000_000,
    "mem_avail": 1_000_000,
    "mem_buffer": 200_000,
    "mem_cached": 800_000,
    "disk_pct": 63,
}


class BuildMetricsTests(unittest.TestCase):
    def test_valores_normales(self):
        m = build_metrics(RAW_OK)
        self.assertEqual(m["cpu"], 30.0)
        self.assertEqual(m["ram"], 50.0)      # (4000-1000-200-800)/4000
        self.assertEqual(m["disco"], 63.0)
        self.assertEqual(m["uptime"], 86400)

    def test_disco_y_uptime_opcionales(self):
        raw = {**RAW_OK, "disk_pct": None, "uptime_ticks": None}
        m = build_metrics(raw)
        self.assertIsNone(m["disco"])
        self.assertIsNone(m["uptime"])

    def test_sin_buffers_ni_cache(self):
        raw = {**RAW_OK, "mem_buffer": None, "mem_cached": None}
        self.assertEqual(build_metrics(raw)["ram"], 75.0)

    def test_faltan_datos_imprescindibles(self):
        with self.assertRaises(IncompleteData):
            build_metrics({**RAW_OK, "cpu_idle": None})

    def test_se_limita_a_0_100(self):
        raw = {**RAW_OK, "cpu_idle": -5, "mem_avail": 5_000_000, "mem_buffer": 0, "mem_cached": 0}
        m = build_metrics(raw)
        self.assertEqual(m["cpu"], 100.0)
        self.assertEqual(m["ram"], 0.0)


class FakeDB:
    def __init__(self, servers):
        self.servers = servers
        self.inserted = []

    def enabled_servers(self):
        return self.servers

    def insert_metrics(self, rows):
        self.inserted.extend(rows)


class CycleTests(unittest.TestCase):
    def test_un_servidor_caido_no_frena_a_los_demas(self):
        servers = [
            {"id": 1, "hostname": "a", "ip": "10.0.0.1", "comunidad": "public"},
            {"id": 2, "hostname": "b", "ip": "10.0.0.2", "comunidad": "public"},   # timeout
            {"id": 3, "hostname": "c", "ip": "10.0.0.3", "comunidad": "public"},   # datos incompletos
            {"id": 4, "hostname": "d", "ip": "10.0.0.4", "comunidad": "public"},
        ]

        async def poller(s):
            if s["id"] == 2:
                raise TimeoutError("No SNMP response received before timeout")
            if s["id"] == 3:
                return build_metrics({**RAW_OK, "cpu_idle": None})
            return build_metrics(RAW_OK)

        db = FakeDB(servers)
        ok, failed = asyncio.run(main.run_cycle(db, poller, concurrency=2))
        self.assertEqual((ok, failed), (2, 2))
        self.assertEqual([r[0] for r in db.inserted], [1, 4])
        server_id, fecha, cpu, ram, disco, uptime = db.inserted[0]
        self.assertEqual((cpu, ram, disco, uptime), (30.0, 50.0, 63.0, 86400))
        self.assertIsNone(fecha.tzinfo)

    def test_sin_servidores(self):
        async def poller(s):
            raise AssertionError("no debería consultarse")
        db = FakeDB([])
        self.assertEqual(asyncio.run(main.run_cycle(db, poller)), (0, 0))
        self.assertEqual(db.inserted, [])


if __name__ == "__main__":
    unittest.main()
