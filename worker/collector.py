"""OIDs a consultar y cálculo de las métricas (sin dependencias de red)."""

# nombre -> OID (Net-SNMP, ver el PDF del proyecto)
OIDS = {
    "uptime_ticks": "1.3.6.1.2.1.25.1.1.0",     # hrSystemUptime.0 (centésimas de segundo)
    "cpu_idle": "1.3.6.1.4.1.2021.11.11.0",     # ssCpuIdle.0 (% ocioso)
    "mem_total": "1.3.6.1.4.1.2021.4.5.0",      # memTotalReal.0 (KB)
    "mem_avail": "1.3.6.1.4.1.2021.4.6.0",      # memAvailReal.0 (KB libres)
    "mem_buffer": "1.3.6.1.4.1.2021.4.14.0",    # memBuffer.0 (KB)
    "mem_cached": "1.3.6.1.4.1.2021.4.15.0",    # memCached.0 (KB)
    "disk_pct": "1.3.6.1.4.1.2021.9.1.9.1",     # dskPercent.1 (% usado de "disk /")
}

# Sin estos no hay medición útil. Disco y uptime pueden faltar.
REQUIRED = ("cpu_idle", "mem_total", "mem_avail")


class IncompleteData(Exception):
    """El agente respondió, pero faltan datos imprescindibles."""


def _clamp(v, lo=0.0, hi=100.0):
    return max(lo, min(hi, v))


def build_metrics(raw):
    """raw: {nombre: int | None}. Devuelve {cpu, ram, disco, uptime}."""
    missing = [k for k in REQUIRED if raw.get(k) is None]
    if missing:
        raise IncompleteData(
            "el agente no expone " + ", ".join(missing)
            + " (revisar la vista/community en snmpd.conf)")

    total = raw["mem_total"]
    if total <= 0:
        raise IncompleteData("memTotalReal vale 0")

    cpu = _clamp(100 - raw["cpu_idle"])
    # La memoria reciclable (buffers y caché) no cuenta como usada.
    used = total - raw["mem_avail"] - (raw.get("mem_buffer") or 0) - (raw.get("mem_cached") or 0)
    ram = _clamp(100 * used / total)
    disk = raw.get("disk_pct")
    ticks = raw.get("uptime_ticks")

    return {
        "cpu": round(cpu, 2),
        "ram": round(ram, 2),
        "disco": round(_clamp(disk), 2) if disk is not None else None,
        "uptime": int(ticks // 100) if ticks is not None else None,
    }
