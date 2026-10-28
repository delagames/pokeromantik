// Parajes: cuando una región de un bioma crece, en ella van surgiendo cosas
// (hierba alta, cuevas, dunas, pueblos, un faro…). Son solo paisaje: no puntúan
// ni atraen Pokémon. Se deducen del tablero, así que deshacer o retomar la
// partida los deja como estaban sin tener que guardar nada.

import { HEX_SIZE, hexToPixel } from './hex.js';

// Tamaño de región a partir del cual surge cada paraje: el primero con 3
// hexágonos, el segundo con 6… Cada bioma tiene su lista, en el mismo orden.
const THRESHOLDS = [3, 6, 10, 15, 21, 28, 36];

const KINDS = {
  pradera: ['hierbaAlta', 'flores', 'hierbaAlta', 'molino', 'flores', 'granja', 'hierbaAlta'],
  bosque: ['arbolGrande', 'setas', 'arbolGrande', 'arbolGigante', 'setas', 'arbolGrande', 'arbolGigante'],
  agua: ['dunas', 'nenufares', 'barca', 'faro', 'dunas', 'nenufares', 'barca'],
  montana: ['picoNevado', 'rocas', 'picoNevado', 'cumbre', 'rocas', 'picoNevado', 'cumbre'],
  cueva: ['cueva', 'cristales', 'cueva', 'gruta', 'cristales', 'cueva', 'gruta'],
  volcan: ['fumarola', 'lava', 'fumarola', 'crater', 'lava', 'fumarola', 'crater'],
  ciudad: ['casas', 'centro', 'casas', 'tienda', 'gimnasio', 'pueblo', 'torre'],
};

const NAMES = {
  hierbaAlta: 'Hierba alta', flores: 'Un prado de flores', molino: 'Un molino', granja: 'Una granja',
  arbolGrande: 'Un árbol centenario', setas: 'Un corro de setas', arbolGigante: 'Un árbol gigante',
  dunas: 'Dunas en la orilla', nenufares: 'Nenúfares', barca: 'Una barca', faro: 'Un faro',
  picoNevado: 'Un pico nevado', rocas: 'Peñascos', cumbre: 'La cumbre',
  cueva: 'Una cueva', cristales: 'Cristales', gruta: 'Una gruta',
  fumarola: 'Una fumarola', lava: 'Un río de lava', crater: 'Un cráter',
  casas: 'Unas casas', centro: 'Un Centro Pokémon', pueblo: 'Un pueblo', tienda: 'Una Tienda Pokémon', gimnasio: 'Un gimnasio', torre: 'Una torre de radio',
};

const POP_TIME = 0.7;    // lo que tarda en brotar
const LABEL_TIME = 2.4;  // lo que se ve su nombre encima
const POP_DELAY = 0.2;   // espera a que caiga la loseta

let list = [];           // { id, kind, x, y, s, seed, born }
let lastRegions = null;
let known = new Set();
let quiet = true;        // la primera vez (partida nueva o retomada) no se anuncian

// Vuelve a empezar: lo que haya en el tablero aparece sin animación.
export function resetParajes() {
  list = [];
  lastRegions = null;
  known = new Set();
  quiet = true;
}

// Recalcula los parajes si el tablero ha cambiado. Devuelve los que acaban de surgir.
export function updateParajes(game, now) {
  if (game.regions === lastRegions) return [];
  lastRegions = game.regions;
  const next = computeParajes(game);
  const fresh = [];
  for (const p of next) {
    const old = list.find(o => o.id === p.id);
    if (old) p.born = old.born;
    else if (quiet || known.has(p.id)) p.born = -Infinity;
    else {
      p.born = now + POP_DELAY;
      fresh.push(p);
    }
    known.add(p.id);
  }
  list = next.sort((a, b) => a.y - b.y);
  quiet = false;
  return fresh;
}

function computeParajes(game) {
  const { board } = game;
  // Las losetas en el orden en que se pusieron: así cada paraje se queda donde
  // surgió aunque la región siga creciendo.
  const order = new Map([...board.tiles.keys()].map((k, i) => [k, i]));
  const firstOf = r => Math.min(...r.nodes.map(n => order.get(n.split('|')[0])));
  const regions = game.regions.list
    .filter(r => KINDS[r.biome] && r.size >= THRESHOLDS[0])
    .sort((a, b) => firstOf(a) - firstOf(b));

  const used = new Set();
  const result = [];
  for (const region of regions) {
    const count = THRESHOLDS.filter(t => region.size >= t).length;
    const nodes = region.nodes
      .map(n => {
        const key = n.split('|')[0];
        const tile = board.tiles.get(key);
        const sides = tile.sides.map((b, i) => (b === region.biome ? i : -1)).filter(i => i >= 0);
        return { key, tile, sides };
      })
      .filter(n => n.sides.length >= 3)
      .sort((a, b) => order.get(a.key) - order.get(b.key));
    let i = 0;
    for (const node of nodes) {
      if (i >= count) break;
      if (used.has(node.key)) continue;
      used.add(node.key);
      const kind = KINDS[region.biome][i++];
      result.push({ id: `${node.key}|${region.biome}|${kind}`, kind, ...placeIn(node), seed: hash(node.key + kind) });
    }
  }
  return result;
}

// Centro del paraje: en mitad de la loseta si es toda del bioma; si no, desplazado
// hacia sus sectores y algo más pequeño.
function placeIn({ tile, sides }) {
  const c = hexToPixel(tile.hex, HEX_SIZE);
  let dx = 0;
  let dy = 0;
  for (const side of sides) {
    dx += Math.cos(-side * Math.PI / 3);
    dy += Math.sin(-side * Math.PI / 3);
  }
  const k = sides.length === 6 ? 0 : (HEX_SIZE * 0.42) / Math.max(1, Math.hypot(dx, dy)) * (1 - sides.length / 6) * 2;
  return {
    x: c.x + dx * k,
    y: c.y + dy * k + 14,
    s: sides.length >= 5 ? 1.5 : sides.length === 4 ? 1.2 : 0.95,
  };
}

// --- Dibujo -------------------------------------------------------------------

// Dibuja los parajes en coordenadas de mundo. `time` en segundos (performance.now).
export function drawParajes(c, time, { animate = true } = {}) {
  for (const p of list) {
    const k = animate ? (time - p.born) / POP_TIME : 1;
    if (k < 0) continue;
    const grow = k >= 1 ? 1 : easeOutBack(k);
    const painter = PAINTERS[p.kind];
    c.save();
    c.translate(p.x, p.y);
    c.scale(p.s * grow, p.s * grow);
    shadow(c, painter.shadow ?? 14);
    painter.draw(c, time + (p.seed % 1000) / 100, seeded(p.seed));
    c.restore();
  }
}

// Luces que se ven de noche (ventanas, faro, lava): van después del tinte
// nocturno para que brillen. `dark` de 0 a 1.
export function drawParajeLights(c, time, dark) {
  if (dark <= 0) return;
  for (const p of list) {
    const painter = PAINTERS[p.kind];
    if (!painter.lights || time < p.born) continue;
    c.save();
    c.translate(p.x, p.y);
    c.scale(p.s, p.s);
    c.globalAlpha = dark;
    painter.lights(c, time + (p.seed % 1000) / 100, seeded(p.seed));
    c.restore();
  }
}

// Nombre flotante de los recién surgidos.
export function drawParajeLabels(c, time, zoom) {
  for (const p of list) {
    const age = time - p.born;
    if (age < 0.15 || age > LABEL_TIME) continue;
    const a = Math.min(1, (age - 0.15) * 4, (LABEL_TIME - age) * 2);
    c.save();
    c.globalAlpha = a;
    c.font = `800 ${15 / Math.max(zoom, 0.6)}px 'Baloo 2', system-ui, sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'bottom';
    const y = p.y - 40 * p.s - age * 6;
    c.lineWidth = 4 / Math.max(zoom, 0.6);
    c.strokeStyle = 'rgba(255,255,255,0.9)';
    c.lineJoin = 'round';
    c.strokeText(NAMES[p.kind], p.x, y);
    c.fillStyle = '#2E3A2A';
    c.fillText(NAMES[p.kind], p.x, y);
    c.restore();
  }
}

function shadow(c, w) {
  c.fillStyle = 'rgba(30,40,20,0.22)';
  c.beginPath();
  c.ellipse(0, 1, w, w * 0.32, 0, 0, Math.PI * 2);
  c.fill();
}

function poly(c, points, fill) {
  c.beginPath();
  points.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
  c.closePath();
  c.fillStyle = fill;
  c.fill();
}

function circle(c, x, y, r, fill) {
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fillStyle = fill;
  c.fill();
}

// Humo que sube desde (x, y) en bocanadas que se desvanecen.
function smoke(c, x, y, t, color = 'rgba(235,235,235,', big = 1) {
  for (let i = 0; i < 4; i++) {
    const k = (t * 0.45 + i / 4) % 1;
    const r = (2.5 + k * 5) * big;
    circle(c, x + Math.sin((t + i) * 1.7) * 2 * k + k * 4, y - k * 22 * big, r, `${color}${0.55 * (1 - k)})`);
  }
}

function house(c, x, y, w, h, roof, body = '#F7F0E2') {
  c.fillStyle = 'rgba(0,0,0,0.12)';
  c.fillRect(x - w / 2 + 2, y - h + 2, w, h);
  c.fillStyle = body;
  c.fillRect(x - w / 2, y - h, w, h);
  poly(c, [[x - w / 2 - 2.5, y - h], [x, y - h - w * 0.55], [x + w / 2 + 2.5, y - h]], roof);
  c.fillStyle = 'rgba(0,0,0,0.15)';
  c.fillRect(x - w / 2, y - h, w, 1.5);
  c.fillStyle = '#8A6448';
  c.fillRect(x - 1.8, y - 5, 3.6, 5);
}

function windows(c, x, y, w, h, lit) {
  c.fillStyle = lit ? '#FFD86B' : '#8FB3D1';
  const wy = y - h + 3;
  c.fillRect(x - w / 2 + 2, wy, 3, 3);
  c.fillRect(x + w / 2 - 5, wy, 3, 3);
}

function glow(c, x, y, r, color) {
  const g = c.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(255,200,90,0)');
  c.fillStyle = g;
  c.fillRect(x - r, y - r, 2 * r, 2 * r);
}

function blade(c, x, y, h, lean, color) {
  c.strokeStyle = color;
  c.beginPath();
  c.moveTo(x, y);
  c.quadraticCurveTo(x + lean * 0.3, y - h * 0.6, x + lean, y - h);
  c.stroke();
}

const PAINTERS = {
  // --- Pradera ---
  hierbaAlta: {
    shadow: 16,
    draw(c, t, rand) {
      c.lineWidth = 2;
      c.lineCap = 'round';
      for (let i = 0; i < 6; i++) {
        const x = -14 + i * 5.6 + (rand() - 0.5) * 3;
        const y = -3 + (i % 2) * 5 + rand() * 2;
        const sway = Math.sin(t * 2.2 + i * 0.8) * 2.2;
        for (let b = -1; b <= 1; b++) {
          blade(c, x + b * 2, y, 11 + rand() * 5, b * 3 + sway, b ? '#4F8F3A' : '#6FB04A');
        }
      }
    },
  },
  flores: {
    shadow: 15,
    draw(c, t, rand) {
      const colors = ['#F6D04D', '#F08AA0', '#FFFFFF', '#B48CF0', '#F4A259'];
      c.lineWidth = 1.5;
      c.lineCap = 'round';
      for (let i = 0; i < 8; i++) {
        const x = (rand() - 0.5) * 30;
        const y = (rand() - 0.5) * 10;
        const h = 6 + rand() * 4;
        const sway = Math.sin(t * 1.8 + i) * 1.2;
        blade(c, x, y, h, sway, '#4F8F3A');
        const color = colors[Math.floor(rand() * colors.length)];
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * Math.PI * 2;
          circle(c, x + sway + Math.cos(a) * 2, y - h + Math.sin(a) * 2, 1.6, color);
        }
        circle(c, x + sway, y - h, 1.2, '#E59B2E');
      }
    },
  },
  molino: {
    shadow: 13,
    draw(c, t) {
      poly(c, [[-8, 0], [8, 0], [5, -28], [-5, -28]], '#EFE3C8');
      poly(c, [[0, 0], [8, 0], [5, -28], [0, -28]], 'rgba(0,0,0,0.08)');
      poly(c, [[-7, -28], [7, -28], [0, -37]], '#B5583E');
      c.fillStyle = '#8A6448';
      c.fillRect(-2.5, -7, 5, 7);
      const a = t * 1.3;
      c.save();
      c.translate(0, -29);
      for (let i = 0; i < 4; i++) {
        c.rotate(Math.PI / 2 + (i === 0 ? a : 0));
        c.fillStyle = '#8A6A4A';
        c.fillRect(-0.8, 0, 1.6, 18);
        c.fillStyle = '#F7F1E3';
        c.fillRect(0.8, 4, 5, 13);
      }
      c.restore();
      circle(c, 0, -29, 2, '#6B4F37');
    },
    lights(c) {
      glow(c, 0, -14, 9, 'rgba(255,214,110,0.8)');
      c.fillStyle = '#FFD86B';
      c.fillRect(-1.5, -17, 3, 3);
    },
  },
  granja: {
    shadow: 18,
    draw(c, t) {
      // Granero rojo, almiar y una valla.
      c.fillStyle = '#B9472F';
      c.fillRect(-14, -14, 18, 14);
      poly(c, [[-16, -14], [-5, -23], [6, -14]], '#7D2E22');
      c.strokeStyle = '#F7F0E2';
      c.lineWidth = 1.5;
      c.strokeRect(-8.5, -8, 7, 8);
      c.beginPath();
      c.moveTo(-8.5, -8); c.lineTo(-1.5, 0);
      c.moveTo(-1.5, -8); c.lineTo(-8.5, 0);
      c.stroke();
      c.beginPath();
      c.ellipse(12, -4, 6, 5, 0, Math.PI, 0);
      c.lineTo(18, 0); c.lineTo(6, 0);
      c.fillStyle = '#E8C45A';
      c.fill();
      c.strokeStyle = '#9A7B52';
      c.lineWidth = 1.2;
      c.beginPath();
      for (let x = -18; x <= 18; x += 6) { c.moveTo(x, 6); c.lineTo(x, 1); }
      c.moveTo(-18, 3); c.lineTo(18, 3);
      c.stroke();
      smoke(c, 3, -20, t, 'rgba(240,240,240,', 0.6);
    },
    lights(c) {
      glow(c, -5, -6, 10, 'rgba(255,214,110,0.7)');
    },
  },

  // --- Bosque ---
  arbolGrande: {
    shadow: 15,
    draw(c, t) {
      c.fillStyle = '#5A3C2B';
      c.fillRect(-3, -12, 6, 12);
      c.save();
      c.translate(0, -12);
      c.rotate(Math.sin(t * 0.9) * 0.025);
      circle(c, -8, -8, 10, '#2F7A45');
      circle(c, 8, -8, 10, '#2F7A45');
      circle(c, 0, -17, 12, '#3A8F53');
      circle(c, -4, -21, 5, 'rgba(255,255,255,0.18)');
      c.restore();
    },
  },
  arbolGigante: {
    shadow: 20,
    draw(c, t) {
      poly(c, [[-6, 0], [6, 0], [4, -20], [-4, -20]], '#5A3C2B');
      poly(c, [[-6, 0], [-11, 2], [-4, -4]], '#5A3C2B');
      poly(c, [[6, 0], [11, 2], [4, -4]], '#5A3C2B');
      c.save();
      c.translate(0, -20);
      c.rotate(Math.sin(t * 0.7) * 0.02);
      circle(c, -13, -6, 12, '#245F3B');
      circle(c, 13, -6, 12, '#245F3B');
      circle(c, -7, -18, 13, '#2F7A45');
      circle(c, 8, -19, 13, '#2F7A45');
      circle(c, 0, -28, 12, '#3A8F53');
      circle(c, -5, -32, 5, 'rgba(255,255,255,0.18)');
      c.restore();
    },
  },
  setas: {
    shadow: 13,
    draw(c, t, rand) {
      c.fillStyle = '#6E4B34';
      c.beginPath();
      c.ellipse(0, -3, 12, 3.5, 0, 0, Math.PI * 2);
      c.fill();
      for (let i = 0; i < 4; i++) {
        const x = -10 + i * 6.5 + (rand() - 0.5) * 2;
        const h = 4 + rand() * 4;
        const bob = Math.sin(t * 1.5 + i) * 0.4;
        c.fillStyle = '#F4EBD8';
        c.fillRect(x - 1.2, -h, 2.4, h);
        c.beginPath();
        c.ellipse(x, -h + bob, 4.2, 3.2, 0, Math.PI, 0);
        c.fillStyle = i % 2 ? '#D9483B' : '#E86A3F';
        c.fill();
        circle(c, x - 1.5, -h - 1.5 + bob, 0.8, '#FFFFFF');
        circle(c, x + 1.5, -h - 1 + bob, 0.7, '#FFFFFF');
      }
    },
  },

  // --- Agua ---
  dunas: {
    shadow: 0,
    draw(c, t, rand) {
      c.beginPath();
      c.ellipse(0, -2, 20, 9, 0, 0, Math.PI * 2);
      c.fillStyle = '#EAD9A6';
      c.fill();
      // Espuma que va y viene por la orilla.
      c.strokeStyle = `rgba(255,255,255,${0.5 + Math.sin(t * 1.4) * 0.25})`;
      c.lineWidth = 1.5;
      c.beginPath();
      c.ellipse(0, -2, 21 + Math.sin(t * 1.4), 10, 0, 0.1 * Math.PI, 0.9 * Math.PI);
      c.stroke();
      for (let i = 0; i < 3; i++) {
        const x = -10 + i * 9;
        const y = -3 + (i % 2) * 3;
        c.beginPath();
        c.moveTo(x - 7, y + 1);
        c.quadraticCurveTo(x - 1, y - 6, x + 6, y + 1);
        c.closePath();
        c.fillStyle = '#F3E6BC';
        c.fill();
        c.strokeStyle = '#CDB57C';
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(x - 1, y - 3.5);
        c.quadraticCurveTo(x + 2, y - 2, x + 6, y + 1);
        c.stroke();
      }
      c.lineWidth = 1.3;
      c.lineCap = 'round';
      blade(c, -14, -4, 5, -1 + Math.sin(t * 2) * 0.8, '#8BAA55');
      blade(c, -13, -4, 6, 1 + Math.sin(t * 2) * 0.8, '#8BAA55');
      blade(c, 12, 2, 5, Math.sin(t * 2 + 1) * 0.8, '#8BAA55');
      circle(c, 4 + rand() * 4, 3, 1.3, '#F2A9A0');
    },
  },
  nenufares: {
    shadow: 0,
    draw(c, t) {
      const pads = [[-9, -2, 6], [5, -5, 5], [8, 4, 4.5], [-3, 6, 4]];
      pads.forEach(([x, y, r], i) => {
        const bob = Math.sin(t * 1.2 + i * 1.3) * 0.8;
        c.beginPath();
        c.moveTo(x, y + bob);
        c.arc(x, y + bob, r, 0.3 + i, Math.PI * 1.8 + i);
        c.closePath();
        c.fillStyle = '#4E9B4A';
        c.fill();
        c.strokeStyle = 'rgba(255,255,255,0.35)';
        c.lineWidth = 1;
        c.beginPath();
        c.arc(x, y + bob, r + 2.5 + Math.sin(t * 1.2 + i) * 0.5, 0, Math.PI * 2);
        c.stroke();
      });
      const bob = Math.sin(t * 1.2) * 0.8;
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        c.beginPath();
        c.ellipse(-9 + Math.cos(a) * 2, -4 + bob + Math.sin(a) * 1.2, 2.2, 1.2, a, 0, Math.PI * 2);
        c.fillStyle = '#F6B6C8';
        c.fill();
      }
      circle(c, -9, -4.5 + bob, 1.3, '#F6D04D');
    },
  },
  barca: {
    shadow: 0,
    draw(c, t) {
      const bob = Math.sin(t * 1.6) * 1.2;
      const tilt = Math.sin(t * 1.6 + 0.6) * 0.06;
      c.strokeStyle = 'rgba(255,255,255,0.55)';
      c.lineWidth = 1.2;
      for (let i = 0; i < 2; i++) {
        const k = (t * 0.4 + i / 2) % 1;
        c.globalAlpha = 1 - k;
        c.beginPath();
        c.ellipse(0, 1, 14 + k * 10, 4 + k * 3, 0, 0, Math.PI * 2);
        c.stroke();
      }
      c.globalAlpha = 1;
      c.save();
      c.translate(0, bob);
      c.rotate(tilt);
      poly(c, [[-13, -4], [13, -4], [9, 2], [-9, 2]], '#8A5A3C');
      c.fillStyle = '#6B4530';
      c.fillRect(-13, -4, 26, 1.8);
      c.fillStyle = '#5A3C2B';
      c.fillRect(-0.8, -24, 1.6, 20);
      poly(c, [[1, -23], [1, -6], [11, -6]], '#F7F1E3');
      poly(c, [[-1, -21], [-1, -7], [-8, -7]], '#E8DCC2');
      c.restore();
    },
  },
  faro: {
    shadow: 12,
    draw(c) {
      c.beginPath();
      c.ellipse(0, -1, 13, 6, 0, 0, Math.PI * 2);
      c.fillStyle = '#8D8F96';
      c.fill();
      poly(c, [[-6, -3], [6, -3], [4, -34], [-4, -34]], '#F7F3EA');
      poly(c, [[-5.4, -11], [5.4, -11], [5, -17], [-5, -17]], '#D2463A');
      poly(c, [[-4.6, -23], [4.6, -23], [4.3, -29], [-4.3, -29]], '#D2463A');
      c.fillStyle = '#3B4152';
      c.fillRect(-5, -36, 10, 2);
      c.fillStyle = '#FFE9A6';
      c.fillRect(-3.5, -41, 7, 5);
      poly(c, [[-5, -41], [5, -41], [0, -46]], '#D2463A');
    },
    lights(c, t) {
      glow(c, 0, -38, 14, 'rgba(255,233,150,0.95)');
      const a = t * 1.4;
      const dir = Math.cos(a);
      c.fillStyle = 'rgba(255,240,170,0.35)';
      c.beginPath();
      c.moveTo(0, -38);
      c.lineTo(dir * 70, -38 - 10 + Math.sin(a) * 6);
      c.lineTo(dir * 70, -38 + 10 + Math.sin(a) * 6);
      c.closePath();
      c.fill();
    },
  },

  // --- Montaña ---
  picoNevado: {
    shadow: 16,
    draw(c) {
      poly(c, [[-17, 0], [0, -30], [17, 0]], '#8C93A0');
      poly(c, [[0, -30], [17, 0], [4, 0]], '#737A88');
      poly(c, [[-6.5, -18.5], [0, -30], [6.5, -18.5], [3, -20.5], [0, -17.5], [-3, -21]], '#FFFFFF');
    },
  },
  rocas: {
    shadow: 15,
    draw(c) {
      const rocks = [[-8, 0, 7, 6], [7, 1, 6, 5], [0, -4, 8, 8]];
      for (const [x, y, w, h] of rocks) {
        c.beginPath();
        c.ellipse(x, y - h / 2, w, h, 0, Math.PI, 0);
        c.lineTo(x + w, y);
        c.lineTo(x - w, y);
        c.fillStyle = '#868C98';
        c.fill();
        c.beginPath();
        c.ellipse(x - w * 0.3, y - h * 0.9, w * 0.35, h * 0.25, -0.3, 0, Math.PI * 2);
        c.fillStyle = 'rgba(255,255,255,0.35)';
        c.fill();
      }
    },
  },
  cumbre: {
    shadow: 22,
    draw(c, t) {
      poly(c, [[-24, 0], [-11, -22], [2, 0]], '#8C93A0');
      poly(c, [[-11, -22], [2, 0], [-6, 0]], '#737A88');
      poly(c, [[-12, 0], [6, -38], [24, 0]], '#9DA4B0');
      poly(c, [[6, -38], [24, 0], [10, 0]], '#7D8492');
      poly(c, [[-2, -21], [6, -38], [14, -21], [10, -23.5], [6, -20], [2, -24]], '#FFFFFF');
      poly(c, [[-15, -15], [-11, -22], [-7, -15], [-9, -16.5], [-11, -14.5]], '#FFFFFF');
      // Bandera en la cima.
      c.fillStyle = '#5A3C2B';
      c.fillRect(5.4, -50, 1.2, 12);
      const w = Math.sin(t * 4) * 1.2;
      poly(c, [[6.6, -50], [14, -48 + w], [6.6, -45]], '#D2463A');
    },
  },

  // --- Cueva ---
  cueva: {
    shadow: 17,
    draw(c, t) {
      c.beginPath();
      c.ellipse(0, 0, 18, 15, 0, Math.PI, 0);
      c.fillStyle = '#6E5444';
      c.fill();
      c.beginPath();
      c.ellipse(5, -2, 13, 11, 0, Math.PI * 1.25, 0);
      c.fillStyle = 'rgba(0,0,0,0.1)';
      c.fill();
      c.beginPath();
      c.ellipse(0, 0, 8, 9, 0, Math.PI, 0);
      c.fillStyle = '#21160F';
      c.fill();
      circle(c, -11, -9, 2.5, 'rgba(255,255,255,0.15)');
      // De vez en cuando, dos ojos en lo oscuro.
      if (Math.sin(t * 0.7) > 0.6 && Math.sin(t * 9) > -0.8) {
        circle(c, -2, -4, 0.9, '#F6D04D');
        circle(c, 2, -4, 0.9, '#F6D04D');
      }
    },
  },
  cristales: {
    shadow: 12,
    draw(c, t) {
      const gems = [[-7, 0, 4, 13, -0.2, '#9E7BE0'], [0, 0, 5, 18, 0, '#7FC8E8'], [7, 0, 4, 11, 0.25, '#B997F0']];
      for (const [x, y, w, h, rot, color] of gems) {
        c.save();
        c.translate(x, y);
        c.rotate(rot);
        poly(c, [[-w, 0], [-w, -h * 0.75], [0, -h], [w, -h * 0.75], [w, 0]], color);
        poly(c, [[0, 0], [0, -h], [w, -h * 0.75], [w, 0]], 'rgba(255,255,255,0.25)');
        c.restore();
      }
      const k = (t * 0.6) % 1;
      const s = Math.sin(k * Math.PI) * 3;
      c.strokeStyle = '#FFFFFF';
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(3 - s, -15); c.lineTo(3 + s, -15);
      c.moveTo(3, -15 - s); c.lineTo(3, -15 + s);
      c.stroke();
    },
    lights(c) {
      glow(c, 0, -8, 16, 'rgba(170,150,255,0.6)');
    },
  },
  gruta: {
    shadow: 22,
    draw(c, t) {
      c.beginPath();
      c.ellipse(0, 0, 24, 21, 0, Math.PI, 0);
      c.fillStyle = '#5E4638';
      c.fill();
      c.beginPath();
      c.ellipse(-6, -8, 12, 9, 0, 0, Math.PI * 2);
      c.fillStyle = 'rgba(255,255,255,0.07)';
      c.fill();
      c.beginPath();
      c.ellipse(0, 0, 12, 13, 0, Math.PI, 0);
      c.fillStyle = '#1A110C';
      c.fill();
      for (let x = -8; x <= 8; x += 4) poly(c, [[x - 1.6, -11 + Math.abs(x) * 0.25], [x + 1.6, -11 + Math.abs(x) * 0.25], [x, -6 + Math.abs(x) * 0.2]], '#5E4638');
      for (const x of [-15, 15]) {
        c.fillStyle = '#5A3C2B';
        c.fillRect(x - 0.8, -12, 1.6, 8);
        const f = Math.sin(t * 13 + x) * 0.8;
        poly(c, [[x - 2.2, -12], [x + f, -18], [x + 2.2, -12]], '#F4A259');
        poly(c, [[x - 1, -12], [x + f * 0.5, -15.5], [x + 1, -12]], '#FFE08A');
      }
    },
    lights(c, t) {
      for (const x of [-15, 15]) glow(c, x, -14, 12 + Math.sin(t * 13 + x), 'rgba(255,190,90,0.85)');
    },
  },

  // --- Volcán ---
  fumarola: {
    shadow: 11,
    draw(c, t) {
      poly(c, [[-11, 0], [-3, -9], [3, -9], [11, 0]], '#8A4B37');
      c.beginPath();
      c.ellipse(0, -9, 3, 1.2, 0, 0, Math.PI * 2);
      c.fillStyle = '#FFB347';
      c.fill();
      smoke(c, 0, -11, t, 'rgba(220,210,205,', 0.9);
    },
    lights(c) {
      glow(c, 0, -9, 8, 'rgba(255,170,80,0.8)');
    },
  },
  lava: {
    shadow: 0,
    draw(c, t) {
      c.beginPath();
      c.ellipse(0, -2, 17, 8, 0, 0, Math.PI * 2);
      c.fillStyle = '#5B2A1F';
      c.fill();
      const pulse = 0.5 + Math.sin(t * 2) * 0.5;
      c.beginPath();
      c.ellipse(0, -2, 13, 5.5, 0, 0, Math.PI * 2);
      c.fillStyle = `rgb(255, ${120 + pulse * 50}, 50)`;
      c.fill();
      for (let i = 0; i < 3; i++) {
        const k = (t * 0.8 + i / 3) % 1;
        circle(c, -7 + i * 7, -2 - k * 3, 1.8 * Math.sin(k * Math.PI), '#FFE08A');
      }
    },
    lights(c, t) {
      glow(c, 0, -2, 22 + Math.sin(t * 2) * 2, 'rgba(255,140,60,0.9)');
    },
  },
  crater: {
    shadow: 22,
    draw(c, t) {
      poly(c, [[-24, 0], [-7, -26], [7, -26], [24, 0]], '#9A4A33');
      poly(c, [[2, -26], [7, -26], [24, 0], [10, 0]], 'rgba(0,0,0,0.12)');
      c.beginPath();
      c.ellipse(0, -26, 7, 2.5, 0, 0, Math.PI * 2);
      c.fillStyle = '#FFB347';
      c.fill();
      poly(c, [[-3, -25], [3, -25], [1, -14], [3, -8], [-1, -12]], '#F27A3A');
      smoke(c, 0, -28, t, 'rgba(120,110,110,', 1.4);
    },
    lights(c) {
      glow(c, 0, -26, 18, 'rgba(255,160,70,0.9)');
    },
  },

  // --- Ciudad ---
  casas: {
    shadow: 18,
    draw(c, t, rand) {
      const roofs = ['#C86E5F', '#5E86B8', '#D9A13B', '#6FA060'];
      const r1 = roofs[Math.floor(rand() * 4)];
      const r2 = roofs[Math.floor(rand() * 4)];
      house(c, -8, -2, 13, 10, r1);
      house(c, 8, 2, 12, 9, r2);
      c.fillStyle = '#9A7B6A';
      c.fillRect(-4, -20, 2.5, 5);
      smoke(c, -3, -21, t, 'rgba(240,240,240,', 0.6);
      windows(c, -8, -2, 13, 10, false);
      windows(c, 8, 2, 12, 9, false);
    },
    lights(c) {
      windows(c, -8, -2, 13, 10, true);
      windows(c, 8, 2, 12, 9, true);
      glow(c, -8, -8, 9, 'rgba(255,214,110,0.5)');
      glow(c, 8, -3, 9, 'rgba(255,214,110,0.5)');
    },
  },
  pueblo: {
    shadow: 24,
    draw(c, t) {
      c.strokeStyle = '#D9C8A0';
      c.lineWidth = 3;
      c.beginPath();
      c.moveTo(-22, 6); c.quadraticCurveTo(0, -2, 22, 6);
      c.stroke();
      const hs = [[-13, -6, 11, 9, '#C86E5F'], [2, -9, 12, 10, '#5E86B8'], [15, -3, 10, 8, '#D9A13B'], [-4, 7, 11, 8, '#6FA060']];
      for (const [x, y, w, h, roof] of hs) {
        house(c, x, y, w, h, roof);
        windows(c, x, y, w, h, false);
      }
      smoke(c, 5, -24, t, 'rgba(240,240,240,', 0.6);
    },
    lights(c) {
      for (const [x, y, w, h] of [[-13, -6, 11, 9], [2, -9, 12, 10], [15, -3, 10, 8], [-4, 7, 11, 8]]) {
        windows(c, x, y, w, h, true);
        glow(c, x, y - h / 2, 8, 'rgba(255,214,110,0.45)');
      }
      glow(c, 0, 2, 6, 'rgba(255,230,150,0.6)');
    },
  },
  centro: {
    shadow: 17,
    draw(c, t) {
      c.fillStyle = '#F7F3EA';
      c.fillRect(-14, -16, 28, 16);
      poly(c, [[-16, -16], [-12, -23], [12, -23], [16, -16]], '#E04A3F');
      c.fillStyle = '#C53A31';
      c.fillRect(-14, -9, 28, 2);
      c.fillStyle = '#8FB3D1';
      c.fillRect(-4, -7, 8, 7);
      c.fillRect(-11, -14, 5, 4);
      c.fillRect(6, -14, 5, 4);
      // Emblema que late despacio.
      const r = 4 + Math.sin(t * 2) * 0.3;
      c.beginPath();
      c.arc(0, -20, r, Math.PI, 0);
      c.fillStyle = '#E04A3F';
      c.fill();
      c.beginPath();
      c.arc(0, -20, r, 0, Math.PI);
      c.fillStyle = '#FFFFFF';
      c.fill();
      c.fillStyle = '#2E3A2A';
      c.fillRect(-r, -20.5, 2 * r, 1);
      circle(c, 0, -20, 1.3, '#FFFFFF');
    },
    lights(c) {
      c.fillStyle = '#FFD86B';
      c.fillRect(-4, -7, 8, 7);
      c.fillRect(-11, -14, 5, 4);
      c.fillRect(6, -14, 5, 4);
      glow(c, 0, -5, 14, 'rgba(255,214,110,0.6)');
      glow(c, 0, -20, 9, 'rgba(255,120,110,0.6)');
    },
  },
  tienda: {
    shadow: 15,
    draw(c) {
      c.fillStyle = '#F7F3EA';
      c.fillRect(-12, -14, 24, 14);
      poly(c, [[-14, -14], [-11, -20], [11, -20], [14, -14]], '#4A7FC1');
      // Toldo de rayas.
      for (let i = 0; i < 6; i++) {
        c.fillStyle = i % 2 ? '#FFFFFF' : '#4A7FC1';
        c.fillRect(-12 + i * 4, -12, 4, 3);
      }
      c.fillStyle = '#8FB3D1';
      c.fillRect(-9, -7, 7, 5);
      c.fillStyle = '#8A6448';
      c.fillRect(3, -7, 5, 7);
      // Cartel azul con la «M» de las tiendas.
      c.fillStyle = '#4A7FC1';
      c.fillRect(-5, -27, 10, 7);
      c.strokeStyle = '#FFFFFF';
      c.lineWidth = 1.2;
      c.beginPath();
      c.moveTo(-3, -21.5); c.lineTo(-3, -25.5); c.lineTo(0, -23); c.lineTo(3, -25.5); c.lineTo(3, -21.5);
      c.stroke();
    },
    lights(c) {
      c.fillStyle = '#FFD86B';
      c.fillRect(-9, -7, 7, 5);
      glow(c, -5, -4, 11, 'rgba(255,214,110,0.6)');
    },
  },
  gimnasio: {
    shadow: 22,
    draw(c, t) {
      // Edificio ancho de tejado a dos colores, estatuas a la entrada y la medalla arriba.
      c.fillStyle = '#EDE3CF';
      c.fillRect(-19, -17, 38, 17);
      c.fillStyle = 'rgba(0,0,0,0.08)';
      c.fillRect(6, -17, 13, 17);
      poly(c, [[-22, -17], [-15, -27], [15, -27], [22, -17]], '#7E8794');
      poly(c, [[-22, -17], [-17, -22], [17, -22], [22, -17]], '#E07B39');
      c.fillStyle = '#C9BFA9';
      c.fillRect(-19, -6, 38, 1.5);
      c.fillStyle = '#5B6270';
      c.fillRect(-4.5, -9, 9, 9);
      c.fillStyle = '#8FB3D1';
      c.fillRect(-15, -14, 6, 4);
      c.fillRect(9, -14, 6, 4);
      for (const x of [-24, 24]) {
        c.fillStyle = '#9DA4B0';
        c.fillRect(x - 2.5, -3, 5, 3);
        poly(c, [[x - 2, -3], [x - 1.5, -9], [x + 1.5, -9], [x + 2, -3]], '#B7BDC7');
        circle(c, x, -10.5, 2, '#B7BDC7');
      }
      // Medalla que gira despacio.
      const w = Math.abs(Math.cos(t * 1.2)) * 4 + 0.6;
      c.beginPath();
      c.ellipse(0, -31, w, 4.2, 0, 0, Math.PI * 2);
      c.fillStyle = '#F6C343';
      c.fill();
      c.beginPath();
      c.ellipse(0, -31, w * 0.5, 2, 0, 0, Math.PI * 2);
      c.fillStyle = '#FFF1B0';
      c.fill();
    },
    lights(c) {
      c.fillStyle = '#FFD86B';
      c.fillRect(-15, -14, 6, 4);
      c.fillRect(9, -14, 6, 4);
      c.fillRect(-4.5, -9, 9, 9);
      glow(c, 0, -5, 16, 'rgba(255,214,110,0.6)');
      glow(c, 0, -31, 8, 'rgba(255,220,120,0.7)');
    },
  },
  torre: {
    shadow: 10,
    draw(c) {
      c.strokeStyle = '#B8423A';
      c.lineWidth = 1.6;
      c.beginPath();
      c.moveTo(-8, 0); c.lineTo(0, -40); c.lineTo(8, 0);
      for (let y = -6; y > -36; y -= 7) {
        const w = 8 * (1 + y / 40);
        c.moveTo(-w, y); c.lineTo(w, y);
        c.moveTo(-w, y); c.lineTo(w * 0.8, y - 7);
      }
      c.stroke();
      circle(c, 0, -41, 1.8, '#E04A3F');
    },
    lights(c, t) {
      if (Math.sin(t * 3) > 0) glow(c, 0, -41, 9, 'rgba(255,90,80,0.95)');
    },
  },
};

function easeOutBack(k) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2);
}

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// mulberry32, como en tiles.js: cada paraje se ve igual en cada fotograma.
function seeded(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
