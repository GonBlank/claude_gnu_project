/* El panel es solo estado: las métricas viven en el detalle de cada host. */
const REFRESH_MS = 60000;
let isFetching = false;
const hostNodes = new Map();

function newHostCard(id) {
  const column = document.createElement('div');
  column.className = 'col-12 col-md-6 col-xl-4';
  column.innerHTML = '<a class="srv-card" href="/servers/' + encodeURIComponent(id) + '">' +
    '<div class="srv-card-head"><span class="srv-card-icon"><i class="bi bi-hdd-network" aria-hidden="true"></i></span>' +
    '<span class="status-pill"></span></div>' +
    '<div class="srv-card-body"><h3 class="srv-name"></h3><p class="srv-ip"></p></div>' +
    '<div class="srv-card-foot"><span class="card-updated"><i class="bi bi-clock-history" aria-hidden="true"></i> <span></span></span>' +
    '<span class="open-detail"><i class="bi bi-arrow-up-right" aria-hidden="true"></i></span></div></a>';
  return column;
}
function updateHostCard(column, server) {
  const card = column.querySelector('.srv-card');
  const sev = server.status === 'online' ? server.severity :
    server.status === 'sin_respuesta' ? 'crit' : 'off';
  card.className = 'srv-card sev-' + sev;
  card.setAttribute('aria-label', 'Ver detalle de ' + server.hostname + '. Estado: ' + STATUS[server.status]);
  const status = column.querySelector('.status-pill');
  status.className = 'status-pill st-' + server.status;
  const icons = { online: 'bi-check-circle', sin_respuesta: 'bi-exclamation-circle',
    deshabilitado: 'bi-pause-circle', sin_datos: 'bi-dash-circle' };
  status.innerHTML = '<i class="bi ' + icons[server.status] + '" aria-hidden="true"></i> ';
  status.append(document.createTextNode(STATUS[server.status]));
  column.querySelector('.srv-name').textContent = server.hostname;
  column.querySelector('.srv-ip').textContent = server.ip;
  column.querySelector('.card-updated span').textContent = server.last ? fmtAgo(server.last.ts) : 'Sin mediciones';
}
function renderHosts(servers) {
  const grid = $('#serverGrid');
  if (!servers.length) {
    hostNodes.clear();
    grid.innerHTML = '<div class="col-12"><div class="empty"><i class="bi bi-hdd-stack" aria-hidden="true"></i><strong>Sin servidores registrados</strong>Agregá el primero desde <a href="/servers">Servidores</a>.</div></div>';
    return;
  }
  // Mantener las mismas tarjetas evita parpadeos cada 60 segundos.
  if (grid.querySelector('.empty')) grid.replaceChildren();
  const existing = new Set();
  let position = 0;
  for (const server of servers) {
    const id = String(server.id);
    existing.add(id);
    let column = hostNodes.get(id);
    if (!column) {
      column = newHostCard(id);
      hostNodes.set(id, column);
    }
    updateHostCard(column, server);
    if (grid.children[position] !== column) grid.insertBefore(column, grid.children[position] || null);
    position++;
  }
  for (const [id, element] of hostNodes) {
    if (!existing.has(id)) { element.remove(); hostNodes.delete(id); }
  }
}
function renderWorker(worker) {
  const bar = $('#workerBar');
  if (!worker || worker.status === 'ok') {
    bar.className = 'd-none';
    return;
  }
  bar.className = 'worker-bar ' + (worker.status === 'late' ? 'worker-late' : 'worker-never');
  bar.textContent = worker.status === 'late'
    ? 'El worker dejó de registrar actividad. Los estados pueden estar desactualizados.'
    : 'El worker todavía no completó ninguna ronda.';
}
async function load(manual = false) {
  if (isFetching) return;
  isFetching = true;
  const refresh = $('#btnRefresh');
  if (manual) setBusy(refresh, true, 'Actualizando...');
  try {
    const data = await api('/api/overview');
    $('#kTotal').textContent = data.kpis.total;
    $('#kOnline').textContent = data.kpis.online;
    $('#kDown').textContent = data.kpis.down;
    renderWorker(data.worker);
    renderHosts(data.servers);
    $('#lastUpdate').textContent = 'Actualizado ' + new Date().toLocaleTimeString('es-AR');
  } catch (error) {
    $('#lastUpdate').textContent = 'No se pudo actualizar';
    if (manual) toast(error.message, 'error');
  } finally {
    isFetching = false;
    if (manual) setBusy(refresh, false);
  }
}
$('#btnRefresh').addEventListener('click', () => load(true));
load();
setInterval(() => load(), REFRESH_MS);
