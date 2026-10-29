// Mapa de Kanto del recorrido: tierra, mar, caminos y pueblos de paso, en un SVG
// de 160 × 120 unidades. Las pantallas se colocan encima con su `mapa` de
// pantallas.json, en las mismas unidades. En pantallas altas el mapa se estira
// hacia abajo (`stretch`) sin deformar montes, árboles ni islas.

export const MAP_W = 160;
export const MAP_H = 120;

// Pueblos por los que pasa el camino pero que no son pantallas.
export const TOWNS = [
  { nombre: 'Paleta', x: 35, y: 92, etiqueta: 'derecha' },
  { nombre: 'Verde', x: 35, y: 64, etiqueta: 'derecha' },
  { nombre: 'Plateada', x: 35, y: 30, etiqueta: 'derecha' },
  { nombre: 'Celeste', x: 96, y: 22, etiqueta: 'arriba' },
  { nombre: 'Azafrán', x: 96, y: 50, etiqueta: 'abajo' },
  { nombre: 'Carmín', x: 96, y: 72, etiqueta: 'abajo' },
  { nombre: 'Fucsia', x: 82, y: 96, etiqueta: 'derecha' },
];

const LAND = `M 8 8 C 40 4, 120 4, 150 8 C 156 30, 156 70, 150 90 C 140 102, 110 104, 92 103
  C 80 104, 70 100, 58 101 C 48 102, 42 100, 30 100 C 18 100, 10 94, 8 84 C 4 60, 4 30, 8 8 Z`;

const ISLANDS = [
  [43, 111, 8, 5.5],  // Canela
  [64, 112, 5, 3.5],  // Espuma
  [71, 109, 3, 2],
];

// Caminos por tierra, como listas de puntos.
const ROADS = [
  [[35, 92], [35, 30]],
  [[35, 30], [66, 22], [96, 22]],
  [[96, 22], [96, 72], [128, 72]],
  [[70, 50], [128, 50]],
  [[96, 22], [128, 22], [128, 86], [96, 96], [82, 96]],
  [[70, 50], [50, 50], [50, 92], [82, 96]],
  [[35, 64], [18, 64], [18, 28]],
];

// Rutas por mar.
const SEA_ROUTES = [
  [[35, 92], [43, 111]],
  [[43, 111], [66, 111]],
  [[66, 111], [82, 106], [82, 96]],
];

const MOUNTAINS = [
  [52, 17, 6], [59, 14, 7], [74, 15, 6], [80, 18, 5],  // Monte Moon
  [9, 42, 5], [12, 50, 6], [25, 41, 5], [9, 58, 5],    // Calle Victoria
  [140, 24, 6], [146, 31, 5],                          // Roca Túnel
];

const TREES = [
  [26, 41], [30, 38], [40, 38], [44, 42], [25, 52], [29, 56], [42, 56], [45, 51],
];

const WAVES = [[12, 108], [92, 112], [118, 108], [140, 113], [150, 98]];

const NS = 'http://www.w3.org/2000/svg';

function el(name, attrs, parent) {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  parent?.append(node);
  return node;
}

export function kantoSVG(stretch = 1) {
  const sy = y => y * stretch;
  const line = points => 'M ' + points.map(([x, y]) => `${x} ${sy(y)}`).join(' L ');
  const svg = el('svg', { viewBox: `0 0 ${MAP_W} ${sy(MAP_H)}`, class: 'kanto', 'aria-hidden': 'true' });
  el('rect', { class: 'mar', x: 0, y: 0, width: MAP_W, height: sy(MAP_H) }, svg);
  for (const [x, y] of WAVES) el('path', { class: 'ola', d: `M ${x} ${sy(y)} q 2 -2 4 0 t 4 0` }, svg);
  for (const route of SEA_ROUTES) el('path', { class: 'ruta-mar', d: line(route) }, svg);
  el('path', { class: 'tierra', d: LAND.replace(/([\d.]+) ([\d.]+)/g, (_, x, y) => `${x} ${sy(+y)}`) }, svg);
  for (const [cx, cy, rx, ry] of ISLANDS) el('ellipse', { class: 'tierra', cx, cy: sy(cy), rx, ry }, svg);
  for (const [x, y, s] of MOUNTAINS) {
    const cy = sy(y);
    el('path', { class: 'monte', d: `M ${x - s / 2} ${cy + s / 2} L ${x} ${cy - s / 2} L ${x + s / 2} ${cy + s / 2} Z` }, svg);
  }
  for (const [cx, cy] of TREES) el('circle', { class: 'arbol', cx, cy: sy(cy), r: 2.6 }, svg);
  for (const road of ROADS) el('path', { class: 'borde-camino', d: line(road) }, svg);
  for (const road of ROADS) el('path', { class: 'camino', d: line(road) }, svg);
  return svg;
}

// Posición en % del mapa para colocar encima botones y nombres (vale para
// cualquier `stretch`: el estiramiento es igual en todo el mapa).
export function place(node, x, y) {
  node.style.left = `${(x / MAP_W) * 100}%`;
  node.style.top = `${(y / MAP_H) * 100}%`;
}
