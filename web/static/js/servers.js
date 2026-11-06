/* Inventario interactivo: detalle por host y acciones con feedback accesible. */
const serverModal = new bootstrap.Modal($('#serverModal'));
const deleteModal = new bootstrap.Modal($('#deleteModal'));
const inventoryNodes = new Map();
let servers = [];
let defaults = { comunidad_default: '' };
let pendingDelete = null;
let fetching = false;
let editing = false;
let deleting = false;
const toggling = new Set();

function newRow(id) {
  const tr = document.createElement('tr');
  tr.className = 'inventory-row';
  tr.tabIndex = 0;
  tr.dataset.id = String(id);
  tr.innerHTML =
    '<td><span class="dot"></span><span class="inventory-status"></span></td>' +
    '<td><a class="inventory-name" href="/servers/' + encodeURIComponent(id) + '"></a></td>' +
    '<td class="mono inventory-ip"></td>' +
    '<td class="muted-cell inventory-updated"></td>' +
    '<td class="text-center"><div class="d-inline-flex align-items-center gap-2">' +
      '<div class="form-check form-switch m-0"><input type="checkbox" class="form-check-input" data-act="toggle" role="switch" aria-label="Habilitar monitoreo"></div>' +
      '<span class="spinner-border spinner-border-sm switch-loader" role="status" aria-label="Actualizando" hidden></span>' +
    '</div></td>' +
    '<td class="text-end text-nowrap">' +
      '<button type="button" class="btn btn-outline-secondary btn-icon me-1" data-act="edit" aria-label="Editar servidor" title="Editar"><i class="bi bi-pencil-square" aria-hidden="true"></i></button>' +
      '<button type="button" class="btn btn-outline-danger btn-icon" data-act="delete" aria-label="Eliminar servidor" title="Eliminar"><i class="bi bi-trash3" aria-hidden="true"></i></button>' +
    '</td>';
  return tr;
}
function updateRow(tr, server) {
  const dot = tr.querySelector('.dot');
  dot.className = 'dot ' + (server.status === 'online' ? 'ok' : server.status === 'sin_respuesta' ? 'crit' : 'off');
  tr.querySelector('.inventory-status').textContent = STATUS[server.status];
  tr.querySelector('.inventory-name').textContent = server.hostname;
  tr.querySelector('.inventory-ip').textContent = server.ip;
  tr.querySelector('.inventory-updated').textContent = server.last ? fmtAgo(server.last.ts) : 'Sin mediciones';
  tr.setAttribute('aria-label', 'Ver métricas de ' + server.hostname);
  const toggle = tr.querySelector('[data-act="toggle"]');
  if (!toggling.has(String(server.id))) toggle.checked = !!server.enabled;
  toggle.setAttribute('aria-label', 'Monitoreo de ' + server.hostname);
  for (const action of ['edit', 'delete']) {
    tr.querySelector('[data-act="' + action + '"]').setAttribute(
      'aria-label', (action === 'edit' ? 'Editar ' : 'Eliminar ') + server.hostname);
  }
}
function renderRows() {
  const tbody = $('#serversBody');
  if (!servers.length) {
    inventoryNodes.clear();
    tbody.innerHTML = '<tr><td colspan="6" class="table-empty">No hay servidores registrados. Agregá el primero para comenzar.</td></tr>';
    return;
  }
  if (tbody.querySelector('.table-empty')) tbody.replaceChildren();
  const active = new Set();
  let position = 0;
  for (const server of servers) {
    const id = String(server.id);
    active.add(id);
    let tr = inventoryNodes.get(id);
    if (!tr) { tr = newRow(id); inventoryNodes.set(id, tr); }
    updateRow(tr, server);
    if (tbody.children[position] !== tr) tbody.insertBefore(tr, tbody.children[position] || null);
    position++;
  }
  for (const [id, tr] of inventoryNodes) {
    if (!active.has(id)) { tr.remove(); inventoryNodes.delete(id); }
  }
}
async function load() {
  if (fetching) return;
  fetching = true;
  try {
    const response = await api('/api/servers');
    servers = response.servers;
    defaults = response.settings;
    renderRows();
  } catch (error) {
    if (!servers.length) $('#serversBody').innerHTML =
      '<tr><td colspan="6" class="table-empty">No se pudo cargar el inventario.</td></tr>';
    toast(error.message, 'error');
  } finally { fetching = false; }
}
function clearErrors() {
  $('#formError').classList.add('d-none');
  for (const field of [$('#fHostname'), $('#fIp'), $('#fCommunity')]) setInvalid(field, false);
}
function openForm(server) {
  if (editing) return;
  clearErrors();
  $('#serverModalTitle').textContent = server ? 'Editar servidor' : 'Agregar servidor';
  $('#fId').value = server ? server.id : '';
  $('#fHostname').value = server ? server.hostname : '';
  $('#fIp').value = server ? server.ip : '';
  const community = $('#fCommunity');
  community.type = 'password';
  $('#btnRevealCommunity').setAttribute('aria-pressed', 'false');
  $('#btnRevealCommunity').setAttribute('aria-label', 'Mostrar community');
  $('#btnRevealCommunity').innerHTML = '<i class="bi bi-eye" aria-hidden="true"></i>';
  community.value = server ? server.comunidad : (defaults.comunidad_default || '');
  $('#fEnabled').checked = server ? server.enabled : true;
  serverModal.show();
}
function validIPv4(value) {
  const parts = value.trim().split('.');
  return parts.length === 4 && parts.every(part =>
    /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
}
function validate() {
  const hostname = $('#fHostname');
  const ip = $('#fIp');
  const community = $('#fCommunity');
  const hostValid = /^[A-Za-z0-9]([A-Za-z0-9._-]{0,98}[A-Za-z0-9])?$/.test(hostname.value.trim());
  const ipValid = validIPv4(ip.value);
  const communityValid = !!community.value.trim() && community.value.trim().length <= 64;
  setInvalid(hostname, !hostValid);
  setInvalid(ip, !ipValid);
  setInvalid(community, !communityValid);
  if (!hostValid) hostname.focus();
  else if (!ipValid) ip.focus();
  else if (!communityValid) community.focus();
  return hostValid && ipValid && communityValid;
}
$('#btnNew').addEventListener('click', () => openForm(null));
$('#btnRevealCommunity').addEventListener('click', () => toggleSecret($('#btnRevealCommunity'), $('#fCommunity')));
$('#serverModal').addEventListener('shown.bs.modal', () => $('#fHostname').focus());
$$('#serverForm input:not([type="hidden"])').forEach(field => field.addEventListener('input', () => {
  if (field.classList.contains('is-invalid')) setInvalid(field, false);
}));
$('#serverForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (editing || !validate()) return;
  editing = true;
  const submit = $('#btnSave');
  const dismiss = $$('#serverModal [data-bs-dismiss]');
  dismiss.forEach(button => { button.disabled = true; });
  setBusy(submit, true, 'Guardando...');
  $('#formError').classList.add('d-none');
  const id = $('#fId').value;
  const body = {
    hostname: $('#fHostname').value.trim(), ip: $('#fIp').value.trim(),
    comunidad: $('#fCommunity').value.trim(), enabled: $('#fEnabled').checked,
  };
  try {
    const saved = await api(id ? '/api/servers/' + id : '/api/servers',
      { method: id ? 'PUT' : 'POST', body });
    serverModal.hide();
    toast(id ? 'Cambios guardados en ' + saved.hostname : 'Servidor ' + saved.hostname + ' agregado');
    await load();
  } catch (error) {
    $('#formError').textContent = error.message;
    $('#formError').classList.remove('d-none');
  } finally {
    editing = false;
    dismiss.forEach(button => { button.disabled = false; });
    setBusy(submit, false);
  }
});
$('#serversBody').addEventListener('click', event => {
  const tr = event.target.closest('tr[data-id]');
  if (!tr) return;
  const action = event.target.closest('[data-act]');
  const server = servers.find(s => String(s.id) === tr.dataset.id);
  if (!server) return;
  if (action?.dataset.act === 'edit') { openForm(server); return; }
  if (action?.dataset.act === 'delete') {
    if (deleting) return;
    pendingDelete = server;
    $('#deleteText').textContent = '¿Eliminar ' + server.hostname + '? Se eliminará también todo su histórico.';
    deleteModal.show();
    return;
  }
  if (event.target.closest('a, button, input, label, .form-check')) return;
  navigateTo('/servers/' + server.id);
});
$('#serversBody').addEventListener('keydown', event => {
  const tr = event.target.closest('tr[data-id]');
  if (tr && event.target === tr && (event.key === 'Enter' || event.key === ' ')) {
    event.preventDefault();
    navigateTo('/servers/' + tr.dataset.id);
  }
});
$('#serversBody').addEventListener('change', async event => {
  const toggle = event.target;
  if (toggle.dataset.act !== 'toggle') return;
  const tr = toggle.closest('tr[data-id]');
  const id = tr.dataset.id;
  if (toggling.has(id)) return;
  toggling.add(id);
  const enabled = toggle.checked;
  const spinner = tr.querySelector('.switch-loader');
  toggle.disabled = true;
  spinner.hidden = false;
  try {
    const response = await api('/api/servers/' + id, {
      method: 'PUT', body: { enabled },
    });
    toast(response.hostname + (enabled ? ' habilitado' : ' deshabilitado'));
    await load();
  } catch (error) {
    toggle.checked = !enabled;
    toast(error.message, 'error');
  } finally {
    toggling.delete(id);
    toggle.disabled = false;
    spinner.hidden = true;
  }
});
$('#btnConfirmDelete').addEventListener('click', async () => {
  if (!pendingDelete || deleting) return;
  deleting = true;
  const button = $('#btnConfirmDelete');
  const dismiss = $$('#deleteModal [data-bs-dismiss]');
  dismiss.forEach(x => { x.disabled = true; });
  setBusy(button, true, 'Eliminando...');
  const name = pendingDelete.hostname;
  try {
    await api('/api/servers/' + pendingDelete.id, { method: 'DELETE' });
    deleteModal.hide();
    pendingDelete = null;
    toast(name + ' eliminado');
    await load();
  } catch (error) { toast(error.message, 'error'); }
  finally {
    deleting = false;
    dismiss.forEach(x => { x.disabled = false; });
    setBusy(button, false);
  }
});
load();
setInterval(load, 60000);
