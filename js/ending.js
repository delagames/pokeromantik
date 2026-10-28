// Fin de partida: paseo de cámara por el mapa y exportación del mapa como PNG.

import { HEX_SIZE, hexToPixel } from './hex.js';

// Rectángulo del mundo que ocupan las losetas, con margen.
export function mapBounds(board, margin = HEX_SIZE) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const tile of board.tiles.values()) {
    const p = hexToPixel(tile.hex, HEX_SIZE);
    minX = Math.min(minX, p.x - HEX_SIZE);
    maxX = Math.max(maxX, p.x + HEX_SIZE);
    minY = Math.min(minY, p.y - HEX_SIZE);
    maxY = Math.max(maxY, p.y + HEX_SIZE);
  }
  return { x: minX - margin, y: minY - margin, w: maxX - minX + 2 * margin, h: maxY - minY + 2 * margin };
}

// Vista (centro y zoom) que encaja todo el rectángulo en la pantalla.
export function fitView(bounds, viewW, viewH, maxZoom = 1.5) {
  return {
    x: bounds.x + bounds.w / 2,
    y: bounds.y + bounds.h / 2,
    zoom: Math.min(maxZoom, viewW / bounds.w, viewH / bounds.h),
  };
}

// Paseo: de la vista actual a la vista general, visita a unos cuantos Pokémon
// de cerca y vuelve a la vista general. Cada tramo: { to, duration, hold }.
export function buildTour(board, pokemon, from, viewW, viewH) {
  const overview = fitView(mapBounds(board), viewW, viewH);
  const steps = [{ from, to: overview, duration: 3, hold: 1 }];
  const picks = [...pokemon].sort(() => Math.random() - 0.5).slice(0, 4);
  let prev = overview;
  for (const p of picks) {
    const to = { x: p.x, y: p.y, zoom: 1.8 };
    steps.push({ from: prev, to, duration: 3.5, hold: 1.5, follow: p });
    prev = to;
  }
  steps.push({ from: prev, to: overview, duration: 3.5, hold: 1 });
  return { steps, t: 0 };
}

// Avanza el paseo y devuelve la cámara, o null si ha terminado.
export function tourCamera(tour, dt) {
  tour.t += dt;
  let t = tour.t;
  for (const step of tour.steps) {
    const total = step.duration + step.hold;
    if (t > total) {
      t -= total;
      continue;
    }
    const k = smooth(Math.min(1, t / step.duration));
    // Si el tramo sigue a un Pokémon, el destino se mueve con él.
    const to = step.follow ? { ...step.to, x: step.follow.x, y: step.follow.y } : step.to;
    return {
      x: step.from.x + (to.x - step.from.x) * k,
      y: step.from.y + (to.y - step.from.y) * k,
      zoom: Math.exp(Math.log(step.from.zoom) + (Math.log(to.zoom) - Math.log(step.from.zoom)) * k),
    };
  }
  return null;
}

function smooth(k) {
  return k * k * (3 - 2 * k);
}

// Pinta el mapa completo en un canvas aparte. drawWorld(ctx) dibuja el mundo en
// coordenadas de mundo. `scale` son píxeles por unidad de mundo.
function renderMap(board, drawWorld, scale, caption, background = '#eef0e4') {
  const bounds = mapBounds(board, HEX_SIZE * 0.6);
  scale = Math.min(scale, 4000 / Math.max(bounds.w, bounds.h));
  const footer = caption ? 40 : 0;
  const c = document.createElement('canvas');
  c.width = Math.ceil(bounds.w * scale);
  c.height = Math.ceil(bounds.h * scale) + footer;
  const cctx = c.getContext('2d');
  cctx.fillStyle = background;
  cctx.fillRect(0, 0, c.width, c.height);
  cctx.setTransform(scale, 0, 0, scale, -bounds.x * scale, -bounds.y * scale);
  drawWorld(cctx);
  if (caption) {
    cctx.setTransform(1, 0, 0, 1, 0, 0);
    // Franja clara propia: el fondo de algunas pantallas es oscuro.
    cctx.fillStyle = '#F4EFE6';
    cctx.fillRect(0, c.height - footer, c.width, footer);
    cctx.fillStyle = '#1B2238';
    cctx.font = "600 16px Nunito, system-ui, sans-serif";
    cctx.textBaseline = 'middle';
    cctx.fillText(caption, 16, c.height - 20);
  }
  return c;
}

// Miniatura de unos 200 px de ancho para la galería, como dataURL JPEG.
export function mapThumbnail(board, drawWorld, background) {
  const full = renderMap(board, drawWorld, 1, '', background);
  const w = 200;
  const h = Math.round(full.height * (w / full.width));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d').drawImage(full, 0, 0, w, h);
  return c.toDataURL('image/jpeg', 0.8);
}

// Descarga el mapa completo como PNG.
export function downloadMapPNG(board, drawWorld, caption, background) {
  const c = renderMap(board, drawWorld, 2, caption, background);
  c.toBlob(blob => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `pokeromantik-${new Date().toISOString().slice(0, 10)}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, 'image/png');
  return c;
}
