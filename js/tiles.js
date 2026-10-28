// Dibujo y caché de losetas. Cada combinación de lados se pinta una vez en un
// canvas fuera de pantalla y luego se copia escalada en cada fotograma.

import { HEX_SIZE, hexKey, hexNeighbor, hexToPixel, sideCorners, tracePath } from './hex.js';

// Radio al que se pinta la caché: suficiente para el zoom máximo sin verse borroso.
const CACHE_SIZE = 128;
const cache = new Map();

let biomes = {};

export function setBiomes(data) {
  biomes = data;
  cache.clear();
}

export function drawTile(ctx, sides, cx, cy, size) {
  const img = getTileImage(sides);
  const scale = size / CACHE_SIZE;
  ctx.drawImage(img, cx - (img.width / 2) * scale, cy - (img.height / 2) * scale,
    img.width * scale, img.height * scale);
}

function getTileImage(sides) {
  const key = sides.join('|');
  let img = cache.get(key);
  if (!img) {
    img = renderTile(sides, key);
    cache.set(key, img);
  }
  return img;
}

function renderTile(sides, key) {
  const R = CACHE_SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(Math.sqrt(3) * R) + 2;
  canvas.height = 2 * R + 2;
  const ctx = canvas.getContext('2d');
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const rand = seededRandom(hashString(key));

  ctx.save();
  tracePath(ctx, cx, cy, R);
  ctx.clip();
  ctx.drawImage(paintSectors(sides, canvas.width, canvas.height, R, hashString(key)), 0, 0);

  // Ruido suave para textura.
  for (let i = 0; i < 260; i++) {
    const x = rand() * canvas.width;
    const y = rand() * canvas.height;
    const light = rand() < 0.5;
    ctx.fillStyle = light ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.06)';
    ctx.beginPath();
    ctx.arc(x, y, 1.5 + rand() * 3, 0, Math.PI * 2);
    ctx.fill();
  }

  for (let side = 0; side < 6; side++) {
    drawDetail(ctx, sides[side], side, cx, cy, R, rand);
  }
  ctx.restore();

  // Borde fino y claro para que las losetas se distingan sin cortar el paisaje.
  tracePath(ctx, cx, cy, R - 1);
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 2;
  ctx.stroke();

  return canvas;
}

// --- Fronteras orgánicas ---------------------------------------------------------

// Altura de cada bioma: el más alto echa una sombra suave sobre el más bajo.
const HEIGHT = { agua: 0, pradera: 1, ciudad: 1, bosque: 2, cueva: 2, volcan: 3, montana: 3 };
const SAND = [232, 215, 162];
const BAND = 11;        // ancho de la transición dentro de la loseta, en píxeles de la caché
const WOBBLE = 0.3;     // cuánto se ondulan las fronteras entre sectores (radianes)

// Pinta los sectores píxel a píxel: la frontera entre dos biomas es una línea
// ondulada, y junto a ella cada uno se cuela en el otro a manchas. Junto al agua
// sale una orilla de arena y espuma. La ondulación se anula en las esquinas, así
// que los bordes de la loseta siguen casando con los vecinos.
function paintSectors(sides, w, h, R, seed) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  const data = img.data;
  const rgb = sides.map(s => hexToRgb(biomeColor(s)));
  const rand = seededRandom(seed);
  const phases = Array.from({ length: 6 }, () => [rand() * 6.28, rand() * 6.28, 0.06 + rand() * 0.04]);
  const cx = w / 2;
  const cy = h / 2;
  const SECTOR = Math.PI / 3;
  const mixed = sides.some(b => b !== sides[0]);
  const dominant = dominantBiome(sides);
  const rgbOf = Object.fromEntries(sides.map((s, i) => [s, rgb[i]]));

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const r = Math.hypot(dx, dy);
      if (r > R + 2) continue;
      let color = rgb[0];
      if (mixed) {
        // El lado j ocupa los ángulos alrededor de -60°·j.
        const theta = Math.atan2(dy, dx);
        const u0 = -theta / SECTOR;
        const [p1, p2, f] = phases[((Math.floor(u0) % 6) + 6) % 6];
        const amp = WOBBLE * Math.sin(Math.PI * Math.min(1, r / R));
        const wobble = amp * (0.7 * Math.sin(r * f + p1) + 0.3 * Math.sin(r * f * 2.7 + p2));
        const u = -(theta + wobble) / SECTOR;
        const nearest = Math.round(u);
        const side = ((nearest % 6) + 6) % 6;
        const frac = u - nearest;
        let a = sides[side];
        let b = sides[(side + (frac > 0 ? 1 : 5)) % 6];
        let d = (0.5 - Math.abs(frac)) * SECTOR * r;
        // En el centro, una mancha irregular del bioma dominante tapa el punto
        // donde se juntan todos los sectores.
        const dc = r - R * (0.2 + 0.04 * Math.sin(3 * theta + phases[0][0]) + 0.03 * Math.sin(5 * theta + phases[0][1]));
        if (dc < 0) {
          b = a;
          a = dominant;
          d = -dc;
        } else if (dc < d && a !== dominant) {
          b = dominant;
          d = dc;
        }
        color = rgbOf[a];
        if (a !== b && d < BAND) {
          const k = 1 - d / BAND;
          const speck = 0.65 * smoothNoise(x / 6, y / 6, seed) + 0.35 * smoothNoise(x / 2.5, y / 2.5, seed + 7);
          if (a === 'agua' || b === 'agua') {
            // Orilla: arena del lado de tierra, espuma del lado del agua.
            if (a !== 'agua') color = d < BAND * 0.55 || speck < k * 0.8 ? SAND : color;
            else if (d < 3 + speck * 2) color = mix(color, [255, 255, 255], 0.35);
          } else if (speck < k * 0.75) {
            color = rgbOf[b];
          } else if ((HEIGHT[a] ?? 1) < (HEIGHT[b] ?? 1)) {
            color = mix(color, [0, 0, 0], 0.12 * k);
          }
        }
      }
      const i = (y * w + x) * 4;
      data[i] = color[0];
      data[i + 1] = color[1];
      data[i + 2] = color[2];
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

// Costuras entre losetas vecinas cuyos lados no casan: en vez de un corte recto,
// mordiscos redondeados de cada bioma que se entrelazan, o una orilla de arena
// si uno de los dos es agua. Se calculan una vez por tablero y se reutilizan.
const seamCache = new WeakMap(); // Board -> { count, blobs }

export function drawSeams(ctx, board, skip = null) {
  let entry = seamCache.get(board);
  if (!entry || entry.count !== board.tiles.size) {
    entry = { count: board.tiles.size, blobs: computeSeams(board), paths: null };
    seamCache.set(board, entry);
  }
  // Lo normal: un solo trazado por color, preparado una vez.
  if (!skip) {
    entry.paths ??= groupByColor(entry.blobs);
    for (const [color, path] of entry.paths) {
      ctx.fillStyle = color;
      ctx.fill(path);
    }
    return;
  }
  // Mientras cae una loseta, sin las costuras que la tocan.
  const blobs = entry.blobs.filter(b => b.a !== skip && b.b !== skip);
  for (const [color, path] of groupByColor(blobs)) {
    ctx.fillStyle = color;
    ctx.fill(path);
  }
}

function groupByColor(blobs) {
  const paths = new Map();
  for (const blob of blobs) {
    let path = paths.get(blob.color);
    if (!path) paths.set(blob.color, (path = new Path2D()));
    path.moveTo(blob.x + Math.cos(blob.rot) * blob.rx, blob.y + Math.sin(blob.rot) * blob.rx);
    path.ellipse(blob.x, blob.y, blob.rx, blob.ry, blob.rot, 0, Math.PI * 2);
  }
  return paths;
}

function computeSeams(board) {
  const blobs = [];
  for (const tile of board.tiles.values()) {
    const keyA = hexKey(tile.hex);
    const pa = hexToPixel(tile.hex, HEX_SIZE);
    // Cada arista se mira una sola vez: desde la loseta con el lado 0, 1 o 2.
    for (let side = 0; side < 3; side++) {
      const nh = hexNeighbor(tile.hex, side);
      const other = board.get(nh);
      if (!other) continue;
      const a = tile.sides[side];
      const b = other.sides[side + 3];
      if (a === b) continue;
      const keyB = hexKey(nh);
      const pb = hexToPixel(nh, HEX_SIZE);
      const len = Math.hypot(pb.x - pa.x, pb.y - pa.y);
      const nx = (pb.x - pa.x) / len;
      const ny = (pb.y - pa.y) / len;
      const [c1, c2] = sideCorners(side, HEX_SIZE);
      const rand = seededRandom(hashString(`${keyA}>${keyB}`));
      const rot = Math.atan2(c2.y - c1.y, c2.x - c1.x);
      const at = (t, push, r, color, stretch = 1.5) => blobs.push({
        a: keyA, b: keyB, color, rot, rx: r * stretch, ry: r,
        x: pa.x + c1.x + (c2.x - c1.x) * t + nx * push,
        y: pa.y + c1.y + (c2.y - c1.y) * t + ny * push,
      });
      if (a === 'agua' || b === 'agua') {
        // Orilla: arena que se mete un poco en tierra y espuma en el agua.
        const toLand = a === 'agua' ? 1 : -1;
        for (let k = 1; k < 8; k++) at(k / 8 + (rand() - 0.5) * 0.04, toLand * (0.5 + rand() * 1.5), 2 + rand() * 1.8, rgbCss(SAND));
        for (let k = 1; k < 6; k++) at(k / 6 + (rand() - 0.5) * 0.05, -toLand * (1.2 + rand()), 0.9 + rand() * 0.6, 'rgba(255,255,255,0.45)', 2.2);
      } else {
        // Cada bioma se cuela en el otro a manchas pequeñas, más cerca de la arista
        // cuanto más grandes, como la transición de dentro de la loseta.
        for (let k = 0; k < 22; k++) {
          const intoB = rand() < 0.5;
          const r = 0.9 + rand() * 1.6;
          const push = (0.3 + Math.pow(rand(), 1.6) * 4) * (2.6 - r) / 1.7;
          at(0.08 + rand() * 0.84, (intoB ? 1 : -1) * push, r, biomeColor(intoB ? a : b), 1 + rand() * 0.6);
        }
      }
    }
  }
  return blobs;
}

function hexToRgb(hex) {
  return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
}

function rgbCss([r, g, b]) {
  return `rgb(${r},${g},${b})`;
}

function mix(c, d, k) {
  return [0, 1, 2].map(i => Math.round(c[i] + (d[i] - c[i]) * k));
}

// Ruido suave de 0 a 1: valores al azar en una rejilla, interpolados entre ellos.
// Al cortarlo por un umbral salen manchas redondeadas.
function smoothNoise(x, y, seed) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const top = cellNoise(x0, y0, seed) * (1 - sx) + cellNoise(x0 + 1, y0, seed) * sx;
  const bottom = cellNoise(x0, y0 + 1, seed) * (1 - sx) + cellNoise(x0 + 1, y0 + 1, seed) * sx;
  return top * (1 - sy) + bottom * sy;
}

// Un valor fijo de 0 a 1 para cada punto de la rejilla.
function cellNoise(x, y, seed) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ seed;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Detalles sencillos dentro de cada sector, según el campo `detalle` del bioma.
// Además del color sirven para distinguir biomas sin depender solo de él.
function drawDetail(ctx, biome, side, cx, cy, R, rand) {
  const painter = DETAILS[biomes[biome]?.detalle];
  if (!painter) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let i = 0; i < painter.count; i++) {
    const p = randomPointInSector(side, R, rand);
    painter.draw(ctx, cx + p.x, cy + p.y, rand);
  }
  ctx.restore();
}

const DETAILS = {
  hierba: {
    count: 4,
    draw(ctx, x, y) {
      ctx.strokeStyle = 'rgba(111,174,69,0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x - 4, y - 5); ctx.lineTo(x - 2, y + 3);
      ctx.moveTo(x, y - 8); ctx.lineTo(x, y + 3);
      ctx.moveTo(x + 4, y - 5); ctx.lineTo(x + 2, y + 3);
      ctx.stroke();
    },
  },
  pinos: {
    count: 3,
    draw(ctx, x, y, rand) {
      const s = 0.8 + rand() * 0.4;
      ctx.fillStyle = '#4A3328';
      ctx.fillRect(x - 1.5 * s, y + 6 * s, 3 * s, 5 * s);
      ctx.fillStyle = '#245F3B';
      for (let k = 0; k < 3; k++) {
        const ty = y - 10 * s + k * 6 * s;
        const w = (5 + k * 2.5) * s;
        ctx.beginPath();
        ctx.moveTo(x, ty - 4 * s);
        ctx.lineTo(x + w, ty + 6 * s);
        ctx.lineTo(x - w, ty + 6 * s);
        ctx.closePath();
        ctx.fill();
      }
    },
  },
  ondas: {
    count: 3,
    draw(ctx, x, y) {
      ctx.strokeStyle = '#A9DCF4';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x - 10, y);
      ctx.quadraticCurveTo(x - 5, y - 4, x, y);
      ctx.quadraticCurveTo(x + 5, y + 4, x + 10, y);
      ctx.stroke();
    },
  },
  rocas: {
    count: 3,
    draw(ctx, x, y, rand) {
      const r = 4 + rand() * 4;
      ctx.fillStyle = 'rgba(120,122,130,0.9)';
      ctx.beginPath();
      ctx.ellipse(x, y, r * 1.3, r, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath();
      ctx.ellipse(x - r * 0.4, y - r * 0.35, r * 0.5, r * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();
    },
  },
  agujeros: {
    count: 2,
    draw(ctx, x, y, rand) {
      const r = 5 + rand() * 4;
      ctx.fillStyle = 'rgba(50,35,28,0.75)';
      ctx.beginPath();
      ctx.ellipse(x, y, r * 1.4, r, 0, Math.PI, 0);
      ctx.lineTo(x + r * 1.4, y + r * 0.4);
      ctx.lineTo(x - r * 1.4, y + r * 0.4);
      ctx.closePath();
      ctx.fill();
    },
  },
  grietas: {
    count: 2,
    draw(ctx, x, y, rand) {
      ctx.strokeStyle = 'rgba(255,200,90,0.85)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(x - 9, y - 4);
      ctx.lineTo(x - 3, y + 2 * (rand() - 0.5) * 4);
      ctx.lineTo(x + 2, y - 3);
      ctx.lineTo(x + 9, y + 4);
      ctx.stroke();
    },
  },
  casas: {
    count: 2,
    draw(ctx, x, y) {
      ctx.fillStyle = 'rgba(250,245,235,0.95)';
      ctx.fillRect(x - 7, y - 3, 14, 10);
      ctx.fillStyle = 'rgba(200,110,95,0.9)';
      ctx.beginPath();
      ctx.moveTo(x - 9, y - 3);
      ctx.lineTo(x, y - 11);
      ctx.lineTo(x + 9, y - 3);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(120,150,180,0.8)';
      ctx.fillRect(x - 2, y + 1, 4, 6);
    },
  },
};

// Punto uniforme dentro del triángulo centro-esquina-esquina, apartado de los bordes.
function randomPointInSector(side, R, rand) {
  const [a, b] = sideCorners(side, R * 0.82);
  let u = rand();
  let v = rand();
  if (u + v > 1) { u = 1 - u; v = 1 - v; }
  return { x: a.x * u + b.x * v, y: a.y * u + b.y * v };
}

export function dominantBiome(sides) {
  const counts = {};
  for (const s of sides) counts[s] = (counts[s] || 0) + 1;
  return Object.keys(counts).reduce((a, b) => (counts[b] > counts[a] ? b : a));
}

function biomeColor(id) {
  return biomes[id]?.color ?? '#cccccc';
}

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// mulberry32: generador pequeño y determinista para que cada loseta se vea igual siempre.
function seededRandom(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
