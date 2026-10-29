/* Prueba de vida y calidad de la captura facial (funciones puras, sin cámara).
   Reciben los 68 puntos de la cara que entrega face-api y devuelven decisiones simples.
   Se pueden probar en Node: scripts/verify-rostro-vida.js */
(function (raiz, fabrica) {
    if (typeof module === 'object' && module.exports) module.exports = fabrica();
    else raiz.RostroVida = fabrica();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // ---- Ajustes (si la prueba se siente muy fácil o muy difícil, cambia estos números) ----
    var AJUSTES = {
        luzMinima: 40,          // brillo medio de la CARA (0 a 255) por debajo del cual hay "poca luz"
        luzMaxima: 235,         // por encima la cara está quemada por exceso de luz
        tamanoMinimo: 0.30,     // ancho de la cara respecto al círculo visible: menos es "muy lejos"
        tamanoMaximo: 0.88,     // más es "muy cerca"
        descentrado: 0.22,      // cuánto puede alejarse el centro de la cara del centro del círculo
        puntajeMinimo: 0.55,    // confianza mínima del detector de caras
        cierreOjo: 0.72,        // el ojo cuenta como cerrado si baja a esta fracción de su apertura normal
        aperturaOjo: 0.88,      // y como abierto de nuevo cuando vuelve a esta fracción
        giro: 0.18,             // cuánto debe desplazarse la nariz (fracción del ancho de la cara) al girar
        centro: 0.07            // tolerancia para considerar la cara "de frente"
    };

    function distancia(a, b) {
        return Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y));
    }

    // Apertura de un ojo (EAR): alto del ojo dividido por su ancho. Baja casi a 0 al parpadear.
    function aperturaOjo(p, desde) {
        var ancho = distancia(p[desde], p[desde + 3]);
        if (!ancho) return 0;
        return (distancia(p[desde + 1], p[desde + 5]) + distancia(p[desde + 2], p[desde + 4])) / (2 * ancho);
    }

    // Promedio de los dos ojos (puntos 36-41 y 42-47 de los 68).
    function ojos(p) {
        return (aperturaOjo(p, 36) + aperturaOjo(p, 42)) / 2;
    }

    // Hacia dónde mira la cabeza: 0.5 = de frente. Con la cámara frontal (sin espejo) valores
    // MAYORES a 0.5 son un giro hacia TU izquierda y menores hacia tu derecha.
    function giro(p) {
        var ancho = p[16].x - p[0].x;
        if (ancho <= 0) return 0.5;
        return (p[30].x - p[0].x) / ancho;
    }

    function mediana(valores) {
        var ordenados = valores.slice().sort(function (a, b) { return a - b; });
        return ordenados[Math.floor(ordenados.length / 2)];
    }

    // ¿Se puede usar este cuadro para reconocer? Devuelve { ok, codigo }.
    // caras: [{ caja: {x, y, width, height}, puntaje }]; ancho y alto del video; luz: brillo medio de la cara.
    function evaluarCalidad(entrada) {
        var caras = entrada.caras || [];
        if (!caras.length) return { ok: false, codigo: 'sin_rostro' };
        if (caras.length > 1) return { ok: false, codigo: 'varias_caras' };
        if (typeof entrada.luz === 'number') {
            if (entrada.luz < AJUSTES.luzMinima) return { ok: false, codigo: 'poca_luz' };
            if (entrada.luz > AJUSTES.luzMaxima) return { ok: false, codigo: 'mucha_luz' };
        }
        var cara = caras[0];
        if (cara.puntaje < AJUSTES.puntajeMinimo) return { ok: false, codigo: 'sin_rostro' };
        // El círculo muestra el cuadrado central del video (el video se recorta con object-fit: cover).
        var lado = Math.min(entrada.ancho, entrada.alto);
        var cx = entrada.ancho / 2;
        var cy = entrada.alto / 2;
        var relativo = cara.caja.width / lado;
        if (relativo < AJUSTES.tamanoMinimo) return { ok: false, codigo: 'lejos' };
        if (relativo > AJUSTES.tamanoMaximo) return { ok: false, codigo: 'cerca' };
        var dx = (cara.caja.x + cara.caja.width / 2 - cx) / lado;
        var dy = (cara.caja.y + cara.caja.height / 2 - cy) / lado;
        if (Math.sqrt(dx * dx + dy * dy) > AJUSTES.descentrado) return { ok: false, codigo: 'descentrado' };
        return { ok: true, codigo: 'ok' };
    }

    // Un reto es una pequeña máquina de estados: se le dan los puntos de cada cuadro y avisa cuándo se cumplió.
    //   accion: 'parpadear' | 'girar_izquierda' | 'girar_derecha'
    function crearReto(accion) {
        var fase = 'inicio';
        var base = [];
        var apertura = 0;
        var seguidos = 0;

        function parpadeo(p) {
            var valor = ojos(p);
            if (fase === 'inicio') {
                // Primero se mide cómo se ven los ojos abiertos de esta persona.
                if (valor > 0.15) base.push(valor);
                if (base.length >= 6) { apertura = mediana(base); fase = 'espera_cierre'; }
                return { fase: fase, progreso: 0, completado: false };
            }
            if (fase === 'espera_cierre') {
                if (valor < apertura * AJUSTES.cierreOjo) fase = 'cerrado';
                return { fase: fase, progreso: 0.25, completado: false };
            }
            if (fase === 'cerrado' && valor > apertura * AJUSTES.aperturaOjo) fase = 'listo';
            return { fase: fase, progreso: fase === 'listo' ? 1 : 0.6, completado: fase === 'listo' };
        }

        function girar(p) {
            var g = giro(p);
            var deFrente = Math.abs(g - 0.5) <= AJUSTES.centro;
            var girado = accion === 'girar_izquierda' ? g >= 0.5 + AJUSTES.giro : g <= 0.5 - AJUSTES.giro;
            if (fase === 'inicio') {
                seguidos = deFrente ? seguidos + 1 : 0;
                if (seguidos >= 3) { fase = 'esperando_giro'; seguidos = 0; }
                return { fase: fase, progreso: 0, completado: false };
            }
            if (fase === 'esperando_giro') {
                seguidos = girado ? seguidos + 1 : 0;
                if (seguidos >= 2) { fase = 'volver'; seguidos = 0; }
                return { fase: fase, progreso: 0.35, completado: false };
            }
            // Volver al centro asegura que el rostro quede de frente para la captura.
            seguidos = deFrente ? seguidos + 1 : 0;
            if (seguidos >= 3) fase = 'listo';
            return { fase: fase, progreso: fase === 'listo' ? 1 : 0.7, completado: fase === 'listo' };
        }

        return {
            accion: accion,
            procesar: function (puntos) {
                return accion === 'parpadear' ? parpadeo(puntos) : girar(puntos);
            }
        };
    }

    return {
        AJUSTES: AJUSTES,
        ojos: ojos,
        giro: giro,
        evaluarCalidad: evaluarCalidad,
        crearReto: crearReto
    };
}));
