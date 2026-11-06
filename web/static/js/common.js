/* Componentes compartidos · SNMP Monitor */
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const COLORS = {
  blue: '#7d91b5', green: '#58b993', amber: '#e0ae5a', red: '#e77d7f',
  purple: '#aea4d6', teal: '#74b4b2', muted: '#9a9ba5', line: '#33343d',
  cream: '#f1f0e1',
};
const STATUS = {
  online: 'En línea', sin_respuesta: 'Sin respuesta',
  deshabilitado: 'Deshabilitado', sin_datos: 'Sin datos',
};

function esc(value) {
  return String(value).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function api(url, { method = 'GET', body } = {}) {
  const response = await fetch(url, {
    method, headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (response.status === 204) return null;
  let data = null;
  try { data = await response.json(); } catch { /* sin cuerpo JSON */ }
  if (!response.ok) throw new Error((data && data.error) || 'Error ' + response.status);
  return data;
}

/* Un estado busy uniforme: spinner + disabled + aria-busy. */
function setBusy(button, isBusy, message = 'Procesando...') {
  if (!button) return;
  if (isBusy) {
    if (button.dataset.busy === 'true') return;
    button.dataset.busy = 'true';
    button.dataset.originalHtml = button.innerHTML;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.innerHTML = '<span class="spinner-border spinner-border-sm" aria-hidden="true"></span><span>' + esc(message) + '</span>';
  } else if (button.dataset.busy === 'true') {
    button.disabled = false;
    button.removeAttribute('aria-busy');
    button.innerHTML = button.dataset.originalHtml;
    delete button.dataset.busy;
    delete button.dataset.originalHtml;
  }
}
async function withBusy(button, action, message) {
  if (button && button.dataset.busy === 'true') return;
  setBusy(button, true, message);
  try { return await action(); }
  finally { setBusy(button, false); }
}
function setInvalid(field, invalid) {
  field.classList.toggle('is-invalid', !!invalid);
  field.setAttribute('aria-invalid', invalid ? 'true' : 'false');
}
function toggleSecret(button, field) {
  const visible = field.type === 'password';
  field.type = visible ? 'text' : 'password';
  button.setAttribute('aria-pressed', String(visible));
  button.setAttribute('aria-label', visible ? 'Ocultar community' : 'Mostrar community');
  button.innerHTML = '<i class="bi ' + (visible ? 'bi-eye-slash' : 'bi-eye') + '" aria-hidden="true"></i>';
}
function toast(message, kind = 'success') {
  const wrapper = $('#toasts');
  if (!wrapper) return;
  const icon = kind === 'success' ? 'bi-check-circle' : 'bi-exclamation-triangle';
  const el = document.createElement('div');
  el.className = 'toast app-toast align-items-center';
  el.setAttribute('role', 'status');
  el.innerHTML = '<div class="d-flex align-items-center"><div class="toast-body"><i class="bi ' + icon +
    '" aria-hidden="true"></i><span class="ms-2"></span></div><button type="button" class="btn-close me-3 m-auto" data-bs-dismiss="toast" aria-label="Cerrar"></button></div>';
  el.querySelector('.toast-body span').textContent = message;
  wrapper.appendChild(el);
  const instance = new bootstrap.Toast(el, { delay: 4500 });
  el.addEventListener('hidden.bs.toast', () => el.remove());
  instance.show();
}
function fmtUptime(sec) {
  if (sec == null) return '—';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return d + ' d ' + h + ' h';
  if (h > 0) return h + ' h ' + m + ' min';
  return m + ' min';
}
function fmtAgo(ms) {
  if (!ms) return 'sin mediciones';
  const sec = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (sec < 90) return 'hace instantes';
  const minutes = Math.round(sec / 60);
  if (minutes < 60) return 'hace ' + minutes + ' min';
  const hours = Math.round(minutes / 60);
  if (hours < 48) return 'hace ' + hours + ' h';
  return 'hace ' + Math.round(hours / 24) + ' d';
}
function fmtDateTime(ms) {
  return new Date(ms).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'medium' });
}
const pct = v => v == null ? '—' : Number(v).toFixed(1) + '%';
function level(value, config) {
  if (value == null) return '';
  if (value >= config.umbral_critico) return 'crit';
  if (value >= config.umbral_aviso) return 'warn';
  return '';
}
function chartBase() {
  return {
    backgroundColor: 'transparent',
    animation: !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    animationDuration: 340,
    animationEasing: 'cubicOut',
    animationDurationUpdate: 300,
    animationEasingUpdate: 'cubicInOut',
    textStyle: { fontFamily: '"IBM Plex Mono", monospace', color: COLORS.muted, fontSize: 11 },
    grid: { left: 48, right: 24, top: 46, bottom: 48 },
    tooltip: {
      trigger: 'axis', backgroundColor: '#212127', borderColor: COLORS.line,
      textStyle: { color: COLORS.cream },
      valueFormatter: value => value == null ? '—' : Number(value).toFixed(1) + '%',
    },
    legend: { top: 0, textStyle: { color: COLORS.muted }, icon: 'roundRect', itemWidth: 14, itemHeight: 4 },
    xAxis: {
      type: 'time', axisLine: { lineStyle: { color: COLORS.line } },
      axisLabel: { color: COLORS.muted }, splitLine: { show: false },
    },
    yAxis: {
      type: 'value', min: 0, max: 100,
      axisLabel: { color: COLORS.muted, formatter: '{value}%' },
      splitLine: { lineStyle: { color: COLORS.line, type: 'dashed' } },
    },
  };
}
function makeChart(el) {
  const chart = echarts.init(el, null, { renderer: 'canvas' });
  window.addEventListener('resize', () => chart.resize());
  return chart;
}


/* Solo se anima el KPI cuando su valor efectivamente cambia. */
function updateKpi(selector, value) {
  const node = document.querySelector(selector);
  const next = String(value);
  if (!node || node.textContent === next) return;
  node.textContent = next;
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches && node.animate) {
    node.animate([
      { opacity: .68, transform: 'translateY(3px)' },
      { opacity: 1, transform: 'translateY(0)' },
    ], { duration: 210, easing: 'cubic-bezier(.16,1,.3,1)' });
  }
}
