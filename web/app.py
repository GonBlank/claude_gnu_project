import calendar
import calendar
import hmac
import ipaddress
import os
import re
from datetime import timedelta

from flask import Flask, Response, jsonify, render_template, request, redirect, url_for

import store as store_mod
from store import DBUnavailable, DEFAULT_SETTINGS, utcnow

app = Flask(__name__)
store = store_mod.get_store()

HOST_RE = re.compile(r"^[A-Za-z0-9]([A-Za-z0-9._-]{0,98}[A-Za-z0-9])?$")
BUCKET = 1800  # 30 min
RANGES = {"1h": (1, None), "6h": (6, None), "24h": (24, None), "7d": (168, BUCKET)}


# ---------------------------------------------------------------------------
# Utilidades
# ---------------------------------------------------------------------------
def to_ms(dt):
    return int(calendar.timegm(dt.timetuple()) * 1000)


def settings_typed():
    raw = store.get_settings()
    out = {}
    for k, default in DEFAULT_SETTINGS.items():
        v = raw.get(k, default)
        if k == "comunidad_default":
            out[k] = v
        else:
            try:
                out[k] = int(v)
            except (TypeError, ValueError):
                out[k] = int(default)
    return out


def metric_json(m):
    if not m:
        return None
    return {"ts": to_ms(m["fecha"]), "cpu": m["cpu"], "ram": m["ram"],
            "disco": m["disco"], "uptime": m["uptime"]}


def server_status(server, last, cfg):
    if not server["enabled"]:
        return "deshabilitado"
    if not last:
        return "sin_datos"
    age = (utcnow() - last["fecha"]).total_seconds()
    return "online" if age <= cfg["intervalo_minutos"] * 120 + 60 else "sin_respuesta"


def _avg(vals):
    vals = [v for v in vals if v is not None]
    return round(sum(vals) / len(vals), 1) if vals else None


def worker_info(cfg):
    """Estado del worker según su último latido. None en modo demo."""
    if store.is_mock:
        return None
    info = store.get_worker_info()
    if not info:
        return {"status": "never"}
    age = (utcnow() - info["last_round"]).total_seconds()
    return {"status": "ok" if age <= cfg["intervalo_minutos"] * 120 + 60 else "late",
            "last_ts": to_ms(info["last_round"]), "result": info["result"]}


def severity(last, cfg):
    if not last:
        return "ok"
    vals = [v for v in (last["cpu"], last["ram"], last["disco"]) if v is not None]
    worst = max(vals) if vals else 0
    if worst >= cfg["umbral_critico"]:
        return "crit"
    if worst >= cfg["umbral_aviso"]:
        return "warn"
    return "ok"


def describe(server, cfg):
    last = store.last_metric(server["id"])
    status = server_status(server, last, cfg)
    return {**server, "status": status,
            "severity": severity(last, cfg) if status == "online" else "ok",
            "last": metric_json(last)}


def clean_server(payload):
    """Valida el cuerpo de alta/edición. Devuelve (datos, mensaje_de_error)."""
    hostname = str(payload.get("hostname", "")).strip()
    ip = str(payload.get("ip", "")).strip()
    comunidad = str(payload.get("comunidad", "")).strip()
    if not HOST_RE.match(hostname):
        return None, "El hostname solo puede tener letras, números, punto, guion y guion bajo."
    try:
        ip = str(ipaddress.ip_address(ip))
    except ValueError:
        return None, "La IP no es válida."
    if not comunidad or len(comunidad) > 64:
        return None, "La community es obligatoria (máximo 64 caracteres)."
    return {"hostname": hostname, "ip": ip, "comunidad": comunidad,
            "enabled": bool(payload.get("enabled", True))}, None


def clean_settings(payload):
    try:
        data = {
            "intervalo_minutos": int(payload["intervalo_minutos"]),
            "umbral_aviso": int(payload["umbral_aviso"]),
            "umbral_critico": int(payload["umbral_critico"]),
            "retencion_dias": int(payload["retencion_dias"]),
            "comunidad_default": str(payload["comunidad_default"]).strip(),
        }
    except (KeyError, TypeError, ValueError):
        return None, "Completá todos los campos con valores numéricos válidos."
    if not 1 <= data["intervalo_minutos"] <= 60:
        return None, "El intervalo debe estar entre 1 y 60 minutos."
    if not 1 <= data["umbral_aviso"] <= 99:
        return None, "El umbral de aviso debe estar entre 1 y 99."
    if not data["umbral_aviso"] < data["umbral_critico"] <= 100:
        return None, "El umbral crítico tiene que ser mayor que el de aviso y no pasar de 100."
    if not 1 <= data["retencion_dias"] <= 365:
        return None, "La retención debe estar entre 1 y 365 días."
    if not data["comunidad_default"] or len(data["comunidad_default"]) > 64:
        return None, "La community por defecto es obligatoria (máximo 64 caracteres)."
    return data, None


# ---------------------------------------------------------------------------
# Páginas
# ---------------------------------------------------------------------------
@app.before_request
def require_auth():
    """Autenticación básica opcional: se activa si WEB_PASSWORD está definida."""
    password = os.getenv("WEB_PASSWORD", "")
    if not password or request.path == "/healthz":
        return None
    user = os.getenv("WEB_USER", "admin")
    a = request.authorization
    if (a and hmac.compare_digest((a.username or "").encode(), user.encode())
            and hmac.compare_digest((a.password or "").encode(), password.encode())):
        return None
    return Response("Se requiere autenticación.", 401,
                    {"WWW-Authenticate": 'Basic realm="Lector SNMP"'})


@app.context_processor
def inject():
    return {"mock": store.is_mock}


@app.get("/")
def page_dashboard():
    return render_template("dashboard.html", active="dashboard")


@app.get("/servers")
def page_servers():
    return render_template("servers.html", active="servers")


@app.get("/servers/<int:sid>")
def page_detail(sid):
    """Vista ampliada de un host; las métricas se cargan mediante la API."""
    return render_template("detail.html", active="servers", server_id=sid)


@app.get("/history")
def page_history():
    """Redirigir enlaces históricos a la nueva vista individual."""
    sid = request.args.get("server", type=int)
    if sid is None:
        return redirect(url_for("page_servers"))
    return redirect(url_for("page_detail", sid=sid))


@app.get("/settings")
def page_settings():
    return render_template("settings.html", active="settings")


@app.get("/healthz")
def healthz():
    return {"status": "ok", "mode": "demo" if store.is_mock else "mysql"}


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------
@app.errorhandler(DBUnavailable)
def db_down(e):
    return jsonify(error=str(e)), 503


@app.get("/api/overview")
def api_overview():
    cfg = settings_typed()
    end = utcnow()
    start = end - timedelta(hours=24)
    nb = 48
    sums = [[0.0, 0.0, 0] for _ in range(nb)]
    servers = []

    for s in store.list_servers():
        d = describe(s, cfg)
        rows = store.metrics(s["id"], start)
        avail = [None] * nb
        if rows:
            first = min(nb - 1, int((rows[0]["fecha"] - start).total_seconds() // BUCKET))
            for i in range(first, nb):
                avail[i] = 0
            for r in rows:
                i = min(nb - 1, int((r["fecha"] - start).total_seconds() // BUCKET))
                avail[i] = 1
                if s["enabled"]:
                    sums[i][0] += r["cpu"]
                    sums[i][1] += r["ram"]
                    sums[i][2] += 1
        elif d["last"]:
            # Ya se había medido este host: 24 horas sin lecturas no son "sin historial".
            avail = [0] * nb
        known = [a for a in avail if a is not None]
        d["availability"] = avail
        d["availability_pct"] = round(100 * sum(known) / len(known)) if known else None
        servers.append(d)

    online = [s for s in servers if s["status"] == "online"]
    kpis = {
        "total": len(servers),
        "enabled": sum(1 for s in servers if s["enabled"]),
        "online": len(online),
        "down": sum(1 for s in servers if s["status"] == "sin_respuesta"),
        "alerts": sum(1 for s in online if s["severity"] != "ok"),
        "cpu_avg": round(sum(s["last"]["cpu"] for s in online) / len(online), 1) if online else None,
    }
    series = {"cpu": [], "ram": []}
    for i, (c, r, n) in enumerate(sums):
        ts = to_ms(start + timedelta(seconds=(i + 0.5) * BUCKET))
        series["cpu"].append([ts, round(c / n, 1) if n else None])
        series["ram"].append([ts, round(r / n, 1) if n else None])

    return jsonify(servers=servers, kpis=kpis, series=series, settings=cfg,
                   worker=worker_info(cfg), bucket_ms=BUCKET * 1000, start=to_ms(start), now=to_ms(end))


@app.get("/api/servers")
def api_servers():
    cfg = settings_typed()
    return jsonify(servers=[describe(s, cfg) for s in store.list_servers()], settings=cfg)



@app.get("/api/servers/<int:sid>/availability")
def api_server_availability(sid):
    """48 intervalos de 30 min del host seleccionado (24 h).

    1 = se recibió una medición, 0 = no se recibió desde su primera lectura,
    None = todavía no hay historial. No equivale a un chequeo ICMP.
    """
    server = store.get_server(sid)
    if not server:
        return jsonify(error="El servidor no existe."), 404
    end = utcnow()
    start = end - timedelta(hours=24)
    readings = store.metrics(sid, start)
    bins = [None] * 48
    if readings:
        first = max(0, min(47, int((readings[0]["fecha"] - start).total_seconds() // BUCKET)))
        bins[first:] = [0] * (48 - first)
        for reading in readings:
            idx = int((reading["fecha"] - start).total_seconds() // BUCKET)
            if 0 <= idx < 48:
                bins[idx] = 1
    elif store.last_metric(sid):
        # Sin lecturas recientes, pero con historial previo: intervalos sin respuesta.
        bins = [0] * 48
    known = [value for value in bins if value is not None]
    percentage = round(100 * sum(known) / len(known)) if known else None
    return jsonify(availability=bins, availability_pct=percentage,
                   start=to_ms(start), bucket_ms=BUCKET * 1000)


@app.post("/api/servers")
def api_server_create():
    data, err = clean_server(request.get_json(silent=True) or {})
    if err:
        return jsonify(error=err), 400
    try:
        created = store.create_server(data)
    except ValueError as e:
        return jsonify(error=str(e)), 409
    return jsonify(describe(created, settings_typed())), 201


@app.put("/api/servers/<int:sid>")
def api_server_update(sid):
    current = store.get_server(sid)
    if not current:
        return jsonify(error="El servidor no existe."), 404
    merged = {**current, **(request.get_json(silent=True) or {})}
    data, err = clean_server(merged)
    if err:
        return jsonify(error=err), 400
    try:
        updated = store.update_server(sid, data)
    except ValueError as e:
        return jsonify(error=str(e)), 409
    return jsonify(describe(updated, settings_typed()))


@app.delete("/api/servers/<int:sid>")
def api_server_delete(sid):
    if not store.delete_server(sid):
        return jsonify(error="El servidor no existe."), 404
    return "", 204


@app.get("/api/servers/<int:sid>/metrics")
def api_metrics(sid):
    server = store.get_server(sid)
    if not server:
        return jsonify(error="El servidor no existe."), 404
    key = request.args.get("range", "24h")
    hours, bucket = RANGES.get(key, RANGES["24h"])
    cfg = settings_typed()
    since = utcnow() - timedelta(hours=hours)
    rows = store.metrics(sid, since)

    if bucket:
        grouped = {}
        for r in rows:
            b = int(calendar.timegm(r["fecha"].timetuple()) // bucket)
            grouped.setdefault(b, []).append(r)
        points = []
        for b in sorted(grouped):
            g = grouped[b]
            points.append({"ts": b * bucket * 1000,
                           **{k: _avg(x[k] for x in g) for k in ("cpu", "ram", "disco")}})
    else:
        points = [{"ts": to_ms(r["fecha"]), "cpu": r["cpu"], "ram": r["ram"],
                   "disco": r["disco"]} for r in rows]

    stats = {}
    for k in ("cpu", "ram", "disco"):
        vals = [r[k] for r in rows if r[k] is not None]
        stats[k] = ({"avg": round(sum(vals) / len(vals), 1), "min": min(vals), "max": max(vals)}
                    if vals else None)

    latest = [metric_json(r) for r in reversed(rows[-15:])]
    return jsonify(server=describe(server, cfg), range=key, points=points, stats=stats,
                   latest=latest, count=len(rows), settings=cfg)


@app.get("/api/settings")
def api_settings_get():
    return jsonify(settings_typed())


@app.put("/api/settings")
def api_settings_put():
    data, err = clean_settings(request.get_json(silent=True) or {})
    if err:
        return jsonify(error=err), 400
    store.save_settings(data)
    return jsonify(settings_typed())


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000, debug=True)
