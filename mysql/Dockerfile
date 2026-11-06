FROM mysql:8.0

COPY my.cnf /etc/mysql/conf.d/snmp.cnf
COPY initdb/ /docker-entrypoint-initdb.d/
COPY demo/ /opt/demo/

EXPOSE 3306

HEALTHCHECK --interval=10s --timeout=5s --start-period=40s --retries=10 \
  CMD mysqladmin ping -h 127.0.0.1 -uroot -p"$MYSQL_ROOT_PASSWORD" --silent || exit 1
