#!/usr/bin/env bash
# Botón de arranque del proyecto: MySQL + worker + web.
#   ./start.sh            levanta todo (la primera vez crea el .env)
#   ./start.sh stop       apaga todo (conserva los datos)
#   ./start.sh status     muestra el estado de los tres módulos
#   ./start.sh logs [mod] sigue los logs (mod: mysql | worker | web)
#   ./start.sh reset      apaga todo y BORRA la base de datos
set -euo pipefail
cd "$(dirname "$0")"

VOLUME="snmp-monitor_mysql_data"   # proyecto fijado en docker-compose.yml

say() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }
env_get() { grep -E "^$1=" .env 2>/dev/null | head -n1 | cut -d= -f2- || true; }

command -v docker >/dev/null || die "Docker no está instalado."
docker compose version >/dev/null 2>&1 || die "Falta el plugin 'docker compose' (v2)."

# Contraseña aleatoria sin depender de openssl.
rand() { head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n'; }

create_env() {
  # Si ya hay una base creada con otras contraseñas, un .env nuevo dejaría a la
  # web y al worker sin poder entrar: mejor frenar y avisar.
  if docker volume inspect "$VOLUME" >/dev/null 2>&1; then
    die "Hay una base de una instalación anterior pero falta el archivo .env. Restauralo, o ejecutá './start.sh reset' para empezar de cero."
  fi
  say "Creando .env con contraseñas nuevas"
  umask 077  # .env solo será legible por el usuario que lo crea
  cp .env.example .env
  sed -i.bak \
    -e "s/^DB_PASSWORD=.*/DB_PASSWORD=$(rand)/" \
    -e "s/^MYSQL_ROOT_PASSWORD=.*/MYSQL_ROOT_PASSWORD=$(rand)/" \
    -e "s/^WEB_PASSWORD=.*/WEB_PASSWORD=$(rand)/" .env
  rm -f .env.bak
}

validate_env() {
  # Impedir iniciar con valores vacíos o credenciales de ejemplo.
  local key value
  for key in DB_PASSWORD MYSQL_ROOT_PASSWORD WEB_PASSWORD; do
    value="$(env_get "$key")"
    case "$value" in
      ""|cambiame|cambiame-root)
        die "Credencial $key ausente o insegura en .env. Restaurá las credenciales originales o, si no hay datos, regenerá el archivo."
        ;;
    esac
  done
}

compose_manage() {
  # ps/logs/down no requieren claves reales: permite administrar y resetear
  # incluso cuando se perdió .env, sin volver a generar claves persistentes.
  DB_PASSWORD="${DB_PASSWORD:-$(rand)}" \
  MYSQL_ROOT_PASSWORD="${MYSQL_ROOT_PASSWORD:-$(rand)}" \
  WEB_PASSWORD="${WEB_PASSWORD:-$(rand)}" \
    docker compose "$@"
}

wait_web() {   # espera el healthcheck del contenedor web (no necesita curl)
  local cid st
  for _ in $(seq 1 60); do
    cid="$(docker compose ps -q web 2>/dev/null || true)"
    if [ -n "$cid" ]; then
      st="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$cid" 2>/dev/null || echo none)"
      [ "$st" = "healthy" ] && return 0
    fi
    sleep 2
  done
  return 1
}

case "${1:-start}" in
  start)
    [ -f .env ] || create_env
    chmod 600 .env  # protege también instalaciones anteriores
    validate_env
    say "Construyendo y levantando mysql, worker y web"
    docker compose up -d --build
    say "Esperando a que la web esté lista"
    if wait_web; then
      say "Listo: http://localhost:$(env_get WEB_PORT)"
      pw="$(env_get WEB_PASSWORD)"
      [ -z "$pw" ] || say "Usuario: $(env_get WEB_USER)   Clave: $pw   (están en .env)"
      docker compose ps
    else
      docker compose ps
      die "La web no quedó lista en 2 minutos. Revisá: ./start.sh logs web"
    fi
    ;;
  stop)   say "Apagando"; compose_manage down ;;
  status) compose_manage ps ;;
  logs)   shift; compose_manage logs -f --tail=100 "$@" ;;
  reset)
    read -r -p "Esto borra TODOS los datos de MySQL. ¿Seguro? [s/N] " a
    [[ "$a" =~ ^[sS]$ ]] || { echo "Cancelado."; exit 0; }
    compose_manage down -v
    ;;
  *) die "Uso: ./start.sh [start|stop|status|logs [módulo]|reset]" ;;
esac
