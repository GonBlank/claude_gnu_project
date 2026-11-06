const chart = makeChart($('#histChart'));
const params = new URLSearchParams(location.search);
let range = ['1h', '6h', '24h', '7d'].includes(params.get('range')) ? params.get('range') : '24h';
let serverId = params.get('server');

const RANGE_LABEL = { '1h': 'última hora', '6h': 'últimas 6 horas', '24h': 'últimas 24 horas', '7d': 'últimos 7 días' };

function syncUrl() {
  const q = new URLSearchParams({ server: serverId, range });
  history.replaceState(null, '', `?${q}`);
  $$('#rangeGroup .btn').forEach(b => b.classList.toggle('active', b.dataset.range === range));
}

function showEmpty(title, text) {
  $('#histContent').classList.add('d-none');
  const box = $('#histEmpty');
  box.classList.remove('d-none');
  box.innerHTML = `<strong>${title}</strong>${text}`;
}

function statCard(title, color, s) {
  const vals = s
    ? `<div><small>Promedio</small><b>${s.avg}%</b></div><div><small>Máximo</small><b>${s.max}%</b></div><div><small>Mínimo</small><b>${s.min}%</b></div>`
    : '<span class="text-muted">Sin datos</span>';
  return `<div class="col-md-4"><div class="stat-card" style="--accent:${color}"><h3>${title}</h3><div class="stat-vals">${vals}</div></div></div>`;
}

function renderChart(d) {
  const base = chartBase();
  const line = (name, key, color) => ({
    name, type: 'line', showSymbol: false, smooth: true,
    data: d.points.map(p => [p.ts, p[key]]),
    lineStyle: { width: 2, color }, itemStyle: { color },
  });
  const cpu = line('CPU', 'cpu', COLORS.blue);
  cpu.areaStyle = { color: 'rgba(125,180,234,.10)' };
  cpu.markLine = {
    silent: true, symbol: 'none', label: { color: COLORS.muted, formatter: '{b}', position: 'insideEndTop' },
    data: [
      { yAxis: d.settings.umbral_aviso, name: 'aviso', lineStyle: { color: COLORS.amber, type: 'dashed', opacity: .7 } },
      { yAxis: d.settings.umbral_critico, name: 'crítico', lineStyle: { color: COLORS.red, type: 'dashed', opacity: .7 } },
    ],
  };
  chart.setOption({
    ...base,
    grid: { ...base.grid, bottom: 64 },
    dataZoom: [
      { type: 'inside' },
      { type: 'slider', height: 18, bottom: 8, borderColor: COLORS.line, textStyle: { color: COLORS.muted },
        fillerColor: 'rgba(125,180,234,.15)', handleStyle: { color: COLORS.blue } },
    ],
    series: [cpu, line('RAM', 'ram', COLORS.purple), line('Disco', 'disco', COLORS.amber)],
  }, true);
}

function renderTable(rows) {
  $('#latestBody').innerHTML = rows.map(r => {
    const cell = v => `<td class="text-end ${level(v, window.cfg) === 'crit' ? 'text-danger' : level(v, window.cfg) === 'warn' ? 'text-warning' : ''}">${pct(v)}</td>`;
    return `<tr><td>${fmtDateTime(r.ts)}</td>${cell(r.cpu)}${cell(r.ram)}${cell(r.disco)}<td class="text-end text-muted">${fmtUptime(r.uptime)}</td></tr>`;
  }).join('');
}

async function load() {
  syncUrl();
  try {
    const d = await api(`/api/servers/${serverId}/metrics?range=${range}`);
    window.cfg = d.settings;
    if (!d.count) {
      const s = d.server;
      showEmpty(`${esc(s.hostname)} no tiene mediciones en ${RANGE_LABEL[range]}`,
        s.enabled ? 'Si es un servidor nuevo, el worker las guardará en su próxima ronda.'
                  : 'Está deshabilitado, así que el worker no lo consulta.');
      return;
    }
    $('#histEmpty').classList.add('d-none');
    $('#histContent').classList.remove('d-none');
    $('#chartTitle').textContent = `${d.server.hostname}: ${RANGE_LABEL[range]}`;
    $('#chartMeta').textContent = `${d.count} mediciones${range === '7d' ? ' (promedio cada 30 min)' : ''}`;
    $('#statsRow').innerHTML = statCard('CPU', COLORS.blue, d.stats.cpu)
      + statCard('RAM', COLORS.purple, d.stats.ram) + statCard('Disco', COLORS.amber, d.stats.disco);
    renderChart(d);
    renderTable(d.latest);
    chart.resize();
  } catch (e) {
    showEmpty('No se pudieron cargar las mediciones', esc(e.message));
  }
}

async function init() {
  try {
    const { servers } = await api('/api/servers');
    if (!servers.length) {
      $('#serverSelect').classList.add('d-none');
      $('#rangeGroup').classList.add('d-none');
      return showEmpty('Todavía no hay servidores', 'Agregalos desde <a href="/servers">Servidores</a> para ver su histórico.');
    }
    const sel = $('#serverSelect');
    sel.innerHTML = servers.map(s => `<option value="${s.id}">${esc(s.hostname)} (${esc(s.ip)})</option>`).join('');
    if (!servers.some(s => String(s.id) === String(serverId))) serverId = servers[0].id;
    sel.value = serverId;
    sel.addEventListener('change', () => { serverId = sel.value; load(); });
    $$('#rangeGroup .btn').forEach(b => b.addEventListener('click', () => { range = b.dataset.range; load(); }));
    load();
  } catch (e) {
    showEmpty('No se pudo cargar la lista de servidores', esc(e.message));
  }
}

init();
