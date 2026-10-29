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

    /* ---------- Menús desplegables propios ----------
       Sustituyen al <select> nativo (cuya lista dibuja el sistema operativo y no se puede estilar).
       El <select> original sigue en la página, oculto: así el formulario, la validación y los eventos
       "change" funcionan igual. Cualquier <select> nuevo se convierte solo; para dejar uno nativo,
       añade el atributo data-nativo.
       Opciones: data-icono (clase de Bootstrap Icons), data-tono (verde, ambar, azul, indigo, rojo,
       tierra) y data-detalle (texto pequeño debajo del nombre). */
    function iniciarDesplegables() {
        var panel = null;       // un solo panel compartido por todos los menús
        var abierto = null;     // menú abierto en este momento
        var contador = 0;
        var instancias = [];
        var busqueda = '';
        var temporizador = null;
        var pendiente = false;

        function textoDe(opcion) {
            return (opcion.textContent || '').replace(/\s+/g, ' ').trim();
        }

        function obtenerPanel() {
            if (panel) return panel;
            panel = document.createElement('div');
            panel.id = 'selector-panel';
            panel.className = 'selector-panel';
            panel.setAttribute('role', 'listbox');
            panel.tabIndex = -1;
            document.body.appendChild(panel);
            // El foco se queda en el botón para que el teclado siga funcionando.
            panel.addEventListener('mousedown', function (e) { e.preventDefault(); });
            panel.addEventListener('click', function (e) {
                var opcion = e.target.closest('.selector-opcion');
                if (!opcion || !abierto || opcion.getAttribute('aria-disabled') === 'true') return;
                elegir(Number(opcion.getAttribute('data-n')));
            });
            panel.addEventListener('mousemove', function (e) {
                var opcion = e.target.closest('.selector-opcion');
                if (!opcion || !abierto || opcion.getAttribute('aria-disabled') === 'true') return;
                var n = Number(opcion.getAttribute('data-n'));
                if (n !== abierto.activo) resaltar(n, false);
            });
            return panel;
        }

        function pintarIcono(caja, opcion) {
            var icono = opcion && opcion.getAttribute('data-icono');
            caja.hidden = !icono;
            if (!icono) return;
            caja.firstChild.className = 'bi ' + icono;
            var tono = opcion.getAttribute('data-tono');
            if (tono) caja.setAttribute('data-tono', tono);
            else caja.removeAttribute('data-tono');
        }

        function sincronizar(inst, animar) {
            var select = inst.select;
            var opcion = select.options[select.selectedIndex];
            var texto = opcion ? textoDe(opcion) : '';
            inst.valor.textContent = texto;
            pintarIcono(inst.icono, opcion);
            inst.boton.classList.toggle('selector-vacio', !opcion || opcion.value === '');
            inst.boton.disabled = select.disabled;
            if (inst.nombre) inst.boton.setAttribute('aria-label', inst.nombre + ': ' + texto);
            if (animar && !reducir) {
                inst.valor.classList.remove('cambio');
                void inst.valor.offsetWidth;
                inst.valor.classList.add('cambio');
            }
        }

        function llenar(inst) {
            var lista = obtenerPanel();
            lista.textContent = '';
            inst.items = [];
            var agregar = function (opcion) {
                if (opcion.hidden) return;
                var n = inst.items.length;
                var fila = document.createElement('div');
                fila.className = 'selector-opcion' + (opcion.disabled ? ' deshabilitada' : '');
                fila.id = 'selector-op-' + n;
                fila.setAttribute('role', 'option');
                fila.setAttribute('data-n', String(n));
                fila.setAttribute('aria-selected', opcion.selected ? 'true' : 'false');
                if (opcion.disabled) fila.setAttribute('aria-disabled', 'true');
                fila.style.setProperty('--i', String(n));

                if (opcion.getAttribute('data-icono')) {
                    var caja = document.createElement('span');
                    caja.className = 'selector-icono';
                    caja.setAttribute('aria-hidden', 'true');
                    caja.appendChild(document.createElement('i'));
                    pintarIcono(caja, opcion);
                    fila.appendChild(caja);
                }

                var bloque = document.createElement('span');
                bloque.className = 'selector-texto';
                var nombre = document.createElement('span');
                nombre.className = 'selector-nombre';
                nombre.textContent = textoDe(opcion);
                bloque.appendChild(nombre);
                var detalle = opcion.getAttribute('data-detalle');
                if (detalle) {
                    var pequeno = document.createElement('small');
                    pequeno.className = 'selector-detalle';
                    pequeno.textContent = detalle;
                    bloque.appendChild(pequeno);
                }
                fila.appendChild(bloque);

                var marca = document.createElement('i');
                marca.className = 'bi bi-check2 selector-check';
                marca.setAttribute('aria-hidden', 'true');
                fila.appendChild(marca);

                lista.appendChild(fila);
                inst.items.push({ opcion: opcion, el: fila });
            };
            Array.prototype.forEach.call(inst.select.children, function (hijo) {
                if (hijo.tagName === 'OPTGROUP') {
                    var titulo = document.createElement('div');
                    titulo.className = 'selector-grupo';
                    titulo.setAttribute('role', 'presentation');
                    titulo.textContent = hijo.label;
                    lista.appendChild(titulo);
                    Array.prototype.forEach.call(hijo.children, function (opcion) { agregar(opcion); });
                } else if (hijo.tagName === 'OPTION') {
                    agregar(hijo);
                }
            });
        }

        function colocar() {
            if (!abierto || !panel) return;
            var caja = abierto.boton.getBoundingClientRect();
            if (caja.bottom < 0 || caja.top > window.innerHeight) { cerrar(false); return; }
            var margen = 8;
            var hueco = 6;
            var tope = 300;
            panel.style.minWidth = Math.max(caja.width, 168) + 'px';
            panel.style.maxHeight = tope + 'px';
            var natural = panel.offsetHeight;
            var abajo = window.innerHeight - caja.bottom - hueco - margen;
            var arriba = caja.top - hueco - margen;
            // Si abajo no cabe y arriba hay más sitio, el menú se abre hacia arriba.
            var haciaArriba = natural > abajo && arriba > abajo;
            var espacio = Math.max(120, Math.min(tope, haciaArriba ? arriba : abajo));
            panel.style.maxHeight = espacio + 'px';
            var alto = Math.min(natural, espacio);
            var ancho = panel.offsetWidth;
            var izquierda = Math.max(margen, Math.min(caja.left, window.innerWidth - ancho - margen));
            panel.style.left = izquierda + 'px';
            panel.style.top = (haciaArriba ? caja.top - hueco - alto : caja.bottom + hueco) + 'px';
            panel.setAttribute('data-lado', haciaArriba ? 'arriba' : 'abajo');
        }

        function resaltar(n, desplazar) {
            if (!abierto) return;
            var anterior = abierto.items[abierto.activo];
            if (anterior) anterior.el.classList.remove('activa');
            abierto.activo = n;
            var item = abierto.items[n];
            if (!item) { abierto.boton.removeAttribute('aria-activedescendant'); return; }
            item.el.classList.add('activa');
            abierto.boton.setAttribute('aria-activedescendant', item.el.id);
            if (desplazar) {
                var arriba = item.el.offsetTop;
                var abajo = arriba + item.el.offsetHeight;
                if (arriba < panel.scrollTop + 4) panel.scrollTop = Math.max(0, arriba - 6);
                else if (abajo > panel.scrollTop + panel.clientHeight - 4) panel.scrollTop = abajo - panel.clientHeight + 6;
            }
        }

        function mover(paso, desde) {
            if (!abierto) return;
            var n = desde === undefined ? abierto.activo : desde;
            for (n += paso; n >= 0 && n < abierto.items.length; n += paso) {
                if (!abierto.items[n].opcion.disabled) { resaltar(n, true); return; }
            }
        }

        function buscar(letra) {
            if (!abierto) return;
            busqueda += letra.toLowerCase();
            clearTimeout(temporizador);
            temporizador = setTimeout(function () { busqueda = ''; }, 700);
            var total = abierto.items.length;
            var inicio = busqueda.length === 1 ? abierto.activo + 1 : Math.max(abierto.activo, 0);
            for (var k = 0; k < total; k += 1) {
                var n = (inicio + k) % total;
                var item = abierto.items[n];
                if (!item.opcion.disabled && textoDe(item.opcion).toLowerCase().indexOf(busqueda) === 0) {
                    resaltar(n, true);
                    return;
                }
            }
        }

        function abrir(inst) {
            if (inst.select.disabled) return;
            if (abierto && abierto !== inst) cerrar(false);
            if (abierto === inst) return;
            llenar(inst);
            var lista = obtenerPanel();
            lista.classList.remove('abierto');
            abierto = inst;
            inst.activo = -1;
            inst.envoltura.classList.add('abierto');
            inst.boton.setAttribute('aria-expanded', 'true');
            inst.boton.setAttribute('aria-controls', 'selector-panel');
            try { inst.boton.focus({ preventScroll: true }); } catch (error) { inst.boton.focus(); }
            colocar();
            if (!abierto) return;
            void lista.offsetWidth;
            lista.classList.add('abierto');
            var elegida = -1;
            var primera = -1;
            inst.items.forEach(function (item, n) {
                if (item.opcion.selected && elegida < 0) elegida = n;
                if (!item.opcion.disabled && primera < 0) primera = n;
            });
            resaltar(elegida >= 0 ? elegida : primera, true);
        }

        function cerrar(devolverFoco) {
            if (!abierto) return;
            var inst = abierto;
            abierto = null;
            busqueda = '';
            if (panel) panel.classList.remove('abierto');
            inst.envoltura.classList.remove('abierto');
            inst.boton.setAttribute('aria-expanded', 'false');
            inst.boton.removeAttribute('aria-activedescendant');
            if (devolverFoco) inst.boton.focus();
        }

        function elegir(n) {
            var inst = abierto;
            if (!inst) return;
            var item = inst.items[n];
            if (!item || item.opcion.disabled) return;
            var cambio = inst.select.selectedIndex !== item.opcion.index;
            inst.select.selectedIndex = item.opcion.index;
            sincronizar(inst, cambio);
            cerrar(true);
            if (cambio) {
                inst.select.dispatchEvent(new Event('input', { bubbles: true }));
                inst.select.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }

        function crear(select) {
            if (select.multiple || select.size > 1 || select.hasAttribute('data-nativo') || select.hasAttribute('data-listo')) return;
            select.setAttribute('data-listo', '1');
            contador += 1;
            var id = 'selector-' + contador;

            var envoltura = document.createElement('div');
            envoltura.className = 'selector-eco' + (select.classList.contains('form-select-sm') ? ' selector-sm' : '');
            if (select.style.width) { envoltura.style.width = select.style.width; select.style.width = ''; }

            var etiqueta = null;
            if (select.id) {
                $$('label').forEach(function (candidata) { if (candidata.htmlFor === select.id) etiqueta = candidata; });
            }

            var boton = document.createElement('button');
            boton.type = 'button';
            boton.id = id;
            boton.className = 'selector-boton';
            boton.setAttribute('role', 'combobox');
            boton.setAttribute('aria-haspopup', 'listbox');
            boton.setAttribute('aria-expanded', 'false');

            var icono = document.createElement('span');
            icono.className = 'selector-icono';
            icono.hidden = true;
            icono.setAttribute('aria-hidden', 'true');
            icono.appendChild(document.createElement('i'));
            var valor = document.createElement('span');
            valor.className = 'selector-valor';
            valor.id = id + '-valor';
            var flecha = document.createElement('i');
            flecha.className = 'bi bi-chevron-down selector-flecha';
            flecha.setAttribute('aria-hidden', 'true');
            boton.appendChild(icono);
            boton.appendChild(valor);
            boton.appendChild(flecha);

            var nombre = '';
            if (etiqueta) {
                if (!etiqueta.id) etiqueta.id = id + '-etiqueta';
                boton.setAttribute('aria-labelledby', etiqueta.id + ' ' + valor.id);
            } else {
                nombre = select.getAttribute('aria-label') || select.getAttribute('name') || '';
            }

            select.parentNode.insertBefore(envoltura, select);
            envoltura.appendChild(boton);
            envoltura.appendChild(select);
            select.classList.remove('form-select', 'form-select-sm');
            select.classList.add('selector-nativo');
            select.tabIndex = -1;
            select.setAttribute('aria-hidden', 'true');

            var inst = { select: select, envoltura: envoltura, boton: boton, valor: valor, icono: icono, nombre: nombre, items: [], activo: -1 };

            boton.addEventListener('click', function () {
                if (abierto === inst) cerrar(true);
                else abrir(inst);
            });
            boton.addEventListener('keydown', function (e) {
                if (e.ctrlKey || e.metaKey || e.altKey) return;
                var tecla = e.key;
                if (abierto !== inst) {
                    if (tecla === 'ArrowDown' || tecla === 'ArrowUp' || tecla === 'Enter' || tecla === ' ') {
                        e.preventDefault();
                        abrir(inst);
                    } else if (tecla.length === 1) {
                        abrir(inst);
                        buscar(tecla);
                    }
                    return;
                }
                switch (tecla) {
                    case 'ArrowDown': e.preventDefault(); mover(1); break;
                    case 'ArrowUp': e.preventDefault(); mover(-1); break;
                    case 'Home': e.preventDefault(); mover(1, -1); break;
                    case 'End': e.preventDefault(); mover(-1, inst.items.length); break;
                    case 'Enter':
                    case ' ': e.preventDefault(); elegir(inst.activo); break;
                    case 'Escape': e.preventDefault(); cerrar(true); break;
                    case 'Tab': cerrar(false); break;
                    default: if (tecla.length === 1) { e.preventDefault(); buscar(tecla); }
                }
            });
            // Evita que la barra espaciadora vuelva a abrir el menú justo después de elegir.
            boton.addEventListener('keyup', function (e) { if (e.key === ' ') e.preventDefault(); });
            // Pulsar la etiqueta (label) lleva el foco al botón.
            select.addEventListener('focus', function () { boton.focus(); });
            select.addEventListener('change', function () { sincronizar(inst, false); });
            if (select.form) {
                select.form.addEventListener('reset', function () { setTimeout(function () { sincronizar(inst, false); }, 0); });
            }

            sincronizar(inst, false);
            instancias.push(inst);
        }

        function barrer(raiz) {
            if (!raiz || raiz.nodeType !== 1) return;
            if (raiz.tagName === 'SELECT') crear(raiz);
            else $$('select', raiz).forEach(crear);
        }

        document.addEventListener('pointerdown', function (e) {
            if (!abierto) return;
            if ((panel && panel.contains(e.target)) || abierto.envoltura.contains(e.target)) return;
            cerrar(false);
        }, true);

        var reposicionar = function (e) {
            if (!abierto || pendiente) return;
            if (e && e.type === 'scroll' && panel && panel.contains(e.target)) return;
            pendiente = true;
            window.requestAnimationFrame(function () { pendiente = false; colocar(); });
        };
        window.addEventListener('scroll', reposicionar, true);
        window.addEventListener('resize', reposicionar);
        window.addEventListener('pageshow', function () {
            instancias.forEach(function (inst) { sincronizar(inst, false); });
        });

        barrer(document.body);
        // Si más adelante se agrega un <select> a la página, también se convierte.
        if ('MutationObserver' in window) {
            new MutationObserver(function (cambios) {
                cambios.forEach(function (cambio) { Array.prototype.forEach.call(cambio.addedNodes, barrer); });
            }).observe(document.body, { childList: true, subtree: true });
        }
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
            iniciarDesplegables,
            iniciarAlertas,
            iniciarTransicion,
            iniciarSubir
        ].forEach(seguro);
    });
})();
