// Interfaz dibujada en el canvas: la mano con la cola de las dos siguientes
// losetas, el marcador y las etiquetas de misión.

import { drawTile } from './tiles.js';

const BIG = 44;     // radio de la loseta en la mano
const SMALL = 26;   // radio de las dos siguientes
const W = Math.sqrt(3) / 2; // semiancho de un hexágono pointy-top por unidad de radio

export function handLayout(viewW, viewH) {
  const cy = viewH - 30 - BIG;
  const current = { x: viewW - 22 - W * BIG, y: cy, size: BIG };
  const next1 = { x: current.x - W * BIG - 16 - W * SMALL, y: cy + BIG - SMALL, size: SMALL };
  const next2 = { x: next1.x - 2 * W * SMALL - 10, y: next1.y, size: SMALL };
  const panel = {
    x: next2.x - W * SMALL - 14,
    y: cy - BIG - 12,
    w: viewW - 10 - (next2.x - W * SMALL - 14),
    h: viewH - 10 - (cy - BIG - 12),
  };
  return { current, queue: [next1, next2], panel };
}

// ¿El punto de pantalla cae sobre la loseta de la mano?
export function hitHand(sx, sy, viewW, viewH) {
  const { current } = handLayout(viewW, viewH);
  return Math.hypot(sx - current.x, sy - current.y) < current.size;
}

export function drawHand(ctx, upcoming, remaining, viewW, viewH, biomes, hint) {
  const { current, queue, panel } = handLayout(viewW, viewH);

  ctx.fillStyle = 'rgba(255,255,255,0.82)';
  roundRect(ctx, panel.x, panel.y, panel.w, panel.h, 14);
  ctx.fill();

  queue.forEach((slot, i) => {
    const tile = upcoming[i + 1];
    if (!tile) return;
    ctx.globalAlpha = i === 0 ? 0.9 : 0.6;
    drawTile(ctx, tile.sides, slot.x, slot.y, slot.size);
    ctx.globalAlpha = 1;
  });
  if (upcoming[0]) {
    drawTile(ctx, upcoming[0].sides, current.x, current.y, current.size);
    if (upcoming[0].mission) {
      drawMissionBadge(ctx, upcoming[0].mission, current.x, current.y - current.size - 2, biomes, 1);
    }
  }

  ctx.fillStyle = '#1B2238';
  ctx.font = '600 13px Nunito, system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(`Quedan ${remaining}`, panel.x + 12, panel.y + 10);
  ctx.font = '600 11px Nunito, system-ui, sans-serif';
  ctx.fillStyle = '#6B7389';
  ctx.textBaseline = 'bottom';
  ctx.fillText(hint, panel.x + 12, panel.y + panel.h - 8);
}

// Marcador pequeño en la esquina superior izquierda.
export function drawScore(ctx, game, extra = '') {
  const done = game.missions.filter(m => m.status === 'cumplida').length;
  const resident = game.pokemon.filter(p => p.kind !== 'visitante').length;
  const text = `${game.score} puntos · ${resident} Pokémon · ${done} misiones` + (extra ? ` · ${extra}` : '');
  ctx.font = '600 13px Nunito, system-ui, sans-serif';
  const w = ctx.measureText(text).width + 24;
  ctx.fillStyle = 'rgba(255,255,255,0.82)';
  roundRect(ctx, 12, 12, w, 30, 10);
  ctx.fill();
  ctx.fillStyle = '#1B2238';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 24, 27);
}

// Objetivo de la pantalla del recorrido, debajo del marcador. `done` lo pinta de verde.
export function drawGoal(ctx, text, done) {
  ctx.font = '600 12px Nunito, system-ui, sans-serif';
  const w = ctx.measureText(text).width + 22;
  ctx.fillStyle = done ? 'rgba(226,246,206,0.92)' : 'rgba(255,255,255,0.82)';
  roundRect(ctx, 12, 48, w, 26, 9);
  ctx.fill();
  ctx.fillStyle = done ? '#2F6B2A' : '#1B2238';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 23, 61);
}

// Etiqueta de misión: color del bioma, objetivo y, si está activa, el progreso.
// (x, y) es el centro de la etiqueta; `scale` permite dibujarla en el mundo.
export function drawMissionBadge(ctx, mission, x, y, biomes, scale) {
  // Las misiones de frontera cuentan aristas compartidas con el otro bioma: dos puntos de color.
  const border = mission.mode === 'frontera';
  const goal = mission.mode === 'exacta' ? `=${mission.target}` : `≥${mission.target}`;
  const text = mission.status === 'activa' ? `${mission.progress} / ${goal}` : goal;
  const dots = border ? [mission.biome, mission.other] : [mission.biome];
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.font = "800 13px 'Baloo 2', Nunito, sans-serif";
  const w = ctx.measureText(text).width + 18 + dots.length * 12;
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  roundRect(ctx, -w / 2, -11, w, 22, 11);
  ctx.fill();
  ctx.strokeStyle = 'rgba(27,34,56,0.35)';
  ctx.lineWidth = 1;
  ctx.stroke();
  dots.forEach((b, i) => {
    ctx.fillStyle = biomes[b]?.color ?? '#ccc';
    ctx.beginPath();
    ctx.arc(-w / 2 + 12 + i * 10, 0, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  });
  ctx.fillStyle = '#1B2238';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, -w / 2 + 10 + dots.length * 12, 1);
  ctx.restore();
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
