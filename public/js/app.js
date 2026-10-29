/* EcoFlora - comportamiento del frontend (sin dependencias; Bootstrap solo para menús y alertas) */
(function () {
    'use strict';

    var reducir = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var puntero = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

    function $(selector, contexto) { return (contexto || document).querySelector(selector); }
    function $$(selector, contexto) { return Array.prototype.slice.call((contexto || document).querySelectorAll(selector)); }
    function seguro(fn) {
        try { fn(); } catch (error) { if (window.console) console.warn('EcoFlora:', error); }
    }
    function alListo(fn) {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
        else fn();
    }

    /* ---------- Barra de navegación ---------- */
    function iniciarNavegacion() {
        var nav = $('[data-nav]');
        if (!nav) return;

        var ticking = false;
        function alScroll() {
            ticking = false;
            nav.classList.toggle('compacta', window.scrollY > 24);
        }
        window.addEventListener('scroll', function () {
            if (!ticking) { ticking = true; window.requestAnimationFrame(alScroll); }
        }, { passive: true });
        alScroll();

        var lista = $('[data-nav-lista]', nav);
        var indicador = lista && $('.nav-indicador', lista);
        if (lista && indicador) {
            var escritorio = window.matchMedia('(min-width: 992px)');
            var mover = function (enlace) {
                if (!escritorio.matches || !enlace) return;
                var base = lista.getBoundingClientRect();
                var caja = enlace.getBoundingClientRect();
                indicador.style.width = caja.width + 'px';
                indicador.style.height = caja.height + 'px';
                indicador.style.transform = 'translate(' + (caja.left - base.left) + 'px,' + (caja.top - base.top) + 'px)';
                indicador.classList.add('visible');
            };
            var volverAlActivo = function () {
                var activo = $('.nav-link.activo', lista);
                if (activo) mover(activo);
                else indicador.classList.remove('visible');
            };
            lista.addEventListener('mouseover', function (e) {
                var enlace = e.target.closest('.nav-link, .btn-nav');
                if (enlace && lista.contains(enlace) && enlace.classList.contains('nav-link')) mover(enlace);
            });
            lista.addEventListener('focusin', function (e) {
                var enlace = e.target.closest('.nav-link');
                if (enlace) mover(enlace);
            });
            lista.addEventListener('mouseleave', volverAlActivo);
            lista.addEventListener('focusout', volverAlActivo);
            window.addEventListener('resize', volverAlActivo);
            if (document.fonts && document.fonts.ready) document.fonts.ready.then(volverAlActivo);
            volverAlActivo();
        }

        var numero = $('[data-carrito-numero]');
        var boton = $('.carrito-btn');
        if (numero && boton && !reducir) setTimeout(function () { boton.classList.add('rebote'); }, 500);
    }

    /* ---------- Fondo vivo: hojas que caen, paralaje y pausa ---------- */
    function iniciarJardin() {
        var jardin = $('[data-jardin]');
        if (!jardin) return;

        var caida = $('[data-hojas]', jardin);
        if (caida && !reducir) {
            var total = window.innerWidth < 768 ? 7 : 16;
            var hojas = ['#74c69d', '#52b788', '#95d5b2', '#40916c', '#b7e4c7'];
            var petalos = ['#ffb3c6', '#ffd6e0', '#f4b942', '#ffffff', '#e5738f'];
            for (var i = 0; i < total; i += 1) {
                var esPetalo = i % 4 === 3;
                var paleta = esPetalo ? petalos : hojas;
                var elemento = document.createElement('span');
                var tamano = esPetalo ? 9 + Math.random() * 9 : 12 + Math.random() * 16;
                elemento.className = 'hoja-cae' + (esPetalo ? ' petalo' : '');
                elemento.style.setProperty('--x', (Math.random() * 100).toFixed(1) + '%');
                elemento.style.setProperty('--s', tamano.toFixed(1) + 'px');
                elemento.style.setProperty('--dur', (16 + Math.random() * 16).toFixed(1) + 's');
                elemento.style.setProperty('--delay', (-Math.random() * 30).toFixed(1) + 's');
                elemento.style.setProperty('--giro', (2.4 + Math.random() * 3).toFixed(1) + 's');
                elemento.style.setProperty('--deriva', Math.round(-60 + Math.random() * 180) + 'px');
                elemento.style.setProperty('--c', paleta[Math.floor(Math.random() * paleta.length)]);
                elemento.appendChild(document.createElement('i'));
                caida.appendChild(elemento);
            }
        }

        if (!reducir) {
            var mx = 0;
            var my = 0;
            var sy = 0;
            var pendiente = false;
            var collages = $$('[data-collage]');
            var pintar = function () {
                pendiente = false;
                jardin.style.setProperty('--mx', mx.toFixed(3));
                jardin.style.setProperty('--my', my.toFixed(3));
                jardin.style.setProperty('--sy', String(Math.round(sy)));
                collages.forEach(function (collage) {
                    collage.style.setProperty('--cx', mx.toFixed(3));
                    collage.style.setProperty('--cy', my.toFixed(3));
                });
            };
            var pedir = function () {
                if (!pendiente) { pendiente = true; window.requestAnimationFrame(pintar); }
            };
            if (puntero) {
                window.addEventListener('mousemove', function (e) {
                    mx = (e.clientX / window.innerWidth) * 2 - 1;
                    my = (e.clientY / window.innerHeight) * 2 - 1;
                    pedir();
                }, { passive: true });
            }
            window.addEventListener('scroll', function () {
                sy = Math.min(window.scrollY, 1400);
                pedir();
            }, { passive: true });
            sy = Math.min(window.scrollY, 1400);
            pedir();
        }

        document.addEventListener('visibilitychange', function () {
            jardin.classList.toggle('pausado', document.hidden);
        });
    }

    /* ---------- Aparición al hacer scroll ---------- */
    function iniciarRevelado() {
        var elementos = $$('.reveal');
        if (!elementos.length) return;
        if (reducir || !('IntersectionObserver' in window)) {
            elementos.forEach(function (el) { el.classList.add('visible'); });
            return;
        }
        var observador = new IntersectionObserver(function (entradas) {
            entradas.forEach(function (entrada) {
                if (entrada.isIntersecting) {
                    entrada.target.classList.add('visible');
                    observador.unobserve(entrada.target);
                }
            });
        }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
        elementos.forEach(function (el) { observador.observe(el); });
        // Respaldo: si por algún motivo no se disparó, se muestran igual.
        setTimeout(function () {
            elementos.forEach(function (el) {
                var caja = el.getBoundingClientRect();
                if (caja.top < window.innerHeight && caja.bottom > 0) el.classList.add('visible');
            });
        }, 1800);
    }

    /* ---------- Onda al pulsar botones ---------- */
    function iniciarBotones() {
        if (reducir) return;
        document.addEventListener('pointerdown', function (e) {
            var boton = e.target.closest('.btn, .tp-btn, .chip-filtro');
            if (!boton || boton.disabled) return;
            var caja = boton.getBoundingClientRect();
            var diametro = Math.max(caja.width, caja.height);
            var onda = document.createElement('span');
            onda.className = 'ripple';
            onda.style.width = onda.style.height = diametro + 'px';
            onda.style.left = (e.clientX - caja.left - diametro / 2) + 'px';
            onda.style.top = (e.clientY - caja.top - diametro / 2) + 'px';
            boton.appendChild(onda);
            onda.addEventListener('animationend', function () { onda.remove(); });
        });
    }

    /* ---------- Selector de cantidad ---------- */
    function iniciarSelectores() {
        document.addEventListener('click', function (e) {
            var paso = e.target.closest('[data-paso]');
            if (!paso) return;
            var contenedor = paso.closest('[data-stepper]');
            var campo = contenedor && $('input', contenedor);
            if (!campo) return;
            var minimo = campo.min !== '' ? Number(campo.min) : 1;
            var maximo = campo.max !== '' ? Number(campo.max) : Infinity;
            var valor = (Number(campo.value) || minimo) + Number(paso.getAttribute('data-paso'));
            campo.value = Math.max(minimo, Math.min(maximo, valor));
            campo.classList.remove('pop');
            void campo.offsetWidth;
            campo.classList.add('pop');
            campo.dispatchEvent(new Event('input', { bubbles: true }));
        });
        $$('[data-actualizar-carrito]').forEach(function (formulario) {
            var boton = $('[data-actualizar]', formulario);
            formulario.addEventListener('input', function (e) {
                if (boton && e.target.matches('input[type="number"]')) boton.classList.add('pendiente');
            });
        });
    }

    /* ---------- Inclinación 3D de las tarjetas ---------- */
    function iniciarTarjetas() {
        if (!puntero || reducir) return;
        $$('[data-tilt]').forEach(function (tarjeta) {
            var cuadro = null;
            tarjeta.addEventListener('mousemove', function (e) {
                if (cuadro) return;
                cuadro = window.requestAnimationFrame(function () {
                    cuadro = null;
                    var caja = tarjeta.getBoundingClientRect();
                    var x = (e.clientX - caja.left) / caja.width - 0.5;
                    var y = (e.clientY - caja.top) / caja.height - 0.5;
                    tarjeta.style.setProperty('--ry', (x * 8).toFixed(2) + 'deg');
                    tarjeta.style.setProperty('--rx', (-y * 7).toFixed(2) + 'deg');
                });
            });
            tarjeta.addEventListener('mouseleave', function () {
                tarjeta.style.setProperty('--rx', '0deg');
                tarjeta.style.setProperty('--ry', '0deg');
            });
        });
    }

    /* ---------- Contadores animados ---------- */
    function iniciarContadores() {
        var contadores = $$('[data-contar]');
        if (!contadores.length) return;
        var animar = function (el) {
            var meta = Number(el.getAttribute('data-contar')) || 0;
            var sufijo = el.getAttribute('data-sufijo') || '';
            if (reducir) { el.textContent = meta + sufijo; return; }
            var inicio = null;
            var duracion = 1200;
            var paso = function (t) {
                if (inicio === null) inicio = t;
                var avance = Math.min((t - inicio) / duracion, 1);
                var suave = 1 - Math.pow(1 - avance, 3);
                el.textContent = Math.round(meta * suave) + sufijo;
                if (avance < 1) window.requestAnimationFrame(paso);
            };
            window.requestAnimationFrame(paso);
        };
        if (!('IntersectionObserver' in window)) { contadores.forEach(animar); return; }
        var observador = new IntersectionObserver(function (entradas) {
            entradas.forEach(function (entrada) {
                if (entrada.isIntersecting) { animar(entrada.target); observador.unobserve(entrada.target); }
            });
        }, { threshold: 0.4 });
        contadores.forEach(function (el) { observador.observe(el); });
    }

    /* ---------- La planta vuela al carrito ---------- */
    function iniciarAgregarAlCarrito() {
        document.addEventListener('submit', function (e) {
            var formulario = e.target;
            if (!formulario.matches || !formulario.matches('form[data-agregar]')) return;
            if (reducir || formulario.dataset.enviando || !formulario.animate) return;

            var origen = null;
            var tarjeta = formulario.closest('.tarjeta-planta');
            if (tarjeta) origen = $('.tp-img', tarjeta);
            if (!origen) origen = $('.detalle-galeria img');
            var carrito = $('.carrito-btn i');
            var cajaCarrito = carrito && carrito.getBoundingClientRect();
            if (!cajaCarrito || !cajaCarrito.width) {
                var burger = $('.burger');
                cajaCarrito = burger && burger.getBoundingClientRect();
            }
            if (!origen || !cajaCarrito || !cajaCarrito.width) return;

            e.preventDefault();
            formulario.dataset.enviando = '1';
            var enviar = function () { formulario.submit(); };
            var caja = origen.getBoundingClientRect();
            var lado = Math.min(110, caja.width * 0.6);
            var clon = document.createElement('img');
            clon.className = 'vuela-al-carrito';
            clon.src = origen.currentSrc || origen.src;
            clon.alt = '';
            clon.style.width = lado + 'px';
            clon.style.height = lado + 'px';
            clon.style.left = (caja.left + caja.width / 2 - lado / 2) + 'px';
            clon.style.top = (caja.top + caja.height / 2 - lado / 2) + 'px';
            document.body.appendChild(clon);

            var dx = cajaCarrito.left + cajaCarrito.width / 2 - (caja.left + caja.width / 2);
            var dy = cajaCarrito.top + cajaCarrito.height / 2 - (caja.top + caja.height / 2);
            var vuelo = clon.animate([
                { transform: 'translate(0, 0) scale(1) rotate(0deg)', opacity: 1 },
                { transform: 'translate(' + dx * 0.55 + 'px, ' + (dy * 0.55 - 70) + 'px) scale(0.7) rotate(120deg)', opacity: 1, offset: 0.55 },
                { transform: 'translate(' + dx + 'px, ' + dy + 'px) scale(0.12) rotate(300deg)', opacity: 0.35 }
            ], { duration: 720, easing: 'cubic-bezier(0.5, 0, 0.75, 0.4)', fill: 'forwards' });
            var terminado = false;
            var terminar = function () {
                if (terminado) return;
                terminado = true;
                clon.remove();
                var boton = $('.carrito-btn');
                if (boton) { boton.classList.remove('rebote'); void boton.offsetWidth; boton.classList.add('rebote'); }
                setTimeout(enviar, 260);
            };
            vuelo.onfinish = terminar;
            setTimeout(terminar, 1100);
        });
    }

    /* ---------- Zoom en la foto del detalle ---------- */
    function iniciarGaleria() {
        $$('.detalle-galeria').forEach(function (galeria) {
            galeria.addEventListener('mousemove', function (e) {
                var caja = galeria.getBoundingClientRect();
                galeria.style.setProperty('--zx', ((e.clientX - caja.left) / caja.width * 100).toFixed(1) + '%');
                galeria.style.setProperty('--zy', ((e.clientY - caja.top) / caja.height * 100).toFixed(1) + '%');
            });
        });
    }

    /* ---------- Formularios ---------- */
    function iniciarFormularios() {
        // Validación de campos obligatorios en formularios que la piden.
        $$('form[onsubmit]').forEach(function (form) {
            form.addEventListener('submit', function (e) {
                var valido = true;
                $$('[required]', form).forEach(function (campo) {
                    if (!campo.value.trim()) { campo.classList.add('is-invalid'); valido = false; }
                    else campo.classList.remove('is-invalid');
                });
                if (!valido) e.preventDefault();
            });
        });
        // Mostrar u ocultar contraseña.
        $$('[data-ver-clave]').forEach(function (boton) {
            boton.addEventListener('click', function () {
                var campo = $('input', boton.closest('.campo'));
                if (!campo) return;
                var visible = campo.type === 'text';
                campo.type = visible ? 'password' : 'text';
                var icono = $('i', boton);
                if (icono) icono.className = 'bi ' + (visible ? 'bi-eye' : 'bi-eye-slash');
            });
        });
        // Estado de carga al enviar (sin deshabilitar, para no perder el nombre del botón).
        document.addEventListener('submit', function (e) {
            var form = e.target;
            if (e.defaultPrevented || !form.matches || form.matches('[data-agregar]')) return;
            var boton = $('button[type="submit"].btn-ecoflora, button[type="submit"].btn-tierra', form);
            if (boton) setTimeout(function () { boton.classList.add('cargando'); }, 0);
        });
        window.addEventListener('pageshow', function () {
            $$('.btn.cargando').forEach(function (b) { b.classList.remove('cargando'); });
            $$('form[data-agregar]').forEach(function (f) { delete f.dataset.enviando; });
            document.body.classList.remove('saliendo');
        });
    }

    /* ---------- Alertas ---------- */
    function iniciarAlertas() {
        $$('.alert').forEach(function (alerta) {
            setTimeout(function () {
                if (window.bootstrap && window.bootstrap.Alert) {
                    var instancia = window.bootstrap.Alert.getOrCreateInstance(alerta);
                    if (instancia) instancia.close();
                }
            }, 6500);
        });
    }

    /* ---------- Transición suave entre páginas ---------- */
    function iniciarTransicion() {
        if (reducir) return;
        document.addEventListener('click', function (e) {
            if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            var enlace = e.target.closest('a[href]');
            if (!enlace || enlace.target === '_blank' || enlace.hasAttribute('download') || enlace.hasAttribute('data-bs-toggle')) return;
            var url;
            try { url = new URL(enlace.href, window.location.href); } catch (error) { return; }
            if (url.origin !== window.location.origin) return;
            if (url.pathname === window.location.pathname && url.search === window.location.search) return;
            e.preventDefault();
            document.body.classList.add('saliendo');
            setTimeout(function () { window.location.href = url.href; }, 170);
        });
    }

    /* ---------- Volver arriba ---------- */
    function iniciarSubir() {
        $$('[data-subir]').forEach(function (boton) {
            boton.addEventListener('click', function (e) {
                e.preventDefault();
                window.scrollTo({ top: 0, behavior: reducir ? 'auto' : 'smooth' });
            });
        });
    }

    alListo(function () {
        [
            iniciarNavegacion,
            iniciarJardin,
            iniciarRevelado,
            iniciarBotones,
            iniciarSelectores,
            iniciarTarjetas,
            iniciarContadores,
            iniciarAgregarAlCarrito,
            iniciarGaleria,
            iniciarFormularios,
            iniciarAlertas,
            iniciarTransicion,
            iniciarSubir
        ].forEach(seguro);
    });
})();
