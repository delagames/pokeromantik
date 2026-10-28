// Mazo y generación de losetas. Una loseta es { sides: [6 ids de bioma] },
// con los lados en el orden de DIRECTIONS (0 E, 1 NE, 2 NO, 3 O, 4 SO, 5 SE).

export const DECK_SIZE = 40;
const MISSION_CHANCE = 1 / 8;

// Reparto de cuántos biomas lleva cada loseta (sección Mecánica base). Con el
// desbloqueo de 75 avistados, las de tres biomas pasan al 20%.
function biomeCountWeights(threeBiomeShare) {
  const rest = 100 - threeBiomeShare;
  return [
    { count: 1, weight: rest * 5 / 9 },
    { count: 2, weight: rest * 4 / 9 },
    { count: 3, weight: threeBiomeShare },
  ];
}

// Pares de biomas para las misiones de frontera (los que tienen Pokémon de frontera).
const BORDER_PAIRS = [
  ['bosque', 'agua'], ['montana', 'agua'], ['pradera', 'ciudad'], ['cueva', 'montana'],
  ['volcan', 'montana'], ['bosque', 'pradera'], ['agua', 'ciudad'],
];

// Cómo se reparten los seis lados entre los biomas. Cada bioma ocupa lados
// seguidos, para que el dibujo forme zonas y no un abanico de colores.
const SPLITS = {
  1: [[6]],
  2: [[3, 3], [3, 3], [2, 4], [2, 4], [1, 5]],
  3: [[2, 2, 2], [1, 2, 3], [1, 2, 3], [1, 1, 4]],
};

// options: { threeBiomeShare: % de losetas de tres biomas, borderMissions: bool,
//            weights: { bioma: peso } para que unos biomas salgan más (pantallas) }
export class Deck {
  constructor(biomeIds, size = DECK_SIZE, options = {}, rand = Math.random) {
    this.biomeIds = biomeIds;
    this.options = { threeBiomeShare: 10, borderMissions: false, ...options };
    this.rand = rand;
    this.tiles = [];
    this.addRandom(size);
  }

  // Añade losetas nuevas al final del mazo (recompensas).
  addRandom(n) {
    for (let i = 0; i < n; i++) this.tiles.push(generateTile(this.biomeIds, this.rand, this.options));
  }

  get length() {
    return this.tiles.length;
  }

  // Las n siguientes losetas, la primera es la que está en la mano.
  peek(n) {
    return this.tiles.slice(0, n);
  }

  draw() {
    return this.tiles.shift();
  }

  // Devuelve una loseta a la cabeza del mazo (para deshacer).
  putBack(tile) {
    this.tiles.unshift(tile);
  }
}

export function generateTile(biomeIds, rand = Math.random, options = {}) {
  const weights = biomeCountWeights(options.threeBiomeShare ?? 10);
  const count = Math.min(biomeIds.length, weightedPick(weights, rand).count);
  const chosen = weightedSample(biomeIds, count, options.weights, rand);
  const split = shuffle([...pick(SPLITS[count], rand)], rand);

  const sides = [];
  split.forEach((n, i) => {
    for (let k = 0; k < n; k++) sides.push(chosen[i]);
  });
  const tile = { sides: rotateSides(sides, Math.floor(rand() * 6)) };
  if (rand() < MISSION_CHANCE) {
    const main = chosen[split.indexOf(Math.max(...split))];
    tile.mission = (options.borderMissions && rand() < 0.35 && generateBorderMission(main, biomeIds, rand)) ||
      generateMission(main, rand);
  }
  return tile;
}

// Misión de frontera: que la región de `biome` de esta loseta toque regiones de
// `other` en `target` aristas o más.
function generateBorderMission(biome, biomeIds, rand) {
  const pairs = BORDER_PAIRS.filter(p => p.includes(biome) && p.every(b => biomeIds.includes(b)));
  if (!pairs.length) return null;
  const pair = pick(pairs, rand);
  return { biome, other: pair[0] === biome ? pair[1] : pair[0], mode: 'frontera', target: 5 + Math.floor(rand() * 3) };
}

// Misión impresa en la loseta: formar una región de su bioma de exactamente
// `target` hexágonos ('exacta') o de `target` o más ('min').
function generateMission(biome, rand) {
  if (rand() < 0.4) return { biome, mode: 'exacta', target: 4 + Math.floor(rand() * 6) };
  return { biome, mode: 'min', target: 6 + Math.floor(rand() * 9) };
}

// Gira los lados `steps` pasos de 60° en sentido horario en pantalla.
// Como los lados van en sentido antihorario, lo que estaba en el lado i+1 pasa al i.
export function rotateSides(sides, steps = 1) {
  const s = ((steps % 6) + 6) % 6;
  return sides.map((_, i) => sides[(i + s) % 6]);
}

function weightedPick(items, rand) {
  const total = items.reduce((sum, it) => sum + it.weight, 0);
  let x = rand() * total;
  for (const it of items) {
    x -= it.weight;
    if (x < 0) return it;
  }
  return items[items.length - 1];
}

// `count` biomas distintos; con pesos, los más pesados salen antes.
function weightedSample(biomeIds, count, weights, rand) {
  if (!weights) return shuffle([...biomeIds], rand).slice(0, count);
  const left = [...biomeIds];
  const chosen = [];
  while (chosen.length < count) {
    const it = weightedPick(left.map(id => ({ id, weight: weights[id] ?? 1 })), rand);
    chosen.push(it.id);
    left.splice(left.indexOf(it.id), 1);
  }
  return chosen;
}

function pick(arr, rand) {
  return arr[Math.floor(rand() * arr.length)];
}

function shuffle(arr, rand) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
