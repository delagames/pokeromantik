// Dibujo y caché de losetas. Cada combinación de lados se pinta una vez en un
// canvas fuera de pantalla y luego se copia escalada en cada fotograma.

import { sideCorners, tracePath } from './hex.js';

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

  // Un sector triangular por lado, con el color de su bioma.
  for (let side = 0; side < 6; side++) {
    const [a, b] = sideCorners(side, R);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + a.x, cy + a.y);
    ctx.lineTo(cx + b.x, cy + b.y);
    ctx.closePath();
    ctx.fillStyle = biomeColor(sides[side]);
    ctx.fill();
    // Trazo del mismo color para tapar las juntas antialias entre sectores.
    ctx.strokeStyle = ctx.fillStyle;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Suaviza la unión en el centro con un degradado del bioma dominante.
  const dominant = dominantBiome(sides);
  if (sides.some(s => s !== dominant)) {
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.45);
    grad.addColorStop(0, biomeColor(dominant));
    grad.addColorStop(0.55, biomeColor(dominant) + 'cc');
    grad.addColorStop(1, biomeColor(dominant) + '00');
    ctx.fillStyle = grad;
    ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);
  }

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
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 2;
  ctx.stroke();

  return canvas;
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
