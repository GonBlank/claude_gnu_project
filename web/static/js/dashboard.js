const chart = makeChart($('#avgChart'));
const REFRESH_MS = 60000;

function meter(label, value, cfg) {
  if (value == null) {
    return `<div class="meter-row"><span>${label}</span><div class="meter"></div><span class="val text-muted" title="El agente no informa este dato">n/d</span></div>`;
  }
  const lvl = level(value, cfg);
  return `<div class="meter-row">
    <span>${label}</span>
    <div class="meter" role="meter" aria-label="${label}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${value}"><i class="${lvl}" style="width:${value}%"></i></div>
    <span class="val">${value.toFixed(0)}%</span>
  </div>`;
}

function availability(s, bucketMs, startMs) {
  const cells = s.availability.map((a, i) => {
    const from = new Date(startMs + i * bucketMs).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
    const cls = a === 1 ? 'up' : a === 0 ? 'down' : '';
    const txt = a === 1 ? 'con mediciones' : a === 0 ? 'sin mediciones' : 'sin datos';
    return `<i class="${cls}" title="${from}: ${txt}"></i>`;
  }).join('');
  const label = s.availability_pct == null ? 'Sin datos todavía' : `${s.availability_pct}% disponible`;
  return `<div>
    <div class="avail" aria-hidden="true">${cells}</div>
    <div class="avail-cap"><span>hace 24 h</span><span>${label}</span><span>ahora</span></div>
  </div>`;
}

function card(s, cfg, d) {
  const st = s.status;
  const sev = st === 'online' ? s.severity : st === 'sin_respuesta' ? 'crit' : 'off';
  const stale = st !== 'online';
  const last = s.last;
  let body;
  if (last) {
    body = `<div class="meters">
      ${meter('CPU', last.cpu, cfg)}${meter('RAM', last.ram, cfg)}${meter('Disco', last.disco, cfg)}
    </div>
    <div class="srv-meta">
      <span>Encendido hace ${fmtUptime(last.uptime)}</span>
      <span>Lectura ${fmtAgo(last.ts)}</span>
    </div>`;
  } else {
    body = `<div class="srv-meta"><span>Todavía no hay mediciones. El worker las guardará en su próxima ronda.</span></div>`;
  }
  const note = st === 'sin_respuesta'
    ? `<div class="stale-note"><i class="bi bi-exclamation-circle"></i> Mostrando el último valor conocido.</div>` : '';
  return `<div class="col-md-6 col-xl-4">
    <article class="srv-card sev-${sev} ${stale ? 'stale' : ''}">
      <div class="srv-top">
        <div>
          <a class="srv-name" href="/history?server=${s.id}">${esc(s.hostname)}</a>
          <div class="srv-ip">${esc(s.ip)}</div>
        </div>
        <span class="badge-st st-${st}">${STATUS[st]}</span>
      </div>
      ${body}${note}
      ${s.enabled ? availability(s, d.bucket_ms, d.start) : ''}
    </article>
  </div>`;
}

function renderWorker(w) {
  const el = $('#workerBar');
  if (!w) { el.className = 'd-none'; return; }
  let text, cls;
  if (w.status === 'ok') {
    cls = 'worker-ok';
    const r = w.result ? ` (respondieron ${w.result.replace('/', ' de ')} servidores)` : '';
    text = `<i class="bi bi-check-circle"></i> Worker activo: última ronda ${fmtAgo(w.last_ts)}${r}.`;
  } else if (w.status === 'late') {
    cls = 'worker-late';
    text = `<i class="bi bi-exclamation-triangle"></i> El worker no registra actividad desde ${fmtAgo(w.last_ts)}. Los estados que ves pueden estar desactualizados (revisá <span class="mono">./start.sh logs worker</span>).`;
  } else {
    cls = 'worker-never';
    text = `<i class="bi bi-hourglass-split"></i> El worker todavía no completó ninguna ronda.`;
  }
  el.className = `worker-bar ${cls}`;
  el.innerHTML = text;
}

function renderKpis(k) {
  $('#kActive').textContent = k.enabled;
  $('#kActiveSub').textContent = `de ${k.total} registrados`;
  $('#kOnline').textContent = k.online;
  $('#kOnlineSub').textContent = k.alerts ? `${k.alerts} con valores altos` : 'todos dentro de los umbrales';
  $('#kDown').textContent = k.down;
  $('#kDownSub').textContent = k.down ? 'revisar red o snmpd' : 'ninguno caído';
  $('#kCpu').textContent = k.cpu_avg == null ? '-' : `${k.cpu_avg}%`;
  $('#kCpuSub').textContent = 'entre los servidores en línea';
}

function renderChart(d) {
  const base = chartBase();
  chart.setOption({
    ...base,
    series: [
      {
        name: 'CPU promedio', type: 'line', data: d.series.cpu, smooth: true, showSymbol: false,
        lineStyle: { width: 2, color: COLORS.blue }, itemStyle: { color: COLORS.blue },
        areaStyle: { color: 'rgba(125,180,234,.12)' },
        markLine: {
          silent: true, symbol: 'none', label: { color: COLORS.muted, formatter: '{b}', position: 'insideEndTop' },
          data: [
            { yAxis: d.settings.umbral_aviso, name: 'aviso', lineStyle: { color: COLORS.amber, type: 'dashed', opacity: .7 } },
            { yAxis: d.settings.umbral_critico, name: 'crítico', lineStyle: { color: COLORS.red, type: 'dashed', opacity: .7 } },
          ],
        },
      },
      {
        name: 'RAM promedio', type: 'line', data: d.series.ram, smooth: true, showSymbol: false,
        lineStyle: { width: 2, color: COLORS.purple }, itemStyle: { color: COLORS.purple },
      },
    ],
  }, true);
}

async function load() {
  try {
    const d = await api('/api/overview');
    renderWorker(d.worker);
    renderKpis(d.kpis);
    const grid = $('#serverGrid');
    grid.innerHTML = d.servers.length
      ? d.servers.map(s => card(s, d.settings, d)).join('')
      : `<div class="col-12"><div class="empty"><strong>Todavía no hay servidores</strong>
         Agregá el primero desde <a href="/servers">Servidores</a> para empezar a monitorearlo.</div></div>`;
    renderChart(d);
    $('#lastUpdate').textContent = `Actualizado ${new Date().toLocaleTimeString('es-AR')}`;
  } catch (e) {
    $('#lastUpdate').textContent = 'No se pudo actualizar';
    toast(e.message, 'error');
  }
}

$('#btnRefresh').addEventListener('click', load);
load();
setInterval(load, REFRESH_MS);
