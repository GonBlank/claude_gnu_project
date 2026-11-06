#!/bin/bash
# Carga datos de ejemplo solo si LOAD_DEMO_DATA=1 (primer arranque del volumen).
if [ "${LOAD_DEMO_DATA:-0}" = "1" ]; then
  echo "Cargando datos de demostración..."
  mysql -uroot -p"${MYSQL_ROOT_PASSWORD}" "${MYSQL_DATABASE}" < /opt/demo/demo_data.sql
fi
