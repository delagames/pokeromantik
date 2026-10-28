// Bucle principal, estados, cámara y entrada.

import { HEX_SIZE, hexKey, hexToPixel, pixelToHex, tracePath } from './hex.js';
import { rotateSides } from './deck.js';
import { Game } from './game.js';
import { drawSeams, drawTile, setBiomes } from './tiles.js';
import { drawHand, hitHand, drawScore, drawGoal, drawMissionBadge } from './hud.js';
import {
  drawPokemon, pokemonInfo, pokemonPortrait, setPokemonData, updateNightVisitors, updatePokemon,
} from './pokemon.js';
import { buildTour, downloadMapPNG, mapThumbnail, tourCamera } from './ending.js';
import {
  UNLOCKS, addHistory, addToGallery, exportSave, importSave, loadSave, registerSighting,
  seenCount, unlocked, writeSave,
} from './save.js';
import { closePokedex, openPokedex, setupPokedex } from './pokedex.js';
import {
  allPantallas, distinctInGame, finishPantalla, isUnlocked, nextPantalla, pantallaById, pantallaIndex,
  progress, registerCatch, setPantallas, stageOptions, UNCAUGHT_BIAS,
} from './pantallas.js';
import { setMusic, setMusicLayers, setSfx, sfx, startAudio } from './audio.js';
import { drawParajeLabels, drawParajeLights, drawParajes, resetParajes, updateParajes } from './parajes.js';
import { MOTE_PATTERN, claimMote, cleanMote, flushPending, getRanking, submitScore } from './ranking.js';

const ZOOM_MIN = 0.35;
const ZOOM_MAX = 2.5;
const DRAG_THRESHOLD = 4;     // píxeles antes de considerar que un clic es arrastre
const WHEEL_ROTATE_STEP = 80; // delta de rueda (con Shift) por cada giro de 60°
const BACKGROUND = '#eef0e4';
const DAY_LENGTH = 360;       // segundos de amanecer a amanecer
const DROP_TIME = 0.22;       // caída de la loseta al colocarla
const FLASH_TIME = 1.5;       // destello de misión cumplida
const SPAWN_TIME = 1.2;       // brillo al aparecer un Pokémon
const STAGE_UNDOS = 3;        // veces que se puede deshacer en cada partida del recorrido

const $ = id => document.getElementById(id);
// Pantalla táctil como entrada principal (móvil o tablet).
const TOUCH = window.matchMedia('(pointer: coarse)').matches;
const canvas = $('board');
const ctx = canvas.getContext('2d');
const endPanel = $('end-panel');
const showSummaryButton = $('show-summary');

const camera = { x: 0, y: 0, zoom: 1 };
let baseBiomes = {};          // biomes.json tal cual
let biomes = {};              // los de la partida, con los colores de su pantalla
let stage = null;             // pantalla del recorrido que se juega, o null en partida libre
let background = BACKGROUND;
let backgroundPattern = null;
let save;
let game;
let hovered = null;           // hueco libre bajo el cursor, si lo hay
let tour = null;              // paseo de cámara del final
let drop = null;              // { hex, t0 } loseta recién colocada, para la animación
let flashes = [];             // { hexes, t0 } regiones con misión recién cumplida
// Tamaño real del canvas (en el móvil 100vh es más alto que lo visible) y
// márgenes seguros de la muesca y la barra de inicio, que la interfaz respeta.
const view = { w: window.innerWidth, h: window.innerHeight, top: 0, right: 0, bottom: 0, left: 0 };

// Estados de la partida: 'partida', 'paseo' (cámara final) y 'resumen'.
let state = 'partida';
// Pantalla encima del tablero, si la hay: 'menu', 'pokedex', 'galeria', 'recorrido' o 'ranking'.
// El panel del mote va aparte: se abre encima de cualquiera de ellas.
// Mientras hay una, el tablero no recibe entrada.
let overlay = null;

async function init() {
  $('server-warning').classList.add('hidden');

  const [biomeData, pokemonData, stageData] = await Promise.all([
    fetch('data/biomes.json').then(r => r.json()),
    fetch('data/pokemon.json').then(r => r.json()),
    fetch('data/pantallas.json').then(r => r.json()),
  ]);
  await Promise.all([
    document.fonts.load("800 16px 'Baloo 2'"),
    document.fonts.load("600 13px 'Nunito'"),
  ]).catch(() => {});
  if (TOUCH) document.body.classList.add('touch');
  baseBiomes = biomeData;
  biomes = biomeData;
  setBiomes(biomes);
  setPokemonData(pokemonData);
  setPantallas(stageData);
  save = loadSave();

  resize();
  window.addEventListener('resize', resize);
  window.visualViewport?.addEventListener('resize', resize);
  setupInput();
  setupScreens();

  if (!resumeGame()) newGame(currentStageId());
  setMusicLayers(game.placed);
  document.body.classList.add('inicio');
  openOverlay('menu');
  // En pantallas táctiles pointerdown no cuenta como gesto para el audio:
  // hay que esperar a soltar el dedo. Se reintenta en cada gesto.
  const unlockAudio = () => startAudio(save.settings);
  for (const ev of ['pointerup', 'touchend', 'click', 'keydown']) window.addEventListener(ev, unlockAudio);
  // Sin mote no se juega: es lo que identifica al jugador en el ranking.
  if (!save.mote) openMotePanel(true);
  else sendPending();
  requestAnimationFrame(frame);
}

// Opciones de partida. En el recorrido las pone la pantalla; en partida libre,
// lo desbloqueado en la Pokédex.
function gameOptions(stageId) {
  const s = pantallaById(stageId);
  if (s) {
    return {
      ...stageOptions(s),
      undoLimit: STAGE_UNDOS,
      shinyChance: unlocked(save, 'shiny') ? 0.01 : 0,
      ...stageFilters(s.id),
    };
  }
  return {
    biomeIds: Object.keys(biomes).filter(b => b !== 'volcan' || unlocked(save, 'volcan')),
    deckSize: unlocked(save, 'mazoLargo') ? 60 : 40,
    deckOptions: {
      threeBiomeShare: unlocked(save, 'tresBiomas') ? 20 : 10,
      borderMissions: unlocked(save, 'misionesFrontera'),
    },
    shinyChance: unlocked(save, 'shiny') ? 0.01 : 0,
  };
}

// En una pantalla solo salen los Pokémon de su lista, y los que aún no se han
// conseguido en ella salen más.
function stageFilters(stageId) {
  const s = pantallaById(stageId);
  if (!s) return {};
  return {
    canSpawn: d => s.pokemon.includes(d.id),
    weight: d => (save.pantallas[s.id]?.capturados.includes(d.id) ? 1 : UNCAUGHT_BIAS),
  };
}

// La pantalla por la que va el recorrido: la primera abierta sin superar.
function currentStageId() {
  const list = allPantallas();
  return (list.find(s => isUnlocked(save, s.id) && !save.pantallas[s.id]?.superada) ?? list.at(-1)).id;
}

// Colores de losetas, fondo y textura de la pantalla de la partida.
function applyLook() {
  stage = pantallaById(game.options.pantalla);
  biomes = { ...baseBiomes };
  for (const [id, color] of Object.entries(stage?.colores ?? {})) biomes[id] = { ...biomes[id], color };
  setBiomes(biomes);
  background = stage?.fondo ?? BACKGROUND;
  backgroundPattern = makePattern(stage?.patron, background);
}

function newGame(stageId = null) {
  game = new Game(gameOptions(stageId));
  applyLook();
  game.newInDex = [];                 // ids que esta partida ha añadido a la Pokédex
  game.dexAtStart = seenCount(save);  // para anunciar desbloqueos al final
  camera.x = 0;
  camera.y = 0;
  camera.zoom = 1;
  state = 'partida';
  tour = null;
  endPanel.classList.add('hidden');
  showSummaryButton.classList.add('hidden');
  drop = null;
  flashes = [];
  resetParajes();
  setMusicLayers(0);
  closeOverlay();
  persist();
}

// Retoma la partida guardada si la hay y no estaba terminada.
function resumeGame() {
  const data = save.current;
  if (!data) return false;
  try {
    game = Game.fromJSON(data, stageFilters(data.options?.pantalla));
  } catch {
    return false;
  }
  if (game.over) return false;
  applyLook();
  resetParajes();
  game.newInDex = data.newInDex ?? [];
  game.dexAtStart = data.dexAtStart ?? seenCount(save);
  state = 'partida';
  return true;
}

function persist() {
  save.current = { ...game.toJSON(), newInDex: game.newInDex, dexAtStart: game.dexAtStart };
  writeSave(save);
}

// --- Acciones de juego --------------------------------------------------------

function rotateHand(steps = 1) {
  if (state !== 'partida' || !game.hand) return;
  game.hand.sides = rotateSides(game.hand.sides, steps);
  sfx.rotate();
}

function placeHand(h) {
  if (state !== 'partida') return;
  const result = game.place(h);
  if (!result) return;
  registerSpawned(result.spawned);
  persist();

  drop = { hex: h, t0: performance.now() / 1000 };
  sfx.place();
  if (result.perfect) sfx.perfect();
  if (result.spawned.length) setTimeout(sfx.pokemon, 180);
  for (const m of result.missionsDone) {
    const region = game.missionRegion(m);
    const hexes = (region?.nodes ?? []).map(n => {
      const [q, r] = n.split('|')[0].split(',').map(Number);
      return { q, r };
    });
    flashes.push({ hexes, t0: performance.now() / 1000 });
    setTimeout(sfx.mission, 120);
  }
  setMusicLayers(game.placed);
  if (game.over) endGame();
}

// Apunta en la Pokédex los Pokémon que acaban de aparecer.
function registerSpawned(spawned) {
  for (const p of spawned) {
    const bioma = p.anchors.map(a => a.split('|')[1]).join('+');
    if (registerSighting(save, p.id, bioma, p.shiny)) game.newInDex.push(p.id);
    if (stage) registerCatch(save, stage, p.id);
  }
}

function undo() {
  if (state === 'paseo' || !game.undo()) return;
  sfx.undo();
  drop = null;
  if (state === 'resumen') {
    state = 'partida';
    endPanel.classList.add('hidden');
    showSummaryButton.classList.add('hidden');
  }
  persist();
}

// Fin de partida: se oculta la interfaz y la cámara pasea por el mapa.
function endGame() {
  state = 'paseo';
  hovered = null;
  tour = buildTour(game.board, game.pokemon, { ...camera }, view.w, view.h);
  // Accesibilidad: sin animaciones de cámara, directo al resumen.
  if (save.settings.cameraAnimations === false) showSummary();
}

// Se puede saltar el paseo, pero no en el primer segundo: así un doble clic al
// colocar la última loseta no se lo come.
function skipTour() {
  if (tour.t > 1) showSummary();
}

function showSummary() {
  state = 'resumen';
  tour = null;
  recordGame();

  $('end-stats').innerHTML = `
    <div><strong>${game.placed}</strong> losetas</div>
    <div><strong>${game.seen.length}</strong> Pokémon avistados</div>
    <div><strong>${game.score}</strong> puntos</div>`;
  const newUnlocks = UNLOCKS.filter(u => game.dexAtStart < u.at && seenCount(save) >= u.at);
  $('end-unlocks').textContent = newUnlocks.map(u => `Desbloqueado: ${u.text}`).join(' · ');

  renderStageResult();
  renderEndRanking();

  const list = $('end-pokemon');
  list.replaceChildren();
  for (const id of game.seen) {
    const info = pokemonInfo(id);
    const item = document.createElement('div');
    item.className = 'mon';
    item.title = info.nombre;
    const label = document.createElement('span');
    label.textContent = info.nombre;
    item.append(label);
    if (game.newInDex.includes(id)) {
      const badge = document.createElement('span');
      badge.className = 'new';
      badge.textContent = '¡nuevo!';
      item.append(badge);
    }
    pokemonPortrait(id, 2).then(c => c && item.prepend(c));
    list.append(item);
  }
  endPanel.classList.remove('hidden');
}

// Resultado de la pantalla en el resumen: si se ha superado, estrellas y qué se abre.
function renderStageResult() {
  const box = $('end-stage');
  const next = stage && nextPantalla(stage.id);
  let nextOpen = false;
  box.classList.toggle('hidden', !stage);
  if (stage) {
    const result = finishPantalla(save, stage, game.seen);
    // Si se deshace la última loseta y se vuelve a colocar, el aviso no se pierde.
    game.firstClear ||= result.firstClear;
    nextOpen = Boolean(next && isUnlocked(save, next.id));
    const prog = progress(save, stage);
    box.replaceChildren();
    const title = document.createElement('p');
    title.className = 'stage-result';
    const missing = stage.objetivo - result.distinct;
    title.textContent = result.passed
      ? `${stage.nombre}: ¡superada!`
      : `${stage.nombre}: te ${missing === 1 ? 'faltó 1 Pokémon distinto' : `faltaron ${missing} Pokémon distintos`} para superarla`;
    const stars = document.createElement('p');
    stars.className = 'stars big';
    stars.textContent = starText(prog.stars);
    const detail = document.createElement('p');
    detail.className = 'muted';
    detail.textContent = `${result.distinct} de ${stage.objetivo} en esta partida · ` +
      `${prog.caught} / ${prog.total} conseguidos en la pantalla`;
    box.append(title, stars, detail);
    if (game.firstClear && next) {
      const opened = document.createElement('p');
      opened.className = 'stage-opened';
      opened.textContent = `Se abre ${next.nombre}`;
      box.append(opened);
    }
    persist();
  }
  $('end-route').classList.toggle('hidden', !stage);
  $('end-next').classList.toggle('hidden', !nextOpen);
  if (nextOpen) $('end-next').textContent = `Siguiente: ${next.nombre}`;
  $('new-game').textContent = stage ? 'Repetir' : 'Nueva partida';
  $('new-game').classList.toggle('secondary', nextOpen);
}

function starText(n) {
  return '★'.repeat(n) + '☆'.repeat(3 - n);
}

// Apunta la partida terminada en el historial y la galería, una sola vez.
function recordGame() {
  if (game.recorded) return;
  game.recorded = true;
  const fecha = new Date().toISOString();
  const pantalla = stage?.nombre ?? null;
  // Solo las partidas del recorrido entran en el ranking.
  if (stage) game.ranking = submitScore(save, stage.id, game.score).finally(() => writeSave(save));
  addHistory(save, { fecha, pantalla, puntos: game.score, losetas: game.placed, pokemon: game.seen.length });
  addToGallery(save, {
    fecha, pantalla, puntos: game.score, pokemon: game.seen.length,
    img: mapThumbnail(game.board, c => drawWorld(c, { interactive: false }), background),
  });
  persist();
}

function saveMapImage() {
  const date = new Date().toLocaleDateString('es-ES');
  const where = stage ? ` · ${stage.nombre}` : '';
  downloadMapPNG(game.board, c => drawWorld(c, { interactive: false }),
    `Pokéromantik${where} · ${date} · ${game.score} puntos · ${game.seen.length} Pokémon`, background);
}

// --- Menú, Pokédex y galería ---------------------------------------------------

function setupScreens() {
  $('new-game').addEventListener('click', () => newGame(stage?.id ?? null));
  $('end-next').addEventListener('click', () => newGame(nextPantalla(stage.id).id));
  $('end-route').addEventListener('click', () => openOverlay('recorrido'));
  $('save-png').addEventListener('click', saveMapImage);
  $('view-map').addEventListener('click', () => {
    endPanel.classList.add('hidden');
    showSummaryButton.classList.remove('hidden');
  });
  showSummaryButton.addEventListener('click', () => {
    showSummaryButton.classList.add('hidden');
    endPanel.classList.remove('hidden');
  });

  $('menu-button').addEventListener('click', () => openOverlay('menu'));
  $('undo-button').addEventListener('click', undo);
  $('menu-continue').addEventListener('click', closeOverlay);
  $('menu-new').addEventListener('click', () => newGame(null));
  $('menu-route').addEventListener('click', () => openOverlay('recorrido'));
  $('route-close').addEventListener('click', () => openOverlay('menu'));
  $('stage-close').addEventListener('click', closeStagePanel);
  $('stage-play').addEventListener('click', () => {
    const id = $('stage-panel').dataset.stage;
    closeStagePanel();
    newGame(id);
  });
  $('menu-dex').addEventListener('click', () => openOverlay('pokedex'));
  $('menu-ranking').addEventListener('click', () => openOverlay('ranking'));
  $('ranking-close').addEventListener('click', () => openOverlay('menu'));
  $('ranking-select').addEventListener('change', renderRankingScreen);
  $('menu-change-mote').addEventListener('click', () => openMotePanel(false));
  $('mote-cancel').addEventListener('click', closeMotePanel);
  $('mote-form').addEventListener('submit', e => {
    e.preventDefault();
    saveMote();
  });
  $('menu-gallery').addEventListener('click', () => openOverlay('galeria'));
  $('menu-export').addEventListener('click', () => exportSave(save));
  $('menu-import').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      save = await importSave(file);
      writeSave(save);
      if (!resumeGame()) newGame(currentStageId());
      openOverlay('menu');
      $('menu-message').textContent = 'Guardado importado.';
    } catch (err) {
      $('menu-message').textContent = `No se pudo importar: ${err.message}`;
    }
  });

  for (const [id, key, apply] of [
    ['opt-music', 'music', setMusic],
    ['opt-sfx', 'sfx', setSfx],
    ['opt-camera', 'cameraAnimations', () => {}],
  ]) {
    const box = $(id);
    box.checked = save.settings[key] !== false;
    box.addEventListener('change', () => {
      save.settings[key] = box.checked;
      apply(box.checked);
      writeSave(save);
    });
  }

  setupPokedex(() => openOverlay('menu'));
  $('gallery-close').addEventListener('click', () => openOverlay('menu'));
}

function openOverlay(name) {
  overlay = name;
  hovered = null;
  $('menu').classList.toggle('hidden', name !== 'menu');
  $('gallery').classList.toggle('hidden', name !== 'galeria');
  $('recorrido').classList.toggle('hidden', name !== 'recorrido');
  $('ranking').classList.toggle('hidden', name !== 'ranking');
  if (name !== 'recorrido') closeStagePanel();
  if (name === 'pokedex') openPokedex(save, biomes);
  else closePokedex();
  if (name === 'menu') {
    const seen = seenCount(save);
    const next = UNLOCKS.find(u => u.at > seen);
    const stages = allPantallas();
    const cleared = stages.filter(s => save.pantallas[s.id]?.superada).length;
    const stars = stages.reduce((sum, s) => sum + progress(save, s).stars, 0);
    $('menu-progress').textContent = `Recorrido: ${cleared} / ${stages.length} pantallas · ★ ${stars} / ${stages.length * 3}` +
      ` · Pokédex: ${seen} / 151`;
    $('menu-unlock').textContent = next ? `Partida libre: con ${next.at} en la Pokédex, ${next.text.toLowerCase()}` : '';
    const fresh = game.placed === 0 && state === 'partida';
    $('menu-continue').textContent = `${fresh ? 'Jugar' : 'Continuar'} · ${stage?.nombre ?? 'partida libre'}`;
    // Con una partida a medias, lo primero es seguirla; si no, el recorrido.
    $('menu-route').classList.toggle('secondary', state === 'partida');
  }
  if (name === 'galeria') renderGallery();
  if (name === 'recorrido') renderRoute();
  if (name === 'ranking') openRankingScreen();
  if (name === 'menu') renderMenuRanking();
  // El resumen de fin de partida queda tapado mientras haya otra pantalla.
  const summaryVisible = state === 'resumen' && name === null && showSummaryButton.classList.contains('hidden');
  endPanel.classList.toggle('hidden', !summaryVisible);
}

function closeOverlay() {
  document.body.classList.remove('inicio');
  openOverlay(null);
  $('menu-message').textContent = '';
}

function toggleMenu() {
  if (motePanelOpen()) {
    if (save.mote) closeMotePanel();
  } else if (!$('stage-panel').classList.contains('hidden')) closeStagePanel();
  else if (overlay) closeOverlay();
  else openOverlay('menu');
}

// --- Recorrido -----------------------------------------------------------------

const ROUTE_STEP = 132;  // separación vertical entre pantallas, en píxeles
const ROUTE_SWAY = [50, 76, 50, 24];  // posición horizontal (%) en zigzag

function renderRoute() {
  const stages = allPantallas();
  const map = $('route-map');
  map.replaceChildren();
  const height = ROUTE_STEP * stages.length;
  map.style.height = `${height}px`;
  const points = stages.map((s, i) => ({ x: ROUTE_SWAY[i % ROUTE_SWAY.length], y: ROUTE_STEP * (i + 0.5) }));

  // Camino: una curva suave entre pantallas, continua hasta la última abierta
  // y punteada después.
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 100 ${height}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.classList.add('route-path');
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const mid = (a.y + b.y) / 2;
    const path = document.createElementNS(svgNS, 'path');
    path.setAttribute('d', `M ${a.x} ${a.y} C ${a.x} ${mid}, ${b.x} ${mid}, ${b.x} ${b.y}`);
    path.setAttribute('vector-effect', 'non-scaling-stroke');
    path.classList.toggle('open', isUnlocked(save, stages[i].id));
    svg.append(path);
  }
  map.append(svg);

  const current = currentStageId();
  let total = 0;
  stages.forEach((s, i) => {
    const prog = progress(save, s);
    total += prog.stars;
    const open = isUnlocked(save, s.id);
    const node = document.createElement('button');
    node.className = 'stage';
    node.classList.toggle('locked', !open);
    node.classList.toggle('current', open && s.id === current && !prog.superada);
    node.classList.toggle('complete', prog.stars === 3);
    node.style.left = `${points[i].x}%`;
    node.style.top = `${points[i].y}px`;

    const disc = document.createElement('span');
    disc.className = 'disc';
    // El disco lleva los colores de los biomas de la pantalla, en porciones.
    const colors = s.biomas.map(b => s.colores[b] ?? baseBiomes[b]?.color ?? '#ccc');
    const slice = 100 / colors.length;
    disc.style.background = `conic-gradient(${colors.map((c, k) => `${c} ${k * slice}% ${(k + 1) * slice}%`).join(', ')})`;
    const num = document.createElement('span');
    num.className = 'num';
    num.textContent = open ? String(i + 1) : '🔒';
    disc.append(num);
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = s.nombre;
    const stars = document.createElement('span');
    stars.className = 'stars';
    stars.textContent = open ? starText(prog.stars) : '';
    node.append(disc, label, stars);
    node.addEventListener('click', () => openStagePanel(s.id));
    map.append(node);
  });
  $('route-count').textContent = `★ ${total} / ${stages.length * 3}`;
  requestAnimationFrame(() => map.querySelector('.stage.current')?.scrollIntoView({ block: 'center' }));
}

function openStagePanel(id) {
  const s = pantallaById(id);
  const index = pantallaIndex(s.id);
  const open = isUnlocked(save, s.id);
  const prog = progress(save, s);
  const panel = $('stage-panel');
  panel.dataset.stage = s.id;
  $('stage-name').textContent = `${index + 1}. ${s.nombre}`;
  $('stage-text').textContent = s.texto;

  const chips = $('stage-biomes');
  chips.replaceChildren();
  for (const b of s.biomas) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    const dot = document.createElement('i');
    dot.style.background = s.colores[b] ?? baseBiomes[b].color;
    chip.append(dot, baseBiomes[b].nombre);
    chips.append(chip);
  }
  const info = document.createElement('span');
  info.className = 'muted';
  info.textContent = [`${s.mazo} losetas`, ...(s.noche ? ['con noche'] : []), `deshacer ${STAGE_UNDOS} veces`].join(' · ');
  const rules = document.createElement('span');
  rules.className = 'muted rules';
  rules.textContent = `Loseta extra solo si casan todos los lados y tiene ${s.dificultad.vecinosPerfecta} vecinos o más` +
    ` · Misión cumplida: +${s.dificultad.premioMision} losetas`;
  chips.append(info, rules);

  const goals = $('stage-goals');
  goals.replaceChildren();
  for (const [n, text] of [
    [1, `Superarla: atrae ${s.objetivo} Pokémon distintos en una partida`],
    [2, `Consigue ${prog.silver} de sus ${prog.total} Pokémon`],
    [3, `Consíguelos todos (${prog.total})`],
  ]) {
    const li = document.createElement('li');
    li.classList.toggle('done', prog.stars >= n);
    const mark = document.createElement('span');
    mark.className = 'mark';
    mark.textContent = '★'.repeat(n);
    li.append(mark, ` ${text}`);
    goals.append(li);
  }
  $('stage-caught').textContent = `Conseguidos en esta pantalla: ${prog.caught} / ${prog.total}` +
    (prog.mejor ? ` · Mejor partida: ${prog.mejor}` : '');

  // Lista de la pantalla: los conseguidos con su sprite y el resto en silueta.
  const mons = $('stage-pokemon');
  mons.replaceChildren();
  const caught = save.pantallas[s.id]?.capturados ?? [];
  for (const pid of s.pokemon) {
    const has = caught.includes(pid);
    const cell = document.createElement('div');
    cell.className = `stage-mon${has ? ' caught' : ''}`;
    cell.title = has ? pokemonInfo(pid).nombre : '???';
    pokemonPortrait(pid, 1).then(c => c && cell.append(c));
    mons.append(cell);
  }

  const playing = game.placed > 0 && state === 'partida';
  $('stage-warning').textContent = !open
    ? `Supera ${allPantallas()[index - 1].nombre} para abrir esta pantalla.`
    : playing ? 'Si empiezas aquí, se deja la partida en curso.' : '';
  $('stage-play').disabled = !open;
  $('stage-play').textContent = prog.superada ? 'Jugar otra vez' : 'Jugar';
  panel.classList.remove('hidden');
}

function closeStagePanel() {
  $('stage-panel').classList.add('hidden');
}

// --- Mote y ranking --------------------------------------------------------------

const motePanelOpen = () => !$('mote-panel').classList.contains('hidden');

// `forced`: el jugador aún no tiene mote y no puede cerrar el panel sin elegir uno.
function openMotePanel(forced) {
  $('mote-panel').classList.remove('hidden');
  $('modal-backdrop').classList.remove('hidden');
  $('mote-cancel').classList.toggle('hidden', forced);
  $('mote-error').textContent = '';
  $('mote-input').value = save.mote ?? '';
  $('mote-input').focus();
}

function closeMotePanel() {
  $('mote-panel').classList.add('hidden');
  $('modal-backdrop').classList.add('hidden');
}

async function saveMote() {
  const mote = cleanMote($('mote-input').value);
  const error = $('mote-error');
  if (!MOTE_PATTERN.test(mote)) {
    error.textContent = 'De 2 a 16 letras, números o espacios.';
    return;
  }
  const button = $('mote-save');
  button.disabled = true;
  button.textContent = 'Guardando…';
  let offline = false;
  try {
    await claimMote(save, mote);
  } catch (err) {
    // Sin conexión se acepta el mote; se reserva al mandar la primera puntuación.
    if (err.status) {
      error.textContent = err.status === 409 ? 'Ese mote ya lo tiene otra persona. Prueba con otro.' : err.message;
      button.disabled = false;
      button.textContent = 'Guardar';
      return;
    }
    offline = true;
  }
  button.disabled = false;
  button.textContent = 'Guardar';
  save.mote = mote;
  writeSave(save);
  closeMotePanel();
  if (overlay === 'menu') openOverlay('menu');
  if (offline) $('menu-message').textContent = 'Sin conexión: tu mote se apuntará en el ranking más tarde.';
  sendPending();
  if (state === 'resumen' && stage) {
    game.ranking = getRanking(save, stage.id);
    renderEndRanking();
  }
}

// Manda las puntuaciones que quedaron sin mandar (sin conexión, o mote repetido).
function sendPending() {
  if (!save.mote || !save.rankingPendiente?.length) return;
  flushPending(save).then(() => writeSave(save)).catch(() => {});
}

const formatPoints = n => n.toLocaleString('es-ES');

// Lista ordenada de motes y puntos, con la fila del jugador marcada.
function fillRankingList(list, data, max = Infinity) {
  list.replaceChildren();
  data.top.slice(0, max).forEach((row, i) => {
    const li = document.createElement('li');
    li.classList.toggle('mine', row.tuyo);
    const pos = document.createElement('span');
    pos.className = 'pos';
    pos.textContent = String(i + 1);
    const name = document.createElement('span');
    name.className = 'who';
    name.textContent = row.mote;
    const pts = document.createElement('span');
    pts.className = 'pts';
    pts.textContent = formatPoints(row.puntos);
    li.append(pos, name, pts);
    list.append(li);
  });
}

function youText(data) {
  if (!data.tu) return '';
  return `Tu puesto: ${data.tu.puesto}º de ${data.jugadores} · ${formatPoints(data.tu.puntos)} puntos`;
}

// Ranking de la pantalla en el resumen, con la puntuación recién mandada.
function renderEndRanking() {
  const box = $('end-ranking');
  box.classList.toggle('hidden', !stage || !game.ranking);
  if (!stage || !game.ranking) return;
  box.replaceChildren();
  const title = document.createElement('h3');
  title.textContent = `Ranking de ${stage.nombre}`;
  const status = document.createElement('p');
  status.className = 'muted';
  status.textContent = 'Cargando…';
  const list = document.createElement('ol');
  list.className = 'ranking-list compact';
  box.append(title, status, list);
  const shown = game.ranking;
  shown.then(data => {
    if (game.ranking !== shown) return;
    fillRankingList(list, data, 5);
    status.textContent = youText(data);
  }).catch(err => {
    if (game.ranking !== shown) return;
    status.replaceChildren(err.status === 409
      ? 'Tu mote ya lo tiene otra persona: cámbialo para entrar en el ranking. '
      : 'No se ha podido conectar con el ranking; tu puntuación se mandará más tarde. ');
    if (err.status === 409) {
      const change = document.createElement('button');
      change.className = 'link';
      change.textContent = 'Cambiar mote';
      change.addEventListener('click', () => openMotePanel(false));
      status.append(change);
    }
  });
}

// Podio del ranking total en el menú.
let menuRankingRequest = 0;

function renderMenuRanking() {
  $('menu-player').classList.toggle('hidden', !save.mote);
  $('menu-mote').textContent = save.mote ?? '';
  const box = $('menu-top');
  if (!save.mote) {
    box.replaceChildren();
    return;
  }
  const request = ++menuRankingRequest;
  getRanking(save, 'total').then(data => {
    if (request !== menuRankingRequest) return;
    box.replaceChildren();
    if (!data.top.length) {
      box.textContent = 'Ranking: aún no hay puntuaciones. ¡Sé la primera persona!';
      return;
    }
    const line = document.createElement('span');
    line.textContent = '🏆 ' + data.top.slice(0, 3)
      .map((r, i) => `${i + 1}. ${r.mote} ${formatPoints(r.puntos)}`).join(' · ');
    box.append(line);
    if (data.tu && data.tu.puesto > 3) {
      const you = document.createElement('span');
      you.textContent = ` · tú: ${data.tu.puesto}º`;
      box.append(you);
    }
  }).catch(() => {
    if (request === menuRankingRequest) box.textContent = 'Ranking sin conexión';
  });
}

function openRankingScreen() {
  const select = $('ranking-select');
  if (!select.options.length) {
    select.add(new Option('Total del recorrido', 'total'));
    for (const s of allPantallas()) select.add(new Option(s.nombre, s.id));
  }
  // Abre en la pantalla que se está jugando, si es del recorrido.
  select.value = state === 'resumen' && stage ? stage.id : 'total';
  renderRankingScreen();
}

let rankingRequest = 0;

function renderRankingScreen() {
  const pantalla = $('ranking-select').value;
  const request = ++rankingRequest;
  $('ranking-status').textContent = 'Cargando…';
  $('ranking-you').textContent = '';
  $('ranking-list').replaceChildren();
  getRanking(save, pantalla).then(data => {
    if (request !== rankingRequest) return;
    fillRankingList($('ranking-list'), data);
    $('ranking-status').textContent = data.top.length
      ? (pantalla === 'total' ? 'Suma de la mejor partida de cada pantalla.' : 'Mejor partida de cada jugador.')
      : 'Aún no hay puntuaciones aquí.';
    $('ranking-you').textContent = youText(data);
  }).catch(err => {
    if (request === rankingRequest) $('ranking-status').textContent = err.message;
  });
}

function renderGallery() {
  const grid = $('gallery-grid');
  grid.replaceChildren();
  if (!save.gallery.length) grid.textContent = 'Aún no hay mapas terminados.';
  for (const entry of [...save.gallery].reverse()) {
    const item = document.createElement('div');
    item.className = 'thumb';
    const img = new Image();
    img.src = entry.img;
    img.alt = 'Mapa terminado';
    const text = document.createElement('div');
    const where = entry.pantalla ? `${entry.pantalla} · ` : '';
    text.textContent = `${where}${new Date(entry.fecha).toLocaleDateString('es-ES')} · ${entry.puntos} puntos · ${entry.pokemon} Pokémon`;
    item.append(img, text);
    grid.append(item);
  }
  const body = $('history').querySelector('tbody');
  body.replaceChildren();
  for (const h of [...save.history].reverse()) {
    const row = document.createElement('tr');
    for (const v of [new Date(h.fecha).toLocaleString('es-ES'), h.pantalla ?? 'Libre', h.puntos, h.losetas, h.pokemon]) {
      const td = document.createElement('td');
      td.textContent = v;
      row.append(td);
    }
    body.append(row);
  }
}

// --- Cámara -----------------------------------------------------------------

function resize() {
  const dpr = window.devicePixelRatio || 1;
  view.w = canvas.clientWidth || window.innerWidth;
  view.h = canvas.clientHeight || window.innerHeight;
  // env() no se resuelve leyendo la variable CSS: se mide en #safe-area, que la usa de padding.
  const css = getComputedStyle($('safe-area'));
  for (const side of ['top', 'right', 'bottom', 'left']) {
    view[side] = parseFloat(css.getPropertyValue(`padding-${side}`)) || 0;
  }
  canvas.width = Math.round(view.w * dpr);
  canvas.height = Math.round(view.h * dpr);
}

function screenToWorld(sx, sy) {
  return {
    x: (sx - view.w / 2) / camera.zoom + camera.x,
    y: (sy - view.h / 2) / camera.zoom + camera.y,
  };
}

function hexAtScreen(sx, sy) {
  const w = screenToWorld(sx, sy);
  return pixelToHex(w.x, w.y, HEX_SIZE);
}

// Zoom manteniendo fijo el punto del mundo que está bajo el cursor.
function zoomAt(sx, sy, factor) {
  const before = screenToWorld(sx, sy);
  camera.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, camera.zoom * factor));
  const after = screenToWorld(sx, sy);
  camera.x += before.x - after.x;
  camera.y += before.y - after.y;
}

// --- Entrada ----------------------------------------------------------------

// Ratón y táctil van por los mismos eventos de puntero. Con un dedo (o el
// ratón) se arrastra o se toca; con dos se pellizca para el zoom.
function setupInput() {
  const pointers = new Map(); // pointerId -> { x, y }
  let drag = null;
  let pinch = null;
  let wheelRotate = 0;

  canvas.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      drag = { startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY, moved: false,
        threshold: e.pointerType === 'touch' ? DRAG_THRESHOLD * 2.5 : DRAG_THRESHOLD };
    } else if (pointers.size === 2) {
      drag = null;
      pinch = pinchState(pointers);
    }
  });

  canvas.addEventListener('pointermove', e => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size === 2 && !overlay && state !== 'paseo') {
      const now = pinchState(pointers);
      zoomAt(now.x, now.y, now.dist / pinch.dist);
      camera.x -= (now.x - pinch.x) / camera.zoom;
      camera.y -= (now.y - pinch.y) / camera.zoom;
      pinch = now;
      return;
    }
    if (drag) {
      if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > drag.threshold) {
        drag.moved = true;
        canvas.classList.add('dragging');
      }
      if (drag.moved && state !== 'paseo' && !overlay) {
        camera.x -= (e.clientX - drag.lastX) / camera.zoom;
        camera.y -= (e.clientY - drag.lastY) / camera.zoom;
      }
      drag.lastX = e.clientX;
      drag.lastY = e.clientY;
    }
    if (e.pointerType === 'mouse') updateHover(e.clientX, e.clientY);
  });

  const release = e => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) {
      drag = null;
      canvas.classList.remove('dragging');
    }
  };
  canvas.addEventListener('pointerup', e => {
    if (drag && !drag.moved && pointers.size === 1) handleClick(e.clientX, e.clientY);
    release(e);
  });
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('pointerleave', e => {
    if (e.pointerType === 'mouse') hovered = null;
  });

  // Rueda: zoom. Con Shift: girar la loseta de la mano.
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    if (state === 'paseo' || overlay) return;
    if (e.shiftKey) {
      // Algunos navegadores convierten Shift+rueda en desplazamiento horizontal.
      wheelRotate += e.deltaY || e.deltaX;
      while (Math.abs(wheelRotate) >= WHEEL_ROTATE_STEP) {
        rotateHand(Math.sign(wheelRotate));
        wheelRotate -= Math.sign(wheelRotate) * WHEEL_ROTATE_STEP;
      }
      return;
    }
    zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015));
    updateHover(e.clientX, e.clientY);
  }, { passive: false });

  window.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Escape') {
      toggleMenu();
      return;
    }
    // Escribiendo el mote, las teclas no giran ni deshacen.
    if (overlay || motePanelOpen()) return;
    // Cualquier tecla salta el paseo final.
    if (state === 'paseo') {
      skipTour();
      return;
    }
    const key = e.key.toLowerCase();
    if (key === 'r') rotateHand(e.shiftKey ? -1 : 1);
    else if (key === 'z') undo();
  });
}

function pinchState(pointers) {
  const [a, b] = [...pointers.values()];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) };
}

function handleClick(sx, sy) {
  if (overlay) return;
  if (state === 'paseo') {
    skipTour();
    return;
  }
  if (state === 'partida' && hitHand(sx, sy, view.w - view.right, view.h - view.bottom)) {
    rotateHand();
    return;
  }
  placeHand(hexAtScreen(sx, sy));
  updateHover(sx, sy);
}

function updateHover(sx, sy) {
  if (state !== 'partida' || overlay || hitHand(sx, sy, view.w - view.right, view.h - view.bottom)) {
    hovered = null;
    return;
  }
  const h = hexAtScreen(sx, sy);
  hovered = game.board.isOpenSlot(h) ? h : null;
}

// --- Día y noche ----------------------------------------------------------------

// Oscuridad de 0 (día) a 1 (noche cerrada) según la hora del ciclo. Amanece en
// el instante 0; la noche ocupa más o menos el último tercio del ciclo.
function darkness() {
  if (!nightEnabled()) return 0;
  const phase = (game.clock % DAY_LENGTH) / DAY_LENGTH;
  const night = Math.cos((phase - 0.83) * Math.PI * 2);
  return Math.max(0, Math.min(1, (night - 0.5) / 0.4));
}

// En el recorrido la noche depende de la pantalla; en partida libre, del desbloqueo.
const nightEnabled = () => (stage ? stage.noche : unlocked(save, 'noche'));
const isNight = () => darkness() > 0.5;

let visitorCheck = 0;

// Cada pocos segundos, de noche salen los nocturnos y de día se marchan.
function updateNight(dt) {
  visitorCheck -= dt;
  if (visitorCheck > 0 || state === 'resumen') return;
  visitorCheck = 3;
  const spawned = updateNightVisitors(game, isNight(), Math.random, game.options.canSpawn, game.options.weight);
  if (!spawned.length) return;
  registerSpawned(spawned);
  persist();
}

// --- Dibujo -----------------------------------------------------------------

let lastTime = null;

function frame(now) {
  const dt = lastTime === null ? 0 : Math.min(0.1, (now - lastTime) / 1000);
  lastTime = now;
  game.clock += dt;
  updatePokemon(game, dt, Math.random, isNight());
  updateNight(dt);
  if (updateParajes(game, now / 1000).length && state === 'partida') setTimeout(sfx.paraje, 250);
  if (state === 'paseo') {
    const view = tourCamera(tour, dt);
    if (view) Object.assign(camera, view);
    else showSummary();
  }
  document.body.dataset.state = state;
  render();
  requestAnimationFrame(frame);
}

function render() {
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Transformación mundo -> pantalla.
  ctx.setTransform(
    dpr * camera.zoom, 0, 0, dpr * camera.zoom,
    dpr * (view.w / 2 - camera.x * camera.zoom),
    dpr * (view.h / 2 - camera.y * camera.zoom),
  );
  // La textura del fondo va en coordenadas de mundo para que se mueva con el mapa.
  if (backgroundPattern) {
    const w = view.w / camera.zoom;
    const h = view.h / camera.zoom;
    ctx.fillStyle = backgroundPattern;
    ctx.fillRect(camera.x - w / 2, camera.y - h / 2, w, h);
  }
  drawWorld(ctx, { interactive: state === 'partida' && overlay !== 'menu' });

  // Luz del ciclo de día: un tinte azul que multiplica de noche.
  const dark = darkness();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (dark > 0) {
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = `rgba(70, 82, 150, ${0.55 * dark})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'source-over';
    // Ventanas, faros y lava brillan por encima del tinte.
    ctx.setTransform(
      dpr * camera.zoom, 0, 0, dpr * camera.zoom,
      dpr * (view.w / 2 - camera.x * camera.zoom),
      dpr * (view.h / 2 - camera.y * camera.zoom),
    );
    drawParajeLights(ctx, performance.now() / 1000, dark);
  }

  // Interfaz en coordenadas de pantalla. Durante el paseo final no se ve nada.
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  $('menu-button').classList.toggle('hidden', state === 'paseo' || overlay !== null);
  const undoButton = $('undo-button');
  undoButton.classList.toggle('hidden', state !== 'partida' || overlay !== null || !game.canUndo());
  const undoText = Number.isFinite(game.undosLeft) ? `↶ Deshacer (${game.undosLeft})` : '↶ Deshacer';
  if (undoButton.textContent !== undoText) undoButton.textContent = undoText;
  if (state === 'partida' && overlay !== 'menu') {
    ctx.setTransform(dpr, 0, 0, dpr, dpr * view.left, dpr * view.top);
    drawScore(ctx, game, nightEnabled() ? (isNight() ? '☾ noche' : '☀ día') : '');
    if (stage) {
      const n = distinctInGame(stage, game.seen);
      const done = n >= stage.objetivo;
      drawGoal(ctx, `${stage.nombre} · ${n} / ${stage.objetivo} Pokémon distintos` +
        (done ? ' · ¡superada al acabar el mazo!' : ''), done);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawHand(ctx, game.deck.peek(3), game.deck.length, view.w - view.right, view.h - view.bottom, biomes,
      TOUCH ? 'Toca la loseta para girarla' : 'R girar · Z deshacer');
  }
}

// Dibuja el mapa en coordenadas de mundo. `interactive` añade huecos, vista
// previa, misiones y efectos; sin él queda solo el paisaje con sus Pokémon (para el PNG).
function drawWorld(c, { interactive }) {
  const now = performance.now() / 1000;
  if (interactive) {
    for (const slot of game.board.openSlots()) {
      drawSlot(c, slot, hovered && hexKey(slot) === hexKey(hovered));
    }
  }
  const dropping = interactive && drop && now - drop.t0 < DROP_TIME ? drop : null;
  for (const tile of game.board.tiles.values()) {
    const p = hexToPixel(tile.hex, HEX_SIZE);
    if (dropping && hexKey(tile.hex) === hexKey(dropping.hex)) continue;
    drawTile(c, tile.sides, p.x, p.y, HEX_SIZE);
  }
  drawSeams(c, game.board, dropping ? hexKey(dropping.hex) : null);

  // La loseta recién puesta cae con un pequeño rebote y su sombra se encoge.
  if (dropping) {
    const tile = game.board.get(dropping.hex);
    if (tile) {
      const k = (now - dropping.t0) / DROP_TIME;
      const lift = 14 * (1 - easeOutBack(k));
      const p = hexToPixel(dropping.hex, HEX_SIZE);
      c.fillStyle = `rgba(40, 50, 30, ${0.25 * (1 - k)})`;
      tracePath(c, p.x + 3, p.y + 5, HEX_SIZE * (1 + 0.12 * (1 - k)));
      c.fill();
      drawTile(c, tile.sides, p.x, p.y - lift, HEX_SIZE);
    }
  }

  // Parajes que surgen en las regiones grandes (pueblos, cuevas, dunas…).
  drawParajes(c, now, { animate: interactive });

  // Destello suave en la región de una misión cumplida.
  if (interactive) {
    flashes = flashes.filter(f => now - f.t0 < FLASH_TIME);
    for (const f of flashes) {
      const a = Math.sin(Math.PI * (now - f.t0) / FLASH_TIME) * 0.45;
      c.fillStyle = `rgba(255, 252, 220, ${a})`;
      for (const h of f.hexes) {
        const p = hexToPixel(h, HEX_SIZE);
        tracePath(c, p.x, p.y, HEX_SIZE);
        c.fill();
      }
    }
  }

  // Vista previa de la loseta de la mano sobre el hueco bajo el cursor.
  if (interactive && hovered && game.hand) {
    const p = hexToPixel(hovered, HEX_SIZE);
    c.globalAlpha = 0.75;
    drawTile(c, game.hand.sides, p.x, p.y, HEX_SIZE);
    c.globalAlpha = 1;
  }

  // Pokémon, de atrás hacia delante. Los recién llegados aparecen con un brillo.
  const sorted = [...game.pokemon].sort((a, b) => a.y - b.y);
  for (const p of sorted) {
    const age = game.clock - p.born;
    if (interactive && age >= 0 && age < SPAWN_TIME) {
      drawSparkles(c, p, age / SPAWN_TIME);
      drawPokemon(c, p, game.clock, Math.min(1, age / (SPAWN_TIME * 0.5)));
    } else {
      drawPokemon(c, p, game.clock);
    }
  }

  // Misiones activas, encima de su loseta.
  if (interactive) {
    for (const m of game.missions) {
      if (m.status !== 'activa') continue;
      const p = hexToPixel(m.hex, HEX_SIZE);
      drawMissionBadge(c, m, p.x, p.y - HEX_SIZE * 0.55, biomes, 1);
    }
    drawParajeLabels(c, now, camera.zoom);
  }
}

function drawSparkles(c, p, k) {
  c.save();
  c.globalAlpha = 1 - k;
  c.strokeStyle = '#fff6c8';
  c.lineWidth = 1.5;
  for (let i = 0; i < 6; i++) {
    const angle = i * Math.PI / 3 + k * 2;
    const r = 6 + k * 16;
    const x = p.x + Math.cos(angle) * r;
    const y = p.y - 10 + Math.sin(angle) * r * 0.7;
    const s = 3 * (1 - k) + 1;
    c.beginPath();
    c.moveTo(x - s, y);
    c.lineTo(x + s, y);
    c.moveTo(x, y - s);
    c.lineTo(x, y + s);
    c.stroke();
  }
  c.restore();
}

function easeOutBack(k) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2);
}

// Silueta suave de un hueco donde se puede colocar.
function drawSlot(c, h, isHovered) {
  const p = hexToPixel(h, HEX_SIZE);
  tracePath(c, p.x, p.y, HEX_SIZE * 0.9);
  c.fillStyle = isHovered ? 'rgba(255,255,255,0.65)' : 'rgba(255,255,255,0.35)';
  c.fill();
  c.setLineDash([6, 5]);
  c.lineWidth = 1.5 / camera.zoom;
  c.strokeStyle = isHovered ? 'rgba(90,120,70,0.7)' : 'rgba(90,120,70,0.3)';
  c.stroke();
  c.setLineDash([]);
}

// Textura suave del fondo de cada pantalla, en una baldosa que se repite.
const PATTERN_SIZE = 96;
const PATTERNS = {
  hierba(c, ink, rand) {
    c.strokeStyle = ink;
    c.lineWidth = 1.5;
    for (let i = 0; i < 7; i++) {
      const x = rand() * PATTERN_SIZE;
      const y = rand() * PATTERN_SIZE;
      c.beginPath();
      c.moveTo(x - 3, y - 4); c.lineTo(x - 1, y + 2);
      c.moveTo(x + 3, y - 4); c.lineTo(x + 1, y + 2);
      c.stroke();
    }
  },
  hojas(c, ink, rand) {
    c.fillStyle = ink;
    for (let i = 0; i < 6; i++) {
      c.beginPath();
      c.ellipse(rand() * PATTERN_SIZE, rand() * PATTERN_SIZE, 5, 2.5, rand() * Math.PI, 0, Math.PI * 2);
      c.fill();
    }
  },
  estrellas(c, ink, rand) {
    c.fillStyle = ink;
    for (let i = 0; i < 10; i++) {
      c.beginPath();
      c.arc(rand() * PATTERN_SIZE, rand() * PATTERN_SIZE, 0.6 + rand() * 1.4, 0, Math.PI * 2);
      c.fill();
    }
  },
  adoquines(c, ink) {
    c.strokeStyle = ink;
    c.lineWidth = 1;
    for (let row = 0; row < 4; row++) {
      const y = row * 24;
      c.beginPath();
      c.moveTo(0, y); c.lineTo(PATTERN_SIZE, y);
      for (let x = (row % 2) * 16; x < PATTERN_SIZE; x += 32) { c.moveTo(x, y); c.lineTo(x, y + 24); }
      c.stroke();
    }
  },
  olas(c, ink) {
    c.strokeStyle = ink;
    c.lineWidth = 1.5;
    for (let row = 0; row < 3; row++) {
      const y = 16 + row * 32;
      const x0 = (row % 2) * 24;
      c.beginPath();
      c.moveTo(x0, y);
      c.quadraticCurveTo(x0 + 8, y - 6, x0 + 16, y);
      c.quadraticCurveTo(x0 + 24, y + 6, x0 + 32, y);
      c.stroke();
    }
  },
  niebla(c, ink, rand) {
    c.fillStyle = ink;
    for (let i = 0; i < 3; i++) {
      c.beginPath();
      c.ellipse(rand() * PATTERN_SIZE, rand() * PATTERN_SIZE, 22, 6, 0, 0, Math.PI * 2);
      c.fill();
    }
  },
  ceniza(c, ink, rand) {
    c.fillStyle = ink;
    for (let i = 0; i < 14; i++) c.fillRect(rand() * PATTERN_SIZE, rand() * PATTERN_SIZE, 1.5, 1.5);
  },
  puntos(c, ink) {
    c.fillStyle = ink;
    for (let x = 12; x < PATTERN_SIZE; x += 24) {
      for (let y = 12; y < PATTERN_SIZE; y += 24) {
        c.beginPath();
        c.arc(x, y, 1.5, 0, Math.PI * 2);
        c.fill();
      }
    }
  },
};

function makePattern(kind, base) {
  const paint = PATTERNS[kind];
  if (!paint) return null;
  const tile = document.createElement('canvas');
  tile.width = PATTERN_SIZE;
  tile.height = PATTERN_SIZE;
  // Trazo claro sobre fondo oscuro y oscuro sobre fondo claro.
  const [r, g, b] = [1, 3, 5].map(i => parseInt(base.slice(i, i + 2), 16));
  const ink = r * 0.3 + g * 0.59 + b * 0.11 < 128 ? 'rgba(255,255,255,0.35)' : 'rgba(40,50,30,0.08)';
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  paint(tile.getContext('2d'), ink, rand);
  return ctx.createPattern(tile, 'repeat');
}

init();
