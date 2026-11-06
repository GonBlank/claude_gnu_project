#!/usr/bin/env bash
# Prepara un servidor Ubuntu para ser monitoreado por el worker.
# Correr EN CADA servidor a monitorear, como root:
#   sudo ./setup-snmpd.sh [community] [origen_permitido]
# origen_permitido: IP (o red) de la máquina que corre Docker, desde donde sale el worker.
# Ejemplo:
#   sudo ./setup-snmpd.sh public 192.168.56.10      (una IP)
#   sudo ./setup-snmpd.sh public 192.168.56.0/24    (una red)
set -euo pipefail

COMMUNITY="${1:-public}"
SOURCE="${2:-default}"   # "default" = cualquier origen; mejor limitarlo a la red del worker

[ "$(id -u)" -eq 0 ] || { echo "Ejecutar con sudo." >&2; exit 1; }

apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y snmpd

CONF=/etc/snmp/snmpd.conf
[ -f "$CONF.orig" ] || cp "$CONF" "$CONF.orig"

cat > "$CONF" <<EOF
# Generado por setup-snmpd.sh (original en snmpd.conf.orig)
# Escuchar en todas las interfaces, UDP 161
agentaddress udp:161

# Vista completa de solo lectura: hace falta para CPU, RAM y disco (UCD-SNMP-MIB)
view all included .1
rocommunity $COMMUNITY $SOURCE -V all

# Monitorear el uso de la partición raíz (dskPercent.1)
disk /
EOF

systemctl restart snmpd
systemctl enable snmpd >/dev/null 2>&1 || true

echo "snmpd listo. Probalo desde la máquina del worker con:"
echo "  snmpget -v2c -c $COMMUNITY <IP_DE_ESTE_SERVIDOR> 1.3.6.1.4.1.2021.11.11.0"
