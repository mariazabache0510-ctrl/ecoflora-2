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

    // Tiempos y tamaños de cada etapa (en milisegundos). En un dispositivo lento los límites se duplican.
    var ETAPA = {
        reto: 20000,        // para hacer el parpadeo o el giro
        sinRostro: 12000,   // sin ver ninguna cara en todo ese tiempo, se avisa de que no se ve el rostro
        captura: 20000,     // para tomar todas las muestras
        sinAvance: 8000,    // sin avanzar en este tiempo, se muestra una ayuda más concreta
        carga: 20000,       // si descargar los modelos tarda más, se avisa de la lentitud
        servidor: 25000     // espera máxima de una respuesta del servidor
    };
    var PAUSA_MUESTRAS = 140;   // descanso entre una muestra del rostro y la siguiente
    var TAMANO_NORMAL = 224;    // tamaño (px) al que el detector mira cada cuadro
    var TAMANO_LENTO = 192;     // el mismo, en dispositivos lentos

    function $(selector, contexto) { return (contexto || document).querySelector(selector); }
    function dormir(ms) { return new Promise(function (resolver) { setTimeout(resolver, ms); }); }
    function siguienteCuadro() { return new Promise(function (resolver) { window.requestAnimationFrame(resolver); }); }
    function fallo(codigo, texto) {
        var error = new Error(texto || codigo);
        error.codigo = codigo;
        return error;
    }
    // Deja en la consola (F12) cuánto tardó cada etapa: sirve para saber dónde se atasca en un equipo concreto.
    function registrar(etapa, desde, extra) {
        if (window.console && window.console.debug) {
            window.console.debug('[rostro] ' + etapa + (desde ? ': ' + (Date.now() - desde) + ' ms' : '') + (extra ? ' · ' + extra : ''));
        }
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
        tiempo_servidor: { titulo: 'El servidor tarda en responder', texto: 'Puede ser tu conexión o que el sitio se esté despertando. Inténtalo de nuevo en un momento, o entra con tu contraseña.' },
        captura: { titulo: 'No pudimos tomar una buena captura', texto: 'Mantén la cabeza quieta, de frente y con buena luz, e inténtalo otra vez.' },
        no_coincide: { titulo: 'No te reconocimos', texto: 'Inténtalo de nuevo con buena luz y de frente. Si sigue fallando, entra con tu contraseña.' },
        sin_rostro_activo: { titulo: 'Esta cuenta no tiene el rostro activado', texto: 'Revisa que el usuario esté bien escrito. Si aún no lo activaste, entra con tu contraseña y actívalo desde tu perfil.' },
        demasiados_intentos: { titulo: 'Demasiados intentos', texto: 'Espera unos minutos o entra con tu contraseña, que sigue funcionando.' },
        rostro_ilegible: { titulo: 'Hay que registrar tu rostro de nuevo', texto: 'Entra con tu contraseña y vuelve a registrarlo desde tu perfil.' },
        generico: { titulo: 'Algo salió mal', texto: 'No pudimos completar el proceso. Inténtalo de nuevo en un momento.' }
    };

    var PISTAS = {
        sin_rostro: 'No vemos tu rostro. Colócate frente a la cámara, dentro del círculo.',
        varias_caras: 'Aparece más de una persona. Asegúrate de estar solo(a) frente a la cámara.',
        poca_luz: 'Hay poca luz. Busca una luz de frente (una ventana o una lámpara).',
        mucha_luz: 'Hay demasiada luz o contraluz. Evita tener una ventana o lámpara detrás de ti.',
        lejos: 'Acércate un poquito a la cámara.',
        cerca: 'Aléjate un poco de la cámara.',
        descentrado: 'Centra tu rostro dentro del círculo.',
        de_lado: 'Mira de frente a la cámara, con la cabeza recta.'
    };

    var INSTRUCCION_RETO = {
        parpadear: 'Mira a la cámara y parpadea una vez, con calma.',
        girar_izquierda: 'Gira lentamente la cabeza hacia tu izquierda.',
        girar_derecha: 'Gira lentamente la cabeza hacia tu derecha.'
    };

    // Si pasan unos segundos sin avanzar, se dice algo más concreto.
    var AYUDA_RETO = {
        parpadear: 'Mira directo a la cámara y cierra los ojos un instante, bien despacio.',
        girar_izquierda: 'Gira un poco más la cabeza hacia tu izquierda, sin apartar la vista de la cámara.',
        girar_derecha: 'Gira un poco más la cabeza hacia tu derecha, sin apartar la vista de la cámara.'
    };

    function esAppInterna() {
        return /FBAN|FBAV|FB_IAB|Instagram|Line\/|WhatsApp|Snapchat|MicroMessenger|; wv\)/i.test(navigator.userAgent || '');
    }

    /* ---------- Llamadas al servidor (JSON) ---------- */

    function api(ruta, cuerpo) {
        // Si el servidor no responde en un rato se corta la espera, para no dejar la pantalla "verificando" para siempre.
        var control = window.AbortController ? new window.AbortController() : null;
        var reloj = control ? setTimeout(function () { control.abort(); }, ETAPA.servidor) : null;
        return fetch(ruta, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(cuerpo || {}),
            signal: control ? control.signal : undefined
        }).then(function (respuesta) {
            clearTimeout(reloj); // ya respondió: lo que falta del cuerpo es mínimo
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
        }, function (error) {
            clearTimeout(reloj);
            if (error && error.name === 'AbortError') throw fallo('tiempo_servidor', 'El servidor tardó demasiado en responder.');
            throw error;
        });
    }

    /* ---------- Librería, modelos y cámara ---------- */

    var promesaModelos = null;
    var promesaCalentamiento = null;
    var modelosListos = false;  // true cuando los modelos están descargados Y calentados
    var motor = '';            // 'webgl' (rápido) o 'cpu' (lento): lo que usa el navegador para los cálculos
    var textoCarga = '';
    var oyentesCarga = [];
    var detectores = {};

    function informarCarga(texto) {
        textoCarga = texto;
        oyentesCarga.slice().forEach(function (oyente) { oyente(texto); });
    }

    function escucharCarga(oyente) {
        if (!oyente) return;
        oyentesCarga.push(oyente);
        if (textoCarga) oyente(textoCarga);
    }

    function quitarOyenteCarga(oyente) {
        var i = oyentesCarga.indexOf(oyente);
        if (i >= 0) oyentesCarga.splice(i, 1);
    }

    // Opciones del detector de caras (una por tamaño, para no crearlas en cada cuadro).
    function opcionesDetector(tamano) {
        if (!detectores[tamano]) detectores[tamano] = new window.faceapi.TinyFaceDetectorOptions({ inputSize: tamano, scoreThreshold: 0.5 });
        return detectores[tamano];
    }

    // Una pasada de prueba con las 3 redes, sobre una imagen gris, para que el navegador compile sus programas
    // de cálculo (shaders de WebGL) ahora. Si no, esa compilación ocurre con el primer cuadro de la cámara y
    // congela la página unos segundos.
    function calentar(f) {
        // Los programas dependen del tamaño de la imagen: el cuadro de prueba mide lo mismo que el de la cámara (640x480)
        // y el recorte de la cara es de un tamaño parecido a los reales.
        function gris(ancho, alto) {
            var lienzo = document.createElement('canvas');
            lienzo.width = ancho;
            lienzo.height = alto;
            var pincel = lienzo.getContext('2d');
            pincel.fillStyle = '#808080';
            pincel.fillRect(0, 0, ancho, alto);
            return lienzo;
        }
        var cuadroPrueba = gris(640, 480);
        var caraPrueba = gris(160, 160);
        return Promise.resolve(f.detectAllFaces(cuadroPrueba, opcionesDetector(TAMANO_NORMAL)))
            .then(function () { return f.nets.faceLandmark68Net.detectLandmarks(caraPrueba); })
            .then(function () { return f.nets.faceRecognitionNet.computeFaceDescriptor(caraPrueba); })
            .catch(function () { /* si algo falla aquí, simplemente se compila con el primer cuadro real */ });
    }

    // Baja la librería y los modelos, elige WebGL o CPU y calienta las redes. Es seguro llamarla varias veces:
    // todas comparten la misma descarga. oyente(texto) recibe los avances ("Descargando modelos 2 de 3…").
    function cargarModelos(oyente) {
        escucharCarga(oyente);
        if (promesaModelos) return promesaModelos;
        var inicio = Date.now();
        informarCarga('Preparando el reconocimiento facial…');
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
                // WebGL es rápido; si el dispositivo no lo tiene (o falla al arrancar) se usa el procesador.
                preparar = f.tf.setBackend('webgl')
                    .then(function (listo) { return listo ? true : f.tf.setBackend('cpu'); })
                    .catch(function () { return f.tf.setBackend('cpu'); })
                    .then(function () { return f.tf.ready(); })
                    .catch(function () { return f.tf.setBackend('cpu').then(function () { return f.tf.ready(); }); });
            }
            return preparar.then(function () {
                motor = f.tf && f.tf.getBackend ? f.tf.getBackend() : '';
                var hechos = 0;
                function avanzar() { hechos += 1; informarCarga('Descargando modelos ' + hechos + ' de 3…'); }
                informarCarga('Descargando modelos…');
                return Promise.all([
                    f.nets.tinyFaceDetector.loadFromUri(RUTA_MODELOS).then(avanzar),
                    f.nets.faceLandmark68Net.loadFromUri(RUTA_MODELOS).then(avanzar),
                    f.nets.faceRecognitionNet.loadFromUri(RUTA_MODELOS).then(avanzar)
                ]);
            });
        }).then(function () {
            informarCarga('');
            registrar('modelos descargados', inicio, 'motor ' + (motor || 'desconocido'));
        }).catch(function () {
            promesaModelos = null;
            promesaCalentamiento = null;
            modelosListos = false;
            informarCarga('');
            throw fallo('modelos');
        });
        return promesaModelos;
    }

    // Además de bajar los modelos, los calienta (ver calentar). Es trabajo pesado para el navegador: se hace cuando
    // la persona ya terminó de escribir, o mientras responde el permiso de la cámara.
    function calentarModelos(oyente) {
        escucharCarga(oyente);
        if (promesaCalentamiento) return promesaCalentamiento;
        promesaCalentamiento = cargarModelos().then(function () {
            var inicio = Date.now();
            informarCarga('Preparando el detector…');
            return calentar(window.faceapi).then(function () {
                modelosListos = true;
                informarCarga('');
                registrar('detector calentado', inicio);
            });
        }).catch(function (error) {
            promesaCalentamiento = null;
            throw error;
        });
        return promesaCalentamiento;
    }

    // Empieza a preparar todo en segundo plano, para que al pulsar "Encender cámara" ya esté listo. Si falla, se
    // reintenta al pulsar el botón. Con conCalentamiento también se calientan las redes (trabajo pesado: solo cuando
    // la persona no está escribiendo).
    function precargar(conCalentamiento) {
        if (!window.fetch || !window.Promise) return;
        var arrancar = function () {
            (conCalentamiento ? calentarModelos() : cargarModelos()).catch(function () { /* se avisará al encender la cámara */ });
        };
        if (window.requestIdleCallback) window.requestIdleCallback(arrancar, { timeout: 1500 });
        else setTimeout(arrancar, 300);
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
            // iPhone y iPad exigen estos atributos antes de dar el video, o lo abren a pantalla completa y no lo reproducen.
            video.setAttribute('playsinline', '');
            video.setAttribute('webkit-playsinline', '');
            video.setAttribute('autoplay', '');
            video.muted = true;
            video.playsInline = true;
            video.srcObject = flujo;
            var listo = new Promise(function (resolver) {
                if (video.readyState >= 2 && video.videoWidth) return resolver();
                video.addEventListener('loadeddata', function () { resolver(); }, { once: true });
                setTimeout(resolver, 2500);
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
        var ultimoProgreso = -1;

        function $$(selector, contexto) { return Array.prototype.slice.call((contexto || document).querySelectorAll(selector)); }

        return {
            caja: caja,
            estado: function (nombre) { if (caja.getAttribute('data-estado') !== nombre) caja.setAttribute('data-estado', nombre); },
            // Solo se toca la página si algo cambió: se llama en cada cuadro de la cámara.
            instruccion: function (texto, tono) {
                if (instruccion.textContent !== texto) instruccion.textContent = texto;
                var t = tono || 'normal';
                if (instruccion.getAttribute('data-tono') !== t) instruccion.setAttribute('data-tono', t);
            },
            pasos: function (hechos) {
                pasos.forEach(function (punto, i) { punto.classList.toggle('hecho', i < hechos); });
            },
            progreso: function (valor) {
                if (valor !== 0 && valor !== 1 && Math.abs(valor - ultimoProgreso) < 0.01) return;
                ultimoProgreso = valor;
                caja.style.setProperty('--progreso', String(valor));
            },
            ocultarPasos: function (ocultar) { var cont = $('[data-rostro-pasos]', caja); if (cont) cont.hidden = ocultar; },
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

    // Líneas de la malla sobre el rostro: [desde, hasta, cerrado] y enlaces sueltos entre puntos de los 68.
    var CONTORNOS = [[0, 16, false], [17, 21, false], [22, 26, false], [27, 30, false], [31, 35, false],
        [36, 41, true], [42, 47, true], [48, 59, true], [60, 67, true]];
    var ENLACES = [[30, 36], [30, 45], [27, 39], [27, 42], [30, 48], [30, 54], [8, 48], [8, 54], [36, 48], [45, 54],
        [31, 48], [35, 54], [17, 36], [26, 45], [0, 36], [16, 45], [0, 48], [16, 54], [21, 27], [22, 27]];

    // config.cantidad: cuántos descriptores tomar.
    // config.pedirDesafio(): promesa con { nonce, accion } del servidor.
    // config.enviar(descriptores, nonce): promesa; si el servidor rechaza, lanza el error.
    //
    // Flujo: la cámara y los modelos se preparan a la vez -> prueba de vida (parpadeo o giro) -> captura de
    // los descriptores -> envío. No hay una etapa de "alinear" aparte: las pistas (luz, distancia...) se
    // muestran sin bloquear y la calidad solo se exige al tomar cada muestra.
    function Captura(raiz, config) {
        var ui = crearUI(raiz);
        var video = ui.video;
        var lienzo = ui.lienzo;
        var contexto = lienzo ? lienzo.getContext('2d') : null;
        // Copia del cuadro de video que se analiza: el rostro se recorta de ESTA misma copia para el descriptor,
        // así los puntos y el recorte corresponden exactamente al mismo instante.
        var cuadro = document.createElement('canvas');
        var contextoCuadro = cuadro.getContext('2d');
        var muestra = document.createElement('canvas');
        muestra.width = 24;
        muestra.height = 24;
        var contextoMuestra = muestra.getContext('2d', { willReadFrequently: true });
        var flujo = null;
        var turno = 0; // cada intento tiene su número; cancelar lo invalida
        var corriendo = false;
        var factor = 1;          // 1 normal; 2 en un dispositivo lento (los límites de tiempo se duplican)
        var tamano = TAMANO_NORMAL;
        var duracion = 0;        // cuánto tarda, en promedio, analizar un cuadro (ms)
        var cuadros = 0;
        var neutro = null;       // dónde tiene la nariz esta persona al mirar de frente (para pedir la captura derecha)
        var ultimoDibujo = 0;
        var dibujado = false;
        ui.ocultarPasos(Boolean(config.sinPasos));

        // Tiempo máximo de una etapa: el normal (duplicado en equipos lentos), pero nunca menos que el necesario
        // para analizar unos cuantos cuadros, por muy lento que vaya el equipo.
        function limite(base, cuadrosMinimos) {
            return Math.max(base * factor, duracion * cuadrosMinimos);
        }

        function modoLento(motivo) {
            if (factor > 1) return;
            factor = 2;
            tamano = TAMANO_LENTO;
            registrar('dispositivo lento: más tiempo y detector más pequeño', null, motivo);
        }

        // Brillo medio (0 a 255) de la CARA (su zona central), no de todo el cuadro: un fondo oscuro
        // no es "poca luz", pero una cara a contraluz sí.
        function medirLuz(caja) {
            var ancho = cuadro.width;
            var alto = cuadro.height;
            if (!ancho || !alto || !caja) return null;
            var sx = Math.max(0, caja.x + caja.width * 0.2);
            var sy = Math.max(0, caja.y + caja.height * 0.2);
            var sw = Math.min(ancho - sx, caja.width * 0.6);
            var sh = Math.min(alto - sy, caja.height * 0.6);
            if (sw < 4 || sh < 4) return null;
            contextoMuestra.drawImage(cuadro, sx, sy, sw, sh, 0, 0, 24, 24);
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

        function limpiarLienzo() {
            if (contexto && dibujado) contexto.clearRect(0, 0, lienzo.width, lienzo.height);
            dibujado = false;
        }

        // Dibuja sobre el rostro una malla ligera (líneas finas y puntos) con los 68 puntos. Es solo decoración:
        // se repinta unas 14 veces por segundo (no en cada cuadro) y sin sombras, que en celulares cuestan mucho.
        function pintar(puntos, advertencia) {
            if (!contexto) return;
            if (!puntos) { limpiarLienzo(); return; }
            var t = Date.now();
            if (t - ultimoDibujo < (factor > 1 ? 180 : 70)) return;
            ultimoDibujo = t;
            contexto.clearRect(0, 0, lienzo.width, lienzo.height);
            dibujado = true;
            var color = advertencia ? '255, 214, 120' : '183, 255, 214';
            var escala = lienzo.width / 400;
            contexto.lineJoin = 'round';
            contexto.lineCap = 'round';
            contexto.lineWidth = Math.max(1, escala * 1.1);
            contexto.strokeStyle = 'rgba(' + color + ', 0.5)';
            CONTORNOS.forEach(function (c) {
                contexto.beginPath();
                for (var i = c[0]; i <= c[1]; i += 1) {
                    if (i === c[0]) contexto.moveTo(puntos[i].x, puntos[i].y);
                    else contexto.lineTo(puntos[i].x, puntos[i].y);
                }
                if (c[2]) contexto.closePath();
                contexto.stroke();
            });
            contexto.strokeStyle = 'rgba(' + color + ', 0.22)';
            contexto.beginPath();
            ENLACES.forEach(function (e) {
                contexto.moveTo(puntos[e[0]].x, puntos[e[0]].y);
                contexto.lineTo(puntos[e[1]].x, puntos[e[1]].y);
            });
            contexto.stroke();
            // Puntos: un halo suave y un núcleo, cada uno en UN solo trazo (mucho más barato que 68 círculos con sombra).
            var radio = 1.9 * escala;
            contexto.fillStyle = 'rgba(' + color + ', 0.2)';
            contexto.beginPath();
            puntos.forEach(function (punto) {
                contexto.moveTo(punto.x + radio * 2.3, punto.y);
                contexto.arc(punto.x, punto.y, radio * 2.3, 0, Math.PI * 2);
            });
            contexto.fill();
            contexto.fillStyle = 'rgba(' + color + ', 0.95)';
            contexto.beginPath();
            puntos.forEach(function (punto) {
                contexto.moveTo(punto.x + radio, punto.y);
                contexto.arc(punto.x, punto.y, radio, 0, Math.PI * 2);
            });
            contexto.fill();
        }

        // Una sola pasada por cuadro: detecta las caras y saca sus 68 puntos. tolerancia (1 a 2) relaja los
        // criterios de calidad. Devuelve { calidad, puntos, cantidad, cara }.
        function analizar(tolerancia) {
            var ancho = video.videoWidth;
            var alto = video.videoHeight;
            if (!ancho || !alto || video.readyState < 2) {
                // La cámara aún no entrega imagen: se espera un momento en vez de dejar que la librería falle.
                return dormir(60).then(function () {
                    return { calidad: { ok: false, codigo: 'sin_rostro' }, puntos: null, cantidad: 0, cara: null };
                });
            }
            if (cuadro.width !== ancho || cuadro.height !== alto) {
                cuadro.width = ancho;
                cuadro.height = alto;
            }
            var t0 = Date.now();
            contextoCuadro.drawImage(video, 0, 0, ancho, alto);
            return window.faceapi.detectAllFaces(cuadro, opcionesDetector(tamano)).withFaceLandmarks().then(function (resultados) {
                cuadros += 1;
                var tardo = Date.now() - t0;
                if (cuadros <= 6) registrar('cuadro ' + cuadros, null, tardo + ' ms');
                // Los primeros cuadros pagan la preparación de la tarjeta gráfica: no cuentan para saber si el equipo es lento.
                if (cuadros === 3) duracion = tardo;
                else if (cuadros > 3) duracion = duracion * 0.8 + tardo * 0.2;
                if (factor === 1 && cuadros >= 8 && duracion > 600) modoLento('cada cuadro tarda ' + Math.round(duracion) + ' ms');
                var cara = resultados.length === 1 ? resultados[0] : null;
                var luz = cara ? medirLuz(cara.detection.box) : null;
                var caras = resultados.map(function (r) { return { caja: r.detection.box, puntaje: r.detection.score }; });
                var calidad = Vida.evaluarCalidad({ caras: caras, ancho: ancho, alto: alto, luz: luz, tolerancia: tolerancia || 1 });
                var puntos = cara ? cara.landmarks.positions : null;
                pintar(puntos, !calidad.ok);
                return { calidad: calidad, puntos: puntos, cantidad: resultados.length, cara: cara };
            });
        }

        // Descriptor (128 números) de una cara YA detectada en el último cuadro analizado: solo corre la red de
        // reconocimiento. Es lo mismo que hace face-api por dentro con withFaceDescriptor(), sin repetir la detección.
        function descriptorDe(cara) {
            var f = window.faceapi;
            var zona = cara.landmarks.align(null, { useDlibAlignment: true });
            return f.extractFaces(cuadro, [zona]).then(function (recortes) {
                return f.nets.faceRecognitionNet.computeFaceDescriptor(recortes[0]);
            }).then(function (numeros) {
                var lista = Array.prototype.map.call(numeros, function (valor) { return Number(valor.toFixed(6)); });
                var fuerza = lista.reduce(function (suma, valor) { return suma + valor * valor; }, 0);
                return lista.length === 128 && isFinite(fuerza) && fuerza > 0 ? lista : null;
            });
        }

        // El fondo animado del sitio (hojas que caen, mariposas) se detiene mientras la cámara trabaja,
        // para que el equipo use todas sus fuerzas en reconocer el rostro.
        function pausarFondo(pausar) {
            var jardin = $('[data-jardin]');
            if (jardin) jardin.classList.toggle('rostro-pausa', pausar);
        }

        function detener() {
            detenerCamara(flujo, video);
            flujo = null;
            limpiarLienzo();
            pausarFondo(false);
        }

        function mostrarError(error) {
            var datos = MENSAJES[error.codigo];
            if (datos) ui.mensaje('error', datos.titulo, datos.texto);
            else ui.mensaje('error', 'No pudimos continuar', error.message || MENSAJES.generico.texto);
        }

        // Prueba de vida: parpadear o girar la cabeza. Empieza en cuanto hay cámara; mientras tanto se muestran
        // pistas (poca luz, lejos...) pero NUNCA se espera a que todo esté perfecto.
        async function superarReto(desafio, yo) {
            var accion = desafio.accion;
            var reto = Vida.crearReto(accion);
            var inicio = Date.now();
            var avanceEn = inicio;   // última vez que el progreso subió
            var mejor = 0;
            var visto = false;       // ¿se vio alguna cara en esta etapa?
            var malos = 0;           // cuadros seguidos con un problema (para no hacer parpadear el texto)
            var posiciones = [];     // dónde tenía la nariz al empezar
            ui.estado('reto');
            ui.progreso(0);
            ui.instruccion(INSTRUCCION_RETO[accion] || INSTRUCCION_RETO.parpadear, 'reto');
            while (yo === turno) {
                // Un parpadeo dura menos que un cuadro en un equipo lento y se perdería: se pide girar la cabeza,
                // que se ve igual de bien a pocos cuadros por segundo. (El servidor solo emite el desafío; no pide una acción.)
                if (factor > 1 && accion === 'parpadear') {
                    accion = 'girar_derecha';
                    reto = Vida.crearReto(accion);
                    registrar('prueba de vida cambiada a giro', null, 'equipo lento');
                    ui.instruccion(INSTRUCCION_RETO[accion], 'reto');
                }
                var a = await analizar(1);
                if (yo !== turno) return;
                var pista = null;
                if (a.cantidad > 1) {
                    pista = 'varias_caras';
                } else if (!a.puntos) {
                    pista = 'sin_rostro';
                } else {
                    visto = true;
                    if (posiciones.length < 4) posiciones.push(Vida.giro(a.puntos));
                    var estado = reto.procesar(a.puntos);
                    ui.progreso(estado.progreso);
                    if (estado.progreso > mejor + 0.02) { mejor = estado.progreso; avanceEn = Date.now(); }
                    if (estado.completado) { neutro = Vida.mediana(posiciones); return accion; }
                    // Solo se avisa de lo que de verdad estorba al gesto; el centrado y el tamaño se piden al capturar.
                    if (['poca_luz', 'mucha_luz', 'lejos'].indexOf(a.calidad.codigo) >= 0) pista = a.calidad.codigo;
                }
                malos = pista ? malos + 1 : 0;
                var ahora = Date.now();
                if (pista && malos >= 3) ui.instruccion(PISTAS[pista], 'pista');
                else if (!pista) ui.instruccion(ahora - avanceEn > ETAPA.sinAvance ? AYUDA_RETO[accion] : INSTRUCCION_RETO[accion], 'reto');
                if (!visto && ahora - inicio > limite(ETAPA.sinRostro, 6)) throw fallo('tiempo_alinear');
                if (ahora - inicio > limite(ETAPA.reto, 12)) throw fallo(visto ? 'tiempo_reto' : 'tiempo_alinear');
                await siguienteCuadro();
            }
        }

        // Toma las muestras: por cada cuadro bueno (de frente, con luz y a buena distancia) corre SOLO la red de
        // reconocimiento. Si tarda en salir una buena, los criterios se van relajando hasta el doble.
        async function tomarDescriptores(yo) {
            var tomados = [];
            var inicio = Date.now();
            var ultima = inicio;     // cuándo se tomó la última muestra
            var malos = 0;
            ui.estado('capturando');
            ui.progreso(0);
            ui.pasos(0);
            ui.instruccion('¡Bien! Ahora mira al frente y no te muevas…', 'ok');
            while (tomados.length < config.cantidad && yo === turno) {
                var tolerancia = 1 + Math.min(1, (Date.now() - ultima) / limite(6000, 3));
                var a = await analizar(tolerancia);
                if (yo !== turno) break;
                var codigo = a.calidad.codigo;
                if (a.calidad.ok && !Vida.deFrente(a.puntos, neutro, tolerancia)) codigo = 'de_lado';
                if (codigo === 'ok') {
                    malos = 0;
                    var d = await descriptorDe(a.cara);
                    if (yo !== turno) break;
                    if (d) {
                        tomados.push(d);
                        ui.pasos(tomados.length);
                        ui.progreso(tomados.length / config.cantidad);
                        ui.instruccion('Perfecto, no te muevas…', 'ok');
                        ultima = Date.now();
                        await dormir(PAUSA_MUESTRAS);
                    }
                } else {
                    malos += 1;
                    if (malos >= 2) ui.instruccion(PISTAS[codigo] || PISTAS.sin_rostro, 'pista');
                }
                if (Date.now() - inicio > limite(ETAPA.captura, 14)) throw fallo('captura');
                await siguienteCuadro();
            }
            return tomados;
        }

        this.corriendo = function () { return corriendo; };

        this.cancelar = function () {
            turno += 1;
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
            var yo = turno += 1;
            var corrida = { viva: true }; // para que una cámara que tarda en abrirse no quede encendida si el intento terminó
            var inicio = Date.now();
            var marca = inicio;
            var camaraLista = false;
            var demorada = false;
            var aviso = null;
            neutro = null;
            cuadros = 0;
            duracion = 0;
            factor = 1;
            tamano = TAMANO_NORMAL;
            // Avances de la descarga ("Descargando modelos 2 de 3…") en el texto de la cámara.
            var oyente = function (texto) {
                if (yo !== turno || !texto) return;
                var base = demorada ? 'Esto tarda más de lo normal… ' + texto : texto;
                ui.instruccion(camaraLista ? base : base + ' (permite la cámara si te la piden)');
            };
            ui.ocultarMensaje();
            ui.pasos(0);
            ui.progreso(0);
            try {
                // Comprobaciones previas (por ejemplo, que la cuenta tenga rostro) antes de bajar los modelos.
                if (config.antes) await config.antes();
                if (yo !== turno) return null;
                if (esAppInterna()) ui.mensaje('aviso', MENSAJES.app_interna.titulo, MENSAJES.app_interna.texto);
                pausarFondo(true);
                ui.estado(modelosListos ? 'camara' : 'cargando');
                ui.instruccion(modelosListos
                    ? 'Permite el acceso a la cámara cuando tu navegador lo pida.'
                    : 'Preparando el reconocimiento facial… la primera vez puede tardar un poco.');
                aviso = setTimeout(function () {
                    demorada = true;
                    if (textoCarga) oyente(textoCarga);
                }, ETAPA.carga);
                // La cámara se pide AL MISMO TIEMPO que se preparan los modelos: la persona responde el permiso
                // mientras se descargan, en vez de esperar una cosa tras la otra.
                var camara = abrirCamara(video).then(function (obtenido) {
                    if (!corrida.viva || yo !== turno) { detenerCamara(obtenido, video); return null; }
                    flujo = obtenido;
                    camaraLista = true;
                    return obtenido;
                });
                var modelos = calentarModelos(oyente).then(function () {
                    if (yo === turno && !camaraLista) {
                        ui.estado('camara');
                        ui.instruccion('Permite el acceso a la cámara cuando tu navegador lo pida.');
                    }
                });
                await Promise.all([camara, modelos]);
                if (yo !== turno) return null;
                registrar('modelos y cámara', marca, 'motor ' + (motor || 'desconocido'));
                marca = Date.now();
                if (motor === 'cpu') modoLento('el navegador usa el procesador (sin WebGL)');
                ajustarLienzo();
                ui.ocultarMensaje();
                ui.estado('reto');
                ui.instruccion('Mira a la cámara…');
                var desafio = await config.pedirDesafio();
                if (yo !== turno) return null;
                var accionFinal = await superarReto(desafio, yo);
                if (yo !== turno) return null;
                registrar('prueba de vida', marca, accionFinal + ', ' + cuadros + ' cuadros, ' + Math.round(duracion) + ' ms por cuadro');
                marca = Date.now();
                var descriptores = await tomarDescriptores(yo);
                if (yo !== turno) return null;
                registrar('captura', marca, descriptores.length + ' muestras');
                marca = Date.now();
                ui.estado('verificando');
                ui.instruccion('Verificando…');
                var resultado = await config.enviar(descriptores, desafio.nonce);
                registrar('servidor', marca);
                registrar('total', inicio);
                detener();
                ui.pasos(config.cantidad);
                ui.progreso(1);
                ui.instruccion(typeof config.textoExito === 'function' ? config.textoExito(resultado) : (config.textoExito || '¡Listo!'), 'ok');
                ui.estado('exito');
                corriendo = false;
                return resultado;
            } catch (error) {
                // Si la persona canceló, no se muestran errores de un intento que ya no cuenta.
                if (yo !== turno) return null;
                detener();
                ui.estado('error');
                ui.instruccion('No se pudo completar.', 'error');
                mostrarError(error);
                corriendo = false;
                registrar('error ' + (error.codigo || 'desconocido'), inicio);
                throw error;
            } finally {
                corrida.viva = false;
                clearTimeout(aviso);
                quitarOyenteCarga(oyente);
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
                precargar();
            });
        }

        // Mientras la persona acepta la autorización y escribe su contraseña, ya se van descargando los modelos.
        if (!contenedor.hidden) precargar();

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
                precargar(true); // ya terminó de escribir: se calientan las redes mientras ve el botón "Encender cámara"
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
            captura.ejecutar().then(function (resultado) {
                if (!resultado) return; // se canceló
                // Un momento para ver la animación de éxito y se entra a la página de destino.
                setTimeout(function () { window.location.href = destino; }, reducir ? 600 : 3000);
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

    /* ---------- Página /login: pestañas Contraseña | Rostro ---------- */

    // Este navegador recuerda SOLO el nombre de usuario (nunca el rostro) para no volver a escribirlo.
    var CLAVE_USUARIO = 'ecoflora_rostro_usuario';
    function leerRecordado() {
        try { return window.localStorage.getItem(CLAVE_USUARIO) || ''; } catch (error) { return ''; }
    }
    function guardarRecordado(valor) {
        try { window.localStorage.setItem(CLAVE_USUARIO, valor); } catch (error) { /* navegación privada */ }
    }
    function olvidarRecordado() {
        try { window.localStorage.removeItem(CLAVE_USUARIO); } catch (error) { /* navegación privada */ }
    }

    function iniciarLogin(panelRostro) {
        var barra = $('[data-login-modos]');
        var pestanas = Array.prototype.slice.call(document.querySelectorAll('[data-login-tab]'));
        var paneles = Array.prototype.slice.call(document.querySelectorAll('[data-login-panel]'));
        var bloqueUsuario = $('[data-rostro-bloque-usuario]', panelRostro);
        var campoUsuario = $('[data-rostro-usuario]', panelRostro);
        var recordado = $('[data-rostro-recordado]', panelRostro);
        var nombreRecordado = $('[data-rostro-recordado-nombre]', panelRostro);
        var noSoy = $('[data-rostro-no-soy]', panelRostro);
        var iniciar = $('[data-login-rostro-iniciar]', panelRostro);
        var cancelar = $('[data-login-rostro-cancelar]', panelRostro);
        var usuarioFijo = leerRecordado();

        function usuarioActual() { return (usuarioFijo || campoUsuario.value).trim(); }

        function pintarUsuario() {
            recordado.hidden = !usuarioFijo;
            bloqueUsuario.hidden = Boolean(usuarioFijo);
            nombreRecordado.textContent = usuarioFijo;
        }

        var captura = new Captura(panelRostro, {
            cantidad: 1,
            sinPasos: true,
            textoExito: function (resultado) {
                var nombre = String((resultado && resultado.nombre) || '').split(' ')[0];
                return nombre ? '¡Hola, ' + nombre + '! Entrando…' : '¡Bienvenido a EcoFlora!';
            },
            antes: function () { return api('/login/rostro/comprobar', { usuario: usuarioActual() }); },
            pedirDesafio: function () { return api('/login/rostro/desafio', { usuario: usuarioActual() }).then(function (r) { return r.desafio; }); },
            enviar: function (descriptores, nonce) { return api('/login/rostro', { usuario: usuarioActual(), desafio: nonce, descriptor: descriptores[0] }); }
        });

        function textoBotonInicial() { return '<i class="bi bi-camera-video me-2"></i>Entrar con mi rostro'; }

        function detener() {
            if (captura.corriendo()) captura.cancelar();
            iniciar.disabled = false;
            iniciar.innerHTML = textoBotonInicial();
            cancelar.hidden = true;
        }

        function activar(nombre) {
            pestanas.forEach(function (pestana) {
                var activa = pestana.getAttribute('data-login-tab') === nombre;
                pestana.classList.toggle('activo', activa);
                pestana.setAttribute('aria-selected', activa ? 'true' : 'false');
                pestana.tabIndex = activa ? 0 : -1;
            });
            paneles.forEach(function (panel) { panel.hidden = panel.getAttribute('data-login-panel') !== nombre; });
            barra.setAttribute('data-activo', nombre);
            if (nombre !== 'rostro') detener();
            // Si este navegador ya entró con rostro, se sabe que la cuenta lo tiene: se preparan los modelos de una vez.
            // Si no, se espera a que escriba su usuario y pulse el botón (así quien no tiene rostro no descarga nada).
            else if (usuarioFijo) precargar(true);
        }

        barra.hidden = false;
        pestanas.forEach(function (pestana, i) {
            pestana.addEventListener('click', function () { activar(pestana.getAttribute('data-login-tab')); });
            // Flechas izquierda/derecha para moverse entre pestañas (accesibilidad).
            pestana.addEventListener('keydown', function (evento) {
                if (evento.key !== 'ArrowRight' && evento.key !== 'ArrowLeft') return;
                var destino = pestanas[(i + (evento.key === 'ArrowRight' ? 1 : pestanas.length - 1)) % pestanas.length];
                destino.focus();
                activar(destino.getAttribute('data-login-tab'));
            });
        });

        pintarUsuario();
        // Quien ya entró con rostro en este navegador empieza directamente en la pestaña del rostro.
        activar(usuarioFijo ? 'rostro' : 'clave');

        noSoy.addEventListener('click', function () {
            olvidarRecordado();
            usuarioFijo = '';
            campoUsuario.value = '';
            detener();
            pintarUsuario();
            campoUsuario.focus();
        });

        iniciar.addEventListener('click', function () {
            if (captura.corriendo()) return;
            if (!usuarioActual()) {
                campoUsuario.focus();
                campoUsuario.classList.add('is-invalid');
                return;
            }
            campoUsuario.classList.remove('is-invalid');
            iniciar.disabled = true;
            cancelar.hidden = false;
            captura.ejecutar().then(function (resultado) {
                if (!resultado) return;
                guardarRecordado(usuarioActual());
                cancelar.hidden = true;
                setTimeout(function () { window.location.href = resultado.destino || '/'; }, reducir ? 600 : 2800);
            }).catch(function () {
                iniciar.disabled = false;
                iniciar.innerHTML = '<i class="bi bi-arrow-repeat me-2"></i>Intentar de nuevo';
            });
        });

        cancelar.addEventListener('click', detener);
        campoUsuario.addEventListener('input', function () { campoUsuario.classList.remove('is-invalid'); });
        campoUsuario.addEventListener('keydown', function (evento) {
            if (evento.key === 'Enter') { evento.preventDefault(); iniciar.click(); }
        });
    }

    window.EcoRostro = { api: api, Captura: Captura, MENSAJES: MENSAJES, cargarModelos: cargarModelos, precargar: precargar };

    function arrancar() {
        var registro = $('[data-rostro-registro]');
        if (registro) iniciarRegistro(registro);
        var login = $('[data-login-rostro]');
        if (login) iniciarLogin(login);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arrancar);
    else arrancar();
}());
