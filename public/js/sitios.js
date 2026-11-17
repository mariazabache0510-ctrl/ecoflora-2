/* EcoFlora - Sitios de interés: mapa de Google, formulario y lista.
   Todo lo que viene del servidor se muestra con textContent (nunca como HTML). */
(function () {
    'use strict';

    var raiz = document.querySelector('[data-sitios]');
    if (!raiz) return;

    var nonce = (document.currentScript && document.currentScript.nonce) || '';
    var mapaConfigurado = raiz.getAttribute('data-mapa') === '1';
    var csrf = raiz.getAttribute('data-csrf');
    var esAdmin = raiz.getAttribute('data-admin') === '1';

    var contenedorMapa = raiz.querySelector('[data-sitios-mapa]');
    var avisoMapa = raiz.querySelector('[data-sitios-aviso]');
    var formulario = raiz.querySelector('[data-sitios-form]');
    var errorCaja = raiz.querySelector('[data-sitios-error]');
    var botonGuardar = raiz.querySelector('[data-sitios-guardar]');
    var botonUbicacion = raiz.querySelector('[data-sitios-ubicacion]');
    var estado = raiz.querySelector('[data-sitios-estado]');
    var lista = raiz.querySelector('[data-sitios-lista]');
    var campoNombre = document.getElementById('sitio-nombre');
    var campoDescripcion = document.getElementById('sitio-descripcion');
    var campoCategoria = document.getElementById('sitio-categoria');
    var campoLat = document.getElementById('sitio-lat');
    var campoLng = document.getElementById('sitio-lng');

    var NOMBRES_CATEGORIA = { vivero: 'Vivero', jardin: 'Jardín', parque: 'Parque', tienda: 'Tienda', otro: 'Otro' };
    var CENTRO = { lat: 4.142, lng: -73.6266 }; // Villavicencio

    var mapa = null;
    var marcadorNuevo = null;
    var marcadores = {};
    var ventana = null;
    var sitios = [];
    var saltoId = 0;
    var ICONO_NUEVO = null;
    var puntoSalto = null;

    function iconoNuevo() {
        if (!ICONO_NUEVO) {
            ICONO_NUEVO = {
                url: 'https://maps.google.com/mapfiles/ms/icons/red-dot.png',
                scaledSize: new google.maps.Size(32, 32),
                anchor: new google.maps.Point(16, 32)
            };
        }
        return ICONO_NUEVO;
    }

    // Salto en arco en coordenadas de pantalla (una sola setPosition por frame, sin recrear el icono).
    // La duración y la altura dependen de la distancia: cerca = rápido; lejos = un poco más alto, sin llegar a lento.
    function animarSaltoMarcador(marcador, destino) {
        var origen = marcador.getPosition();
        var destLatLng = destino instanceof google.maps.LatLng
            ? destino
            : new google.maps.LatLng(destino.lat, destino.lng);
        if (!origen) {
            marcador.setPosition(destLatLng);
            marcador.setAnimation(google.maps.Animation.DROP);
            return;
        }
        if (Math.abs(origen.lat() - destLatLng.lat()) < 1e-6 && Math.abs(origen.lng() - destLatLng.lng()) < 1e-6) {
            marcador.setAnimation(google.maps.Animation.BOUNCE);
            setTimeout(function () {
                if (marcador.getAnimation() === google.maps.Animation.BOUNCE) marcador.setAnimation(null);
            }, 420);
            return;
        }

        var id = ++saltoId;
        marcador.setAnimation(null);

        var proy = mapa.getProjection && mapa.getProjection();
        var zoom = mapa.getZoom() || 12;
        var escala = Math.pow(2, zoom);
        var duracion;
        var alturaMax;
        var de;
        var a;

        if (proy) {
            de = proy.fromLatLngToPoint(origen);
            a = proy.fromLatLngToPoint(destLatLng);
            var distPx = Math.hypot((a.x - de.x) * escala, (a.y - de.y) * escala);
            duracion = Math.min(480, Math.max(220, 180 + distPx * 0.35));
            alturaMax = Math.min(64, Math.max(18, distPx * 0.2));
            if (!puntoSalto) puntoSalto = new google.maps.Point(0, 0);
        } else {
            de = null;
            duracion = 320;
            alturaMax = 0;
        }

        var inicio = 0;

        function cuadro(ahora) {
            if (id !== saltoId) return;
            if (!inicio) inicio = ahora;
            var t = Math.min(1, (ahora - inicio) / duracion);
            // Salida rápida y aterrizaje suave (más dinámico que ease-in-out).
            var e = 1 - Math.pow(1 - t, 2.6);
            if (proy && de && a) {
                var hop = Math.sin(Math.PI * t) * alturaMax / escala;
                puntoSalto.x = de.x + (a.x - de.x) * e;
                puntoSalto.y = de.y + (a.y - de.y) * e - hop;
                marcador.setPosition(proy.fromPointToLatLng(puntoSalto));
            } else {
                marcador.setPosition({
                    lat: origen.lat() + (destLatLng.lat() - origen.lat()) * e,
                    lng: origen.lng() + (destLatLng.lng() - origen.lng()) * e
                });
            }
            if (t < 1) {
                requestAnimationFrame(cuadro);
                return;
            }
            marcador.setPosition(destLatLng);
            marcador.setAnimation(google.maps.Animation.BOUNCE);
            setTimeout(function () {
                if (id === saltoId && marcador.getAnimation() === google.maps.Animation.BOUNCE) marcador.setAnimation(null);
            }, 400);
        }
        requestAnimationFrame(cuadro);
    }

    function mostrarError(texto) {
        errorCaja.textContent = texto;
        errorCaja.hidden = !texto;
    }

    function api(metodo, url, cuerpo) {
        var opciones = {
            method: metodo,
            credentials: 'same-origin',
            headers: { Accept: 'application/json', 'X-CSRF-Token': csrf }
        };
        if (cuerpo !== undefined) {
            opciones.headers['Content-Type'] = 'application/json';
            opciones.body = JSON.stringify(cuerpo);
        }
        return fetch(url, opciones).then(function (r) {
            return r.json().catch(function () { return { ok: false, error: 'Respuesta inesperada del servidor.' }; }).then(function (datos) {
                if (r.status === 401) { window.location.href = '/login'; }
                return datos;
            });
        });
    }

    /* ---------- Lista ---------- */

    function fecha(valor) {
        var d = new Date(valor);
        if (isNaN(d.getTime())) return '';
        return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
    }

    function dibujarLista() {
        lista.textContent = '';
        estado.hidden = sitios.length > 0;
        if (!sitios.length) estado.textContent = esAdmin ? 'Todavía no hay sitios guardados.' : 'Aún no guardas ningún sitio. Marca uno en el mapa.';
        sitios.forEach(function (sitio) {
            var item = document.createElement('li');
            item.className = 'sitio-item';
            item.tabIndex = 0;
            item.setAttribute('data-id', sitio.id);

            var cuerpo = document.createElement('div');
            cuerpo.className = 'sitio-cuerpo';
            var titulo = document.createElement('h3');
            titulo.textContent = sitio.nombre;
            var cat = document.createElement('span');
            cat.className = 'sitio-cat';
            cat.textContent = NOMBRES_CATEGORIA[sitio.categoria] || sitio.categoria;
            titulo.appendChild(cat);
            cuerpo.appendChild(titulo);
            if (sitio.descripcion) {
                var p = document.createElement('p');
                p.textContent = sitio.descripcion;
                cuerpo.appendChild(p);
            }
            var pie = document.createElement('small');
            var partes = [sitio.lat.toFixed(5) + ', ' + sitio.lng.toFixed(5), fecha(sitio.creado)];
            if (esAdmin && sitio.autor) partes.push('de ' + sitio.autor);
            pie.textContent = partes.filter(Boolean).join(' · ');
            cuerpo.appendChild(pie);
            item.appendChild(cuerpo);

            if (sitio.propio || esAdmin) {
                var borrar = document.createElement('button');
                borrar.type = 'button';
                borrar.className = 'btn btn-sm btn-outline-danger';
                borrar.setAttribute('aria-label', 'Borrar ' + sitio.nombre);
                borrar.innerHTML = '<i class="bi bi-trash3"></i>';
                borrar.addEventListener('click', function (evento) {
                    evento.stopPropagation();
                    if (!window.confirm('¿Borrar "' + sitio.nombre + '"?')) return;
                    borrar.disabled = true;
                    api('DELETE', '/api/sitios/' + encodeURIComponent(sitio.id)).then(function (datos) {
                        if (datos && datos.ok) { cargar(); return; }
                        borrar.disabled = false;
                        mostrarError((datos && datos.error) || 'No pudimos borrar el sitio.');
                    }).catch(function () { borrar.disabled = false; mostrarError('Sin conexión. Inténtalo de nuevo.'); });
                });
                item.appendChild(borrar);
            }

            function enfocar() { irA(sitio); }
            item.addEventListener('click', enfocar);
            item.addEventListener('keydown', function (e) { if (e.key === 'Enter') enfocar(); });
            lista.appendChild(item);
        });
    }

    function cargar() {
        return api('GET', '/api/sitios').then(function (datos) {
            if (!datos || !datos.ok) {
                estado.hidden = false;
                estado.textContent = (datos && datos.error) || 'No pudimos cargar los sitios.';
                return;
            }
            sitios = datos.sitios || [];
            dibujarLista();
            dibujarMarcadores();
        }).catch(function () {
            estado.hidden = false;
            estado.textContent = 'Sin conexión. Revisa tu internet y recarga la página.';
        });
    }

    /* ---------- Mapa ---------- */

    function numeroDe(campo) {
        var texto = String(campo.value || '').trim().replace(',', '.');
        if (!/^-?\d{1,3}(\.\d+)?$/.test(texto)) return null;
        return Number(texto);
    }

    function ponerCoordenadas(lat, lng) {
        campoLat.value = lat.toFixed(6);
        campoLng.value = lng.toFixed(6);
    }

    function colocarMarcadorNuevo(lat, lng, centrar) {
        if (!mapa) return;
        var posicion = { lat: lat, lng: lng };
        if (!marcadorNuevo) {
            marcadorNuevo = new google.maps.Marker({
                map: mapa,
                position: posicion,
                draggable: true,
                title: 'Nuevo sitio',
                icon: iconoNuevo(),
                animation: google.maps.Animation.DROP,
                optimized: true
            });
            marcadorNuevo.addListener('dragend', function () {
                saltoId += 1;
                marcadorNuevo.setAnimation(null);
                var p = marcadorNuevo.getPosition();
                ponerCoordenadas(p.lat(), p.lng());
            });
            marcadorNuevo.addListener('dragstart', function () {
                saltoId += 1;
                marcadorNuevo.setAnimation(null);
            });
        } else {
            animarSaltoMarcador(marcadorNuevo, posicion);
        }
        if (centrar) mapa.panTo(posicion);
    }

    function irA(sitio) {
        if (!mapa) return;
        mapa.panTo({ lat: sitio.lat, lng: sitio.lng });
        mapa.setZoom(Math.max(mapa.getZoom() || 0, 15));
        var m = marcadores[sitio.id];
        if (m) abrirInfo(sitio, m);
    }

    function abrirInfo(sitio, marcador) {
        if (!ventana) ventana = new google.maps.InfoWindow();
        var caja = document.createElement('div');
        var t = document.createElement('strong');
        t.textContent = sitio.nombre;
        caja.appendChild(t);
        var c = document.createElement('div');
        c.textContent = NOMBRES_CATEGORIA[sitio.categoria] || sitio.categoria;
        caja.appendChild(c);
        if (sitio.descripcion) {
            var d = document.createElement('div');
            d.textContent = sitio.descripcion;
            caja.appendChild(d);
        }
        ventana.setContent(caja);
        ventana.open({ map: mapa, anchor: marcador });
    }

    function dibujarMarcadores() {
        if (!mapa) return;
        Object.keys(marcadores).forEach(function (id) { marcadores[id].setMap(null); });
        marcadores = {};
        var limites = new google.maps.LatLngBounds();
        sitios.forEach(function (sitio) {
            var m = new google.maps.Marker({
                map: mapa,
                position: { lat: sitio.lat, lng: sitio.lng },
                title: sitio.nombre,
                icon: 'https://maps.google.com/mapfiles/ms/icons/' + (sitio.propio ? 'green' : 'blue') + '-dot.png'
            });
            m.addListener('click', function () { abrirInfo(sitio, m); });
            marcadores[sitio.id] = m;
            limites.extend(m.getPosition());
        });
        if (sitios.length === 1) { mapa.setCenter(limites.getCenter()); }
        else if (sitios.length > 1) { mapa.fitBounds(limites, 60); }
    }

    window.iniciarMapaEcoflora = function () {
        if (avisoMapa) avisoMapa.remove();
        mapa = new google.maps.Map(contenedorMapa, {
            center: CENTRO,
            zoom: 12,
            streetViewControl: false,
            mapTypeControl: false,
            clickableIcons: false
        });
        mapa.addListener('click', function (evento) {
            var lat = evento.latLng.lat();
            var lng = evento.latLng.lng();
            ponerCoordenadas(lat, lng);
            colocarMarcadorNuevo(lat, lng, false);
            mostrarError('');
        });
        var lat = numeroDe(campoLat);
        var lng = numeroDe(campoLng);
        if (lat !== null && lng !== null) colocarMarcadorNuevo(lat, lng, true);
        dibujarMarcadores();
    };

    function cargarGoogleMaps(llaveMapa) {
        if (!llaveMapa) return;
        var s = document.createElement('script');
        if (nonce) s.nonce = nonce;
        s.async = true;
        s.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(llaveMapa) + '&callback=iniciarMapaEcoflora&loading=async&v=weekly';
        s.onerror = function () {
            if (avisoMapa) avisoMapa.querySelector('span').textContent = 'No pudimos cargar Google Maps. Puedes guardar un sitio escribiendo sus coordenadas.';
        };
        document.head.appendChild(s);
    }

    // La llave no viene en el HTML: se pide al servidor después de cargar la página (así no aparece en "ver código fuente").
    function pedirLlaveDelMapa() {
        if (!mapaConfigurado) return;
        api('GET', '/api/sitios/mapa').then(function (datos) {
            if (datos && datos.ok && datos.mapsKey) cargarGoogleMaps(datos.mapsKey);
            else if (avisoMapa) avisoMapa.querySelector('span').textContent = 'El mapa todavía no está configurado en este sitio. Aun así puedes guardar un sitio escribiendo sus coordenadas.';
        }).catch(function () {
            if (avisoMapa) avisoMapa.querySelector('span').textContent = 'No pudimos cargar Google Maps. Puedes guardar un sitio escribiendo sus coordenadas.';
        });
    }

    // Si Google rechaza la llave (dominio no permitido, etc.), avisa aquí en vez de dejar un mapa gris.
    window.gm_authFailure = function () {
        mapa = null;
        contenedorMapa.textContent = '';
        var aviso = document.createElement('div');
        aviso.className = 'sitios-mapa-aviso';
        aviso.innerHTML = '<i class="bi bi-exclamation-triangle"></i>';
        var texto = document.createElement('span');
        texto.textContent = 'Google no aceptó la llave del mapa para este dominio. Revisa las restricciones de la llave en Google Cloud. Puedes guardar un sitio escribiendo sus coordenadas.';
        aviso.appendChild(texto);
        contenedorMapa.appendChild(aviso);
    };

    /* ---------- Formulario ---------- */

    function alEscribirCoordenadas() {
        var lat = numeroDe(campoLat);
        var lng = numeroDe(campoLng);
        if (lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) colocarMarcadorNuevo(lat, lng, true);
    }
    campoLat.addEventListener('change', alEscribirCoordenadas);
    campoLng.addEventListener('change', alEscribirCoordenadas);

    if (navigator.geolocation) {
        botonUbicacion.hidden = false;
        botonUbicacion.addEventListener('click', function () {
            navigator.geolocation.getCurrentPosition(function (pos) {
                ponerCoordenadas(pos.coords.latitude, pos.coords.longitude);
                colocarMarcadorNuevo(pos.coords.latitude, pos.coords.longitude, true);
                if (mapa) mapa.setZoom(15);
            }, function () {
                mostrarError('No pudimos obtener tu ubicación. Revisa el permiso del navegador o márcala en el mapa.');
            }, { enableHighAccuracy: false, timeout: 10000 });
        });
    }

    formulario.addEventListener('submit', function (evento) {
        evento.preventDefault();
        mostrarError('');
        var nombre = campoNombre.value.trim();
        var lat = numeroDe(campoLat);
        var lng = numeroDe(campoLng);
        if (nombre.length < 2) { mostrarError('Escribe el nombre del sitio (mínimo 2 letras).'); campoNombre.focus(); return; }
        if (lat === null || lng === null) { mostrarError('Marca el lugar en el mapa o escribe la latitud y la longitud.'); return; }
        botonGuardar.disabled = true;
        api('POST', '/api/sitios', {
            nombre: nombre,
            descripcion: campoDescripcion.value.trim(),
            categoria: campoCategoria.value,
            lat: lat,
            lng: lng
        }).then(function (datos) {
            botonGuardar.disabled = false;
            if (!datos || !datos.ok) { mostrarError((datos && datos.error) || 'No pudimos guardar el sitio.'); return; }
            formulario.reset();
            if (marcadorNuevo) { marcadorNuevo.setMap(null); marcadorNuevo = null; }
            return cargar().then(function () { if (datos.sitio) irA(datos.sitio); });
        }).catch(function () {
            botonGuardar.disabled = false;
            mostrarError('Sin conexión. Inténtalo de nuevo.');
        });
    });

    cargar();
    pedirLlaveDelMapa();
})();
