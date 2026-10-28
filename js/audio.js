// Música y efectos, generados con Web Audio: no hay archivos de sonido.
//
// Efectos: sintetizador mínimo al estilo de sfxr (onda, tono que se desliza y
// envolvente corta). Música: ambiente original por capas; la base suena
// siempre y se añade un instrumento por cada 20 losetas colocadas.

let ac = null;
let master = null;
let musicBus = null;
let sfxBus = null;
let musicOn = true;
let sfxOn = true;
let layers = 0;
let musicTimer = null;
let step = 0;

const MUSIC_VOLUME = 0.22;
const SFX_VOLUME = 0.35;

// Escala pentatónica de Re mayor: no hay combinación que suene mal.
const SCALE = [62, 64, 66, 69, 71, 74, 76, 78, 81, 83];
const CHORDS = [[50, 57, 62, 66], [47, 54, 59, 62], [43, 50, 55, 59], [45, 52, 57, 61]];

// El navegador solo deja arrancar el audio tras un gesto del jugador.
export function startAudio(settings = {}) {
  musicOn = settings.music !== false;
  sfxOn = settings.sfx !== false;
  if (!ac) {
    ac = new (window.AudioContext || window.webkitAudioContext)();
    master = ac.createGain();
    master.connect(ac.destination);
    musicBus = ac.createGain();
    musicBus.gain.value = musicOn ? MUSIC_VOLUME : 0;
    musicBus.connect(master);
    sfxBus = ac.createGain();
    sfxBus.gain.value = SFX_VOLUME;
    sfxBus.connect(master);
  }
  if (ac.state === 'suspended') ac.resume();
  if (!musicTimer) musicTimer = setInterval(musicTick, 500);
}

export function setMusic(on) {
  musicOn = on;
  if (musicBus) musicBus.gain.setTargetAtTime(on ? MUSIC_VOLUME : 0, ac.currentTime, 0.5);
}

export function setSfx(on) {
  sfxOn = on;
}

// Capas de música según losetas colocadas.
export function setMusicLayers(placed) {
  layers = Math.min(3, Math.floor(placed / 20));
}

const midi = n => 440 * Math.pow(2, (n - 69) / 12);

// --- Efectos ------------------------------------------------------------------

// Un sonido: { wave, from, to (Hz), dur (s), vol, attack, delay }
function blip({ wave = 'square', from, to = from, dur = 0.1, vol = 0.5, attack = 0.005, delay = 0 }) {
  if (!ac || !sfxOn) return;
  const t = ac.currentTime + delay;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = wave;
  osc.frequency.setValueAtTime(from, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(vol, t + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(sfxBus);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

export const sfx = {
  rotate: () => blip({ wave: 'triangle', from: 660, to: 760, dur: 0.05, vol: 0.25 }),
  place: () => {
    blip({ wave: 'sine', from: 220, to: 110, dur: 0.14, vol: 0.6 });
    blip({ wave: 'triangle', from: 440, to: 330, dur: 0.06, vol: 0.15 });
  },
  perfect: () => {
    blip({ wave: 'sine', from: midi(81), dur: 0.25, vol: 0.3, delay: 0.05 });
    blip({ wave: 'sine', from: midi(86), dur: 0.35, vol: 0.25, delay: 0.12 });
  },
  // El sonido de dos notas al aparecer un Pokémon (sección Pulido).
  pokemon: () => {
    blip({ wave: 'square', from: midi(76), dur: 0.09, vol: 0.18 });
    blip({ wave: 'square', from: midi(83), dur: 0.16, vol: 0.18, delay: 0.1 });
  },
  mission: () => {
    [74, 78, 81, 86].forEach((n, i) => blip({ wave: 'triangle', from: midi(n), dur: 0.3, vol: 0.22, delay: i * 0.08 }));
  },
  // Arpegio suave cuando surge un paraje.
  paraje: () => {
    [67, 71, 74, 79].forEach((n, i) => blip({ wave: 'sine', from: midi(n), dur: 0.22, vol: 0.14, delay: i * 0.06 }));
  },
  undo: () => blip({ wave: 'triangle', from: 520, to: 300, dur: 0.1, vol: 0.25 }),
};

// --- Música -------------------------------------------------------------------

// Cada medio segundo decide qué suena. Un acorde dura 16 pasos (8 s).
function musicTick() {
  if (!ac || !musicOn || ac.state !== 'running') return;
  const chord = CHORDS[Math.floor(step / 16) % CHORDS.length];
  const t = ac.currentTime + 0.05;

  // Base: pad suave al cambiar de acorde.
  if (step % 16 === 0) for (const n of chord) pad(midi(n), t, 8.5, 0.05);

  // Capa 1: arpegio pulsado lento.
  if (layers >= 1 && step % 2 === 0) {
    const n = chord[(step / 2) % chord.length] + 12;
    pluck(midi(n), t, 0.9, 0.06);
  }
  // Capa 2: campanas sueltas en la escala.
  if (layers >= 2 && step % 4 === 1 && Math.random() < 0.6) {
    pluck(midi(SCALE[Math.floor(Math.random() * SCALE.length)] + 12), t, 1.6, 0.035, 'sine');
  }
  // Capa 3: bajo.
  if (layers >= 3 && step % 8 === 0) pluck(midi(chord[0] - 12), t, 2.5, 0.09, 'sine');

  step++;
}

function pad(freq, t, dur, vol) {
  for (const detune of [-6, 6]) {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    osc.detune.value = detune;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(vol, t + 2);
    gain.gain.linearRampToValueAtTime(vol * 0.8, t + dur - 2);
    gain.gain.linearRampToValueAtTime(0, t + dur);
    osc.connect(gain).connect(musicBus);
    osc.start(t);
    osc.stop(t + dur + 0.1);
  }
}

function pluck(freq, t, dur, vol, wave = 'triangle') {
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = wave;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(vol, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(musicBus);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}
