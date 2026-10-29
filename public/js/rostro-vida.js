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
        puntajeMinimo: 0.5,     // confianza mínima del detector de caras
        cierreOjo: 0.72,        // el ojo cuenta como cerrado si baja a esta fracción de su apertura normal
        aperturaOjo: 0.85,      // y como abierto de nuevo cuando vuelve a esta fracción
        giro: 0.15,             // cuánto debe moverse la nariz (fracción de la distancia entre las esquinas de los ojos) desde donde empezó
        frente: 0.10            // cuánto puede alejarse la nariz de su posición "de frente" para tomar la captura
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

    // Hacia dónde mira la cabeza: posición de la nariz (punto 30) entre las esquinas exteriores de los
    // ojos (puntos 36 y 45). Aprox. 0.5 = de frente. Con la cámara frontal (sin espejo) valores MAYORES
    // son un giro hacia TU izquierda y MENORES hacia tu derecha. Las esquinas de los ojos se detectan
    // mucho mejor que el contorno de la mandíbula, que se deforma al girar.
    function giro(p) {
        var ancho = p[45].x - p[36].x;
        if (ancho <= 0) return 0.5;
        return (p[30].x - p[36].x) / ancho;
    }

    function mediana(valores) {
        var ordenados = valores.slice().sort(function (a, b) { return a - b; });
        return ordenados[Math.floor(ordenados.length / 2)];
    }

    // Valor "alto" (percentil 80): la apertura normal de los ojos sin que un guiño la arrastre hacia abajo.
    function alto(valores) {
        var ordenados = valores.slice().sort(function (a, b) { return b - a; });
        return ordenados[Math.floor(ordenados.length * 0.2)];
    }

    // ¿La cara mira de frente? neutro es donde estaba la nariz al empezar (cada rostro tiene su simetría);
    // si no se conoce, se usa 0.5 con un margen más amplio. tolerancia >= 1 relaja el margen.
    function deFrente(p, neutro, tolerancia) {
        var conocido = typeof neutro === 'number';
        var margen = (conocido ? AJUSTES.frente : 0.2) * Math.max(1, tolerancia || 1);
        return Math.abs(giro(p) - (conocido ? neutro : 0.5)) <= margen;
    }

    // ¿Se puede usar este cuadro para reconocer? Devuelve { ok, codigo }.
    // caras: [{ caja: {x, y, width, height}, puntaje }]; ancho y alto del video; luz: brillo medio de la cara.
    // tolerancia (1 a 2): 1 es el criterio normal y 2 acepta el doble de margen (se usa si tarda en salir una buena).
    function evaluarCalidad(entrada) {
        var t = Math.max(1, entrada.tolerancia || 1);
        var caras = entrada.caras || [];
        if (!caras.length) return { ok: false, codigo: 'sin_rostro' };
        if (caras.length > 1) return { ok: false, codigo: 'varias_caras' };
        if (typeof entrada.luz === 'number') {
            if (entrada.luz < AJUSTES.luzMinima / t) return { ok: false, codigo: 'poca_luz' };
            if (entrada.luz > Math.min(250, AJUSTES.luzMaxima + (t - 1) * 15)) return { ok: false, codigo: 'mucha_luz' };
        }
        var cara = caras[0];
        if (cara.puntaje < AJUSTES.puntajeMinimo) return { ok: false, codigo: 'sin_rostro' };
        // El círculo muestra el cuadrado central del video (el video se recorta con object-fit: cover).
        var lado = Math.min(entrada.ancho, entrada.alto);
        var cx = entrada.ancho / 2;
        var cy = entrada.alto / 2;
        var relativo = cara.caja.width / lado;
        if (relativo < AJUSTES.tamanoMinimo / t) return { ok: false, codigo: 'lejos' };
        if (relativo > Math.min(0.98, AJUSTES.tamanoMaximo + (t - 1) * 0.1)) return { ok: false, codigo: 'cerca' };
        var dx = (cara.caja.x + cara.caja.width / 2 - cx) / lado;
        var dy = (cara.caja.y + cara.caja.height / 2 - cy) / lado;
        if (Math.sqrt(dx * dx + dy * dy) > AJUSTES.descentrado * t) return { ok: false, codigo: 'descentrado' };
        return { ok: true, codigo: 'ok' };
    }

    // Un reto es una pequeña máquina de estados: se le dan los puntos de cada cuadro y avisa cuándo se cumplió.
    //   accion: 'parpadear' | 'girar_izquierda' | 'girar_derecha'
    // Cada respuesta trae un progreso de 0 a 1 que sube de forma continua mientras la persona hace el gesto.
    function crearReto(accion) {
        var fase = 'inicio';
        var abiertos = [];   // aperturas recientes de los ojos (solo cuando están abiertos)
        var posiciones = []; // posición de la nariz de los primeros cuadros
        var neutro = 0.5;
        var seguidos = 0;

        function parpadeo(p) {
            var valor = ojos(p);
            if (valor > 0.15) {
                abiertos.push(valor);
                if (abiertos.length > 40) abiertos.shift();
            }
            if (fase === 'inicio') {
                // Primero se mide cómo se ven los ojos abiertos de esta persona.
                if (abiertos.length >= 6) fase = 'espera_cierre';
                return { fase: fase, progreso: 0, completado: false };
            }
            var apertura = alto(abiertos);
            if (fase === 'espera_cierre') {
                if (valor < apertura * AJUSTES.cierreOjo) fase = 'cerrado';
                return { fase: fase, progreso: fase === 'cerrado' ? 0.6 : 0.25, completado: false };
            }
            if (fase === 'cerrado' && valor > apertura * AJUSTES.aperturaOjo) fase = 'listo';
            return { fase: fase, progreso: fase === 'listo' ? 1 : 0.6, completado: fase === 'listo' };
        }

        function girar(p) {
            var g = giro(p);
            if (fase === 'inicio') {
                // La posición de partida es la de los primeros cuadros: así cada cara (más o menos simétrica) cuenta igual.
                posiciones.push(g);
                if (posiciones.length >= 4) { neutro = mediana(posiciones); fase = 'esperando_giro'; }
                return { fase: fase, progreso: 0, completado: false };
            }
            // Cuánto se ha movido la nariz hacia el lado pedido desde donde empezó.
            var avance = accion === 'girar_izquierda' ? g - neutro : neutro - g;
            seguidos = avance >= AJUSTES.giro ? seguidos + 1 : 0;
            if (seguidos >= 2) fase = 'listo';
            var progreso = Math.max(0, Math.min(1, avance / AJUSTES.giro));
            return { fase: fase, progreso: fase === 'listo' ? 1 : Math.min(progreso, 0.95), completado: fase === 'listo' };
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
        mediana: mediana,
        deFrente: deFrente,
        evaluarCalidad: evaluarCalidad,
        crearReto: crearReto
    };
}));
