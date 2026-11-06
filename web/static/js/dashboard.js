/* Dashboard: tres KPI y resumen de disponibilidad por host.
   Tarjetas estables entre actualizaciones: sin parpadeos ni renderizados completos. */
const REFRESH_MS = 60000;
let isFetching = false;
const hostNodes = new Map();

function newHostCard(id) {
  const column = document.createElement('div');
  column.className = 'col-12 col-md-6 col-xl-4';
  column.innerHTML =
    '<a class="host-card" href="/servers/' + encodeURIComponent(id) + '">' +
      '<div class="host-card__top">' +
        '<span class="host-card__identity"><span class="host-card__icon"><i class="bi bi-hdd-network" aria-hidden="true"></i></span>' +
          '<span class="host-card__overline">HOST / ' + String(id).padStart(3, '0') + '</span></span>' +
        '<span class="status-pill"></span>' +
      '</div>' +
      '<div class="host-card__name-line"><h3 class="host-card__name"></h3><i class="bi bi-arrow-up-right" aria-hidden="true"></i></div>' +
      '<p class="host-card__ip"></p>' +
      '<div class="host-card__availability">' +
        '<div class="host-card__availability-caption"><span>DISPONIBILIDAD / 24 H</span><span class="host-card__coverage"></span></div>' +
        '<div class="host-card__timeline" role="img"></div>' +
        '<div class="host-card__ticks"><span>HACE 24 H</span><span>AHORA</span></div>' +
      '</div>' +
      '<div class="host-card__footer"><span class="host-card__last"><i class="bi bi-clock" aria-hidden="true"></i><span></span></span>' +
        '<span class="host-card__hint">Ver detalle <i class="bi bi-chevron-right" aria-hidden="true"></i></span></div>' +
    '</a>';
  const timeline = column.querySelector('.host-card__timeline');
  const fragment = document.createDocumentFragment();
  for (let i = 0; i < 48; i++) {
    const segment = document.createElement('span');
    segment.className = 'host-card__segment is-unknown';
    segment.setAttribute('aria-hidden', 'true');
    fragment.appendChild(segment);
  }
  timeline.appendChild(fragment);
  return column;
}

function updateAvailability(column, server, bucketMs, startMs) {
  const timeline = column.querySelector('.host-card__timeline');
  const readings = Array.isArray(server.availability) ? server.availability : [];
  const labels = { 'is-up': 'Con mediciones', 'is-down': 'Sin mediciones', 'is-unknown': 'Sin historial' };

  for (let i = 0; i < 48; i++) {
    const value = readings[i];
    const next = value === 1 ? 'is-up' : value === 0 ? 'is-down' : 'is-unknown';
    const cell = timeline.children[i];
    if (!cell.classList.contains(next)) cell.className = 'host-card__segment ' + next;
    const when = new Date(startMs + i * bucketMs).toLocaleString('es-AR', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    });
    const title = when + ' · ' + labels[next];
    if (cell.title !== title) cell.title = title;
  }
  // Porcentaje de intervalos con lecturas desde el primer intervalo conocido.
  // Nunca presentarlo como SLA ni uptime garantizado.
  const percent = server.availability_pct;
  column.querySelector('.host-card__coverage').textContent = percent == null
    ? 'SIN HISTORIAL' : percent + '%';
  const label = percent == null
    ? 'No hay lecturas suficientes para calcular cobertura en 24 horas'
    : percent + '% de intervalos conocidos con lecturas en 24 horas';
  timeline.setAttribute('aria-label', label + '. Verde con lecturas, rojo sin lecturas, gris sin historial.');
  timeline.title = label;
}

function updateHostCard(column, server, bucketMs, startMs) {
  const link = column.querySelector('.host-card');
  link.classList.toggle('host-card--down', server.status === 'sin_respuesta');
  link.classList.toggle('host-card--off', server.status === 'deshabilitado' || server.status === 'sin_datos');
  link.setAttribute('aria-label', 'Ver detalle de ' + server.hostname + '. Estado: ' + STATUS[server.status]);

  const status = column.querySelector('.status-pill');
  if (status.dataset.status !== server.status) {
    const icons = {
      online: 'bi-check-circle', sin_respuesta: 'bi-exclamation-circle',
      deshabilitado: 'bi-pause-circle', sin_datos: 'bi-dash-circle',
    };
    status.className = 'status-pill st-' + server.status;
    status.replaceChildren();
    const icon = document.createElement('i');
    icon.className = 'bi ' + icons[server.status];
    icon.setAttribute('aria-hidden', 'true');
    status.append(icon, document.createTextNode(STATUS[server.status]));
    status.dataset.status = server.status;
  }

  const name = column.querySelector('.host-card__name');
  if (name.textContent !== server.hostname) name.textContent = server.hostname;
  const ip = column.querySelector('.host-card__ip');
  if (ip.textContent !== server.ip) ip.textContent = server.ip;
  column.querySelector('.host-card__last span').textContent = server.last
    ? fmtAgo(server.last.ts) : 'Sin lecturas';
  updateAvailability(column, server, bucketMs, startMs);
}

function renderHosts(servers, bucketMs, startMs) {
  const grid = $('#serverGrid');
  const legend = $('.dashboard-legend');
  legend.hidden = !servers.length;
  $('#hostCount').textContent = String(servers.length);
  if (!servers.length) {
    hostNodes.clear();
    grid.innerHTML =
      '<div class="col-12"><div class="empty"><i class="bi bi-hdd-stack" aria-hidden="true"></i>' +
      '<strong>Sin servidores registrados</strong>Agregá el primero desde <a href="/servers">Servidores</a>.</div></div>';
    return;
  }
  if (grid.querySelector('.empty')) grid.replaceChildren();
  const existing = new Set();
  let index = 0;
  for (const server of servers) {
    const id = String(server.id);
    existing.add(id);
    let column = hostNodes.get(id);
    if (!column) {
      column = newHostCard(id);
      hostNodes.set(id, column);
    }
    updateHostCard(column, server, bucketMs, startMs);
    if (grid.children[index] !== column) {
      grid.insertBefore(column, grid.children[index] || null);
    }
    index++;
  }
  for (const [id, column] of hostNodes) {
    if (!existing.has(id)) {
      column.remove();
      hostNodes.delete(id);
    }
  }
}

function renderWorker(worker) {
  const bar = $('#workerBar');
  const live = $('#systemLive');
  const label = $('#systemLiveLabel');
  const healthy = worker && worker.status === 'ok';
  live.classList.toggle('is-warning', !healthy);
  label.textContent = healthy ? 'MONITOREO ACTIVO' :
    !worker ? 'MODO DEMOSTRACIÓN' : worker.status === 'never' ? 'SIN PRIMERA RONDA' : 'WORKER DEMORADO';
  if (!worker || healthy) {
    bar.className = 'd-none';
    return;
  }
  bar.className = 'worker-bar ' + (worker.status === 'late' ? 'worker-late' : 'worker-never');
  bar.textContent = worker.status === 'late'
    ? 'El worker no registra actividad reciente. Estos estados podrían estar desactualizados.'
    : 'El worker todavía no completó ninguna ronda de monitoreo.';
}

async function load(manual = false) {
  if (isFetching) return;
  isFetching = true;
  const button = $('#btnRefresh');
  if (manual) setBusy(button, true, 'Actualizando...');
  try {
    const data = await api('/api/overview');
    updateKpi('#kTotal', data.kpis.total);
    updateKpi('#kOnline', data.kpis.online);
    updateKpi('#kDown', data.kpis.down);
    renderWorker(data.worker);
    renderHosts(data.servers, data.bucket_ms, data.start);
    $('#lastUpdate').textContent = 'Actualizado ' + new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  } catch (error) {
    $('#lastUpdate').textContent = 'No se pudo actualizar';
    $('#systemLive').classList.add('is-warning');
    $('#systemLiveLabel').textContent = 'DATOS NO DISPONIBLES';
    if (manual) toast(error.message, 'error');
  } finally {
    isFetching = false;
    if (manual) setBusy(button, false);
  }
}

$('#btnRefresh').addEventListener('click', () => load(true));
load();
setInterval(() => { if (!document.hidden) load(); }, REFRESH_MS);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) load();
});
