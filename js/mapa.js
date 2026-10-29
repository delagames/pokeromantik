// Mapa de Kanto del recorrido, hecho con las losetas del juego: cada loseta toma
// el bioma que hay en ese punto de Kanto (mar, pradera, bosque, montaña, cueva,
// volcán, ciudad) y se pinta como en el tablero, con sus orillas y costuras.
// Encima van los caminos, y en HTML los nombres y las pantallas.

import { Board } from './board.js';
import { HEX_SIZE, hexToPixel } from './hex.js';
import { drawSeams, drawTile } from './tiles.js';

export const MAP_W = 20;
export const MAP_H = 17;

const COLUMNS = 26;  // losetas de ancho

// Kanto en la cuadrícula del Mapa del Pueblo de Rojo y Amarillo: 20 × 17 casillas,
// con cada ciudad en el centro de la suya. Las posiciones de aquí y de
// pantallas.json van en casillas.

// Ciudades por las que pasa el camino pero que no son pantallas.
export const TOWNS = [
  { nombre: 'Pueblo Paleta', x: 4.5, y: 11.5, etiqueta: 'derecha' },
  { nombre: 'Ciudad Verde', x: 4.5, y: 8.5, etiqueta: 'derecha' },
  { nombre: 'Ciudad Plateada', x: 4.5, y: 3.5, etiqueta: 'izquierda' },
  { nombre: 'Ciudad Celeste', x: 12.5, y: 2.5, etiqueta: 'derecha' },
  { nombre: 'Ciudad Azafrán', x: 12.5, y: 5.5, etiqueta: 'derecha' },
  { nombre: 'Ciudad Carmín', x: 12.5, y: 9.5, etiqueta: 'izquierda' },
  { nombre: 'Ciudad Fucsia', x: 10.5, y: 13.5, etiqueta: 'abajo' },
];

// Tierra (.) y mar (~) a media casilla.
const MASK = [
  '...............................~~~~~~~~~',
  '...............................~~~~~~~~~',
  '...................................~~~~~',
  '...................................~~~~~',
  '......................................~~',
  '......................................~~',
  '......................................~~',
  '.....................................~~~',
  '....................................~~~~',
  '...................................~~~~~',
  '..................................~~~~~~',
  '..................................~~~~~~',
  '..................................~~~~~~',
  '..................................~~~~~~',
  '...............~~.................~~~~~~',
  '...............~~~................~~~~~~',
  '..............~~~~~~~.............~~~~~~',
  '..............~~~~~~~~............~~~~~~',
  '...~~...........~~~~~~............~~~~~~',
  '..~~~...........~~~~~~............~~~~~~',
  '.~~~~~.........~~~~~~~~.............~~~~',
  '~~~~~~.........~~~~~~~~~...........~~~~~',
  '~~~~~~.....~~~~~~~~~~~~~..........~~~~~~',
  '~~~~~~.....~~~~~~~~~~~~~..........~~~~~~',
  '~~~~~~~.~~~~~~~~~~~~............~~~~~~~~',
  '~~~~~~~.~~~~~~~~~~~.............~~~~~~~~',
  '~~~~~~~~~~~~~~~~................~~~~~~~~',
  '~~~~~~~~~~~~~~~~...............~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~.......~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~......~~~~~~~~~~~~~~~~~',
  '~~~~~~......~~..~~~~~~~~~~~~~~~~~~~~~~~~',
  '~~~~~~......~~..~~~~~~~~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
];

// Zonas de cada bioma sobre la tierra: [x, y, radio] en casillas. El resto es pradera.
const ZONES = {
  volcan: [[3.4, 15.5, 0.6]],
  ciudad: [
    ...TOWNS.map(t => [t.x, t.y, 0.6]),
    [9.5, 5.5, 0.6], [16.5, 5.5, 0.6], [2.5, 2.5, 0.6], [4.5, 15.5, 0.55],  // Azulona, Lavanda, Meseta, Canela
  ],
  cueva: [[8.5, 1.5, 0.7], [17.4, 3.5, 0.55], [11.2, 1.4, 0.45], [2.5, 4.5, 0.5]],  // Monte Moon, Roca Túnel, Cueva Celeste, Calle Victoria
  montana: [
    [1, 0.8, 1.3], [4, 0.6, 1.1], [0.7, 3.5, 1], [1.4, 5.6, 1], [0.8, 7.4, 0.9], [3.4, 5.5, 0.6],
    [7.2, 1.2, 0.9], [9.8, 1, 0.8], [6.4, 0.4, 0.7], [16.8, 2.2, 0.6], [17.8, 4.6, 0.5],
    [7.5, 15.5, 0.75],  // Islas Espuma
  ],
  bosque: [
    [4.5, 4.5, 1], [9.5, 4.3, 0.6], [15.8, 1.2, 0.9], [10.5, 12.2, 0.7], [14.8, 12.6, 0.8],
    [3.2, 10.2, 0.5], [14.6, 7.4, 0.8], [10.5, 8.2, 0.5], [0.8, 9.6, 0.5],
  ],
};

// Caminos, como listas de casillas. Las rutas 17 y 18 cruzan el mar.
const ROADS = [
  [[4.5, 3.5], [4.5, 11.5]],                                 // rutas 2 y 1
  [[2.5, 2.5], [2.5, 8.5], [4.5, 8.5]],                      // rutas 23 y 22
  [[4.5, 3.5], [7.5, 3.5], [7.5, 2.5], [16.5, 2.5], [16.5, 11.5], [13.5, 11.5], [13.5, 13.5], [10.5, 13.5]], // 3, 4, 9, 10, 12 a 15
  [[12.5, 2.5], [12.5, 0.5], [14.5, 0.5]],                   // rutas 24 y 25
  [[12.5, 2.5], [12.5, 9.5], [16.5, 9.5]],                   // rutas 5, 6 y 11
  [[6.5, 5.5], [16.5, 5.5]],                                 // rutas 16, 7 y 8
  [[6.5, 5.5], [6.5, 13.5], [10.5, 13.5], [10.5, 14.4]],     // rutas 17, 18 y 19
];

// Rutas por mar: 19, 20 y 21.
const SEA_ROUTES = [
  [[10.5, 14.4], [10.5, 15.5], [4.5, 15.5]],
  [[4.5, 11.5], [4.5, 15.5]],
];

const near = (zones, x, y) => zones.some(([zx, zy, r]) => (x - zx) ** 2 + (y - zy) ** 2 <= r * r);

function biomeAt(x, y) {
  const row = MASK[Math.floor(y * 2)];
  if ((row?.[Math.floor(x * 2)] ?? '~') === '~') return 'agua';
  for (const biome of ['volcan', 'ciudad', 'cueva', 'montana', 'bosque']) {
    if (near(ZONES[biome], x, y)) return biome;
  }
  return 'pradera';
}

// Losetas que cubren el mapa, en coordenadas de mundo. Cada una es de un solo
// bioma (el de su centro): así solo hay siete losetas distintas que pintar, y las
// costuras del tablero ya hacen orillas y bordes redondeados.
function buildBoard() {
  const worldW = COLUMNS * Math.sqrt(3) * HEX_SIZE;
  const worldH = worldW * (MAP_H / MAP_W);
  const board = new Board();
  const rows = Math.ceil(worldH / (1.5 * HEX_SIZE)) + 1;
  for (let r = -1; r <= rows; r++) {
    for (let q = -Math.ceil(r / 2) - 1; q <= COLUMNS - Math.floor(r / 2); q++) {
      const p = hexToPixel({ q, r }, HEX_SIZE);
      const biome = biomeAt((p.x / worldW) * MAP_W, (p.y / worldH) * MAP_H);
      board.place({ q, r }, Array(6).fill(biome));
    }
  }
  return { board, worldW, worldH };
}

let cached = null;

// Pinta el mapa en `canvas` a su tamaño en pantalla.
export function drawKanto(canvas) {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  cached ??= buildBoard();
  const { board, worldW, worldH } = cached;

  const c = canvas.getContext('2d');
  const scale = canvas.width / worldW;
  c.setTransform(scale, 0, 0, scale, 0, 0);
  c.fillStyle = '#4EA6DD';
  c.fillRect(0, 0, worldW, worldH);
  for (const tile of board.tiles.values()) {
    const p = hexToPixel(tile.hex, HEX_SIZE);
    drawTile(c, tile.sides, p.x, p.y, HEX_SIZE);
  }
  drawSeams(c, board);

  const toWorld = ([x, y]) => [(x / MAP_W) * worldW, (y / MAP_H) * worldH];
  const trace = points => {
    c.beginPath();
    points.map(toWorld).forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
  };
  c.lineCap = 'round';
  c.lineJoin = 'round';
  // Rutas por mar: estela de espuma.
  c.setLineDash([10, 14]);
  c.strokeStyle = 'rgba(255,255,255,0.75)';
  c.lineWidth = 6;
  for (const route of SEA_ROUTES) { trace(route); c.stroke(); }
  c.setLineDash([]);
  // Caminos de tierra, con un borde oscuro suave.
  for (const [color, width] of [['rgba(92,70,38,0.35)', 26], ['#E8D7A2', 18], ['rgba(255,255,255,0.25)', 5]]) {
    c.strokeStyle = color;
    c.lineWidth = width;
    for (const road of ROADS) { trace(road); c.stroke(); }
  }
}

// Posición en % del mapa para colocar encima botones y nombres.
export function place(node, x, y) {
  node.style.left = `${(x / MAP_W) * 100}%`;
  node.style.top = `${(y / MAP_H) * 100}%`;
}
