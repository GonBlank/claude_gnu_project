# Lector SNMP de servidores Ubuntu

## Idea

Un **servidor controlador** consulta por SNMP a varios servidores Ubuntu cada pocos minutos, guarda su CPU, RAM, disco y uptime en MySQL, y los muestra en una web con el estado de disponibilidad y el histórico. Todo corre en Docker.

## Cómo funciona

```
Servidores Ubuntu           ───────── Servidor controlador (docker compose) ─────────
   (snmpd)      <-- SNMP, UDP 161 --  worker  -- SQL -->  MySQL  <-- SQL --  web  <-- HTTP --  navegador
```

| Carpeta | Módulo | Función |
|---------|--------|---------|
| `worker/` | Python + PySNMP | Cada N minutos lee de MySQL los servidores habilitados, los consulta y guarda una fila en `metrics`. También avisa que está vivo: el Panel muestra si el worker se detuvo. |
| `mysql/` | MySQL 8 | Tablas `servers`, `metrics` y `settings`. Borra solo el histórico más viejo que la retención configurada. |
| `web/` | Flask + Bootstrap + ECharts | ABM de servidores, estado, histórico y configuración. |

- **Los Ubuntu no envían nada:** el worker les pregunta. Solo necesitan `snmpd` y ser alcanzables por UDP 161 desde el controlador.
- El worker y la web no se hablan entre sí: **MySQL es el punto de encuentro**. Lo que se cambia en la web (servidores, intervalo) el worker lo toma en la ronda siguiente.
- Un servidor figura como *sin respuesta* si pasan más de dos intervalos sin una medición.
- **Panel:** muestra tres KPI (cargados, en línea y sin respuesta) y tarjetas de host con estado, última lectura y barra de disponibilidad de 24 h (48 intervalos de 30 minutos). Las tarjetas abren el detalle; CPU/RAM/disco no se dispersan por el panel.
- **Detalle por host:** clic en una tarjeta o fila de inventario para abrir `/servers/<id>`. Allí se encuentran las estadísticas CPU/RAM/disco, series históricas, promedio de 24 h del propio host y tabla de mediciones.
- **UI/UX:** paleta oscura inspirada en Proto Mono, formularios con validación contextual, iconos, feedback de carga en acciones asíncronas y actualizaciones sin reconstruir las tarjetas.
- **UI/UX:** animaciones centralizadas en `motion.js` / `motion.css`: transiciones visibles entre documentos mediante capa de salida/entrada, hover con desplazamientos de 1–2 px y easing asimétrico, y desplazamiento vertical amortiguado (rueda, `requestAnimationFrame`). Respetan scrolls internos, teclado y `prefers-reduced-motion`. Se eliminó el controlador duplicado de `common.js`; no afecta recolección SNMP ni datos.
- **Disponibilidad en cada tarjeta:** verde = intervalo con lectura, rojo = intervalo conocido sin lectura, gris = sin historial suficiente. El porcentaje representa *intervalos conocidos con lecturas*, no una medición SLA/ICMP. El detalle concentra los gráficos e históricos del host.


## Levantar el servidor controlador

Requisitos: Docker con `docker compose` v2.

```bash
./start.sh            # mysql + worker + web
```

Abre http://localhost:8080. La primera vez genera automáticamente `.env` con contraseñas aleatorias y permisos `600`, e imprime el usuario y la clave de la web. No hay que crear archivos manualmente: `.env` está excluido de Git y las contraseñas se inyectan al **ejecutar** los contenedores, nunca al construir las imágenes.

```bash
./start.sh status | logs worker | stop     # estado, logs, apagar (conserva los datos)
./start.sh reset                           # apaga y BORRA la base
```

Para probar sin servidores reales, con el `.env` generado previamente por `./start.sh`: `USE_MOCK=1 docker compose up --build web` (solo la web, con datos de ejemplo). Con `LOAD_DEMO_DATA=1` en el `.env` la base arranca con 2 servidores inventados; el worker los va a consultar y va a loguear timeouts, así que conviene borrarlos desde la web.

## Conectar un servidor al controlador

**1. En el Ubuntu a monitorear** (copiar `docs/setup-snmpd.sh` con `scp` y correrlo):

```bash
sudo ./setup-snmpd.sh <community> <IP_de_la_máquina_que_corre_docker>
```

Instala `snmpd`, lo deja escuchando en UDP 161 con acceso de solo lectura para esa IP y habilita el monitoreo de `/`. Se usa la IP de la máquina que corre Docker (no la del contenedor), porque desde ahí salen las consultas. Si el servidor tiene firewall: `sudo ufw allow from <IP_del_controlador> to any port 161 proto udp`.

**2. Verificar desde el controlador** (`sudo apt install snmp`):

```bash
snmpget -v2c -c <community> <IP_del_servidor> 1.3.6.1.4.1.2021.11.11.0    # debe devolver el % de CPU ociosa
```

**3. En la web:** *Servidores > Agregar servidor* con hostname, IP y community. En la próxima ronda del worker (hasta N minutos) el Panel pasa de *Sin datos* a *En línea*.

Si no aparece, mirar `./start.sh logs worker`:
- `timeout`: la red, el firewall o la community están mal.
- `el agente no expone cpu_idle`: la vista de `snmpd` está restringida; volver a correr `setup-snmpd.sh`.
- Disco en `n/d`: falta la línea `disk /` en `snmpd.conf`.

## Tests

```bash
pip install flask
python -m unittest discover -s tests              # web + worker contra una base compartida (SQLite simulada)
cd worker && python -m unittest discover -s tests # cálculo de métricas, ronda del worker y cliente SNMP
```

## Límites a tener en cuenta

- SNMP v2c no cifra: la community viaja en texto plano. En la base también se guarda en texto plano (el worker la necesita).
- El login de la web es HTTP básico sin TLS: pensado para una red interna. Si se expone, ponerle un proxy con HTTPS.
- La web no muestra *por qué* un servidor no responde; eso queda solo en los logs del worker.
- Bootstrap, ECharts y las tipografías se cargan desde CDN: el navegador necesita internet.
