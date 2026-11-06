/* Formularios de sistema: validación en contexto y feedback en cada acción. */
let settingsLoading = false;
let settingsSaving = false;
function fill(config) {
  $('#sInterval').value = config.intervalo_minutos;
  $('#sRetention').value = config.retencion_dias;
  $('#sWarn').value = config.umbral_aviso;
  $('#sCrit').value = config.umbral_critico;
  $('#sCommunity').value = config.comunidad_default;
  $$('#settingsForm input').forEach(input => setInvalid(input, false));
}
function validateSettings() {
  const intField = $('#sInterval');
  const retField = $('#sRetention');
  const warnField = $('#sWarn');
  const critField = $('#sCrit');
  const communityField = $('#sCommunity');
  const values = [intField, retField, warnField, critField].map(x => Number(x.value));
  const valid = [
    !!intField.value && Number.isInteger(values[0]) && values[0] >= 1 && values[0] <= 60,
    !!retField.value && Number.isInteger(values[1]) && values[1] >= 1 && values[1] <= 365,
    !!warnField.value && Number.isInteger(values[2]) && values[2] >= 1 && values[2] <= 99,
    !!critField.value && Number.isInteger(values[3]) && values[3] > values[2] && values[3] <= 100,
    !!communityField.value.trim() && communityField.value.trim().length <= 64,
  ];
  [intField, retField, warnField, critField, communityField].forEach((field, index) =>
    setInvalid(field, !valid[index]));
  if (valid.includes(false)) {
    [intField, retField, warnField, critField, communityField][valid.indexOf(false)].focus();
    return false;
  }
  return true;
}
async function load(button = null) {
  if (settingsLoading || settingsSaving) return;
  settingsLoading = true;
  if (button) setBusy(button, true, 'Cargando...');
  try {
    fill(await api('/api/settings'));
    $('#settingsError').classList.add('d-none');
    if (button) toast('Cambios descartados');
  } catch (error) {
    $('#settingsError').textContent = error.message;
    $('#settingsError').classList.remove('d-none');
  } finally {
    settingsLoading = false;
    if (button) setBusy(button, false);
  }
}
$('#btnRevealDefault').addEventListener('click', () => toggleSecret($('#btnRevealDefault'), $('#sCommunity')));
$$('#settingsForm input').forEach(field => field.addEventListener('input', () => {
  if (field.classList.contains('is-invalid')) setInvalid(field, false);
}));
$('#settingsForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (settingsSaving || settingsLoading || !validateSettings()) return;
  settingsSaving = true;
  const button = $('#btnSaveSettings');
  const discard = $('#btnReload');
  discard.disabled = true;
  setBusy(button, true, 'Guardando...');
  $('#settingsError').classList.add('d-none');
  try {
    const result = await api('/api/settings', {
      method: 'PUT',
      body: {
        intervalo_minutos: $('#sInterval').value,
        retencion_dias: $('#sRetention').value,
        umbral_aviso: $('#sWarn').value,
        umbral_critico: $('#sCrit').value,
        comunidad_default: $('#sCommunity').value.trim(),
      },
    });
    fill(result);
    toast('Configuración guardada correctamente');
  } catch (error) {
    $('#settingsError').textContent = error.message;
    $('#settingsError').classList.remove('d-none');
  } finally {
    settingsSaving = false;
    discard.disabled = false;
    setBusy(button, false);
  }
});
$('#btnReload').addEventListener('click', event => load(event.currentTarget));
load();
