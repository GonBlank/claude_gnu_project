function fill(s) {
  $('#sInterval').value = s.intervalo_minutos;
  $('#sRetention').value = s.retencion_dias;
  $('#sWarn').value = s.umbral_aviso;
  $('#sCrit').value = s.umbral_critico;
  $('#sCommunity').value = s.comunidad_default;
}

async function load() {
  $('#settingsError').classList.add('d-none');
  try {
    fill(await api('/api/settings'));
  } catch (e) {
    toast(e.message, 'error');
  }
}

$('#settingsForm').addEventListener('submit', async e => {
  e.preventDefault();
  const box = $('#settingsError');
  box.classList.add('d-none');
  const btn = $('#btnSaveSettings');
  btn.disabled = true;
  try {
    const saved = await api('/api/settings', {
      method: 'PUT',
      body: {
        intervalo_minutos: $('#sInterval').value,
        retencion_dias: $('#sRetention').value,
        umbral_aviso: $('#sWarn').value,
        umbral_critico: $('#sCrit').value,
        comunidad_default: $('#sCommunity').value,
      },
    });
    fill(saved);
    toast('Configuración guardada.');
  } catch (err) {
    box.textContent = err.message;
    box.classList.remove('d-none');
  } finally {
    btn.disabled = false;
  }
});

$('#btnReload').addEventListener('click', load);
load();
