const QR = require('qrcode');
const fs = require('fs');
const A = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
let s = 7;
const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const str = (n) => Array.from({ length: n }, () => A[Math.floor(rnd() * A.length)]).join('');
const mat = (text) => {
  const q = QR.create(text, { errorCorrectionLevel: 'L' });
  const n = q.modules.size;
  return { n, bits: Array.from(q.modules.data).join('') };
};
const frames = Array.from({ length: 24 }, (_, i) => mat('QR1:' + i + ':' + str(300)));
const key = mat('QRK:K7QF:' + str(60));
fs.writeFileSync('qr.js', 'window.QRDATA=' + JSON.stringify({ frames, key }) + ';');
console.log(frames[0].n, key.n);
