/* Inicio de sesión con rostro (lado del navegador).
   - Usa la cámara (getUserMedia) y face-api para sacar el "descriptor" del rostro: 128 números.
   - Hace una prueba de vida sencilla (parpadear o girar la cabeza) antes de capturar.
   - Solo envía al servidor esos números, nunca fotos. La comparación final la hace el servidor.
   La lógica de la prueba de vida y de la calidad está en rostro-vida.js. */
(function () {
    'use strict';

    var Vida = window.RostroVida;
    var RUTA_LIBRERIA = '/vendor/face-api/face-api.js';
    var RUTA_MODELOS = '/modelos/rostro';
    var reducir = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function $(selector, contexto) { return (contexto || document).querySelector(selector); }
    function dormir(ms) { return new Promise(function (resolver) { setTimeout(resolver, ms); }); }
    function siguienteCuadro() { return new Promise(function (resolver) { window.requestAnimationFrame(resolver); }); }
    function fallo(codigo, texto) {
        var error = new Error(texto || codigo);
        error.codigo = codigo;
        return error;
    }

    /* ---------- Mensajes amables ---------- */

    var MENSAJES = {
        bloqueada: { titulo: 'La cámara está bloqueada', texto: 'Para usar tu rostro necesitamos la cámara. Toca el candado (o el ícono de cámara) junto a la dirección del sitio, elige "Permitir" en Cámara y vuelve a intentarlo.' },
        sin_camara: { titulo: 'No encontramos una cámara', texto: 'Parece que este dispositivo no tiene cámara o está desconectada. Puedes entrar con tu contraseña.' },
        ocupada: { titulo: 'La cámara está ocupada', texto: 'Otra aplicación o pestaña la está usando. Ciérrala y vuelve a intentarlo.' },
        inseguro: { titulo: 'Conexión no segura', texto: 'La cámara solo funciona en conexiones seguras (https://). Abre EcoFlora desde su dirección segura.' },
        sin_soporte: { titulo: 'Tu navegador no permite usar la cámara', texto: 'Prueba con una versión actualizada de Chrome, Edge, Firefox o Safari.' },
        app_interna: { titulo: 'Ábrelo en tu navegador', texto: 'Parece que abriste EcoFlora dentro de otra app (Instagram, Facebook, WhatsApp...). Ahí la cámara suele fallar: ábrelo en Chrome o Safari.' },
        modelos: { titulo: 'No pudimos preparar el reconocimiento', texto: 'Revisa tu conexión a internet y vuelve a intentarlo. La primera vez se descargan unos 8 MB.' },
        tiempo_alinear: { titulo: 'No logramos ver tu rostro', texto: 'Busca una luz de frente, quítate gorra o lentes oscuros y colócate dentro del círculo. Luego inténtalo otra vez.' },
        tiempo_reto: { titulo: 'Se acabó el tiempo', texto: 'No detectamos el movimiento a tiempo. Inténtalo de nuevo con calma y buena luz.' },
        captura: { titulo: 'No pudimos tomar una buena captura', texto: 'Mantén la cabeza quieta, de frente y con buena luz, e inténtalo otra vez.' },
        generico: { titulo: 'Algo salió mal', texto: 'No pudimos completar el proceso. Inténtalo de nuevo en un momento.' }
    };

    var PISTAS = {
        sin_rostro: 'No vemos tu rostro. Colócate frente a la cámara, dentro del círculo.',
        varias_caras: 'Aparece más de una persona. Asegúrate de estar solo(a) frente a la cámara.',
        poca_luz: 'Hay poca luz. Busca una luz de frente (una ventana o una lámpara).',
        mucha_luz: 'Hay demasiada luz o contraluz. Evita tener una ventana o lámpara detrás de ti.',
        lejos: 'Acércate un poquito a la cámara.',
        cerca: 'Aléjate un poco de la cámara.',
        descentrado: 'Centra tu rostro dentro del círculo.'
    };

    var INSTRUCCION_RETO = {
        parpadear: 'Ahora parpadea una vez, con calma.',
        girar_izquierda: 'Gira lentamente la cabeza hacia tu izquierda y vuelve al centro.',
        girar_derecha: 'Gira lentamente la cabeza hacia tu derecha y vuelve al centro.'
    };

    function esAppInterna() {
        return /FBAN|FBAV|FB_IAB|Instagram|Line\/|WhatsApp|Snapchat|MicroMessenger|; wv\)/i.test(navigator.userAgent || '');
    }

    /* ---------- Llamadas al servidor (JSON) ---------- */

    function api(ruta, cuerpo) {
        return fetch(ruta, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(cuerpo || {})
        }).then(function (respuesta) {
            return respuesta.json().catch(function () { return {}; }).then(function (datos) {
                if (!respuesta.ok || datos.ok === false) {
                    var error = new Error(datos.error || 'No pudimos completar la acción. Inténtalo de nuevo.');
                    error.codigo = datos.codigo || 'servidor';
                    error.estado = respuesta.status;
                    error.datos = datos;
                    throw error;
                }
                return datos;
            });
        });
    }

    /* ---------- Librería, modelos y cámara ---------- */

    var promesaModelos = null;

    function cargarModelos() {
        if (promesaModelos) return promesaModelos;
        promesaModelos = new Promise(function (resolver, rechazar) {
            if (window.faceapi) return resolver();
            var script = document.createElement('script');
            script.src = RUTA_LIBRERIA;
            script.onload = resolver;
            script.onerror = rechazar;
            document.head.appendChild(script);
            return null;
        }).then(function () {
            var f = window.faceapi;
            var preparar = Promise.resolve();
            if (f.tf && f.tf.setBackend) {
                // WebGL es rápido; si el dispositivo no lo tiene se usa el procesador.
                preparar = f.tf.setBackend('webgl')
                    .then(function (listo) { return listo ? true : f.tf.setBackend('cpu'); })
                    .catch(function () { return f.tf.setBackend('cpu'); })
                    .then(function () { return f.tf.ready(); });
            }
            return preparar.then(function () {
                return Promise.all([
                    f.nets.tinyFaceDetector.loadFromUri(RUTA_MODELOS),
                    f.nets.faceLandmark68Net.loadFromUri(RUTA_MODELOS),
                    f.nets.faceRecognitionNet.loadFromUri(RUTA_MODELOS)
                ]);
            });
        }).catch(function () {
            promesaModelos = null;
            throw fallo('modelos');
        });
        return promesaModelos;
    }

    function codigoErrorCamara(error) {
        switch (error && error.name) {
            case 'NotAllowedError':
            case 'PermissionDeniedError':
            case 'SecurityError':
                return 'bloqueada';
            case 'NotFoundError':
            case 'DevicesNotFoundError':
            case 'OverconstrainedError':
                return 'sin_camara';
            case 'NotReadableError':
            case 'TrackStartError':
            case 'AbortError':
                return 'ocupada';
            default:
                return 'generico';
        }
    }

    function abrirCamara(video) {
        if (!window.isSecureContext) return Promise.reject(fallo('inseguro'));
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return Promise.reject(fallo(esAppInterna() ? 'app_interna' : 'sin_soporte'));
        return navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
            audio: false
        }).then(function (flujo) {
            video.muted = true;
            video.srcObject = flujo;
            var listo = new Promise(function (resolver) {
                if (video.videoWidth) return resolver();
                video.addEventListener('loadeddata', function () { resolver(); }, { once: true });
                setTimeout(resolver, 4000);
                return null;
            });
            return Promise.resolve(video.play()).catch(function () { /* el navegador lo reanuda solo */ }).then(function () { return listo; }).then(function () { return flujo; });
        }, function (error) {
            throw fallo(codigoErrorCamara(error));
        });
    }

    function detenerCamara(flujo, video) {
        if (flujo) flujo.getTracks().forEach(function (pista) { pista.stop(); });
        if (video) video.srcObject = null;
    }

    /* ---------- Interfaz de la cámara ---------- */

    function crearUI(raiz) {
        var caja = $('[data-rostro-camara]', raiz) || raiz;
        var instruccion = $('[data-rostro-instruccion]', caja);
        var pasos = $$('[data-rostro-pasos] span', caja);
        var mensaje = $('[data-rostro-mensaje]', caja);
        var iconos = { info: 'bi-info-circle', aviso: 'bi-exclamation-triangle', error: 'bi-x-octagon' };

        function $$(selector, contexto) { return Array.prototype.slice.call((contexto || document).querySelectorAll(selector)); }

        return {
            caja: caja,
            estado: function (nombre) { caja.setAttribute('data-estado', nombre); },
            instruccion: function (texto, tono) {
                if (instruccion.textContent !== texto) instruccion.textContent = texto;
                instruccion.setAttribute('data-tono', tono || 'normal');
            },
            pasos: function (hechos) {
                pasos.forEach(function (punto, i) { punto.classList.toggle('hecho', i < hechos); });
            },
            progreso: function (valor) { caja.style.setProperty('--progreso', String(valor)); },
            mensaje: function (tipo, titulo, texto) {
                $('[data-rostro-mensaje-titulo]', mensaje).textContent = titulo;
                $('[data-rostro-mensaje-texto]', mensaje).textContent = texto;
                $('[data-rostro-mensaje-icono]', mensaje).className = 'bi ' + (iconos[tipo] || iconos.info);
                mensaje.setAttribute('data-tipo', tipo);
                mensaje.hidden = false;
            },
            ocultarMensaje: function () { mensaje.hidden = true; },
            video: $('[data-rostro-video]', caja),
            lienzo: $('[data-rostro-lienzo]', caja)
        };
    }

    /* ---------- Captura: cámara + prueba de vida + descriptores ---------- */

    // config.cantidad: cuántos descriptores tomar.
    // config.pedirDesafio(): promesa con { nonce, accion } del servidor.
    // config.enviar(descriptores, nonce): promesa; si el servidor rechaza, lanza el error.
    function Captura(raiz, config) {
        var ui = crearUI(raiz);
        var video = ui.video;
        var lienzo = ui.lienzo;
        var contexto = lienzo ? lienzo.getContext('2d') : null;
        var muestra = document.createElement('canvas');
        muestra.width = 24;
        muestra.height = 24;
        var contextoMuestra = muestra.getContext('2d', { willReadFrequently: true });
        var flujo = null;
        var cancelado = false;
        var corriendo = false;
        var luz = null;
        var cuadros = 0;

        function opciones() {
            return new window.faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 });
        }

        // Brillo medio (0 a 255) de la zona central del video.
        function medirLuz() {
            var lado = Math.min(video.videoWidth, video.videoHeight);
            if (!lado) return null;
            contextoMuestra.drawImage(video, (video.videoWidth - lado) / 2, (video.videoHeight - lado) / 2, lado, lado, 0, 0, 24, 24);
            var datos = contextoMuestra.getImageData(0, 0, 24, 24).data;
            var suma = 0;
            for (var i = 0; i < datos.length; i += 4) suma += 0.299 * datos[i] + 0.587 * datos[i + 1] + 0.114 * datos[i + 2];
            return suma / (datos.length / 4);
        }

        function ajustarLienzo() {
            if (!lienzo) return;
            lienzo.width = video.videoWidth || 640;
            lienzo.height = video.videoHeight || 480;
        }

        function pintar(puntos, tono) {
            if (!contexto) return;
            contexto.clearRect(0, 0, lienzo.width, lienzo.height);
            if (!puntos) return;
            contexto.fillStyle = tono || 'rgba(183, 255, 214, 0.9)';
            puntos.forEach(function (punto) {
                contexto.beginPath();
                contexto.arc(punto.x, punto.y, 2.4, 0, Math.PI * 2);
                contexto.fill();
            });
        }

        function analizar() {
            return window.faceapi.detectAllFaces(video, opciones()).withFaceLandmarks().then(function (resultados) {
                cuadros += 1;
                if (luz === null || cuadros % 5 === 0) luz = medirLuz();
                var caras = resultados.map(function (r) { return { caja: r.detection.box, puntaje: r.detection.score }; });
                var calidad = Vida.evaluarCalidad({ caras: caras, ancho: video.videoWidth, alto: video.videoHeight, luz: luz });
                var puntos = resultados.length === 1 ? resultados[0].landmarks.positions : null;
                pintar(puntos, calidad.ok ? null : 'rgba(255, 214, 120, 0.9)');
                return { calidad: calidad, puntos: puntos, cantidad: resultados.length };
            });
        }

        function descriptor() {
            return window.faceapi.detectSingleFace(video, opciones()).withFaceLandmarks().withFaceDescriptor().then(function (r) {
                if (!r) return null;
                return Array.prototype.map.call(r.descriptor, function (valor) { return Number(valor.toFixed(6)); });
            });
        }

        function detener() {
            detenerCamara(flujo, video);
            flujo = null;
            if (contexto) contexto.clearRect(0, 0, lienzo.width, lienzo.height);
        }

        function mostrarError(error) {
            var datos = MENSAJES[error.codigo];
            if (datos) ui.mensaje('error', datos.titulo, datos.texto);
            else ui.mensaje('error', 'No pudimos continuar', error.message || MENSAJES.generico.texto);
        }

        // Espera a que el rostro esté bien puesto durante unos cuadros seguidos.
        async function alinear() {
            var buenos = 0;
            var limite = Date.now() + 40000;
            while (!cancelado) {
                var a = await analizar();
                if (a.calidad.ok) {
                    buenos += 1;
                    ui.instruccion('Perfecto, no te muevas…', 'ok');
                } else {
                    buenos = 0;
                    ui.instruccion(PISTAS[a.calidad.codigo] || PISTAS.sin_rostro, 'pista');
                }
                if (buenos >= 8) return;
                if (Date.now() > limite) throw fallo('tiempo_alinear');
                await siguienteCuadro();
            }
        }

        async function superarReto(desafio) {
            var reto = Vida.crearReto(desafio.accion);
            var limite = Date.now() + 30000;
            ui.estado('reto');
            ui.instruccion(INSTRUCCION_RETO[desafio.accion] || INSTRUCCION_RETO.parpadear, 'reto');
            while (!cancelado) {
                var a = await analizar();
                if (a.cantidad > 1) {
                    ui.instruccion(PISTAS.varias_caras, 'pista');
                } else if (a.puntos) {
                    var estado = reto.procesar(a.puntos);
                    ui.progreso(estado.progreso);
                    if (estado.completado) return;
                    ui.instruccion(INSTRUCCION_RETO[desafio.accion], 'reto');
                } else {
                    ui.instruccion(PISTAS.sin_rostro, 'pista');
                }
                if (Date.now() > limite) throw fallo('tiempo_reto');
                await siguienteCuadro();
            }
        }

        async function tomarDescriptores() {
            var tomados = [];
            // En celulares lentos cada captura puede tardar un par de segundos.
            var limite = Date.now() + 25000;
            ui.estado('capturando');
            ui.instruccion('¡Bien! Ahora mira al frente y no te muevas…', 'ok');
            ui.pasos(0);
            while (tomados.length < config.cantidad && !cancelado) {
                var a = await analizar();
                if (a.calidad.ok) {
                    var d = await descriptor();
                    if (d) {
                        tomados.push(d);
                        ui.pasos(tomados.length);
                        await dormir(320);
                    }
                } else {
                    ui.instruccion(PISTAS[a.calidad.codigo] || PISTAS.sin_rostro, 'pista');
                }
                if (Date.now() > limite) throw fallo('captura');
                await siguienteCuadro();
            }
            return tomados;
        }

        this.corriendo = function () { return corriendo; };

        this.cancelar = function () {
            cancelado = true;
            detener();
            corriendo = false;
            ui.estado('inactivo');
            ui.ocultarMensaje();
            ui.pasos(0);
            ui.progreso(0);
            ui.instruccion('Pulsa el botón para encender la cámara.');
        };

        // Devuelve lo que responda config.enviar. Si algo falla, muestra el mensaje y relanza el error.
        this.ejecutar = async function () {
            if (corriendo) return null;
            corriendo = true;
            cancelado = false;
            ui.ocultarMensaje();
            ui.pasos(0);
            ui.progreso(0);
            try {
                if (esAppInterna()) ui.mensaje('aviso', MENSAJES.app_interna.titulo, MENSAJES.app_interna.texto);
                ui.estado('cargando');
                ui.instruccion('Preparando el reconocimiento facial… la primera vez puede tardar un poco.');
                await cargarModelos();
                if (cancelado) return null;
                ui.estado('camara');
                ui.instruccion('Permite el acceso a la cámara cuando tu navegador lo pida.');
                flujo = await abrirCamara(video);
                if (cancelado) { detener(); return null; }
                ajustarLienzo();
                ui.ocultarMensaje();
                ui.estado('alineando');
                await alinear();
                if (cancelado) return null;
                var desafio = await config.pedirDesafio();
                await superarReto(desafio);
                if (cancelado) return null;
                var descriptores = await tomarDescriptores();
                if (cancelado) return null;
                ui.estado('verificando');
                ui.instruccion('Verificando…');
                var resultado = await config.enviar(descriptores, desafio.nonce);
                detener();
                ui.pasos(config.cantidad);
                ui.instruccion(config.textoExito || '¡Listo!', 'ok');
                ui.estado('exito');
                corriendo = false;
                return resultado;
            } catch (error) {
                detener();
                ui.estado('error');
                ui.instruccion('No se pudo completar.', 'error');
                mostrarError(error);
                corriendo = false;
                throw error;
            }
        };

        window.addEventListener('pagehide', detener);
    }

    /* ---------- Página /rostro: activar el inicio con rostro ---------- */

    function iniciarRegistro(contenedor) {
        var formulario = $('[data-rostro-autorizar]', contenedor);
        var casilla = $('[data-rostro-consentimiento]', contenedor);
        var clave = $('[data-rostro-clave]', contenedor);
        var continuar = $('[data-rostro-continuar]', contenedor);
        var errorForm = $('[data-rostro-error-form]', contenedor);
        var pasoCamara = $('[data-rostro-paso-camara]', contenedor);
        var iniciar = $('[data-rostro-iniciar]', contenedor);
        var cancelar = $('[data-rostro-cancelar]', contenedor);
        var destino = contenedor.getAttribute('data-destino') || '/rostro?activado=1';
        var captura = null;

        function mostrarErrorForm(texto) {
            errorForm.textContent = texto;
            errorForm.hidden = !texto;
        }

        function actualizarBoton() {
            continuar.disabled = !(casilla.checked && clave.value.length > 0);
        }

        function volverAlFormulario() {
            if (captura) captura.cancelar();
            pasoCamara.hidden = true;
            formulario.hidden = false;
            clave.value = '';
            actualizarBoton();
        }

        casilla.addEventListener('change', actualizarBoton);
        clave.addEventListener('input', actualizarBoton);

        // Botón "Volver a registrar mi rostro" (cuando ya estaba activado).
        var reiniciar = $('[data-rostro-reiniciar]');
        if (reiniciar) {
            reiniciar.addEventListener('click', function () {
                var activo = $('[data-rostro-activo]');
                if (activo) activo.hidden = true;
                contenedor.hidden = false;
            });
        }

        formulario.addEventListener('submit', function (evento) {
            evento.preventDefault();
            mostrarErrorForm('');
            if (!casilla.checked) return mostrarErrorForm('Para continuar debes aceptar la autorización de tratamiento de datos biométricos.');
            if (!clave.value) return mostrarErrorForm('Escribe tu contraseña para confirmar que eres tú.');
            continuar.disabled = true;
            return api('/rostro/autorizar', { clave: clave.value, consentimiento: true }).then(function () {
                clave.value = '';
                formulario.hidden = true;
                pasoCamara.hidden = false;
                captura = new Captura(pasoCamara, {
                    cantidad: 4,
                    textoExito: '¡Listo! Tu rostro quedó registrado.',
                    pedirDesafio: function () { return api('/rostro/desafio', {}).then(function (r) { return r.desafio; }); },
                    enviar: function (descriptores, nonce) { return api('/rostro/registro', { desafio: nonce, descriptores: descriptores }); }
                });
            }).catch(function (error) {
                mostrarErrorForm(error.message);
                actualizarBoton();
            });
        });

        iniciar.addEventListener('click', function () {
            if (!captura || captura.corriendo()) return;
            iniciar.disabled = true;
            captura.ejecutar().then(function () {
                // Un momento para ver la animación de éxito y se entra a la página de destino.
                setTimeout(function () { window.location.href = destino; }, reducir ? 600 : 2400);
            }).catch(function (error) {
                iniciar.disabled = false;
                iniciar.innerHTML = '<i class="bi bi-arrow-repeat me-2"></i>Intentar de nuevo';
                // Si se venció la autorización, hay que confirmar la contraseña otra vez.
                if (error.codigo === 'sin_autorizacion') volverAlFormulario();
            });
        });

        cancelar.addEventListener('click', function () {
            volverAlFormulario();
            iniciar.disabled = false;
            iniciar.innerHTML = '<i class="bi bi-camera-video me-2"></i>Encender cámara';
        });
    }

    window.EcoRostro = { api: api, Captura: Captura, MENSAJES: MENSAJES, cargarModelos: cargarModelos };

    function arrancar() {
        var registro = $('[data-rostro-registro]');
        if (registro) iniciarRegistro(registro);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arrancar);
    else arrancar();
}());
