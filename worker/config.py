"""Configuración del worker (todo por variables de entorno)."""
import os


def _int(name, default):
    try:
        return int(os.getenv(name, default))
    except ValueError:
        return int(default)


DB = dict(
    host=os.getenv("DB_HOST", "mysql"),
    port=_int("DB_PORT", 3306),
    user=os.getenv("DB_USER", "snmp"),
    password=os.getenv("DB_PASSWORD", "snmp"),
    database=os.getenv("DB_NAME", "snmp_monitor"),
)

SNMP_PORT = _int("SNMP_PORT", 161)
SNMP_TIMEOUT = _int("SNMP_TIMEOUT", 3)          # segundos por intento
SNMP_RETRIES = _int("SNMP_RETRIES", 1)
SNMP_CONCURRENCY = _int("SNMP_CONCURRENCY", 10)  # servidores consultados a la vez

DEFAULT_INTERVAL_MIN = 5   # si la base todavía no tiene settings.intervalo_minutos
RUN_ONCE = os.getenv("RUN_ONCE", "0") == "1"     # una sola ronda y salir (para pruebas)
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
