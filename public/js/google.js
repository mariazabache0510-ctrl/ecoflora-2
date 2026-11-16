/* EcoFlora - botón "Continuar con Google" (Google Identity Services).
   Google entrega una credencial (JWT); aquí solo se envía al servidor, que es quien la verifica. */
(function () {
    'use strict';

    var bloque = document.querySelector('[data-google]');
    if (!bloque) return;

    var contenedor = bloque.querySelector('[data-google-boton]');
    var aviso = bloque.querySelector('[data-google-error]');
    var clientId = bloque.getAttribute('data-client-id');
    var csrf = bloque.getAttribute('data-csrf');
    var texto = bloque.getAttribute('data-texto') || 'continue_with';

    function mostrarError(mensaje) {
        aviso.textContent = mensaje;
        aviso.hidden = false;
    }

    function alRecibirCredencial(respuesta) {
        aviso.hidden = true;
        bloque.classList.add('ocupado');
        fetch('/auth/google', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, Accept: 'application/json' },
            body: JSON.stringify({ credential: respuesta && respuesta.credential })
        }).then(function (r) {
            return r.json().catch(function () { return { ok: false, error: 'No pudimos entrar con Google. Inténtalo de nuevo.' }; });
        }).then(function (datos) {
            if (datos && datos.ok) {
                window.location.href = datos.destino || '/';
                return;
            }
            bloque.classList.remove('ocupado');
            mostrarError((datos && datos.error) || 'No pudimos entrar con Google. Inténtalo de nuevo.');
        }).catch(function () {
            bloque.classList.remove('ocupado');
            mostrarError('Sin conexión. Revisa tu internet e inténtalo de nuevo.');
        });
    }

    function dibujarBoton() {
        window.google.accounts.id.initialize({ client_id: clientId, callback: alRecibirCredencial, auto_select: false, cancel_on_tap_outside: true });
        var ancho = Math.max(200, Math.min(400, Math.floor(bloque.getBoundingClientRect().width) || 300));
        window.google.accounts.id.renderButton(contenedor, {
            type: 'standard', theme: 'outline', size: 'large', shape: 'pill', text: texto, logo_alignment: 'left', width: ancho, locale: 'es'
        });
    }

    var script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = function () {
        try { dibujarBoton(); } catch (error) { mostrarError('No se pudo preparar el botón de Google.'); }
    };
    script.onerror = function () {
        mostrarError('No pudimos cargar Google. Revisa tu conexión o entra con tu contraseña.');
    };
    document.head.appendChild(script);
})();
