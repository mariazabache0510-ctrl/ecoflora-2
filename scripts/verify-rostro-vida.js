// Pruebas de la prueba de vida (parpadeo y giro) y de la calidad de la captura, con puntos
// de cara INVENTADOS (sin cámara). Comprueba la lógica, no la cámara real.
//
// Uso: node scripts/verify-rostro-vida.js
const Vida = require('../public/js/rostro-vida.js');

function assert(condition, message) {
  if (!condition) {
    console.error('FALLO:', message);
    process.exit(1);
  }
  console.log('ok', message);
}

// Construye los 68 puntos. apertura = alto/ancho del ojo (abierto ~0.30, cerrado ~0.08).
// giro = posición de la nariz entre las esquinas exteriores de los ojos, puntos 36 y 45
// (0.5 de frente; >0.5 hacia TU izquierda). Las esquinas quedan en x=130 y x=250.
function cara({ apertura = 0.3, giro = 0.5 } = {}) {
  const p = Array.from({ length: 68 }, () => ({ x: 0, y: 0 }));
  p[0] = { x: 100, y: 200 };
  p[16] = { x: 300, y: 200 };
  p[30] = { x: 130 + giro * 120, y: 220 };
  const ojo = (desde, x0) => {
    const ancho = 40;
    const medio = (apertura * ancho) / 2;
    p[desde] = { x: x0, y: 150 };
    p[desde + 1] = { x: x0 + ancho * 0.3, y: 150 - medio };
    p[desde + 2] = { x: x0 + ancho * 0.7, y: 150 - medio };
    p[desde + 3] = { x: x0 + ancho, y: 150 };
    p[desde + 4] = { x: x0 + ancho * 0.7, y: 150 + medio };
    p[desde + 5] = { x: x0 + ancho * 0.3, y: 150 + medio };
  };
  ojo(36, 130);
  ojo(42, 210);
  return p;
}

function correr(reto, cuadros) {
  let ultimo = { completado: false };
  let completoEn = -1;
  cuadros.forEach((cuadro, i) => {
    ultimo = reto.procesar(cuadro);
    if (ultimo.completado && completoEn < 0) completoEn = i;
  });
  return { ultimo, completoEn };
}

const repetir = (cuadro, veces) => Array.from({ length: veces }, () => cuadro);

// ---------- Medidas básicas ----------
assert(Math.abs(Vida.ojos(cara({ apertura: 0.3 })) - 0.3) < 0.01, 'la apertura del ojo se mide bien (0.30)');
assert(Vida.ojos(cara({ apertura: 0.08 })) < 0.1, 'un ojo cerrado mide cerca de 0');
assert(Math.abs(Vida.giro(cara()) - 0.5) < 1e-9, 'de frente la nariz queda en el centro (0.5)');
assert(Vida.giro(cara({ giro: 0.75 })) > 0.5, 'girar hacia la izquierda sube el valor');
assert(Math.abs(Vida.giro(cara({ giro: 0.65 })) - 0.65) < 1e-9, 'el giro se mide entre las esquinas de los ojos');

// ---------- Parpadeo ----------
const parpadeo = () => Vida.crearReto('parpadear');
let r = correr(parpadeo(), [...repetir(cara(), 8), ...repetir(cara({ apertura: 0.08 }), 3), ...repetir(cara(), 3)]);
assert(r.ultimo.completado, 'un parpadeo real (abierto, cerrado, abierto) completa el reto');

r = correr(parpadeo(), repetir(cara(), 120));
assert(!r.ultimo.completado, 'una foto fija (ojos siempre abiertos) NO completa el reto');

r = correr(parpadeo(), repetir(cara({ apertura: 0.08 }), 120));
assert(!r.ultimo.completado, 'ojos siempre cerrados (o tapados) NO completa el reto');

r = correr(parpadeo(), [...repetir(cara(), 8), ...repetir(cara({ apertura: 0.25 }), 10), ...repetir(cara(), 5)]);
assert(!r.ultimo.completado, 'un pequeño cambio de apertura (no es parpadeo) NO completa el reto');

r = correr(parpadeo(), [...repetir(cara(), 8), ...repetir(cara({ apertura: 0.08 }), 30)]);
assert(!r.ultimo.completado, 'cerrar los ojos y no volver a abrirlos NO completa el reto');

r = correr(parpadeo(), [...repetir(cara(), 8), cara({ apertura: 0.08 }), cara({ apertura: 0.2 }), cara({ apertura: 0.3 })]);
assert(r.ultimo.completado, 'un parpadeo rápido (1 cuadro cerrado) también se detecta');

// ---------- Giro ----------
const izquierda = () => Vida.crearReto('girar_izquierda');
const derecha = () => Vida.crearReto('girar_derecha');

r = correr(izquierda(), [...repetir(cara(), 4), ...repetir(cara({ giro: 0.75 }), 4), ...repetir(cara(), 4)]);
assert(r.ultimo.completado, 'girar a la izquierda completa el reto');

r = correr(derecha(), [...repetir(cara(), 4), ...repetir(cara({ giro: 0.25 }), 4), ...repetir(cara(), 4)]);
assert(r.ultimo.completado, 'girar a la derecha completa el reto');

r = correr(izquierda(), [...repetir(cara(), 4), ...repetir(cara({ giro: 0.66 }), 3)]);
assert(r.ultimo.completado, 'un giro moderado (la nariz se mueve 0.16 desde donde empezó) alcanza, sin volver al centro');

r = correr(izquierda(), [...repetir(cara(), 4), ...repetir(cara({ giro: 0.25 }), 6), ...repetir(cara(), 6)]);
assert(!r.ultimo.completado, 'girar hacia el lado contrario NO completa el reto');

r = correr(izquierda(), repetir(cara(), 120));
assert(!r.ultimo.completado, 'una foto fija NO completa el reto de giro');

r = correr(izquierda(), [...repetir(cara(), 4), ...repetir(cara({ giro: 0.6 }), 30)]);
assert(!r.ultimo.completado, 'un movimiento muy pequeño de la cabeza (0.10) NO completa el reto');

r = correr(izquierda(), [...repetir(cara({ giro: 0.75 }), 30), ...repetir(cara({ giro: 0.75 }), 6)]);
assert(!r.ultimo.completado, 'empezar ya girado y quedarse así NO completa el reto');

r = correr(izquierda(), [...repetir(cara(), 4), cara({ giro: 0.75 }), ...repetir(cara(), 6)]);
assert(!r.ultimo.completado, 'un giro de un solo cuadro (ruido) NO completa el reto');

// Cada cara es un poco asimétrica: la nariz puede quedar en 0.58 "de frente" y el reto debe seguir funcionando.
r = correr(izquierda(), [...repetir(cara({ giro: 0.58 }), 4), ...repetir(cara({ giro: 0.78 }), 3)]);
assert(r.ultimo.completado, 'una cara con la nariz algo descentrada (0.58) también puede completar el giro');
r = correr(izquierda(), repetir(cara({ giro: 0.58 }), 120));
assert(!r.ultimo.completado, 'y quedarse quieta con esa misma cara NO lo completa');

// El progreso sube de forma continua mientras se gira (el anillo se va llenando).
{
  const reto = izquierda();
  repetir(cara(), 4).forEach((c) => reto.procesar(c));
  const p1 = reto.procesar(cara({ giro: 0.57 })).progreso;
  const p2 = reto.procesar(cara({ giro: 0.62 })).progreso;
  assert(p1 > 0 && p2 > p1 && p2 < 1, 'el progreso del giro sube poco a poco (0 < ' + p1.toFixed(2) + ' < ' + p2.toFixed(2) + ' < 1)');
}

// ---------- De frente (para tomar la captura) ----------
assert(Vida.deFrente(cara({ giro: 0.52 }), 0.5), 'una cara a 0.02 de su posición inicial está de frente');
assert(!Vida.deFrente(cara({ giro: 0.7 }), 0.5), 'una cara girada (0.20 de su posición inicial) NO está de frente');
assert(Vida.deFrente(cara({ giro: 0.7 }), 0.5, 2), 'con tolerancia doble se acepta un giro de 0.20');
assert(Vida.deFrente(cara({ giro: 0.6 }), 0.58), 'se mide contra donde empezó la persona (0.58), no contra 0.5 fijo');
assert(Vida.deFrente(cara({ giro: 0.62 })), 'sin posición inicial conocida se usa un margen amplio alrededor de 0.5');

// ---------- Calidad de la captura ----------
const video = { ancho: 640, alto: 480 };
const buena = { caja: { x: 220, y: 120, width: 200, height: 240 }, puntaje: 0.95 };
const evaluar = (cambios) => Vida.evaluarCalidad({ caras: [buena], ...video, luz: 140, ...cambios });

assert(evaluar({}).ok, 'una cara centrada, de buen tamaño y con luz es válida');
assert(Vida.evaluarCalidad({ caras: [], ...video, luz: 140 }).codigo === 'sin_rostro', 'sin cara: sin_rostro');
assert(evaluar({ caras: [buena, buena] }).codigo === 'varias_caras', 'dos caras: varias_caras');
assert(evaluar({ luz: 20 }).codigo === 'poca_luz', 'luz baja: poca_luz');
assert(evaluar({ luz: 250 }).codigo === 'mucha_luz', 'luz exagerada: mucha_luz');
assert(evaluar({ caras: [{ ...buena, caja: { x: 290, y: 200, width: 60, height: 70 } }] }).codigo === 'lejos', 'cara pequeña: lejos');
assert(evaluar({ caras: [{ ...buena, caja: { x: 40, y: 20, width: 440, height: 440 } }] }).codigo === 'cerca', 'cara enorme: cerca');
assert(evaluar({ caras: [{ ...buena, caja: { x: 0, y: 120, width: 200, height: 240 } }] }).codigo === 'descentrado', 'cara en el borde: descentrado');
assert(evaluar({ caras: [{ ...buena, puntaje: 0.3 }] }).codigo === 'sin_rostro', 'detección poco confiable: sin_rostro');
assert(Vida.evaluarCalidad({ caras: [buena], ...video }).ok, 'si no se pudo medir la luz no se bloquea');

// Con tolerancia (si tarda en salir una buena captura) se aceptan márgenes más amplios.
const lejana = { ...buena, caja: { x: 255, y: 165, width: 110, height: 130 } };
assert(evaluar({ caras: [lejana] }).codigo === 'lejos', 'una cara algo lejana (0.23) se rechaza con el criterio normal');
assert(evaluar({ caras: [lejana], tolerancia: 2 }).ok, 'pero con tolerancia doble se acepta');
assert(evaluar({ luz: 30, tolerancia: 2 }).ok, 'con tolerancia doble también se acepta una luz algo baja (30)');
assert(evaluar({ luz: 10, tolerancia: 2 }).codigo === 'poca_luz', 'aun con tolerancia, la oscuridad total se rechaza');
assert(evaluar({ caras: [buena, buena], tolerancia: 2 }).codigo === 'varias_caras', 'con tolerancia siguen rechazándose dos caras');

console.log('\nTodo bien: la prueba de vida y la calidad se comportan como se espera.');
