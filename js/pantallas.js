// Recorrido: pantallas en fila, cada una con sus biomas, su aspecto y su lista
// de Pokémon. Se supera una pantalla atrayendo `objetivo` Pokémon distintos de
// su lista en una partida, y eso abre la siguiente. Las estrellas miden cuánto
// de su lista se ha conseguido en total, sumando todas las partidas.

let list = [];

export function setPantallas(data) {
  list = data;
}

export function allPantallas() {
  return list;
}

export function pantallaById(id) {
  return list.find(s => s.id === id) ?? null;
}

export function pantallaIndex(id) {
  return list.findIndex(s => s.id === id);
}

export function nextPantalla(id) {
  return list[pantallaIndex(id) + 1] ?? null;
}

// Opciones de partida que pone la pantalla (las comparte la simulación de
// tools/). `dificultad` endurece las reglas pantalla a pantalla.
export function stageOptions(screen) {
  const d = screen.dificultad;
  return {
    pantalla: screen.id,
    biomeIds: screen.biomas,
    startBiome: screen.inicio,
    deckSize: screen.mazo,
    perfectMin: d.vecinosPerfecta,
    missionReward: d.premioMision,
    thresholdScale: d.escalaRegiones,
    deckOptions: {
      threeBiomeShare: d.tresBiomas,
      borderMissions: d.misionesFrontera,
      weights: Object.keys(screen.pesos).length ? screen.pesos : undefined,
    },
  };
}

// Los Pokémon de la lista que aún no se han conseguido en la pantalla salen
// este número de veces más, para que el 100% no sea pura suerte.
export const UNCAUGHT_BIAS = 3;

// Parte del 100% que da la segunda estrella.
const SILVER_SHARE = 0.6;

function record(save, id) {
  if (!save.pantallas[id]) save.pantallas[id] = { capturados: [], superada: false, mejor: 0 };
  return save.pantallas[id];
}

// La primera siempre está abierta; las demás, al superar la anterior.
export function isUnlocked(save, id) {
  const i = pantallaIndex(id);
  return i === 0 || (i > 0 && Boolean(save.pantallas[list[i - 1].id]?.superada));
}

// Progreso guardado de una pantalla: capturados, estrellas (0 a 3) y lo que
// pide cada una.
export function progress(save, screen) {
  const r = save.pantallas[screen.id] ?? { capturados: [], superada: false, mejor: 0 };
  const total = screen.pokemon.length;
  const caught = r.capturados.filter(id => screen.pokemon.includes(id)).length;
  const silver = Math.ceil(total * SILVER_SHARE);
  let stars = 0;
  if (r.superada) stars = 1 + (caught >= silver) + (caught >= total);
  return { caught, total, silver, stars, superada: r.superada, mejor: r.mejor };
}

// Apunta un Pokémon conseguido en la pantalla. Devuelve true si es nuevo en ella.
export function registerCatch(save, screen, id) {
  if (!screen.pokemon.includes(id)) return false;
  const r = record(save, screen.id);
  if (r.capturados.includes(id)) return false;
  r.capturados.push(id);
  return true;
}

// Distintos de la lista de la pantalla vistos en una partida.
export function distinctInGame(screen, seenIds) {
  return new Set(seenIds.filter(id => screen.pokemon.includes(id))).size;
}

// Cierra una partida de la pantalla. Devuelve si se ha superado ahora por
// primera vez y la pantalla que eso abre, si la hay.
export function finishPantalla(save, screen, seenIds) {
  const r = record(save, screen.id);
  const distinct = distinctInGame(screen, seenIds);
  r.mejor = Math.max(r.mejor, distinct);
  const firstClear = !r.superada && distinct >= screen.objetivo;
  if (firstClear) r.superada = true;
  return { distinct, passed: distinct >= screen.objetivo, firstClear, opened: firstClear ? nextPantalla(screen.id) : null };
}
