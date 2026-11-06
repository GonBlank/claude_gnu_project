"""Integración web + worker sobre una misma base (SQLite que imita a pymysql).

Ejecutar desde la raíz del proyecto:  python -m unittest discover -s tests -v
No necesita Docker, MySQL ni red. Los agentes SNMP se simulan con funciones.
"""
import asyncio
import base64
import datetime
import os
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path[:0] = [os.path.join(ROOT, "tests"), os.path.join(ROOT, "web"), os.path.join(ROOT, "worker")]

import fake_pymysql  # noqa: E402

fake_pymysql.install()
os.environ["USE_MOCK"] = "0"

import app as web_app  # noqa: E402
import collector  # noqa: E402
import main as worker_main  # noqa: E402
import store as store_mod  # noqa: E402
from db import Database  # noqa: E402

RAW = {"uptime_ticks": 8_640_000, "cpu_idle": 70, "mem_total": 4_000_000, "mem_avail": 1_000_000,
       "mem_buffer": 200_000, "mem_cached": 800_000, "disk_pct": 63}


def good(_server=None, **over):
    return collector.build_metrics({**RAW, **over})


class DBTestCase(unittest.TestCase):
    def setUp(self):
        fd, self.path = tempfile.mkstemp(suffix=".sqlite")
        os.close(fd)
        fake_pymysql.init_schema(self.path)
        web_app.store = store_mod.MySQLStore()
        self.web = web_app.app.test_client()
        self.db = Database()

    def tearDown(self):
        os.environ.pop("WEB_PASSWORD", None)
        os.remove(self.path)

    # helpers
    def add(self, hostname, ip, enabled=True):
        r = self.web.post("/api/servers", json={"hostname": hostname, "ip": ip,
                                                "comunidad": "public", "enabled": enabled})
        self.assertEqual(r.status_code, 201, r.get_json())
        return r.get_json()["id"]

    def round(self, poller):
        ok, failed = asyncio.run(worker_main.run_cycle(self.db, poller))
        self.db.heartbeat(ok, failed)
        return ok, failed

    def overview(self):
        r = self.web.get("/api/overview")
        self.assertEqual(r.status_code, 200)
        d = r.get_json()
        return d, {s["hostname"]: s for s in d["servers"]}


class FlujoCompleto(DBTestCase):
    def test_web_alta_worker_mide_web_muestra(self):
        s1 = self.add("ubuntu-01", "10.0.0.1")
        self.add("ubuntu-02", "10.0.0.2")
        self.add("ubuntu-off", "10.0.0.3", enabled=False)

        d, by = self.overview()
        self.assertEqual(d["worker"]["status"], "never")
        self.assertEqual(by["ubuntu-01"]["status"], "sin_datos")
        self.assertEqual(by["ubuntu-off"]["status"], "deshabilitado")

        async def poller(s):
            if s["hostname"] == "ubuntu-02":
                raise TimeoutError("No SNMP response received before timeout")
            return good()

        self.assertEqual(self.round(poller), (1, 1))        # el deshabilitado no se consulta

        d, by = self.overview()
        self.assertEqual(d["worker"]["status"], "ok")
        self.assertEqual(d["worker"]["result"], "1/2")
        self.assertEqual(by["ubuntu-01"]["status"], "online")
        self.assertEqual(by["ubuntu-01"]["last"]["cpu"], 30.0)
        self.assertEqual(by["ubuntu-01"]["last"]["ram"], 50.0)
        self.assertEqual(by["ubuntu-02"]["status"], "sin_datos")
        self.assertEqual(d["kpis"]["online"], 1)
        self.assertEqual(d["kpis"]["enabled"], 2)

        m = self.web.get(f"/api/servers/{s1}/metrics?range=24h").get_json()
        self.assertEqual(m["count"], 1)
        self.assertEqual(m["stats"]["cpu"], {"avg": 30.0, "min": 30.0, "max": 30.0})

    def test_disco_sin_dato_no_se_muestra_como_cero(self):
        s1 = self.add("ubuntu-01", "10.0.0.1")

        async def poller(s):
            return good(disk_pct=None)

        self.round(poller)
        _, by = self.overview()
        self.assertIsNone(by["ubuntu-01"]["last"]["disco"])
        m = self.web.get(f"/api/servers/{s1}/metrics?range=7d").get_json()
        self.assertIsNone(m["stats"]["disco"])
        self.assertIsNone(m["points"][0]["disco"])
        self.assertEqual(m["stats"]["cpu"]["avg"], 30.0)

    def test_servidor_borrado_durante_la_ronda_no_rompe_a_los_demas(self):
        self.add("ubuntu-01", "10.0.0.1")
        self.add("ubuntu-02", "10.0.0.2")

        async def poller(s):
            if s["hostname"] == "ubuntu-02":     # alguien borra a ubuntu-01 desde la web
                self.assertEqual(self.web.delete("/api/servers/1").status_code, 204)
            return good()

        self.assertEqual(self.round(poller), (2, 0))
        _, by = self.overview()
        self.assertNotIn("ubuntu-01", by)
        self.assertEqual(by["ubuntu-02"]["status"], "online")

    def test_borrar_servidor_borra_su_historial(self):
        s1 = self.add("ubuntu-01", "10.0.0.1")

        async def poller(s):
            return good()

        self.round(poller)
        self.assertEqual(self.db._run("SELECT COUNT(*) AS n FROM metrics", fetch=True)[0]["n"], 1)
        self.web.delete(f"/api/servers/{s1}")
        self.assertEqual(self.db._run("SELECT COUNT(*) AS n FROM metrics", fetch=True)[0]["n"], 0)

    def test_la_configuracion_de_la_web_llega_al_worker(self):
        r = self.web.put("/api/settings", json={"intervalo_minutos": 10, "umbral_aviso": 60,
                                                "umbral_critico": 85, "retencion_dias": 15,
                                                "comunidad_default": "lab"})
        self.assertEqual(r.status_code, 200, r.get_json())
        self.assertEqual(self.db.interval_minutes(), 10)

    def test_worker_o_servidor_atrasados(self):
        self.add("ubuntu-01", "10.0.0.1")
        old = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None) - datetime.timedelta(minutes=30)
        self.db.insert_metrics([(1, old, 20.0, 30.0, 40.0, 100)])
        web_app.store.save_settings({"worker_ultima_ronda": str(int(old.replace(
            tzinfo=datetime.timezone.utc).timestamp())), "worker_ultimo_resultado": "1/1"})
        d, by = self.overview()
        self.assertEqual(by["ubuntu-01"]["status"], "sin_respuesta")
        self.assertEqual(d["worker"]["status"], "late")
        self.assertEqual(d["kpis"]["down"], 1)

    def test_validaciones(self):
        self.add("ubuntu-01", "10.0.0.1")
        bad_ip = self.web.post("/api/servers", json={"hostname": "x", "ip": "999.1.1.1", "comunidad": "p"})
        dup = self.web.post("/api/servers", json={"hostname": "otro", "ip": "10.0.0.1", "comunidad": "p"})
        self.assertEqual(bad_ip.status_code, 400)
        self.assertEqual(dup.status_code, 409)
        self.assertEqual(self.web.get("/api/servers/99/metrics").status_code, 404)

    def test_autenticacion_opcional(self):
        os.environ["WEB_PASSWORD"] = "secreto"
        tok = lambda u, p: {"Authorization": "Basic " + base64.b64encode(f"{u}:{p}".encode()).decode()}
        self.assertEqual(self.web.get("/").status_code, 401)
        self.assertEqual(self.web.get("/api/servers").status_code, 401)
        self.assertEqual(self.web.get("/", headers=tok("admin", "mala")).status_code, 401)
        self.assertEqual(self.web.get("/", headers=tok("admin", "secreto")).status_code, 200)
        self.assertEqual(self.web.get("/healthz").status_code, 200)
        os.environ["WEB_PASSWORD"] = ""
        self.assertEqual(self.web.get("/").status_code, 200)


class ModoDemo(unittest.TestCase):
    def setUp(self):
        self._real = web_app.store
        web_app.store = store_mod.MockStore()
        self.web = web_app.app.test_client()

    def tearDown(self):
        web_app.store = self._real

    def test_demo_completo(self):
        d = self.web.get("/api/overview").get_json()
        self.assertEqual(len(d["servers"]), 5)
        self.assertIsNone(d["worker"])
        states = {s["hostname"]: s["status"] for s in d["servers"]}
        self.assertEqual(states["ubuntu-db"], "sin_respuesta")
        self.assertEqual(states["ubuntu-backup"], "deshabilitado")

        r = self.web.post("/api/servers", json={"hostname": "nuevo", "ip": "10.9.9.9", "comunidad": "public"})
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.get_json()["status"], "sin_datos")
        sid = r.get_json()["id"]
        self.assertEqual(self.web.put(f"/api/servers/{sid}", json={"enabled": False}).get_json()["status"],
                         "deshabilitado")
        self.assertEqual(self.web.delete(f"/api/servers/{sid}").status_code, 204)
        m = self.web.get("/api/servers/1/metrics?range=7d").get_json()
        self.assertIn(len(m["points"]), (336, 337))   # tramos de 30 min, según la hora de corte


if __name__ == "__main__":
    unittest.main()
