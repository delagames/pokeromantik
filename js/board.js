// Tablero: losetas colocadas indexadas por coordenada axial.

import { hexKey, hexNeighbor, hexNeighbors } from './hex.js';

export class Board {
  constructor() {
    this.tiles = new Map(); // hexKey -> { hex, sides }
    this.slotCache = null;
  }

  get(h) {
    return this.tiles.get(hexKey(h));
  }

  has(h) {
    return this.tiles.has(hexKey(h));
  }

  // sides: seis ids de bioma, en el orden de DIRECTIONS.
  place(h, sides) {
    const tile = { hex: { q: h.q, r: h.r }, sides };
    this.tiles.set(hexKey(h), tile);
    this.slotCache = null;
    return tile;
  }

  remove(h) {
    this.tiles.delete(hexKey(h));
    this.slotCache = null;
  }

  isOpenSlot(h) {
    return this.openSlotMap().has(hexKey(h));
  }

  // Huecos libres adyacentes a alguna loseta: donde se puede colocar.
  openSlots() {
    return [...this.openSlotMap().values()];
  }

  // Regiones: grupos de zonas del mismo bioma conectadas por aristas que casan.
  // Un nodo es "hexKey|bioma" (una loseta de dos biomas aporta dos nodos), y el
  // tamaño de una región es su número de nodos, es decir, de hexágonos.
  regions() {
    const parent = new Map();
    const find = k => {
      while (parent.get(k) !== k) {
        parent.set(k, parent.get(parent.get(k)));
        k = parent.get(k);
      }
      return k;
    };
    const union = (a, b) => parent.set(find(a), find(b));

    for (const [key, tile] of this.tiles) {
      for (const b of new Set(tile.sides)) parent.set(`${key}|${b}`, `${key}|${b}`);
    }
    const open = new Set();
    for (const [key, tile] of this.tiles) {
      tile.sides.forEach((biome, side) => {
        const n = hexNeighbor(tile.hex, side);
        const other = this.get(n);
        if (!other) open.add(`${key}|${biome}`);
        else if (other.sides[(side + 3) % 6] === biome) union(`${key}|${biome}`, `${hexKey(n)}|${biome}`);
      });
    }

    const byRoot = new Map();
    for (const node of parent.keys()) {
      const root = find(node);
      let region = byRoot.get(root);
      if (!region) {
        region = { id: root, biome: node.split('|')[1], nodes: [], size: 0, open: false };
        byRoot.set(root, region);
      }
      region.nodes.push(node);
      region.size++;
      if (open.has(node)) region.open = true;
    }
    const nodeRegion = new Map();
    for (const region of byRoot.values()) {
      for (const node of region.nodes) nodeRegion.set(node, region);
    }
    return { list: [...byRoot.values()], byNode: nodeRegion };
  }

  // Cuántos lados de la loseta en h casan con su vecino, y cuántos tienen vecino.
  matchesAt(h) {
    const tile = this.get(h);
    let matches = 0;
    let neighbors = 0;
    tile.sides.forEach((biome, side) => {
      const other = this.get(hexNeighbor(h, side));
      if (!other) return;
      neighbors++;
      if (other.sides[(side + 3) % 6] === biome) matches++;
    });
    return { matches, neighbors };
  }

  openSlotMap() {
    if (!this.slotCache) {
      const slots = new Map();
      for (const tile of this.tiles.values()) {
        for (const n of hexNeighbors(tile.hex)) {
          const key = hexKey(n);
          if (!this.tiles.has(key)) slots.set(key, n);
        }
      }
      this.slotCache = slots;
    }
    return this.slotCache;
  }
}
