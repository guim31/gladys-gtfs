// -----------------------------------------------------------------------------
// The national catalog of transport.data.gouv.fr: every public transit
// dataset of France with a GTFS timetable, and its GTFS-Realtime feeds.
//
// Public API, no key: GET /api/datasets returns every dataset at once (~800,
// 2.5 MB of JSON). It is read on demand (search, add a network) and kept in
// memory for a day, reduced to one entry per GTFS resource: a dataset may
// publish several (the current and the next timetable, one per operator).
//
// A dataset without GTFS-RT may publish SIRI or SIRI Lite resources instead
// (src/siri.js): kept with the RequestorRef the catalog gives for SIRI (the
// key, when it is public).
// -----------------------------------------------------------------------------

import { getJson } from './http.js';
import { normalize } from './search.js';
import { siriFormat } from './siri.js';

export const CATALOG_URL = 'https://transport.data.gouv.fr/api/datasets';
export const CATALOG_MAX_AGE_MS = 24 * 3600 * 1000;
// GTFS-RT resources worth reading: vehicle positions alone do not give a
// departure time. A resource without features declared is tried.
const USEFUL_FEATURES = new Set(['trip_updates', 'service_alerts']);
export const MAX_REALTIME_FEEDS = 3;
export const MAX_SIRI_ENDPOINTS = 3;

const LICENCES = {
  'odc-odbl': 'ODbL',
  'fr-lo': 'Licence Ouverte',
  lov2: 'Licence Ouverte 2.0',
  'mobility-licence': 'Licence Mobilités',
};

/** The licence of a dataset, readable ("ODbL", "Licence Ouverte"...). */
export function licenceName(code) {
  return LICENCES[code] ?? (code ? String(code) : '');
}

/** The id of a catalog network, "tdg82386": the transport.data.gouv.fr resource id. */
export const catalogNetworkId = (resourceId) => `tdg${resourceId}`;

/** A short name for a network: the one its GTFS declares, its brand, else the dataset title. */
function networkName(dataset, resource) {
  const networks = resource.metadata?.networks ?? [];
  if (networks.length === 1 && networks[0]) {
    return networks[0];
  }
  const brands = [...new Set((dataset.offers ?? []).map((o) => o.nom_commercial).filter(Boolean))];
  if (brands.length === 1) {
    return brands[0];
  }
  // "Réseaux urbains et interurbains d'Île-de-France Mobilités" → "Île-de-France Mobilités".
  const title = String(dataset.title ?? '').trim();
  const short = title
    .replace(
      /^(agr[ée]gat des )?r[ée]seaux?( (urbains?|interurbains?|scolaires?|de transports?|en commun|et))*( (de la|du|des|de)\s|\s(d|l)['’]|\s)/i,
      '',
    )
    .trim();
  return short ? short.charAt(0).toUpperCase() + short.slice(1) : title;
}

/**
 * The catalog, one entry per GTFS resource of a public transit dataset.
 * @returns {{ id: string, dataset: string, name: string, title: string, resource: string,
 *   gtfs: string, realtime: { url: string, features: string[] }[],
 *   siri: { url: string, format: string, requestorRef: string|null }[], modes: string[],
 *   licence: string, page: string, endDate: string|null, haystack: string }[]}
 */
export function reduceCatalog(datasets) {
  const entries = [];
  for (const dataset of Array.isArray(datasets) ? datasets : []) {
    if (dataset?.type !== 'public-transit' || !Array.isArray(dataset.resources)) {
      continue;
    }
    const realtime = dataset.resources
      .filter(
        (r) =>
          r.format === 'gtfs-rt' &&
          r.is_available !== false &&
          /^https?:\/\//.test(r.url ?? '') &&
          (!r.features?.length || r.features.some((f) => USEFUL_FEATURES.has(f))),
      )
      .slice(0, MAX_REALTIME_FEEDS)
      .map((r) => ({
        url: r.url,
        features: (r.features ?? []).filter((f) => USEFUL_FEATURES.has(f)),
      }));
    // Availability is not checked: a SIRI server often answers 401 to the
    // catalog's probe, and the resource stays useful with a key.
    const siri = dataset.resources
      .filter((r) => siriFormat(r.format) && /^https?:\/\//.test(r.url ?? ''))
      .slice(0, MAX_SIRI_ENDPOINTS)
      .map((r) => ({
        url: r.url,
        format: siriFormat(r.format),
        requestorRef: r.requestor_ref || null,
      }));
    for (const resource of dataset.resources) {
      if (resource.format !== 'GTFS' || !/^https?:\/\//.test(resource.url ?? '')) {
        continue;
      }
      const name = networkName(dataset, resource);
      const words = [
        name,
        dataset.title,
        resource.title,
        ...(dataset.offers ?? []).flatMap((o) => [o.nom_commercial, o.nom_aom]),
        ...(dataset.covered_area ?? []).map((a) => a.nom),
        ...(dataset.legal_owners ?? []).map((o) => o.name),
        ...(resource.metadata?.networks ?? []),
      ];
      entries.push({
        id: catalogNetworkId(resource.id),
        dataset: dataset.id,
        name,
        title: String(dataset.title ?? ''),
        resource: String(resource.title ?? ''),
        gtfs: resource.url,
        realtime,
        siri,
        modes: resource.metadata?.modes ?? resource.modes ?? [],
        licence: licenceName(dataset.licence),
        page: dataset.page_url ?? '',
        endDate: resource.metadata?.end_date ?? null,
        available: resource.is_available !== false,
        haystack: normalize(words.filter(Boolean).join(' ')),
      });
    }
  }
  return entries;
}

/**
 * Catalog entries matching a query: every word of the query starts a word of
 * the network's names (brand, title, operator, area). Realtime first.
 */
export function searchCatalog(entries, query) {
  const wanted = normalize(query);
  if (!wanted) {
    return [];
  }
  const words = wanted.split(' ');
  const matches = [];
  for (const entry of entries) {
    const hay = entry.haystack.split(' ');
    if (!words.every((word) => hay.some((candidate) => candidate.startsWith(word)))) {
      continue;
    }
    const name = normalize(entry.name);
    const rank = name === wanted ? 0 : name.startsWith(wanted) ? 1 : 2;
    matches.push({ entry, rank });
  }
  return matches
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        b.entry.realtime.length - a.entry.realtime.length ||
        b.entry.siri.length - a.entry.siri.length ||
        Number(b.entry.available) - Number(a.entry.available) ||
        a.entry.name.localeCompare(b.entry.name, 'fr'),
    )
    .map(({ entry }) => entry);
}

export class Catalog {
  constructor({ fetch, now = Date.now, url = CATALOG_URL }) {
    this.fetch = fetch;
    this.now = now;
    this.url = url;
    this.entries = null;
    this.readAt = null;
  }

  async load() {
    if (this.entries && this.now() - this.readAt < CATALOG_MAX_AGE_MS) {
      return this.entries;
    }
    const datasets = await getJson(this.fetch, this.url, { maxBytes: 20e6, timeoutMs: 30000 });
    this.entries = reduceCatalog(datasets);
    this.readAt = this.now();
    return this.entries;
  }

  async find(id) {
    const entries = await this.load();
    return entries.find((entry) => entry.id.toLowerCase() === String(id).toLowerCase()) ?? null;
  }
}
