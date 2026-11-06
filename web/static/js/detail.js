/* Vista ampliada: todas las métricas del host están concentradas aquí. */
const root = $('#serverDetail');
const serverId = Number(root.dataset.serverId);
const validRanges = ['1h', '6h', '24h', '7d'];
const initialRange = new URLSearchParams(location.search).get('range');
let range = validRanges.includes(initialRange) ? initialRange : '24h';
let isLoading = false;
let tableSignature = null;
const detailChart = makeChart($('#histChart'));
const avgChart = makeChart($('#avgChart'));
let latestSeriesSignature = '';
let latestAverageSignature = '';
const seriesLine = (name, color, data = []) => ({
  id: name.toLowerCase(), name, type: 'line', smooth: true, showSymbol: false,
  data, lineStyle: { width: 2.5, color }, itemStyle: { color },
  emphasis: { focus: 'series' },
});

detailChart.setOption({
  ...chartBase(),
  grid: { ...chartBase().grid, bottom: 68 },
  dataZoom: [
    { type: 'inside' },
    { type: 'slider', height: 17, bottom: 10, borderColor: COLORS.line,
      textStyle: { color: COLORS.muted }, fillerColor: 'rgba(80,99,133,.24)',
      handleStyle: { color: COLORS.blue } },
  ],
  series: [
    seriesLine('CPU', COLORS.blue),
    seriesLine('RAM', COLORS.purple),
    seriesLine('Disco', COLORS.amber),
  ],
});
avgChart.setOption({
  ...chartBase(),
  series: [
    seriesLine('CPU', COLORS.blue),
    seriesLine('RAM', COLORS.purple),
  ],
});

const RANGE_LABEL = {
  '1h': 'última hora', '6h': 'últimas 6 horas',
  '24h': 'últimas 24 horas', '7d': 'últimos 7 días',
};
const METRICS = [
  { key: 'cpu', name: 'CPU', icon: 'bi-cpu', color: COLORS.blue },
  { key: 'ram', name: 'RAM', icon: 'bi-memory', color: COLORS.purple },
  { key: 'disco', name: 'DISCO', icon: 'bi-device-hdd', color: COLORS.amber },
];

function updateRange() {
  $$('#rangeGroup button').forEach(button => {
    const isActive = button.dataset.range === range;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  });
  history.replaceState(null, '', location.pathname + '?range=' + encodeURIComponent(range));
}
function renderHeader(server) {
  $('#detailName').textContent = server.hostname;
  $('#breadServer').textContent = server.hostname;
  $('#detailIp').textContent = server.ip;
  $('#detailLast').textContent = server.last
    ? 'Última lectura ' + fmtAgo(server.last.ts) + ' · Uptime ' + fmtUptime(server.last.uptime)
    : 'Sin lecturas registradas';
  const status = $('#detailStatus');
  status.className = 'status-pill st-' + server.status;
  const icons = {
    online: 'bi-check-circle', sin_respuesta: 'bi-exclamation-circle',
    deshabilitado: 'bi-pause-circle', sin_datos: 'bi-dash-circle',
  };
  status.innerHTML = '<i class="bi ' + icons[server.status] + '" aria-hidden="true"></i>';
  status.append(document.createTextNode(STATUS[server.status]));
}
function createStatCard(metric) {
  const column = document.createElement('div');
  column.className = 'col-12 col-md-4';
  column.dataset.stat = metric.key;
  column.innerHTML =
    '<article class="stat-card" style="--accent:' + metric.color + '">' +
    '<div class="stat-header"><span><i class="bi ' + metric.icon + '" aria-hidden="true"></i> ' +
    metric.name + '</span><span class="stat-index">RESOURCE</span></div>' +
    '<div class="stat-main"><strong class="stat-avg">—</strong><small>PROMEDIO</small></div>' +
    '<div class="stat-vals"><span>MIN <b class="stat-min">—</b></span><span>MAX <b class="stat-max">—</b></span></div></article>';
  return column;
}
function renderStats(stats) {
  const row = $('#statsRow');
  if (!row.dataset.initialized) {
    row.replaceChildren(...METRICS.map(createStatCard));
    row.dataset.initialized = 'true';
  }
  for (const metric of METRICS) {
    const node = row.querySelector('[data-stat="' + metric.key + '"]');
    const values = stats[metric.key];
    node.querySelector('.stat-avg').textContent = values ? pct(values.avg) : '—';
    node.querySelector('.stat-min').textContent = values ? pct(values.min) : '—';
    node.querySelector('.stat-max').textContent = values ? pct(values.max) : '—';
  }
}
function thresholds(settings) {
  return {
    silent: true, symbol: 'none',
    label: { color: COLORS.muted, formatter: '{b}', position: 'insideEndTop' },
    data: [
      { yAxis: settings.umbral_aviso, name: 'aviso',
        lineStyle: { color: COLORS.amber, type: 'dashed', opacity: 0.6 } },
      { yAxis: settings.umbral_critico, name: 'crítico',
        lineStyle: { color: COLORS.red, type: 'dashed', opacity: 0.6 } },
    ],
  };
}
function renderMetricChart(data) {
  const chartLines = [
    seriesLine('CPU', COLORS.blue, data.points.map(p => [p.ts, p.cpu])),
    seriesLine('RAM', COLORS.purple, data.points.map(p => [p.ts, p.ram])),
    seriesLine('Disco', COLORS.amber, data.points.map(p => [p.ts, p.disco])),
  ];
  chartLines[0].markLine = thresholds(data.settings);
  const signature = JSON.stringify({ points: data.points, settings: data.settings });
  if (signature !== latestSeriesSignature) {
    latestSeriesSignature = signature;
    detailChart.setOption({ series: chartLines });
  }
  $('#chartMeta').textContent = data.count + ' lecturas' +
    (range === '7d' ? ' · agrupadas cada 30 min' : '');
  $('#histNoData').classList.toggle('d-none', !!data.count);
  $('#histChart').classList.toggle('d-none', !data.count);
}
function groupHalfHour(points) {
  const bucket = 30 * 60 * 1000;
  const groups = new Map();
  for (const point of points) {
    const key = Math.floor(point.ts / bucket) * bucket;
    if (!groups.has(key)) groups.set(key, { ts: key, cpu: 0, ram: 0, countCpu: 0, countRam: 0 });
    const record = groups.get(key);
    for (const field of ['cpu', 'ram']) {
      if (point[field] != null) {
        record[field] += point[field];
        record[field === 'cpu' ? 'countCpu' : 'countRam']++;
      }
    }
  }
  return [...groups.values()].sort((a, b) => a.ts - b.ts).map(g => ({
    ts: g.ts, cpu: g.countCpu ? +(g.cpu / g.countCpu).toFixed(2) : null,
    ram: g.countRam ? +(g.ram / g.countRam).toFixed(2) : null,
  }));
}
function renderAverageChart(data) {
  const points = groupHalfHour(data.points);
  const signature = JSON.stringify(points);
  if (signature !== latestAverageSignature) {
    latestAverageSignature = signature;
    avgChart.setOption({ series: [
      seriesLine('CPU', COLORS.blue, points.map(p => [p.ts, p.cpu])),
      seriesLine('RAM', COLORS.purple, points.map(p => [p.ts, p.ram])),
    ] });
  }
}
function renderTable(records, settings) {
  const signature = JSON.stringify({ records, warn: settings.umbral_aviso, crit: settings.umbral_critico });
  if (signature === tableSignature) return;
  tableSignature = signature;
  const body = $('#latestBody');
  if (!records.length) {
    body.innerHTML = '<tr><td colspan="5" class="table-empty">Sin mediciones en este período.</td></tr>';
    return;
  }
  const rows = records.map(record => {
    const tr = document.createElement('tr');
    const date = document.createElement('td');
    date.textContent = fmtDateTime(record.ts);
    tr.appendChild(date);
    for (const field of ['cpu', 'ram', 'disco']) {
      const td = document.createElement('td');
      td.className = 'text-end mono';
      const severity = level(record[field], settings);
      if (severity) td.classList.add('metric-' + severity);
      td.textContent = pct(record[field]);
      tr.appendChild(td);
    }
    const uptime = document.createElement('td');
    uptime.className = 'text-end mono muted-cell';
    uptime.textContent = fmtUptime(record.uptime);
    tr.appendChild(uptime);
    return tr;
  });
  body.replaceChildren(...rows);
}
function toggleFailure(message) {
  const error = $('#detailError');
  error.classList.remove('d-none');
  error.textContent = message;
  $('#detailContent').classList.add('d-none');
}
async function load(trigger = null) {
  if (isLoading) return;
  isLoading = true;
  const rangeButtons = $$('#rangeGroup button');
  rangeButtons.forEach(b => { b.disabled = true; });
  if (trigger) setBusy(trigger, true, 'Cargando...');
  try {
    const rangeUrl = '/api/servers/' + serverId + '/metrics?range=' + encodeURIComponent(range);
    const primary = await api(rangeUrl);
    // El promedio de 24 h es EXCLUSIVO del host seleccionado, no global.
    const lastDay = range === '24h' ? primary :
      await api('/api/servers/' + serverId + '/metrics?range=24h');
    renderHeader(primary.server);
    $('#detailError').classList.add('d-none');
    $('#detailContent').classList.remove('d-none');
    renderStats(primary.stats);
    renderMetricChart(primary);
    renderAverageChart(lastDay);
    renderTable(primary.latest, primary.settings);
    updateRange();
    detailChart.resize();
    avgChart.resize();
  } catch (error) {
    toggleFailure('No se pudieron cargar las métricas: ' + error.message);
    if (trigger) toast(error.message, 'error');
  } finally {
    isLoading = false;
    if (trigger) setBusy(trigger, false);
    rangeButtons.forEach(b => { b.disabled = false; });
  }
}
$('#btnDetailRefresh').addEventListener('click', e => load(e.currentTarget));
$$('#rangeGroup button').forEach(button => button.addEventListener('click', () => {
  if (isLoading || range === button.dataset.range) return;
  range = button.dataset.range;
  load(button);
}));
load();
setInterval(() => load(), 60000);
