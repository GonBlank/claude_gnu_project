const serverModal = new bootstrap.Modal($('#serverModal'));
const deleteModal = new bootstrap.Modal($('#deleteModal'));
let servers = [];
let defaults = { comunidad_default: 'public' };
let pendingDelete = null;
const revealed = new Set();

function row(s) {
  const dotCls = s.status === 'online' ? 'ok' : s.status === 'sin_respuesta' ? 'crit' : '';
  const community = revealed.has(s.id) ? esc(s.comunidad) : '&bull;&bull;&bull;&bull;&bull;&bull;';
  return `<tr data-id="${s.id}">
    <td><span class="dot ${dotCls}"></span>${STATUS[s.status]}</td>
    <td><a class="srv-name" href="/history?server=${s.id}">${esc(s.hostname)}</a></td>
    <td class="mono">${esc(s.ip)}</td>
    <td class="mono">
      ${community}
      <button class="btn btn-link btn-sm p-0 ms-2 text-muted" data-act="reveal" aria-label="Mostrar u ocultar la community">
        <i class="bi ${revealed.has(s.id) ? 'bi-eye-slash' : 'bi-eye'}"></i></button>
    </td>
    <td class="text-muted">${s.last ? fmtAgo(s.last.ts) : 'sin mediciones'}</td>
    <td class="text-center">
      <div class="form-check form-switch d-inline-block m-0">
        <input class="form-check-input" type="checkbox" role="switch" data-act="toggle" ${s.enabled ? 'checked' : ''}
               aria-label="Habilitar ${esc(s.hostname)}">
      </div>
    </td>
    <td class="text-end text-nowrap">
      <button class="btn btn-outline-secondary btn-icon" data-act="edit" aria-label="Editar ${esc(s.hostname)}"><i class="bi bi-pencil"></i></button>
      <button class="btn btn-outline-danger btn-icon" data-act="delete" aria-label="Eliminar ${esc(s.hostname)}"><i class="bi bi-trash3"></i></button>
    </td>
  </tr>`;
}

function render() {
  $('#serversBody').innerHTML = servers.length
    ? servers.map(row).join('')
    : `<tr><td colspan="7"><div class="empty border-0"><strong>Todavía no hay servidores</strong>
       Agregá el primero para que el worker empiece a consultarlo.</div></td></tr>`;
}

async function load() {
  try {
    const d = await api('/api/servers');
    servers = d.servers;
    defaults = d.settings;
    render();
  } catch (e) {
    $('#serversBody').innerHTML = `<tr><td colspan="7" class="text-danger p-4">${esc(e.message)}</td></tr>`;
  }
}

function openForm(server) {
  $('#formError').classList.add('d-none');
  $('#serverModalTitle').textContent = server ? `Editar ${server.hostname}` : 'Agregar servidor';
  $('#fId').value = server ? server.id : '';
  $('#fHostname').value = server ? server.hostname : '';
  $('#fIp').value = server ? server.ip : '';
  $('#fCommunity').value = server ? server.comunidad : defaults.comunidad_default;
  $('#fEnabled').checked = server ? server.enabled : true;
  serverModal.show();
}

$('#btnNew').addEventListener('click', () => openForm(null));
$('#serverModal').addEventListener('shown.bs.modal', () => $('#fHostname').focus());

$('#btnSave').addEventListener('click', async () => {
  const id = $('#fId').value;
  const body = {
    hostname: $('#fHostname').value,
    ip: $('#fIp').value,
    comunidad: $('#fCommunity').value,
    enabled: $('#fEnabled').checked,
  };
  const btn = $('#btnSave');
  btn.disabled = true;
  try {
    const saved = await api(id ? `/api/servers/${id}` : '/api/servers', { method: id ? 'PUT' : 'POST', body });
    serverModal.hide();
    toast(id ? `Cambios guardados en ${saved.hostname}.` : `${saved.hostname} agregado. Las mediciones aparecen cuando el worker lo consulte.`);
    await load();
  } catch (e) {
    const box = $('#formError');
    box.textContent = e.message;
    box.classList.remove('d-none');
  } finally {
    btn.disabled = false;
  }
});

$('#serverModal').addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') {
    e.preventDefault();
    $('#btnSave').click();
  }
});

$('#serversBody').addEventListener('click', e => {
  const btn = e.target.closest('[data-act]');
  if (!btn || btn.dataset.act === 'toggle') return;
  const id = Number(btn.closest('tr').dataset.id);
  const s = servers.find(x => x.id === id);
  if (btn.dataset.act === 'edit') openForm(s);
  if (btn.dataset.act === 'reveal') { revealed.has(id) ? revealed.delete(id) : revealed.add(id); render(); }
  if (btn.dataset.act === 'delete') {
    pendingDelete = s;
    $('#deleteText').textContent = `¿Eliminar ${s.hostname}? También se borra todo su histórico de mediciones.`;
    deleteModal.show();
  }
});

$('#serversBody').addEventListener('change', async e => {
  if (e.target.dataset.act !== 'toggle') return;
  const id = Number(e.target.closest('tr').dataset.id);
  const enabled = e.target.checked;
  try {
    const s = await api(`/api/servers/${id}`, { method: 'PUT', body: { enabled } });
    toast(`${s.hostname} ${enabled ? 'habilitado' : 'deshabilitado'}.`);
    await load();
  } catch (err) {
    e.target.checked = !enabled;
    toast(err.message, 'error');
  }
});

$('#btnConfirmDelete').addEventListener('click', async () => {
  if (!pendingDelete) return;
  try {
    await api(`/api/servers/${pendingDelete.id}`, { method: 'DELETE' });
    toast(`${pendingDelete.hostname} eliminado.`);
    deleteModal.hide();
    pendingDelete = null;
    await load();
  } catch (e) {
    toast(e.message, 'error');
  }
});

load();
setInterval(load, 60000);
