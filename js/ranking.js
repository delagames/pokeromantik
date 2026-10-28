// Ranking online: mote del jugador y mejores puntuaciones por pantalla.
// Habla con la función de netlify/functions/ranking.mjs, que sigue en Netlify
// aunque el juego se publique en GitHub Pages. Si no hay conexión
// (o se juega en local sin servidor), las puntuaciones esperan en el guardado
// y se mandan la próxima vez.

const API = location.hostname.endsWith('github.io') ? 'https://pokeromantik.netlify.app/api/ranking' : 'api/ranking';
const TIMEOUT = 8000;

async function call(options = {}, query = '') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const response = await fetch(API + query, { ...options, signal: controller.signal });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data) {
      const err = new Error(data?.error ?? 'El ranking no está disponible ahora');
      err.status = response.status;
      throw err;
    }
    return data;
  } catch (err) {
    if (err.status) throw err;
    throw new Error('Sin conexión con el ranking');
  } finally {
    clearTimeout(timer);
  }
}

function post(body) {
  return call({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

// Id aleatorio del jugador, creado una vez y guardado con la partida.
export function playerId(save) {
  if (!save.jugador) save.jugador = crypto.randomUUID?.() ?? `j-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return save.jugador;
}

export const MOTE_PATTERN = /^[\p{L}\p{N} _.\-]{2,16}$/u;

export function cleanMote(raw) {
  return String(raw ?? '').trim().replace(/\s+/g, ' ');
}

// Reserva el mote. Lanza un error con `status` 409 si ya es de otra persona.
export function claimMote(save, mote) {
  return post({ accion: 'mote', jugador: playerId(save), mote });
}

// { top: [{ mote, puntos, tuyo }], tu: { puesto, puntos } | null, jugadores }
export function getRanking(save, pantalla) {
  const q = `?pantalla=${encodeURIComponent(pantalla)}&jugador=${encodeURIComponent(playerId(save))}`;
  return call({}, q);
}

// Apunta la puntuación de una partida del recorrido; si falla, queda pendiente.
export async function submitScore(save, pantalla, puntos) {
  save.rankingPendiente = [...(save.rankingPendiente ?? []), { pantalla, puntos }];
  await flushPending(save);
  return getRanking(save, pantalla);
}

// Manda las puntuaciones que no se pudieron mandar. Devuelve true si no queda ninguna.
export async function flushPending(save) {
  const pending = save.rankingPendiente ?? [];
  while (pending.length) {
    const { pantalla, puntos } = pending[0];
    try {
      await post({ accion: 'puntos', jugador: playerId(save), mote: save.mote, pantalla, puntos });
    } catch (err) {
      // 400: la puntuación no vale y no valdrá nunca; el resto se reintenta luego.
      if (err.status === 400) {
        pending.shift();
        continue;
      }
      throw err;
    }
    pending.shift();
  }
  save.rankingPendiente = pending;
  return true;
}
