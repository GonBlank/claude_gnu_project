"""Worker: cada N minutos consulta por SNMP a los servidores habilitados
y guarda una fila nueva en `metrics` por cada respuesta exitosa."""
import asyncio
import logging
import signal
import time
from datetime import datetime, timezone

import config
from db import DBError, Database

log = logging.getLogger("worker")


def utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None, microsecond=0)


async def run_cycle(db, poller, concurrency=config.SNMP_CONCURRENCY):
    """Una ronda completa. Devuelve (exitosos, fallidos)."""
    servers = db.enabled_servers()
    if not servers:
        log.info("no hay servidores habilitados")
        return 0, 0

    sem = asyncio.Semaphore(concurrency)

    async def one(server):
        async with sem:
            try:
                return server, await poller(server), None
            except Exception as e:  # un servidor caído no frena a los demás
                return server, None, e

    results = await asyncio.gather(*(one(s) for s in servers))

    rows, ok, failed = [], 0, 0
    for server, m, err in results:
        name = f"{server['hostname']} ({server['ip']})"
        if err is not None:
            failed += 1
            log.warning("%s: sin medición: %s", name, err)
            continue
        ok += 1
        log.debug("%s: %s", name, m)
        rows.append((server["id"], utcnow(), m["cpu"], m["ram"], m["disco"], m["uptime"]))
        if m["disco"] is None:
            log.warning("%s: no responde dskPercent.1 (falta 'disk /' en snmpd.conf); disco queda vacío", name)

    db.insert_metrics(rows)
    log.info("ronda terminada: %d ok, %d sin respuesta", ok, failed)
    return ok, failed


async def main():
    logging.basicConfig(level=config.LOG_LEVEL,
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    from snmp_client import poll  # recién acá, así los tests no necesitan PySNMP

    db = Database()
    db.wait_until_ready()

    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)

    log.info("worker iniciado")
    while not stop.is_set():
        started = time.monotonic()
        interval = config.DEFAULT_INTERVAL_MIN
        try:
            interval = db.interval_minutes()
            ok, failed = await run_cycle(db, poll)
            db.heartbeat(ok, failed)
        except DBError as e:
            log.error("%s", e)

        if config.RUN_ONCE:
            break
        wait = max(1.0, interval * 60 - (time.monotonic() - started))
        try:
            await asyncio.wait_for(stop.wait(), timeout=wait)
        except asyncio.TimeoutError:
            pass
    log.info("worker detenido")


if __name__ == "__main__":
    asyncio.run(main())
