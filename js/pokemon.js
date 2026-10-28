// Aparición, movimiento y animación de los Pokémon.
//
// La lógica (aparición y paseo) es pura y vive en el estado serializable de la
// partida. Las imágenes se cargan solo al dibujar, la primera vez que hacen falta.

import { HEX_SIZE, hexKey, hexNeighbor, hexToPixel, sideCorners } from './hex.js';

// Umbrales de tamaño de región y rareza que traen (sección Biomas).
export const THRESHOLDS = [
  { size: 3, rareza: 1 },
  { size: 6, rareza: 1 },
  { size: 10, rareza: 2 },
  { size: 15, rareza: 2 },
  { size: 22, rareza: 3 },
  { size: 30, rareza: 4 },
];

// Pantallas más difíciles piden regiones más grandes para los comunes y poco
// comunes. Raros y legendarios se quedan en 22 y 30: ya cuestan, y así el orden
// de los umbrales no cambia.
const MAX_SCALED = 21;

export function scaledThresholds(scale) {
  if (scale === 1) return THRESHOLDS;
  return THRESHOLDS.map(t => (t.rareza >= 3 ? t : { ...t, size: Math.min(MAX_SCALED, Math.round(t.size * scale)) }));
}

// Puntos al aparecer, por rareza (sección Puntuación).
export const SPAWN_POINTS = { 1: 10, 2: 10, 3: 20, 4: 50 };

const WALK_SPEED = 22;   // unidades de mundo por segundo
const SPRITE_PATH = 'assets/sprites';

let dex = [];

export function setPokemonData(list) {
  dex = list;
}

export function pokemonInfo(id) {
  return dex[id - 1];
}

// --- Aparición -----------------------------------------------------------------

// Recorre las regiones y hace aparecer los Pokémon que les falten según su tamaño.
// Devuelve los nuevos. `canSpawn` filtra especies (desbloqueos, lista de la
// pantalla) y `weight` da más probabilidad a unas que a otras; los dos son opcionales.
export function spawnForRegions(game, rand = Math.random, canSpawn = () => true, weight = () => 1) {
  const spawned = [];
  const residents = new Map(); // id de región -> Pokémon que viven en ella
  for (const p of game.pokemon) {
    if (p.kind !== 'region') continue;
    const region = game.regions.byNode.get(p.anchors[0]);
    if (!region) continue;
    if (!residents.has(region.id)) residents.set(region.id, []);
    residents.get(region.id).push(p);
  }

  const thresholds = scaledThresholds(game.options?.thresholdScale ?? 1);
  for (const region of game.regions.list) {
    const living = residents.get(region.id) ?? [];
    const due = thresholds.filter(t => region.size >= t.size);
    for (let i = living.length; i < due.length; i++) {
      const rareza = due[i].rareza;
      const info = pickSpecies(region.biome, rareza, living, game, rand, canSpawn, weight);
      if (!info) continue;
      if (info.rareza === 4) game.legends.push(region.biome);
      const node = region.nodes[Math.floor(rand() * region.nodes.length)];
      const p = createPokemon(game, info, 'region', [node], node, rand);
      living.push(p);
      spawned.push(p);
    }
  }
  return spawned;
}

// Elige especie del bioma y rareza pedidos, sin repetir dentro de la región.
// Si no hay ninguna (p. ej. legendario ya visto o bioma sin legendario), baja de
// rareza; si tampoco, sube sin llegar a legendario (pantallas con pocas especies).
function pickSpecies(biome, rareza, living, game, rand, canSpawn, weight) {
  const taken = new Set(living.map(p => p.id));
  const order = [];
  for (let r = rareza; r >= 1; r--) order.push(r);
  for (let r = rareza + 1; r <= 3; r++) order.push(r);
  for (const r of order) {
    if (r === 4 && game.legends.includes(biome)) continue;
    const pool = dex.filter(d => d.bioma === biome && d.rareza === r && !d.nocturno &&
      !taken.has(d.id) && canSpawn(d));
    if (pool.length) return weightedPick(pool, rand, weight);
  }
  return null;
}

function weightedPick(pool, rand, weight) {
  const weights = pool.map(d => weight(d));
  let x = rand() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pool.length; i++) {
    x -= weights[i];
    if (x < 0) return pool[i];
  }
  return pool[pool.length - 1];
}

// Fronteras: si dos regiones de biomas distintos comparten al menos
// BORDER_MIN_EDGES aristas y el par tiene Pokémon de frontera definidos,
// aparece uno que pasea por las dos. Uno por cada par de regiones.
export const BORDER_MIN_EDGES = 4;

export function spawnBorders(game, rand = Math.random, canSpawn = () => true, weight = () => 1) {
  const borders = regionBorders(game);
  const spawned = [];
  const occupied = new Set();
  for (const p of game.pokemon) {
    if (p.kind !== 'frontera') continue;
    const ids = p.anchors.map(a => game.regions.byNode.get(a)?.id);
    occupied.add(ids.sort().join('~'));
  }
  for (const [key, border] of borders) {
    if (border.edges < BORDER_MIN_EDGES || occupied.has(key)) continue;
    const pair = [border.a.biome, border.b.biome].sort().join('+');
    const pool = dex.filter(d => d.frontera && [...d.frontera].sort().join('+') === pair && canSpawn(d));
    if (!pool.length) continue;
    const info = weightedPick(pool, rand, weight);
    spawned.push(createPokemon(game, info, 'frontera', [border.nodeA, border.nodeB], border.nodeA, rand));
    occupied.add(key);
  }
  return spawned;
}

// Aristas compartidas entre cada par de regiones de biomas distintos.
// Devuelve Map "idA~idB" -> { a, b, edges, nodeA, nodeB } (nodos a ambos lados de una de ellas).
export function regionBorders(game) {
  const borders = new Map();
  for (const [key, tile] of game.board.tiles) {
    tile.sides.forEach((biome, side) => {
      const n = hexNeighbor(tile.hex, side);
      const other = game.board.get(n);
      if (!other) return;
      const otherBiome = other.sides[(side + 3) % 6];
      if (otherBiome === biome) return;
      const nodeA = `${key}|${biome}`;
      const nodeB = `${hexKey(n)}|${otherBiome}`;
      const ra = game.regions.byNode.get(nodeA);
      const rb = game.regions.byNode.get(nodeB);
      if (ra.id > rb.id) return; // cada arista se cuenta una vez, desde la región de id menor
      const k = `${ra.id}~${rb.id}`;
      if (!borders.has(k)) borders.set(k, { a: ra, b: rb, edges: 0, nodeA, nodeB });
      borders.get(k).edges++;
    });
  }
  return borders;
}

export function createPokemon(game, info, kind, anchors, node, rand) {
  const pos = nodePoint(game.board, node, rand);
  const p = {
    uid: game.nextUid++,
    id: info.id,
    kind,
    anchors,
    node,
    x: pos.x,
    y: pos.y,
    tx: pos.x,
    ty: pos.y,
    state: 'idle',
    timer: 1 + rand() * 2,
    dir: 0,
    born: game.clock,
  };
  game.pokemon.push(p);
  // Los visitantes nocturnos son ambiente: no puntúan (sección Noche).
  if (kind !== 'visitante') game.score += SPAWN_POINTS[info.rareza];
  if (!game.seen.includes(info.id)) game.seen.push(info.id);
  return p;
}

// --- Noche ---------------------------------------------------------------------

// De noche, los Pokémon nocturnos salen a pasear: uno por región de su bioma con
// al menos 3 hexágonos, y más raro cuanto mayor es la región. Al amanecer se van.
// Devuelve los que acaban de salir.
export function updateNightVisitors(game, isNight, rand = Math.random, canSpawn = () => true, weight = () => 1) {
  if (!isNight) {
    game.pokemon = game.pokemon.filter(p => p.kind !== 'visitante');
    return [];
  }
  const visited = new Set(game.pokemon
    .filter(p => p.kind === 'visitante')
    .map(p => game.regions.byNode.get(p.anchors[0])?.id));
  const spawned = [];
  for (const region of game.regions.list) {
    if (region.size < 3 || visited.has(region.id)) continue;
    const maxRareza = region.size >= 22 ? 3 : region.size >= 10 ? 2 : 1;
    const pool = dex.filter(d => d.nocturno && d.bioma === region.biome && d.rareza <= maxRareza && canSpawn(d));
    if (!pool.length) continue;
    const info = weightedPick(pool, rand, weight);
    const node = region.nodes[Math.floor(rand() * region.nodes.length)];
    spawned.push(createPokemon(game, info, 'visitante', [node], node, rand));
  }
  return spawned;
}

// --- Movimiento ----------------------------------------------------------------

// Un punto dentro de la zona del bioma del nodo ("hexKey|bioma") en su loseta.
export function nodePoint(board, node, rand) {
  const [key, biome] = node.split('|');
  const [q, r] = key.split(',').map(Number);
  const tile = board.get({ q, r });
  const c = hexToPixel({ q, r }, HEX_SIZE);
  if (!tile) return c;
  const sides = tile.sides.map((b, i) => (b === biome ? i : -1)).filter(i => i >= 0);
  let x = 0;
  let y = 0;
  for (const side of sides) {
    const [a, b] = sideCorners(side, HEX_SIZE);
    x += (a.x + b.x) / 2;
    y += (a.y + b.y) / 2;
  }
  // Centro de los lados del bioma, recogido hacia dentro, con algo de azar.
  const pull = sides.length === 6 ? 0 : 0.45;
  const jitter = HEX_SIZE * (sides.length === 6 ? 0.45 : 0.2);
  return {
    x: c.x + (x / sides.length) * pull + (rand() - 0.5) * jitter,
    y: c.y + (y / sides.length) * pull + (rand() - 0.5) * jitter,
  };
}

// Nodos a los que un Pokémon puede pasar desde `node` sin salir de sus regiones:
// las otras zonas de la misma loseta y la zona vecina al otro lado de cada arista
// de su bioma.
function nodeNeighbors(game, node, allowed) {
  const [key, biome] = node.split('|');
  const [q, r] = key.split(',').map(Number);
  const tile = game.board.get({ q, r });
  if (!tile) return [];
  const out = new Set();
  for (const b of tile.sides) out.add(`${key}|${b}`);
  tile.sides.forEach((b, side) => {
    if (b !== biome) return;
    const n = hexNeighbor({ q, r }, side);
    const other = game.board.get(n);
    if (other) out.add(`${hexKey(n)}|${other.sides[(side + 3) % 6]}`);
  });
  out.delete(node);
  return [...out].filter(nd => allowed.has(game.regions.byNode.get(nd)?.id));
}

function allowedRegions(game, p) {
  return new Set(p.anchors.map(a => game.regions.byNode.get(a)?.id).filter(Boolean));
}

// Avanza el paseo de todos los Pokémon `dt` segundos.
export function updatePokemon(game, dt, rand = Math.random, isNight = false) {
  for (const p of game.pokemon) {
    const info = pokemonInfo(p.id);
    const awake = !info || info.nocturno === isNight || p.kind === 'visitante';
    if (!awake && p.state !== 'walk') {
      p.state = 'sleep';
      continue;
    }

    if (p.state === 'walk') {
      const dx = p.tx - p.x;
      const dy = p.ty - p.y;
      const dist = Math.hypot(dx, dy);
      const step = WALK_SPEED * dt;
      if (dist <= step) {
        p.x = p.tx;
        p.y = p.ty;
        p.state = rand() < 0.15 ? 'sleep' : 'idle';
        p.timer = p.state === 'sleep' ? 6 + rand() * 8 : 1.5 + rand() * 4;
      } else {
        p.x += (dx / dist) * step;
        p.y += (dy / dist) * step;
        p.dir = directionRow(dx, dy);
      }
      continue;
    }

    p.timer -= dt;
    if (p.timer > 0) continue;

    // Siguiente destino: una zona vecina de su región o, a veces, otro punto de la misma.
    const options = nodeNeighbors(game, p.node, allowedRegions(game, p));
    if (options.length && rand() < 0.75) p.node = options[Math.floor(rand() * options.length)];
    const target = nodePoint(game.board, p.node, rand);
    p.tx = target.x;
    p.ty = target.y;
    p.state = 'walk';
  }
}

// Fila de la hoja de sprites de SpriteCollab según la dirección del movimiento:
// 0 abajo, 1 abajo-dcha, 2 dcha, 3 arriba-dcha, 4 arriba, 5 arriba-izda, 6 izda, 7 abajo-izda.
function directionRow(dx, dy) {
  const octant = (Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8;
  return [2, 1, 0, 7, 6, 5, 4, 3][octant];
}

// --- Dibujo --------------------------------------------------------------------

const sprites = new Map();  // carpeta -> { anims } | 'cargando' | 'error'
const loading = new Map();  // carpeta -> promesa de carga

function spriteFolder(id) {
  return pokemonInfo(id)?.sprites ?? String(id).padStart(4, '0');
}

function loadSprites(folder) {
  if (loading.has(folder)) return loading.get(folder);
  sprites.set(folder, 'cargando');
  const base = `${SPRITE_PATH}/${folder}`;
  const promise = fetch(`${base}/AnimData.xml`)
    .then(r => (r.ok ? r.text() : Promise.reject(new Error(r.status))))
    .then(async text => {
      const xml = new DOMParser().parseFromString(text, 'application/xml');
      const anims = {};
      await Promise.all([...xml.querySelectorAll('Anim')].map(el => new Promise(resolve => {
        const name = el.querySelector('Name').textContent;
        const img = new Image();
        img.onload = () => {
          const fw = Number(el.querySelector('FrameWidth').textContent);
          const fh = Number(el.querySelector('FrameHeight').textContent);
          const durations = [...el.querySelectorAll('Duration')].map(d => Number(d.textContent));
          anims[name] = { img, fw, fh, durations, total: durations.reduce((a, b) => a + b, 0),
            rows: Math.max(1, Math.round(img.height / fh)) };
          resolve();
        };
        img.onerror = resolve;
        img.src = `${base}/${name}-Anim.png`;
      })));
      sprites.set(folder, Object.keys(anims).length ? { anims } : 'error');
    })
    .catch(() => sprites.set(folder, 'error'))
    .then(() => sprites.get(folder));
  loading.set(folder, promise);
  return promise;
}

// Retrato: primer fotograma de Idle mirando abajo, recortado y ampliado `scale` veces.
// Devuelve un canvas, o null si no hay sprite.
export async function pokemonPortrait(id, scale = 2) {
  const data = await loadSprites(spriteFolder(id));
  const anim = typeof data === 'object' ? (data.anims.Idle ?? data.anims.Walk) : null;
  if (!anim) return null;
  const c = document.createElement('canvas');
  c.width = anim.fw * scale;
  c.height = anim.fh * scale;
  const cctx = c.getContext('2d');
  cctx.imageSmoothingEnabled = false;
  cctx.drawImage(anim.img, 0, 0, anim.fw, anim.fh, 0, 0, c.width, c.height);
  return c;
}

const ANIM_FOR_STATE = { walk: 'Walk', idle: 'Idle', sleep: 'Sleep' };

// Dibuja un Pokémon con los pies en (p.x, p.y). `time` en segundos.
export function drawPokemon(ctx, p, time, alpha = 1) {
  const info = pokemonInfo(p.id);
  const folder = spriteFolder(p.id);
  if (!sprites.has(folder)) loadSprites(folder);
  const data = sprites.get(folder);

  ctx.save();
  ctx.globalAlpha = alpha;
  // Sombra.
  ctx.fillStyle = 'rgba(40,50,30,0.22)';
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, 8, 3.5, 0, 0, Math.PI * 2);
  ctx.fill();

  if (typeof data !== 'object') {
    // Sin sprite (cargando o no existe): un círculo con la inicial.
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.arc(p.x, p.y - 8, 7, 0, Math.PI * 2);
    ctx.fill();
    if (data === 'error' && info) {
      ctx.fillStyle = '#3d4436';
      ctx.font = '600 9px Nunito, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(info.nombre[0], p.x, p.y - 8);
    }
    ctx.restore();
    return;
  }

  const anim = data.anims[ANIM_FOR_STATE[p.state]] ?? data.anims.Idle ?? data.anims.Walk;
  // Las duraciones vienen en fotogramas del juego original (60 por segundo).
  let tick = Math.floor((time + p.uid * 0.37) * 60) % anim.total;
  let frame = 0;
  while (tick >= anim.durations[frame]) tick -= anim.durations[frame++];
  const row = Math.min(p.dir, anim.rows - 1);

  ctx.imageSmoothingEnabled = false;
  // Variocolor: un giro de tono basta para distinguirlo sin hojas de sprites aparte.
  if (p.shiny) ctx.filter = 'hue-rotate(150deg) saturate(1.3)';
  // En SpriteCollab el personaje está centrado en el fotograma; sus pies quedan
  // un poco por debajo del centro.
  ctx.drawImage(anim.img, frame * anim.fw, row * anim.fh, anim.fw, anim.fh,
    Math.round(p.x - anim.fw / 2), Math.round(p.y - anim.fh / 2 - 6), anim.fw, anim.fh);
  ctx.restore();
}
