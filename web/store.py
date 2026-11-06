"""Capa de datos de la web.

Hay dos implementaciones con la MISMA interfaz:

* MockStore  -> datos de ejemplo generados en memoria (no necesita base de datos).
* MySQLStore -> lee y escribe en las tablas servers / metrics / settings.

Se elige con la variable de entorno USE_MOCK (1 = demo, 0 = MySQL).
Todas las fechas son UTC "naive" (sin tzinfo), igual que en la columna DATETIME.
"""
import calendar
import math
import os
import random
from datetime import datetime, timedelta, timezone

DEFAULT_SETTINGS = {
    "intervalo_minutos": "5",
    "umbral_aviso": "70",
    "umbral_critico": "90",
    "comunidad_default": "public",
    "retencion_dias": "30",
}

STEP = 300  # segundos entre mediciones (5 min)


class DBUnavailable(Exception):
    """No se pudo hablar con la base de datos."""


def utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _slot(dt):
    """Redondea hacia abajo al múltiplo de 5 minutos."""
    dt = dt.replace(second=0, microsecond=0)
    return dt - timedelta(minutes=dt.minute % 5)


def _epoch(dt):
    return calendar.timegm(dt.timetuple())


# ---------------------------------------------------------------------------
# Modo demo
# ---------------------------------------------------------------------------
# cpu/ram/disk: valores base. peak: hora UTC de mayor carga. gaps: cortes de
# medición, como (hace_horas_inicio, hace_horas_fin). dead_hours: el
# servidor dejó de responder hace esas horas.
SEED_SERVERS = [
    dict(hostname="ubuntu-01", ip="192.168.56.11", comunidad="public", enabled=True,
         cpu=28, cpu_amp=22, ram=52, disk=41, peak=15, boot_days=23),
    dict(hostname="ubuntu-02", ip="192.168.56.12", comunidad="public", enabled=True,
         cpu=48, cpu_amp=24, ram=68, disk=63, peak=14, boot_days=12, gaps=[(9.0, 7.75)]),
    dict(hostname="ubuntu-web", ip="192.168.56.20", comunidad="monitor", enabled=True,
         cpu=60, cpu_amp=30, ram=74, disk=58, peak=17, boot_days=41),
    dict(hostname="ubuntu-db", ip="192.168.56.30", comunidad="public", enabled=True,
         cpu=40, cpu_amp=25, ram=81, disk=77, peak=13, boot_days=65, dead_hours=3),
    dict(hostname="ubuntu-backup", ip="192.168.56.40", comunidad="public", enabled=False,
         cpu=18, cpu_amp=12, ram=35, disk=88, peak=3, boot_days=90, dead_hours=36),
]
_BOOT_REF = datetime(2026, 10, 1)


class MockStore:
    is_mock = True

    def __init__(self):
        self._servers = {}
        self._profiles = {}
        self._next_id = 1
        self._settings = dict(DEFAULT_SETTINGS)
        for seed in SEED_SERVERS:
            s = dict(seed)
            prof = {k: s.pop(k) for k in
                    ("cpu", "cpu_amp", "ram", "disk", "peak", "boot_days", "gaps", "dead_hours")
                    if k in s}
            self._add(s, prof)

    # -- servidores ---------------------------------------------------------
    def _add(self, data, profile):
        sid = self._next_id
        self._next_id += 1
        self._servers[sid] = {"id": sid, **data}
        profile.setdefault("gaps", [])
        profile.setdefault("dead_hours", None)
        profile.setdefault("since", None)
        self._profiles[sid] = profile
        return self._servers[sid]

    def _check_unique(self, data, ignore_id=None):
        for s in self._servers.values():
            if s["id"] == ignore_id:
                continue
            if s["ip"] == data["ip"]:
                raise ValueError("Ya existe un servidor con esa IP.")
            if s["hostname"].lower() == data["hostname"].lower():
                raise ValueError("Ya existe un servidor con ese hostname.")

    def list_servers(self):
        return [dict(s) for s in sorted(self._servers.values(), key=lambda s: s["id"])]

    def get_server(self, sid):
        s = self._servers.get(sid)
        return dict(s) if s else None

    def create_server(self, data):
        self._check_unique(data)
        rnd = random.Random(data["ip"])
        profile = dict(cpu=rnd.randint(20, 55), cpu_amp=rnd.randint(10, 25),
                       ram=rnd.randint(35, 70), disk=rnd.randint(30, 65),
                       peak=rnd.randint(8, 20), boot_days=rnd.randint(2, 40),
                       # el worker "lo descubre" en la próxima ronda
                       since=_slot(utcnow()) + timedelta(seconds=STEP))
        return dict(self._add(dict(data), profile))

    def update_server(self, sid, data):
        if sid not in self._servers:
            return None
        self._check_unique(data, ignore_id=sid)
        self._servers[sid].update(data)
        return dict(self._servers[sid])

    def delete_server(self, sid):
        self._profiles.pop(sid, None)
        return self._servers.pop(sid, None) is not None

    # -- métricas (generadas de forma determinística) -------------------------
    def _has_metric(self, sid, slot, now, midnight):
        p = self._profiles[sid]
        if p["since"] and slot < p["since"]:
            return False
        if p["dead_hours"] is not None and slot > now - timedelta(hours=p["dead_hours"]):
            return False
        for a, b in p["gaps"]:
            if now - timedelta(hours=a) <= slot < now - timedelta(hours=b):
                return False
        return slot <= now

    def _row(self, sid, slot):
        p = self._profiles[sid]
        t = _epoch(slot)
        rnd = random.Random(f"{sid}:{t}")
        hour = (t % 86400) / 3600
        wave = 0.5 + 0.5 * math.cos(2 * math.pi * (hour - p["peak"]) / 24)
        cpu = p["cpu"] + p["cpu_amp"] * wave * 0.7 + rnd.gauss(0, 2.5)
        if rnd.random() < 0.015:
            cpu += rnd.uniform(12, 30)
        ram = p["ram"] + 6 * wave + 3 * math.sin(t / 86400 * 2 * math.pi / 3) + rnd.gauss(0, 0.7)
        disk = p["disk"] + 0.8 * math.sin(2 * math.pi * t / (86400 * 9)) + rnd.gauss(0, 0.05)
        boot = _BOOT_REF - timedelta(days=p["boot_days"])
        uptime = int((slot - boot).total_seconds())
        clamp = lambda v: round(min(99.5, max(1.0, v)), 1)
        return {"fecha": slot, "cpu": clamp(cpu), "ram": clamp(ram),
                "disco": clamp(disk), "uptime": uptime}

    def metrics(self, sid, since):
        if sid not in self._profiles:
            return []
        now = _slot(utcnow())
        midnight = now.replace(hour=0, minute=0)
        slot = max(_slot(since), now - timedelta(days=30))
        if slot < since:
            slot += timedelta(seconds=STEP)
        rows = []
        while slot <= now:
            if self._has_metric(sid, slot, now, midnight):
                rows.append(self._row(sid, slot))
            slot += timedelta(seconds=STEP)
        return rows

    def last_metric(self, sid):
        if sid not in self._profiles:
            return None
        now = _slot(utcnow())
        midnight = now.replace(hour=0, minute=0)
        slot = now
        for _ in range(1200):  # hasta ~4 días hacia atrás
            if self._has_metric(sid, slot, now, midnight):
                return self._row(sid, slot)
            slot -= timedelta(seconds=STEP)
        return None

    # -- configuración -------------------------------------------------------
    def get_settings(self):
        return dict(self._settings)

    def save_settings(self, data):
        self._settings.update({k: str(v) for k, v in data.items()})
        return dict(self._settings)


# ---------------------------------------------------------------------------
# MySQL real
# ---------------------------------------------------------------------------
class MySQLStore:
    is_mock = False

    def __init__(self):
        import pymysql
        import pymysql.cursors
        self.pymysql = pymysql
        self.cfg = dict(
            host=os.getenv("DB_HOST", "mysql"),
            port=int(os.getenv("DB_PORT", "3306")),
            user=os.getenv("DB_USER", "snmp"),
            password=os.environ["DB_PASSWORD"],
            database=os.getenv("DB_NAME", "snmp_monitor"),
            charset="utf8mb4",
            cursorclass=pymysql.cursors.DictCursor,
            connect_timeout=5,
            autocommit=True,
        )

    def _run(self, sql, args=(), fetch=None):
        pm = self.pymysql
        try:
            conn = pm.connect(**self.cfg)
        except pm.err.OperationalError as e:
            raise DBUnavailable("No se pudo conectar a la base de datos.") from e
        try:
            with conn.cursor() as cur:
                cur.execute(sql, args)
                if fetch == "all":
                    return cur.fetchall()
                if fetch == "one":
                    return cur.fetchone()
                return cur.lastrowid if cur.lastrowid else cur.rowcount
        except pm.err.IntegrityError as e:
            raise ValueError("Ya existe un servidor con ese hostname o esa IP.") from e
        except pm.err.OperationalError as e:
            raise DBUnavailable("Error al consultar la base de datos.") from e
        finally:
            conn.close()

    @staticmethod
    def _server(r):
        return {"id": r["id"], "hostname": r["hostname"], "ip": r["ip"],
                "comunidad": r["comunidad"], "enabled": bool(r["enabled"])}

    @staticmethod
    def _metric(r):
        # disco y uptime pueden ser NULL (p. ej. snmpd sin "disk /"): no mostrarlos como 0
        return {"fecha": r["fecha"], "cpu": float(r["cpu"] or 0), "ram": float(r["ram"] or 0),
                "disco": float(r["disco"]) if r["disco"] is not None else None,
                "uptime": int(r["uptime"]) if r["uptime"] is not None else None}

    def list_servers(self):
        rows = self._run("SELECT id, hostname, ip, comunidad, enabled FROM servers ORDER BY id",
                         fetch="all")
        return [self._server(r) for r in rows]

    def get_server(self, sid):
        r = self._run("SELECT id, hostname, ip, comunidad, enabled FROM servers WHERE id=%s",
                      (sid,), fetch="one")
        return self._server(r) if r else None

    def create_server(self, data):
        sid = self._run(
            "INSERT INTO servers (hostname, ip, comunidad, enabled) VALUES (%s,%s,%s,%s)",
            (data["hostname"], data["ip"], data["comunidad"], int(data["enabled"])))
        return self.get_server(sid)

    def update_server(self, sid, data):
        if not self.get_server(sid):
            return None
        self._run("UPDATE servers SET hostname=%s, ip=%s, comunidad=%s, enabled=%s WHERE id=%s",
                  (data["hostname"], data["ip"], data["comunidad"], int(data["enabled"]), sid))
        return self.get_server(sid)

    def delete_server(self, sid):
        return self._run("DELETE FROM servers WHERE id=%s", (sid,)) > 0

    def metrics(self, sid, since):
        rows = self._run(
            "SELECT fecha, cpu, ram, disco, uptime FROM metrics "
            "WHERE server_id=%s AND fecha >= %s ORDER BY fecha", (sid, since), fetch="all")
        return [self._metric(r) for r in rows]

    def last_metric(self, sid):
        r = self._run(
            "SELECT fecha, cpu, ram, disco, uptime FROM metrics "
            "WHERE server_id=%s ORDER BY fecha DESC LIMIT 1", (sid,), fetch="one")
        return self._metric(r) if r else None

    def get_worker_info(self):
        """Último latido del worker, o None si todavía no completó ninguna ronda."""
        rows = self._run("SELECT clave, valor FROM settings WHERE clave IN "
                         "('worker_ultima_ronda','worker_ultimo_resultado')", fetch="all")
        d = {r["clave"]: r["valor"] for r in rows}
        try:
            ts = int(d["worker_ultima_ronda"])
        except (KeyError, ValueError):
            return None
        return {"last_round": datetime.fromtimestamp(ts, timezone.utc).replace(tzinfo=None),
                "result": d.get("worker_ultimo_resultado")}

    def get_settings(self):
        out = dict(DEFAULT_SETTINGS)
        for r in self._run("SELECT clave, valor FROM settings", fetch="all"):
            out[r["clave"]] = r["valor"]
        return out

    def save_settings(self, data):
        for k, v in data.items():
            self._run("INSERT INTO settings (clave, valor) VALUES (%s,%s) "
                      "ON DUPLICATE KEY UPDATE valor=VALUES(valor)", (k, str(v)))
        return self.get_settings()


def get_store():
    if os.getenv("USE_MOCK", "1") == "0":
        return MySQLStore()
    return MockStore()
