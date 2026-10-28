// Estado y reglas de una partida: tablero, mazo, puntuación, misiones y Pokémon.
// Todo el estado es serializable, para deshacer y para guardar.

import { hex, hexKey } from './hex.js';
import { Board } from './board.js';
import { Deck, DECK_SIZE } from './deck.js';
import { regionBorders, spawnBorders, spawnForRegions } from './pokemon.js';

export const POINTS_PER_MATCH = 1;
export const PERFECT_REWARD = 1;  // losetas por colocación perfecta
export const MISSION_REWARD = 3;  // losetas por misión cumplida

// options:
//   biomeIds       biomas que entran en el mazo
//   deckSize       losetas iniciales
//   deckOptions    ver Deck
//   canSpawn(info) filtro de especies (desbloqueos, lista de la pantalla)
//   weight(info)   probabilidad relativa de cada especie
//   shinyChance    probabilidad de variocolor
//   startBiome     bioma de la loseta central
//   pantalla       id de la pantalla del recorrido, o null en partida libre
//   undoLimit      veces que se puede deshacer en la partida, o null sin límite
//   perfectMin     vecinos que hacen falta para que una colocación perfecta dé loseta
//   missionReward  losetas por misión cumplida
//   thresholdScale multiplica el tamaño de región que pide cada Pokémon común y poco común
export class Game {
  constructor(options) {
    this.options = { deckSize: DECK_SIZE, deckOptions: {}, shinyChance: 0, startBiome: 'pradera', pantalla: null, undoLimit: null,
      perfectMin: 1, missionReward: MISSION_REWARD, thresholdScale: 1, ...options };
    this.board = new Board();
    this.board.place(hex(0, 0), Array(6).fill(this.options.startBiome));
    this.deck = new Deck(this.options.biomeIds, this.options.deckSize, this.options.deckOptions);
    this.score = 0;
    this.missions = [];   // { hex, biome, mode, target, progress, status, other? }
    this.placed = 0;
    this.pokemon = [];    // ver createPokemon en pokemon.js
    this.seen = [];       // ids avistados en esta partida, por orden
    this.legends = [];    // biomas cuyo legendario ya ha salido
    this.nextUid = 1;
    this.clock = 0;       // segundos de partida, para animaciones y el ciclo de día
    this.recorded = false; // si ya se apuntó en el historial
    this.ended = false;    // terminada a mano antes de acabar el mazo (partida libre)
    this.undoSnapshot = null;
    this.undosUsed = 0;   // fuera del snapshot: deshacer no devuelve usos
    this.regions = this.board.regions();
  }

  get over() {
    return this.ended || this.deck.length === 0;
  }

  // Termina la partida aunque queden losetas: el mapa se queda como está.
  finish() {
    this.ended = true;
  }

  get hand() {
    return this.deck.tiles[0];
  }

  // Coloca la loseta de la mano en h. Devuelve qué ha pasado, para efectos y sonido.
  place(h) {
    if (this.over || !this.board.isOpenSlot(h)) return null;
    this.undoSnapshot = this.snapshot();

    const tile = this.deck.draw();
    this.board.place(h, tile.sides);
    this.placed++;

    const { matches, neighbors } = this.board.matchesAt(h);
    this.score += matches * POINTS_PER_MATCH;
    const perfect = neighbors >= this.options.perfectMin && matches === neighbors;
    if (perfect) this.deck.addRandom(PERFECT_REWARD);

    if (tile.mission) {
      this.missions.push({ hex: { q: h.q, r: h.r }, ...tile.mission, progress: 0, status: 'activa' });
    }
    this.regions = this.board.regions();
    const missionsDone = this.updateMissions();
    const { canSpawn, weight } = this.options;
    const spawned = [
      ...spawnForRegions(this, Math.random, canSpawn, weight),
      ...spawnBorders(this, Math.random, canSpawn, weight),
    ];
    for (const p of spawned) {
      if (Math.random() < this.options.shinyChance) p.shiny = true;
    }

    return { hex: h, tile, matches, neighbors, perfect, missionsDone, spawned };
  }

  // Revisa las misiones activas contra las regiones actuales.
  updateMissions() {
    const done = [];
    const borders = this.missions.some(m => m.status === 'activa' && m.mode === 'frontera')
      ? regionBorders(this) : null;
    for (const m of this.missions) {
      if (m.status !== 'activa') continue;
      const region = this.missionRegion(m);
      m.progress = !region ? 0 : m.mode === 'frontera' ? borderEdges(borders, region, m.other) : region.size;
      const reached = m.mode === 'exacta' ? m.progress === m.target : m.progress >= m.target;
      if (reached) {
        m.status = 'cumplida';
        m.doneAt = this.clock;
        this.deck.addRandom(this.options.missionReward);
        done.push(m);
      } else if (!region || !region.open || (m.mode === 'exacta' && m.progress > m.target)) {
        // Región cerrada sin cumplir, o pasada de tamaño: la misión desaparece sin penalización.
        m.status = 'fallida';
      }
    }
    return done;
  }

  missionRegion(m) {
    return this.regions.byNode.get(`${hexKey(m.hex)}|${m.biome}`);
  }

  // Usos de deshacer que quedan, o Infinity si no hay límite.
  get undosLeft() {
    const limit = this.options.undoLimit;
    return limit == null ? Infinity : Math.max(0, limit - this.undosUsed);
  }

  canUndo() {
    return this.undoSnapshot !== null && this.undosLeft > 0;
  }

  // Deshace la última colocación. Solo una vez seguida: sirve para corregir un clic.
  undo() {
    if (!this.canUndo()) return false;
    this.restore(this.undoSnapshot);
    this.undoSnapshot = null;
    this.ended = false;
    this.undosUsed++;
    return true;
  }

  snapshot() {
    return JSON.stringify({
      tiles: [...this.board.tiles.values()],
      deck: this.deck.tiles,
      score: this.score,
      missions: this.missions,
      placed: this.placed,
      pokemon: this.pokemon,
      seen: this.seen,
      legends: this.legends,
      nextUid: this.nextUid,
    });
  }

  restore(json) {
    const s = JSON.parse(json);
    this.board = new Board();
    for (const t of s.tiles) this.board.place(t.hex, t.sides);
    this.deck.tiles = s.deck;
    this.score = s.score;
    this.missions = s.missions;
    this.placed = s.placed;
    this.pokemon = s.pokemon;
    this.seen = s.seen;
    this.legends = s.legends;
    this.nextUid = s.nextUid;
    this.regions = this.board.regions();
  }

  // Estado completo para el guardado. canSpawn y weight no se guardan: los pone quien carga.
  toJSON() {
    const { canSpawn, weight, ...options } = this.options;
    return {
      options,
      state: this.snapshot(),
      clock: this.clock,
      recorded: this.recorded,
      ended: this.ended,
      undo: this.undoSnapshot,
      undosUsed: this.undosUsed,
    };
  }

  static fromJSON(data, filters = {}) {
    const game = new Game({ ...data.options, ...filters, deckSize: 0 });
    game.options.deckSize = data.options.deckSize;
    game.restore(data.state);
    game.clock = data.clock ?? 0;
    game.recorded = data.recorded ?? false;
    game.ended = data.ended ?? false;
    game.undoSnapshot = data.undo ?? null;
    game.undosUsed = data.undosUsed ?? 0;
    return game;
  }
}

// Aristas entre la región dada y regiones vecinas del bioma `other`.
function borderEdges(borders, region, other) {
  let edges = 0;
  for (const b of borders.values()) {
    if ((b.a === region && b.b.biome === other) || (b.b === region && b.a.biome === other)) edges += b.edges;
  }
  return edges;
}
