// Guardado en localStorage, exportar e importar, y desbloqueos por avistamientos.
// Todo vive bajo una sola clave como un único JSON (sección Progresión).

const KEY = 'pokeromantik_save';
const VERSION = 1;
const MAX_GALLERY = 40;
const MAX_HISTORY = 200;

// Desbloqueos por Pokémon distintos avistados en total.
export const UNLOCKS = [
  { at: 10, id: 'volcan', text: 'El bioma volcán entra en el mazo' },
  { at: 25, id: 'misionesFrontera', text: 'Misiones de dos biomas' },
  { at: 50, id: 'noche', text: 'Ciclo de noche' },
  { at: 75, id: 'tresBiomas', text: 'Losetas de tres biomas más frecuentes' },
  { at: 100, id: 'mazoLargo', text: 'Mazo largo: 60 losetas iniciales' },
  { at: 151, id: 'shiny', text: 'Pokémon variocolor (1%)' },
];

export function emptySave() {
  return {
    version: VERSION,
    pokedex: {},   // id -> { bioma, fecha, shiny? }
    history: [],   // { fecha, puntos, losetas, pokemon }
    gallery: [],   // { fecha, puntos, pokemon, img (dataURL pequeño) }
    current: null, // partida en curso (Game.toJSON)
    pantallas: {}, // id de pantalla -> { capturados: [ids], superada, mejor }
    settings: {},  // música, efectos, animaciones de cámara
    jugador: null, // id aleatorio para el ranking online
    mote: null,    // nombre en el ranking
    pin: null,     // 4 cifras para recuperar mote y guardado desde otro navegador
    rankingPendiente: [], // { pantalla, puntos } que aún no se han podido mandar
  };
}

export function loadSave() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptySave();
    return normalize(JSON.parse(raw));
  } catch {
    return emptySave();
  }
}

export function writeSave(save) {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
    return true;
  } catch {
    // Sin espacio: se sacrifica la galería antes que la Pokédex o la partida.
    if (save.gallery.length) {
      save.gallery.splice(0, Math.ceil(save.gallery.length / 2));
      return writeSave(save);
    }
    return false;
  }
}

function normalize(data) {
  const save = { ...emptySave(), ...data };
  for (const key of ['pokedex', 'pantallas']) {
    if (typeof save[key] !== 'object' || save[key] === null || Array.isArray(save[key])) save[key] = {};
  }
  for (const key of ['history', 'gallery']) if (!Array.isArray(save[key])) save[key] = [];
  return save;
}

export function seenCount(save) {
  return Object.keys(save.pokedex).length;
}

export function unlocked(save, id) {
  const unlock = UNLOCKS.find(u => u.id === id);
  return seenCount(save) >= unlock.at;
}

// Apunta en la Pokédex un avistamiento. Devuelve true si es nuevo.
export function registerSighting(save, id, bioma, shiny = false) {
  const entry = save.pokedex[id];
  if (entry) {
    if (shiny && !entry.shiny) entry.shiny = true;
    return false;
  }
  save.pokedex[id] = { bioma, fecha: new Date().toISOString(), ...(shiny ? { shiny: true } : {}) };
  return true;
}

export function addHistory(save, entry) {
  save.history.push(entry);
  if (save.history.length > MAX_HISTORY) save.history.splice(0, save.history.length - MAX_HISTORY);
}

export function addToGallery(save, entry) {
  save.gallery.push(entry);
  if (save.gallery.length > MAX_GALLERY) save.gallery.splice(0, save.gallery.length - MAX_GALLERY);
}

export function exportSave(save) {
  const blob = new Blob([JSON.stringify(save, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `pokeromantik-guardado-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Lee un archivo de guardado elegido por el jugador. Rechaza si no lo parece.
export async function importSave(file) {
  const data = JSON.parse(await file.text());
  if (!data || typeof data !== 'object' || !('pokedex' in data)) {
    throw new Error('El archivo no es un guardado de Pokéromantik.');
  }
  return normalize(data);
}

// Lo que se sube al servidor para poder recuperarlo con mote y PIN: todo menos la
// galería (las miniaturas pesan) y lo que es de este navegador.
export function cloudCopy(save) {
  const { gallery, jugador, pin, rankingPendiente, ...rest } = save;
  return rest;
}

// Junta el guardado recuperado del servidor con lo jugado aquí desde que se
// perdió: la Pokédex y el recorrido se suman, y manda la partida en curso de antes.
export function mergeSave(local, remote) {
  const save = normalize({ ...local, ...remote, gallery: local.gallery });
  save.jugador = local.jugador;
  save.mote = local.mote;
  save.pin = local.pin;
  save.rankingPendiente = local.rankingPendiente;
  save.pokedex = { ...local.pokedex, ...save.pokedex };
  for (const [id, mine] of Object.entries(local.pantallas)) {
    const theirs = save.pantallas[id];
    save.pantallas[id] = !theirs ? mine : {
      ...theirs,
      capturados: [...new Set([...theirs.capturados, ...mine.capturados])],
      superada: theirs.superada || mine.superada,
      mejor: Math.max(theirs.mejor, mine.mejor),
    };
  }
  const dates = new Set(save.history.map(h => h.fecha));
  save.history = [...save.history, ...local.history.filter(h => !dates.has(h.fecha))]
    .sort((a, b) => a.fecha.localeCompare(b.fecha)).slice(-MAX_HISTORY);
  save.current = remote.current ?? local.current;
  return save;
}
