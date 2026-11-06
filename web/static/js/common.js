/* Utilidades compartidas */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const COLORS = {
  blue: '#7db4ea', green: '#5ec28f', amber: '#e0a73e', red: '#ef6b6b',
  purple: '#a58bd6', teal: '#5fb7b0', muted: '#8a96a8', line: '#263244',
};

const STATUS = {
  online: 'En línea',
  sin_respuesta: 'Sin respuesta',
  deshabilitado: 'Deshabilitado',
  sin_datos: 'Sin datos',
};

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function api(url, { method = 'GET', body } = {}) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  let data = null;
  try { data = await res.json(); } catch { /* sin cuerpo */ }
  if (!res.ok) throw new Error((data && data.error) || `Error ${res.status}`);
  return data;
}

function toast(message, kind = 'success') {
  const icon = kind === 'success' ? 'bi-check-circle-fill text-success' : 'bi-exclamation-triangle-fill text-danger';
  const el = document.createElement('div');
  el.className = 'toast align-items-center';
  el.setAttribute('role', 'status');
  el.innerHTML = `<div class="d-flex"><div class="toast-body"><i class="bi ${icon} me-2"></i>${esc(message)}</div>
    <button type="button" class="btn-close me-2 m-auto" data-bs-dismiss="toast" aria-label="Cerrar"></button></div>`;
  $('#toasts').appendChild(el);
  const t = new bootstrap.Toast(el, { delay: 4500 });
  el.addEventListener('hidden.bs.toast', () => el.remove());
  t.show();
}

function fmtUptime(sec) {
  if (sec == null) return '-';
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d} d ${h} h`;
  if (h > 0) return `${h} h ${m} min`;
  return `${m} min`;
}

function fmtAgo(ms) {
  if (!ms) return 'nunca';
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 90) return 'hace instantes';
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} d`;
}

function fmtDateTime(ms) {
  return new Date(ms).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'medium' });
}

const pct = v => (v == null ? '-' : `${Number(v).toFixed(1)}%`);

/* Clase de color según los umbrales de configuración */
function level(v, cfg) {
  if (v >= cfg.umbral_critico) return 'crit';
  if (v >= cfg.umbral_aviso) return 'warn';
  return '';
}

/* Opciones base de ECharts para el tema oscuro */
function chartBase() {
  return {
    backgroundColor: 'transparent',
    textStyle: { fontFamily: '"IBM Plex Sans", system-ui, sans-serif', color: COLORS.muted },
    grid: { left: 44, right: 20, top: 40, bottom: 36 },
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#19212c',
      borderColor: COLORS.line,
      textStyle: { color: '#e5eaf1' },
      valueFormatter: v => (v == null ? '-' : `${v}%`),
    },
    legend: { top: 0, textStyle: { color: COLORS.muted }, icon: 'roundRect', itemWidth: 14, itemHeight: 4 },
    xAxis: {
      type: 'time',
      axisLine: { lineStyle: { color: COLORS.line } },
      axisLabel: { color: COLORS.muted },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value', min: 0, max: 100,
      axisLabel: { color: COLORS.muted, formatter: '{value}%' },
      splitLine: { lineStyle: { color: COLORS.line, type: 'dashed' } },
    },
  };
}

/* Crea un gráfico que se adapta al ancho de la ventana */
function makeChart(el) {
  const chart = echarts.init(el, null, { renderer: 'canvas' });
  window.addEventListener('resize', () => chart.resize());
  return chart;
}
