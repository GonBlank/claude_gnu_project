"""Réplica mínima de pymysql sobre SQLite.

Sirve solo para probar la lógica de la web y del worker sin un MySQL real
(traduce %s -> ? y ON DUPLICATE KEY UPDATE). NO valida la sintaxis de los .sql de mysql/.
"""
import datetime
import re
import sqlite3
import sys
import types

DB_PATH = ":memory:"


class MySQLError(Exception):
    pass


class OperationalError(MySQLError):
    pass


class IntegrityError(MySQLError):
    pass


err = types.SimpleNamespace(MySQLError=MySQLError, OperationalError=OperationalError,
                            IntegrityError=IntegrityError)
cursors = types.SimpleNamespace(DictCursor=object)

sqlite3.register_adapter(datetime.datetime, lambda d: d.strftime("%Y-%m-%d %H:%M:%S"))
sqlite3.register_converter("DATETIME", lambda b: datetime.datetime.strptime(b.decode(), "%Y-%m-%d %H:%M:%S"))

SCHEMA = """
CREATE TABLE servers (id INTEGER PRIMARY KEY AUTOINCREMENT, hostname TEXT NOT NULL UNIQUE,
  ip TEXT NOT NULL UNIQUE, comunidad TEXT NOT NULL DEFAULT 'public', enabled INTEGER NOT NULL DEFAULT 1);
CREATE TABLE metrics (id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  fecha DATETIME NOT NULL, cpu REAL, ram REAL, disco REAL, uptime INTEGER);
CREATE TABLE settings (clave TEXT PRIMARY KEY, valor TEXT NOT NULL);
"""


def init_schema(path):
    global DB_PATH
    DB_PATH = path
    con = sqlite3.connect(path)
    con.executescript(SCHEMA)
    con.close()


def _translate(sql):
    sql = sql.replace("%s", "?")
    return re.sub(r"ON DUPLICATE KEY UPDATE valor=VALUES\(valor\)",
                  "ON CONFLICT(clave) DO UPDATE SET valor=excluded.valor", sql)


class _Cursor:
    def __init__(self, con):
        self._c = con.cursor()

    def __enter__(self):
        return self

    def __exit__(self, *a):
        self._c.close()

    def execute(self, sql, args=()):
        try:
            self._c.execute(_translate(sql), args or ())
        except sqlite3.IntegrityError as e:
            raise IntegrityError(str(e)) from e

    def executemany(self, sql, seq):
        try:
            self._c.executemany(_translate(sql), seq)
        except sqlite3.IntegrityError as e:
            raise IntegrityError(str(e)) from e

    def fetchall(self):
        return self._c.fetchall()

    def fetchone(self):
        return self._c.fetchone()

    @property
    def lastrowid(self):
        return self._c.lastrowid

    @property
    def rowcount(self):
        return self._c.rowcount


class _Conn:
    def __init__(self):
        self._con = sqlite3.connect(DB_PATH, detect_types=sqlite3.PARSE_DECLTYPES, isolation_level=None)
        self._con.row_factory = lambda cur, row: {d[0]: v for d, v in zip(cur.description, row)}
        self._con.execute("PRAGMA foreign_keys=ON")

    def cursor(self):
        return _Cursor(self._con)

    def close(self):
        self._con.close()


def connect(**kwargs):
    return _Conn()


def install():
    """Hace que `import pymysql` devuelva esta réplica."""
    mod = sys.modules[__name__]
    sys.modules["pymysql"] = mod
    sys.modules["pymysql.cursors"] = cursors
