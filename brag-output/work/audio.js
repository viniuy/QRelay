// Synthesises the soundtrack: A minor, 116 BPM. Writes music.wav (44.1 kHz stereo).
const fs = require('fs');
const SR = 44100, DUR = 21.5, LEN = Math.ceil(SR * DUR);
const L = new Float32Array(LEN), R = new Float32Array(LEN);
const sendL = new Float32Array(LEN), sendR = new Float32Array(LEN);
const BEAT = 60 / 116, G0 = 3.3;
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
let seed = 3;
const noise = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;

function add(t0, dur, gain, pan, send, fn) {
  const s0 = Math.floor(t0 * SR), n = Math.floor(dur * SR);
  const gl = gain * Math.cos((pan + 1) * Math.PI / 4), gr = gain * Math.sin((pan + 1) * Math.PI / 4);
  for (let i = 0; i < n; i++) {
    const j = s0 + i; if (j < 0 || j >= LEN) continue;
    const v = fn(i / SR);
    L[j] += v * gl; R[j] += v * gr; sendL[j] += v * gl * send; sendR[j] += v * gr * send;
  }
}
const env = (t, a, d) => Math.min(1, t / a) * Math.exp(-t / d);

// pad: additive saw, three detuned voices, slow swell
function pad(t0, dur, notes, gain) {
  notes.forEach((m, k) => {
    [-0.0016, 0, 0.0016].forEach((det, v) => {
      const f = hz(m) * (1 + det);
      add(t0, dur + 0.6, gain, (v - 1) * 0.5, 0.5, (t) => {
        const e = Math.min(1, t / 0.35) * Math.min(1, Math.max(0, (dur + 0.6 - t) / 0.6));
        let s = 0;
        for (let h = 1; h <= 7; h++) s += Math.sin(2 * Math.PI * f * h * t + k + v) / (h * h * 0.7 + 0.3);
        return s * e;
      });
    });
  });
}
function bass(t0, m, gain) {
  const f = hz(m);
  add(t0, 0.32, gain, 0, 0.05, (t) => {
    const e = Math.min(1, t / 0.004) * Math.exp(-t / 0.14);
    return (Math.sin(2 * Math.PI * f * t) + 0.35 * Math.sin(4 * Math.PI * f * t) * Math.exp(-t / 0.05)) * e;
  });
}
function kick(t0, gain) {
  let ph = 0;
  add(t0, 0.4, gain, 0, 0.05, (t) => {
    const f = 45 + 75 * Math.exp(-t / 0.035);
    ph += 2 * Math.PI * f / SR;
    return Math.sin(ph) * Math.min(1, t / 0.002) * Math.exp(-t / 0.13);
  });
}
function hat(t0, gain, pan) {
  let hp = 0, prev = 0;
  add(t0, 0.06, gain, pan, 0.1, (t) => {
    const x = noise(); hp = 0.85 * (hp + x - prev); prev = x;
    return hp * Math.exp(-t / 0.018);
  });
}
function snare(t0, gain) {
  let lp = 0;
  add(t0, 0.25, gain, 0.1, 0.35, (t) => {
    lp += 0.35 * (noise() - lp);
    return (lp * 1.4 + 0.3 * Math.sin(2 * Math.PI * 190 * t)) * Math.min(1, t / 0.002) * Math.exp(-t / 0.07);
  });
}
function bell(t0, m, gain, pan, decay = 0.6) {
  const f = hz(m);
  add(t0, decay * 5, gain, pan, 0.6, (t) => {
    const e = Math.min(1, t / 0.003);
    return e * (Math.sin(2 * Math.PI * f * t) * Math.exp(-t / decay) + 0.25 * Math.sin(2 * Math.PI * f * 2.01 * t) * Math.exp(-t / (decay * 0.4)) + 0.08 * Math.sin(2 * Math.PI * f * 3.98 * t) * Math.exp(-t / (decay * 0.2)));
  });
}
function whoosh(t0, dur, gain) {
  let lp = 0;
  add(t0, dur, gain, 0, 0.4, (t) => {
    const x = t / dur, cut = 0.02 + 0.25 * x;
    lp += cut * (noise() - lp);
    return lp * Math.sin(Math.PI * x) ** 2;
  });
}
function tap(t0, gain) {
  add(t0, 0.05, gain, 0.2, 0.2, (t) => Math.sin(2 * Math.PI * 1760 * t) * Math.exp(-t / 0.008) + 0.3 * noise() * Math.exp(-t / 0.003));
}

// chord grid from the groove start: Am F C G
const CH = [
  { pad: [57, 60, 64], bass: 45, arp: [69, 72, 76, 72] },
  { pad: [53, 57, 60], bass: 41, arp: [65, 69, 72, 69] },
  { pad: [55, 60, 64], bass: 48, arp: [67, 72, 76, 72] },
  { pad: [55, 59, 62], bass: 43, arp: [67, 71, 74, 71] },
];
const BAR = BEAT * 4;

// intro: drone and three thumps under the hook lines
pad(0, 3.2, [45, 52], 0.05);
[0.3, 0.8, 1.3].forEach((t, i) => { kick(t, 0.42); bass(t, [45, 45, 52][i], 0.12); });
whoosh(2.7, 0.7, 0.10);

// groove 3.3 → 18.0
for (let b = 0; G0 + b * BAR < 18.0; b++) {
  const t = G0 + b * BAR, c = CH[b % 4];
  pad(t, Math.min(BAR, 18.0 - t), c.pad, 0.028);
  for (let k = 0; k < 8; k++) {
    const tt = t + k * BEAT / 2; if (tt >= 18.0) break;
    bass(tt, c.bass + (k % 2 ? 12 : 0), k % 2 ? 0.07 : 0.13);
  }
  for (let k = 0; k < 4; k++) {
    const tt = t + k * BEAT; if (tt >= 18.0) break;
    kick(tt, 0.34);
    if (tt >= 10.0 && tt < 15.0 && k % 2 === 1) snare(tt, 0.10);
  }
  for (let k = 0; k < 16; k++) {
    const tt = t + k * BEAT / 4; if (tt >= 18.0 || tt < 6.2) continue;
    const loud = tt >= 10.0 && tt < 15.0;
    hat(tt, (k % 2 ? 0.05 : 0.08) * (loud ? 1.3 : 0.7), k % 2 ? 0.35 : -0.35);
    if (loud && k % 2 === 0) bell(tt, c.arp[(k / 2) % 4], 0.035, (k % 4 ? 0.4 : -0.4), 0.18);
  }
}
whoosh(5.85, 0.5, 0.06);
tap(7.05, 0.10);
whoosh(9.7, 0.55, 0.06);
whoosh(14.8, 0.55, 0.06);
bell(15.4, 81, 0.11, -0.2, 0.7); bell(15.55, 88, 0.09, 0.2, 0.9);

// outro: drums drop, pad holds, the lockup lands on A minor
pad(18.0, 1.9, [53, 57, 60, 64], 0.03);
pad(19.95, 1.55, [45, 57, 60, 64], 0.034);
kick(19.95, 0.38); bass(19.95, 33, 0.16);
bell(19.95, 76, 0.07, -0.3, 0.9); bell(20.1, 81, 0.06, 0.3, 1.1);

// reverb: four feedback combs on the send bus, lowpassed
function verb(src, out, offs) {
  const ds = [1557, 1617, 1491, 1422].map((d) => d + offs);
  const bufs = ds.map((d) => new Float32Array(d)), idx = ds.map(() => 0), lp = ds.map(() => 0);
  for (let i = 0; i < LEN; i++) {
    let s = 0;
    for (let k = 0; k < 4; k++) {
      const y = bufs[k][idx[k]];
      lp[k] += 0.3 * (y - lp[k]);
      bufs[k][idx[k]] = src[i] + lp[k] * 0.8;
      idx[k] = (idx[k] + 1) % ds[k];
      s += y;
    }
    out[i] += s * 0.06;
  }
}
verb(sendL, L, 0); verb(sendR, R, 23);

// master: soft clip, fade out, normalise
let peak = 0;
for (let i = 0; i < LEN; i++) {
  const t = i / SR, f = Math.min(1, (DUR - t) / 0.7, t / 0.02);
  L[i] = Math.tanh(L[i] * 1.2) * f; R[i] = Math.tanh(R[i] * 1.2) * f;
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
}
const g = 0.89 / peak;
const buf = Buffer.alloc(44 + LEN * 4);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + LEN * 4, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24);
buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(LEN * 4, 40);
for (let i = 0; i < LEN; i++) {
  buf.writeInt16LE(Math.round(L[i] * g * 32767), 44 + i * 4);
  buf.writeInt16LE(Math.round(R[i] * g * 32767), 46 + i * 4);
}
fs.writeFileSync('music.wav', buf);
console.log('peak', peak.toFixed(3));
