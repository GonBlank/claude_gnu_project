/* Login · validación en contexto, feedback de envío y animación breve de salida. */
(() => {
  const form = document.getElementById('loginForm');
  const username = document.getElementById('loginUser');
  const password = document.getElementById('loginPassword');
  const reveal = document.getElementById('revealPassword');
  const submit = document.getElementById('loginSubmit');
  const label = submit.querySelector('.login-submit__label');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let submitting = false;

  reveal.addEventListener('click', () => {
    const visible = password.type === 'password';
    password.type = visible ? 'text' : 'password';
    reveal.setAttribute('aria-pressed', String(visible));
    reveal.setAttribute('aria-label', visible ? 'Ocultar contraseña' : 'Mostrar contraseña');
    reveal.innerHTML = '<i class="bi ' + (visible ? 'bi-eye-slash' : 'bi-eye') + '" aria-hidden="true"></i>';
    password.focus({ preventScroll: true });
  });

  [username, password].forEach(field => {
    field.addEventListener('input', () => {
      field.classList.remove('is-invalid');
      field.removeAttribute('aria-invalid');
    });
  });

  form.addEventListener('submit', event => {
    event.preventDefault();
    if (submitting) return;

    let valid = true;
    for (const field of [username, password]) {
      const missing = !field.value.trim();
      field.classList.toggle('is-invalid', missing);
      field.setAttribute('aria-invalid', String(missing));
      if (missing) {
        if (valid) field.focus();
        valid = false;
      }
    }
    if (!valid) return;

    submitting = true;
    submit.disabled = true;
    submit.classList.add('is-busy');
    submit.setAttribute('aria-busy', 'true');
    label.textContent = 'Ingresando...';

    const next = form.elements.namedItem('next')?.value || '/';
    try {
      const url = new URL(next, window.location.href);
      sessionStorage.setItem('snmp-route', JSON.stringify({
        pathname: url.pathname, search: url.search, ts: Date.now(),
      }));
    } catch (_) { /* la navegación normal sigue disponible */ }

    if (!reduced.matches) document.body.classList.add('is-submitting');
    window.setTimeout(() => HTMLFormElement.prototype.submit.call(form), reduced.matches ? 0 : 175);
  });

  if (document.getElementById('loginError')) password.focus();
  else if (username.value) password.focus();
  else username.focus();
})();
