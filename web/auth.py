"""Autenticación de la web: formulario + cookie firmada, sin login HTTP Basic.

Se reutiliza WEB_PASSWORD, que start.sh ya genera aleatoriamente en .env.
No hay sesiones en MySQL ni una clave nueva que migrar en instalaciones existentes.
"""
import hashlib
import hmac
import os
import secrets
import threading
import time
from collections import deque
from urllib.parse import urlsplit

from flask import jsonify, make_response, redirect, render_template, request, url_for
from itsdangerous import BadSignature, URLSafeTimedSerializer

SESSION_COOKIE = "snmp_session"
LOGIN_CHALLENGE_COOKIE = "snmp_login_challenge"
SESSION_SECONDS = 8 * 60 * 60
CHALLENGE_SECONDS = 20 * 60
FAILURE_WINDOW = 5 * 60
MAX_FAILURES = 5

_failed = {}
_failed_lock = threading.Lock()


def enabled():
    return bool(os.environ.get("WEB_PASSWORD", ""))


def username():
    return os.environ.get("WEB_USER", "admin")


def _secret():
    # Clave de firma derivada de una contraseña aleatoria, con separación de dominio.
    # Cambiar WEB_PASSWORD invalida todas las sesiones anteriores.
    return hashlib.sha256(
        b"SNMP-Monitor-Web-Session-v1\0" + os.environ["WEB_PASSWORD"].encode("utf-8")
    ).digest()


def _signer():
    return URLSafeTimedSerializer(_secret(), salt="snmp-monitor-auth-v1")


def current_token():
    """Devuelve el token validado, nunca el valor de una cookie sin verificar."""
    if not enabled():
        return None
    token = request.cookies.get(SESSION_COOKIE, "")
    if not token:
        return None
    try:
        payload = _signer().loads(token, max_age=SESSION_SECONDS)
        if isinstance(payload, dict) and hmac.compare_digest(
            str(payload.get("user", "")).encode(), username().encode()
        ):
            return token
    except (BadSignature, ValueError, TypeError):
        pass
    return None


def csrf_for(token):
    return hmac.new(_secret(), ("csrf:" + token).encode(), hashlib.sha256).hexdigest()


def _valid_csrf():
    session_token = current_token()
    if not session_token:
        return False
    provided = request.headers.get("X-CSRF-Token", "") or request.form.get("csrf_token", "")
    return bool(provided) and hmac.compare_digest(provided, csrf_for(session_token))


def _cookie_secure():
    # Para un reverse proxy HTTPS, WEB_COOKIE_SECURE=1.
    return request.is_secure or os.environ.get("WEB_COOKIE_SECURE") == "1"


def safe_next(candidate):
    """Nunca aceptar esquemas, dominios, //host o backslashes como destino."""
    if not isinstance(candidate, str) or not candidate.startswith("/"):
        return "/"
    if candidate.startswith("//") or "\\" in candidate or any(ord(c) < 32 for c in candidate):
        return "/"
    parts = urlsplit(candidate)
    if parts.scheme or parts.netloc or parts.path in ("/login", "/logout"):
        return "/"
    return candidate if len(candidate) <= 2048 else "/"


def _failures_exceeded(ip):
    with _failed_lock:
        now = time.monotonic()
        # Límite de memoria para visitantes desconocidos.
        if len(_failed) > 1024:
            for key in list(_failed):
                if not _failed[key] or now - _failed[key][-1] > FAILURE_WINDOW:
                    _failed.pop(key, None)
            if len(_failed) > 1024:
                _failed.clear()
        values = _failed.setdefault(ip, deque())
        while values and now - values[0] > FAILURE_WINDOW:
            values.popleft()
        return len(values) >= MAX_FAILURES


def _record_failure(ip):
    with _failed_lock:
        _failed.setdefault(ip, deque()).append(time.monotonic())


def _clear_failures(ip):
    with _failed_lock:
        _failed.pop(ip, None)


def _login_response(next_path, error=None, code=200):
    challenge = secrets.token_urlsafe(32)
    response = make_response(
        render_template(
            "login.html", next_path=next_path, challenge=challenge,
            error=error, default_user=username(),
        ), code
    )
    response.set_cookie(
        LOGIN_CHALLENGE_COOKIE, challenge, max_age=CHALLENGE_SECONDS,
        httponly=True, secure=_cookie_secure(), samesite="Lax", path="/login",
    )
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Frame-Options"] = "DENY"
    return response


def install_auth(app):
    @app.after_request
    def secure_auth_responses(response):
        if enabled() and request.endpoint != "static":
            # Evitar contenido autenticado en caches compartidas/navegador.
            response.headers.setdefault("Cache-Control", "no-store")
            response.headers.setdefault("Vary", "Cookie")
            response.headers.setdefault("X-Content-Type-Options", "nosniff")
            response.headers.setdefault("Referrer-Policy", "same-origin")
        return response

    @app.before_request
    def web_auth_guard():
        # El healthcheck y los assets del login son públicos.
        if request.endpoint in ("static", "login", "healthz"):
            return None
        if not enabled():
            return None
        if current_token() is None:
            if request.path.startswith("/api/"):
                return jsonify(error="La sesión caducó. Volvé a iniciar sesión."), 401
            target = safe_next(request.full_path.rstrip("?"))
            return redirect(url_for("login", next=target))
        if request.method in ("POST", "PUT", "PATCH", "DELETE") and not _valid_csrf():
            if request.path.startswith("/api/"):
                return jsonify(error="Token de seguridad ausente o inválido."), 403
            return "Solicitud no autorizada.", 403
        return None

    @app.context_processor
    def session_context():
        token = current_token()
        return {
            "web_auth_enabled": enabled(),
            "web_user": username() if token else None,
            "csrf_token": csrf_for(token) if token else "",
        }

    @app.route("/login", methods=["GET", "POST"])
    def login():
        if not enabled():
            return redirect(url_for("page_dashboard"))
        next_path = safe_next(
            request.form.get("next") if request.method == "POST" else request.args.get("next")
        )
        if request.method == "GET" and current_token():
            return redirect(next_path)
        if request.method == "GET":
            return _login_response(next_path)

        challenge = request.cookies.get(LOGIN_CHALLENGE_COOKIE, "")
        submitted = request.form.get("challenge", "")
        if not challenge or not submitted or not hmac.compare_digest(challenge, submitted):
            return _login_response(next_path, "El formulario caducó. Volvé a intentarlo.", 400)

        address = request.remote_addr or "unknown"
        if _failures_exceeded(address):
            return _login_response(next_path, "Demasiados intentos. Probá nuevamente en unos minutos.", 429)

        user = request.form.get("username", "")
        password = request.form.get("password", "")
        valid_user = hmac.compare_digest(user.encode(), username().encode())
        valid_password = hmac.compare_digest(
            password.encode(), os.environ["WEB_PASSWORD"].encode()
        )
        if not (valid_user and valid_password):
            _record_failure(address)
            return _login_response(next_path, "Usuario o contraseña incorrectos.", 401)

        _clear_failures(address)
        token = _signer().dumps({"user": username(), "nonce": secrets.token_urlsafe(16)})
        response = redirect(next_path)
        response.set_cookie(
            SESSION_COOKIE, token, max_age=SESSION_SECONDS,
            httponly=True, secure=_cookie_secure(), samesite="Lax", path="/",
        )
        response.delete_cookie(LOGIN_CHALLENGE_COOKIE, path="/login")
        response.headers["Cache-Control"] = "no-store"
        return response

    @app.post("/logout")
    def logout():
        response = redirect(url_for("login"))
        response.delete_cookie(SESSION_COOKIE, path="/")
        response.headers["Cache-Control"] = "no-store"
        return response
