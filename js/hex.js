// Matemáticas de la cuadrícula hexagonal.
// Hexágonos de punta arriba (pointy-top) con coordenadas axiales (q, r).
// Fórmulas de https://www.redblobgames.com/grids/hexagons/

const SQRT3 = Math.sqrt(3);

// Radio (centro-esquina) de una loseta en unidades de mundo.
export const HEX_SIZE = 48;

// Orden de direcciones = orden de los lados de una loseta.
// Lado i es la arista compartida con el vecino en DIRECTIONS[i]:
// 0 E, 1 NE, 2 NO, 3 O, 4 SO, 5 SE.
export const DIRECTIONS = [
  { q: +1, r: 0 }, { q: +1, r: -1 }, { q: 0, r: -1 },
  { q: -1, r: 0 }, { q: -1, r: +1 }, { q: 0, r: +1 },
];

export function hex(q, r) {
  return { q, r };
}

export function hexKey(h) {
  return `${h.q},${h.r}`;
}

export function hexAdd(a, b) {
  return { q: a.q + b.q, r: a.r + b.r };
}

export function hexNeighbor(h, dir) {
  return hexAdd(h, DIRECTIONS[dir]);
}

export function hexNeighbors(h) {
  return DIRECTIONS.map(d => hexAdd(h, d));
}

export function hexDistance(a, b) {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

// Centro del hexágono en coordenadas de mundo. size = distancia centro-esquina.
export function hexToPixel(h, size) {
  return {
    x: size * (SQRT3 * h.q + (SQRT3 / 2) * h.r),
    y: size * (1.5 * h.r),
  };
}

export function pixelToHex(x, y, size) {
  const q = ((SQRT3 / 3) * x - (1 / 3) * y) / size;
  const r = ((2 / 3) * y) / size;
  return hexRound(q, r);
}

// Redondeo en coordenadas cúbicas: se corrige la componente con más error.
export function hexRound(fq, fr) {
  const fs = -fq - fr;
  let q = Math.round(fq);
  let r = Math.round(fr);
  const s = Math.round(fs);
  const dq = Math.abs(q - fq);
  const dr = Math.abs(r - fr);
  const ds = Math.abs(s - fs);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return { q, r };
}

// Esquina i (0..5) relativa al centro, a 60·i − 30 grados. Como el eje y del
// canvas crece hacia abajo, las esquinas avanzan en sentido horario empezando
// por la de arriba a la derecha.
export function hexCorner(i, size) {
  const angle = (Math.PI / 180) * (60 * i - 30);
  return { x: size * Math.cos(angle), y: size * Math.sin(angle) };
}

export function hexCorners(size) {
  return [0, 1, 2, 3, 4, 5].map(i => hexCorner(i, size));
}

// Las dos esquinas que delimitan el lado `side` (0 E, 1 NE, ... 5 SE).
export function sideCorners(side, size) {
  const a = (6 - side) % 6;
  return [hexCorner(a, size), hexCorner((a + 1) % 6, size)];
}

export function tracePath(ctx, cx, cy, size) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const c = hexCorner(i, size);
    if (i === 0) ctx.moveTo(cx + c.x, cy + c.y);
    else ctx.lineTo(cx + c.x, cy + c.y);
  }
  ctx.closePath();
}
