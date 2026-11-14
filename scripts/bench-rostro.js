// Mide cuánto tarda cada paso del reconocimiento facial en ESTE equipo y ESTE navegador.
// Sirve para saber si el inicio con rostro es lento por el equipo (GPU/procesador) o por el código.
//
// Uso:
//   node scripts/bench-rostro.js                 -> imprime una dirección; ábrela en el navegador que quieras medir
//   node scripts/bench-rostro.js --abrir-chrome  -> abre Chrome por ti (macOS)
// Parámetros de la dirección (los pone el script): ?f16=1 usa texturas de media precisión en la GPU.
// No necesita cámara ni base de datos: usa una foto de ejemplo que trae la librería (no se guarda nada).

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');

const carpeta = path.dirname(require.resolve('@vladmandic/face-api/package.json'));
const muestra = path.join(carpeta, 'demo', 'sample1.jpg');
const trabajo = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-rostro-'));
const foto = path.join(trabajo, 'cara.jpg');
// Recorte cuadrado de una persona de la foto de ejemplo (como lo vería una cámara).
execFileSync('sips', ['-c', '560', '560', '--cropOffset', '48', '1295', muestra, '--out', foto], { stdio: 'ignore' });

const PUERTO = Number(process.env.PUERTO || 3100);

const PAGINA = `<!doctype html><meta charset="utf-8"><title>bench rostro</title>
<body style="font:14px system-ui;padding:20px"><h3>Midiendo el reconocimiento facial…</h3><pre id="salida">preparando…</pre>
<script src="/face-api.js"></script>
<script>
(async function () {
  var f = window.faceapi, salida = document.getElementById('salida'), params = new URLSearchParams(location.search);
  var res = { navegador: navigator.userAgent, nucleos: navigator.hardwareConcurrency, memoria: navigator.deviceMemory, pruebas: [] };
  function log(t) { salida.textContent += '\\n' + t; }
  function gpu() {
    try {
      var c = document.createElement('canvas'), gl = c.getContext('webgl2') || c.getContext('webgl');
      var e = gl.getExtension('WEBGL_debug_renderer_info');
      return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'sin dato';
    } catch (x) { return 'sin WebGL'; }
  }
  res.gpu = gpu();
  async function medir(nombre, fn, n) {
    for (var i = 0; i < 3; i++) await fn();
    var t = [];
    for (var j = 0; j < n; j++) { var t0 = performance.now(); await fn(); t.push(performance.now() - t0); }
    t.sort(function (a, b) { return a - b; });
    var r = { nombre: nombre, mediana: Math.round(t[t.length >> 1]), mejor: Math.round(t[0]), peor: Math.round(t[t.length - 1]) };
    res.pruebas.push(r); log(nombre + ': ' + r.mediana + ' ms (mejor ' + r.mejor + ', peor ' + r.peor + ')');
    return r;
  }
  async function elegir(backend) {
    if (params.get('f16') === '1') f.tf.env().set('WEBGL_FORCE_F16_TEXTURES', true);
    if (backend === 'wasm') f.tf.setWasmPaths('/wasm/');
    await f.tf.setBackend(backend); await f.tf.ready();
    res.motor = f.tf.getBackend(); log('motor: ' + res.motor + ' · gpu: ' + res.gpu + (params.get('f16') === '1' ? ' · f16' : ''));
  }
  var img = new Image(); img.src = '/cara.jpg'; await img.decode();
  var cuadro = document.createElement('canvas'); cuadro.width = 640; cuadro.height = 480;
  var cx = cuadro.getContext('2d'); cx.fillStyle = '#777'; cx.fillRect(0, 0, 640, 480); cx.drawImage(img, 80, 0, 480, 480);
  try {
    var backend = params.get('motor') || 'webgl';
    await elegir(backend);
    var t0 = performance.now();
    await Promise.all([f.nets.tinyFaceDetector.loadFromUri('/model'), f.nets.faceLandmark68Net.loadFromUri('/model'),
      f.nets.faceLandmark68TinyNet.loadFromUri('/model'), f.nets.faceRecognitionNet.loadFromUri('/model')]);
    res.cargaModelos = Math.round(performance.now() - t0); log('modelos cargados: ' + res.cargaModelos + ' ms');
    var n = backend === 'cpu' ? 4 : 15;
    var minimo = params.get('minimo') === '1'; // en WebGL cada tamaño nuevo compila programas nuevos: con "minimo" solo se mide lo que usa el sitio
    var op = function (tam) { return new f.TinyFaceDetectorOptions({ inputSize: tam, scoreThreshold: 0.5 }); };
    // Primera pasada (compila los programas de la GPU): es lo que se nota al encender la cámara por primera vez.
    var p0 = performance.now(); await f.detectAllFaces(cuadro, op(224)).withFaceLandmarks();
    res.primerCuadro = Math.round(performance.now() - p0); log('primer cuadro (con compilación): ' + res.primerCuadro + ' ms');
    if (!minimo) {
      await medir('detector 224', function () { return f.detectAllFaces(cuadro, op(224)); }, n);
      await medir('detector 160', function () { return f.detectAllFaces(cuadro, op(160)); }, n);
      await medir('detector 128', function () { return f.detectAllFaces(cuadro, op(128)); }, n);
    }
    await medir('CUADRO ACTUAL: detector 224 + 68 puntos', function () { return f.detectAllFaces(cuadro, op(224)).withFaceLandmarks(); }, n);
    if (!minimo) {
      await medir('detector 160 + 68 puntos', function () { return f.detectAllFaces(cuadro, op(160)).withFaceLandmarks(); }, n);
      await medir('detector 224 + puntos ligeros', function () { return f.detectAllFaces(cuadro, op(224)).withFaceLandmarks(true); }, n);
      await medir('detector 160 + puntos ligeros', function () { return f.detectAllFaces(cuadro, op(160)).withFaceLandmarks(true); }, n);
    }
    var cara = (await f.detectAllFaces(cuadro, op(224)).withFaceLandmarks())[0];
    var zona = cara.landmarks.align(null, { useDlibAlignment: true });
    await medir('DESCRIPTOR (red de reconocimiento)', async function () {
      var rec = await f.extractFaces(cuadro, [zona]); return f.nets.faceRecognitionNet.computeFaceDescriptor(rec[0]);
    }, n);
    // Un ciclo completo real: lo que tarda el tramo de la captura (cuadro + descriptor).
    await medir('cuadro + descriptor', async function () {
      var c = (await f.detectAllFaces(cuadro, op(224)).withFaceLandmarks())[0];
      var z = c.landmarks.align(null, { useDlibAlignment: true });
      var rec = await f.extractFaces(cuadro, [z]); return f.nets.faceRecognitionNet.computeFaceDescriptor(rec[0]);
    }, n);
    res.fin = true;
  } catch (e) { res.error = String(e && e.message || e); log('ERROR ' + res.error); }
  await fetch('/resultado', { method: 'POST', body: JSON.stringify(res) });
  document.querySelector('h3').textContent = 'Listo: ya puedes cerrar esta pestaña.';
})();
</script>`;

const servidor = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(PAGINA); }
  if (url.pathname === '/face-api.js') return res.setHeader('Content-Type', 'text/javascript'), res.end(fs.readFileSync(path.join(carpeta, 'dist', 'face-api.js')));
  if (url.pathname === '/cara.jpg') return res.setHeader('Content-Type', 'image/jpeg'), res.end(fs.readFileSync(foto));
  if (url.pathname.startsWith('/wasm/')) {
    const ruta = path.join(path.dirname(require.resolve('@tensorflow/tfjs-backend-wasm/package.json')), 'dist', path.basename(url.pathname));
    if (!fs.existsSync(ruta)) { res.statusCode = 404; return res.end(); }
    res.setHeader('Content-Type', 'application/wasm');
    return res.end(fs.readFileSync(ruta));
  }
  if (url.pathname.startsWith('/model/')) {
    const archivo = path.basename(url.pathname);
    const ruta = path.join(carpeta, 'model', archivo);
    if (!fs.existsSync(ruta)) { res.statusCode = 404; return res.end(); }
    return res.end(fs.readFileSync(ruta));
  }
  if (url.pathname === '/resultado' && req.method === 'POST') {
    let cuerpo = '';
    req.on('data', (parte) => { cuerpo += parte; });
    req.on('end', () => {
      res.end('ok');
      const datos = JSON.parse(cuerpo);
      fs.writeFileSync(path.join(trabajo, 'resultado.json'), JSON.stringify(datos, null, 2));
      console.log('\nRESULTADO ' + JSON.stringify(datos, null, 1));
      console.log('\n(guardado en ' + path.join(trabajo, 'resultado.json') + ')');
    });
    return null;
  }
  res.statusCode = 404;
  return res.end();
});

servidor.listen(PUERTO, '127.0.0.1', () => {
  const base = `http://127.0.0.1:${PUERTO}/`;
  console.log('Abre en el navegador que quieras medir:\n  ' + base + '   (WebGL: usa la GPU)\n  ' + base + '?f16=1   (GPU con texturas de media precisión)\n  ' + base + '?motor=wasm   (procesador con WebAssembly)\n  ' + base + '?motor=cpu   (procesador en JavaScript, lento)\n  Agrega &minimo=1 para medir solo lo que usa el sitio.');
  if (process.argv.includes('--abrir-chrome')) {
    spawn('open', ['-na', 'Google Chrome', '--args', '--user-data-dir=' + path.join(trabajo, 'perfil'), '--no-first-run', base], { stdio: 'ignore' }).unref();
  }
});
