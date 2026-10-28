// Pantalla de Pokédex: los 151 en cuadrícula, con filtros por bioma y por visto.

import { pokemonInfo, pokemonPortrait } from './pokemon.js';

const TOTAL = 151;
const screen = document.getElementById('pokedex');
const grid = document.getElementById('dex-grid');
const biomeFilter = document.getElementById('dex-biome');
const seenFilter = document.getElementById('dex-seen');
const portraits = new Map(); // id -> canvas, para no recortar dos veces

let currentSave = null;
let currentBiomes = {};

export function setupPokedex(onClose) {
  document.getElementById('dex-close').addEventListener('click', onClose);
  biomeFilter.addEventListener('change', applyFilters);
  seenFilter.addEventListener('change', applyFilters);
}

export function openPokedex(save, biomes) {
  currentSave = save;
  currentBiomes = biomes;
  if (biomeFilter.options.length === 1) {
    for (const [id, b] of Object.entries(biomes)) biomeFilter.add(new Option(b.nombre, id));
  }
  const seen = Object.keys(save.pokedex).length;
  document.getElementById('dex-count').textContent = `${seen} / ${TOTAL}`;
  render();
  screen.classList.remove('hidden');
}

export function closePokedex() {
  screen.classList.add('hidden');
}

export function pokedexOpen() {
  return !screen.classList.contains('hidden');
}

function render() {
  grid.replaceChildren();
  for (let id = 1; id <= TOTAL; id++) {
    const info = pokemonInfo(id);
    const entry = currentSave.pokedex[id];
    const cell = document.createElement('div');
    cell.className = `dex-cell${entry ? ' seen' : ''}`;
    cell.dataset.biomas = [info.bioma, ...(info.frontera ?? [])].join(' ');

    const num = document.createElement('span');
    num.className = 'dex-num';
    num.textContent = `#${String(id).padStart(3, '0')}`;
    const pic = document.createElement('div');
    pic.className = 'dex-pic';
    const name = document.createElement('span');
    name.className = 'dex-name';
    name.textContent = entry ? info.nombre : '???';
    cell.append(num, pic, name);

    if (entry) {
      const where = document.createElement('span');
      where.className = 'dex-where';
      const biome = entry.bioma.split('+').map(b => currentBiomes[b]?.nombre ?? b).join(' y ');
      where.textContent = `${biome} · ${new Date(entry.fecha).toLocaleDateString('es-ES')}`;
      cell.append(where);
      if (entry.shiny) cell.classList.add('shiny');
      if (info.nocturno) cell.title = 'Solo sale de noche';
    }
    portrait(id).then(c => c && pic.append(copyCanvas(c)));
    grid.append(cell);
  }
  applyFilters();
}

async function portrait(id) {
  if (!portraits.has(id)) portraits.set(id, pokemonPortrait(id, 2));
  return portraits.get(id);
}

function copyCanvas(c) {
  const copy = document.createElement('canvas');
  copy.width = c.width;
  copy.height = c.height;
  copy.getContext('2d').drawImage(c, 0, 0);
  return copy;
}

function applyFilters() {
  const biome = biomeFilter.value;
  const seen = seenFilter.value;
  for (const cell of grid.children) {
    const isSeen = cell.classList.contains('seen');
    const show = (!biome || cell.dataset.biomas.split(' ').includes(biome)) &&
      (seen === 'todos' || (seen === 'vistos') === isSeen);
    cell.classList.toggle('hidden', !show);
  }
}
