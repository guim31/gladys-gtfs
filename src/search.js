// -----------------------------------------------------------------------------
// Finding a stop by name, or around the home: accents, case and
// punctuation ignored ("jean jaures" finds "Jean Jaurès"), every word of the
// query must start a word of the name, exact names first.
// -----------------------------------------------------------------------------

/** "Jean-Jaurès (Métro)" → "jean jaures metro". */
export function normalize(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Distance in meters between two WGS84 points (haversine). */
export function distanceMeters(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** "350 m", "1.2 km" ("1,2 km" in French, German and Spanish). */
export function formatDistance(meters, language) {
  if (meters < 1000) {
    return `${Math.round(meters / 10) * 10} m`;
  }
  const km = (meters / 1000).toFixed(1);
  return `${language === 'en' ? km : km.replace('.', ',')} km`;
}

/**
 * Items whose name matches the query, best first.
 * @param {Iterable<{ name: string }>} items
 * @param {string} query
 * @param {{ near?: { lat: number, lon: number } | null }} [options]
 */
export function searchByName(items, query, { near = null } = {}) {
  const wanted = normalize(query);
  if (!wanted) {
    return [];
  }
  const words = wanted.split(' ');
  const scored = [];
  for (const item of items) {
    const name = normalize(item.name);
    const nameWords = name.split(' ');
    if (!words.every((word) => nameWords.some((candidate) => candidate.startsWith(word)))) {
      continue;
    }
    const rank = name === wanted ? 0 : name.startsWith(wanted) ? 1 : 2;
    const distance = near && Number.isFinite(item.lat) ? distanceMeters(near, item) : null;
    scored.push({ item, rank, distance });
  }
  return scored
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        (a.distance ?? Infinity) - (b.distance ?? Infinity) ||
        a.item.name.localeCompare(b.item.name, 'fr'),
    )
    .map(({ item, distance }) => ({ item, distance }));
}

/** The items closest to a point. */
export function nearest(items, point, count) {
  const located = [];
  for (const item of items) {
    if (Number.isFinite(item.lat) && Number.isFinite(item.lon)) {
      located.push({ item, distance: distanceMeters(point, item) });
    }
  }
  return located.sort((a, b) => a.distance - b.distance).slice(0, count);
}
