"""Acceso a MySQL: lee servidores y configuración, escribe mediciones."""
import logging
import time

import config

log = logging.getLogger("worker.db")


class DBError(Exception):
    """No se pudo hablar con MySQL."""


class Database:
    def __init__(self, cfg=None):
        import pymysql
        import pymysql.cursors
        self._pm = pymysql
        self._cfg = dict(cfg or config.DB, charset="utf8mb4", connect_timeout=5,
                         autocommit=True, cursorclass=pymysql.cursors.DictCursor)

    def _run(self, sql, args=None, many=False, fetch=False):
        pm = self._pm
        try:
            conn = pm.connect(**self._cfg)
        except pm.err.OperationalError as e:
            raise DBError(f"no se pudo conectar a MySQL: {e}") from e
        try:
            with conn.cursor() as cur:
                if many:
                    cur.executemany(sql, args)
                else:
                    cur.execute(sql, args)
                return cur.fetchall() if fetch else cur.rowcount
        except pm.err.MySQLError as e:
            raise DBError(f"error de MySQL: {e}") from e
        finally:
            conn.close()

    def wait_until_ready(self, attempts=30, delay=3):
        """MySQL tarda en arrancar la primera vez: reintenta antes de rendirse."""
        for i in range(1, attempts + 1):
            try:
                self._run("SELECT 1 FROM servers LIMIT 1", fetch=True)
                return
            except DBError as e:
                log.info("esperando a MySQL (%d/%d): %s", i, attempts, e)
                time.sleep(delay)
        raise DBError("MySQL no quedó disponible a tiempo")

    def interval_minutes(self):
        rows = self._run("SELECT valor FROM settings WHERE clave='intervalo_minutos'", fetch=True)
        try:
            minutes = int(rows[0]["valor"]) if rows else config.DEFAULT_INTERVAL_MIN
        except (ValueError, KeyError):
            minutes = config.DEFAULT_INTERVAL_MIN
        return max(1, minutes)

    def enabled_servers(self):
        return self._run("SELECT id, hostname, ip, comunidad FROM servers WHERE enabled=1 ORDER BY id",
                         fetch=True)

    def insert_metrics(self, rows):
        """rows: [(server_id, fecha, cpu, ram, disco, uptime), ...]

        Usa INSERT ... SELECT para que, si alguien borra un servidor desde la web
        mientras corre la ronda, esa fila se descarte sin romper la clave foránea
        y sin perder las mediciones de los demás.
        """
        if rows:
            self._run("INSERT INTO metrics (server_id, fecha, cpu, ram, disco, uptime) "
                      "SELECT %s,%s,%s,%s,%s,%s FROM servers WHERE id=%s",
                      [tuple(r) + (r[0],) for r in rows], many=True)

    def heartbeat(self, ok, failed):
        """Avisa a la web que el worker está vivo (la web lo muestra en el Panel)."""
        self._run("INSERT INTO settings (clave, valor) VALUES (%s,%s) "
                  "ON DUPLICATE KEY UPDATE valor=VALUES(valor)",
                  [("worker_ultima_ronda", str(int(time.time()))),
                   ("worker_ultimo_resultado", f"{ok}/{ok + failed}")], many=True)
