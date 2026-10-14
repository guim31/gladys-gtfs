// -----------------------------------------------------------------------------
// The SIRI realtime of one network (src/siri.js speaks the protocol): used
// when the network publishes no GTFS-RT. SIRI is asked stop by stop, so:
//
// - one StopMonitoring request per watched stop point and per refresh, only
//   for the stops with a departure scheduled within 90 minutes (every 15
//   minutes otherwise, as the GTFS-RT at night); disruptions (GeneralMessage,
//   else SituationExchange) every 5 minutes at most;
// - a 429 stops every request to the network for its Retry-After (5 minutes
//   by default); the realtime proxy of transport.data.gouv.fr gets one
//   request per URL every 30 seconds at most (its limit).
//
// Stops: the server knows them by its own reference (MonitoringRef). Tried in
// order: the one the user typed for the stop; the one StopPointsDiscovery
// lists for the GTFS stop point (same code, same local part, else same name
// within 100 m); else the GTFS stop_code, then stop_id. A reference the
// server says it does not know moves to the next candidate.
//
// Visits: matched to the line groups of the timetable (src/departures.js), by
// line (reference, its local part or published name against the route id or
// short name) and direction (the stop point's, the only one served, the
// destination, else Aller/Retour). The board then shows them in place of the
// timetable's for that line and direction (src/departures.js mergeVisits).
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLogger } from '@gladysassistant/integration-sdk';
import { indexRealtime } from './departures.js';
import { getBuffer, hostOf, isRedirectHost, resolveRedirects } from './http.js';
import { distanceMeters, normalize } from './search.js';
import {
  LITE_SERVICES,
  codeKey,
  isAccessError,
  isReferenceError,
  isUnsupportedError,
  localRef,
  NotSiriError,
  parseSiri,
  readSituations,
  readStopPoints,
  readStopVisits,
  redact,
  responseTime,
  siriEndpoint,
  siriError,
  siriRequest,
} from './siri.js';

const logger = createLogger({ name: 'gtfs-siri' });

// At most this many stop points asked per watched stop (a stop area of a
// station may have a dozen; the closest to the timetable's are kept).
export const MAX_REFS_PER_STOP = 4;
export const SIRI_MAX_BYTES = 5e6;
export const DISCOVERY_MAX_BYTES = 15e6;
export const ALERTS_INTERVAL_MS = 5 * 60 * 1000;
export const NIGHT_INTERVAL_MS = 15 * 60 * 1000;
export const STALE_MS = 10 * 60 * 1000;
export const BACKOFF_MS = 5 * 60 * 1000;
export const DISCOVERY_MAX_AGE_MS = 24 * 3600 * 1000;
// A stop the server knows under none of the candidates: tried again this late.
export const UNKNOWN_RETRY_MS = 6 * 3600 * 1000;
export const PROXY_MIN_INTERVAL_MS = 30 * 1000;
export const RESOLVE_RETRY_MS = 30 * 60 * 1000;
// After a 429 from a host: at least this long between two of its requests,
// doubled by every new 429 up to the maximum, halved after an hour without.
export const RATE_SPACING_MS = 10 * 1000;
export const RATE_SPACING_MAX_MS = 2 * 60 * 1000;
export const BACKOFF_MAX_MS = 60 * 60 * 1000;
const PROXY_HOST = 'proxy.transport.data.gouv.fr';
const NEAR_METERS = 100;

const looksLikeSiriRef = (id) => /:(StopPoint|StopArea|Quay):/i.test(id);

/** What is known of a stop point: its id, its code, its position, its name. */
function pointInfo(network, pointId) {
  const areaId = network.pointArea.get(pointId);
  const area = network.areas.get(areaId);
  return { id: pointId, code: network.codes?.get(pointId) ?? null, area };
}

/**
 * The SIRI references of a GTFS stop point, best first, from the discovered
 * stop points of the server when there are some.
 */
export function referenceCandidates(network, pointId, discovered = null) {
  const { code } = pointInfo(network, pointId);
  const own = [
    looksLikeSiriRef(pointId) ? pointId : null,
    code,
    pointId,
    localRef(pointId),
    String(pointId).split(':').pop(),
  ];
  const keys = new Set(own.filter(Boolean).map(codeKey));
  if (discovered?.length) {
    const exact = discovered.filter((p) => p.ref === pointId || p.ref === code);
    const local = discovered.filter(
      (p) => keys.has(codeKey(localRef(p.ref))) || keys.has(codeKey(p.ref)),
    );
    const matched = exact.length > 0 ? exact : local;
    if (matched.length > 0) {
      return [...new Set(matched.map((p) => p.ref))];
    }
    return [];
  }
  return [...new Set(own.filter(Boolean))];
}

/** The discovered stop point named like a GTFS area, closest to a point within 100 m. */
export function nearestByName(network, pointId, discovered) {
  const area = network.areas.get(network.pointArea.get(pointId));
  if (!area || !discovered?.length) {
    return null;
  }
  const name = normalize(area.name);
  let best = null;
  for (const point of discovered) {
    if (
      !Number.isFinite(point.lat) ||
      !Number.isFinite(point.lon) ||
      normalize(point.name) !== name
    ) {
      continue;
    }
    const meters = distanceMeters(area, point);
    if (meters <= NEAR_METERS && (!best || meters < best.meters)) {
      best = { ref: point.ref, meters };
    }
  }
  return best?.ref ?? null;
}

// --- matching to the timetable ----------------------------------------------------

const routeIndexes = new WeakMap();

/** Route ids by line key, in tiers: id, local part of the id, short name. */
function routeIndex(network) {
  let index = routeIndexes.get(network);
  if (!index) {
    index = [new Map(), new Map(), new Map()];
    const add = (tier, key, id) => {
      if (!key) {
        return;
      }
      const list = index[tier].get(key) ?? [];
      list.push(id);
      index[tier].set(key, list);
    };
    for (const route of network.routes.values()) {
      add(0, route.id.toUpperCase(), route.id);
      add(1, codeKey(localRef(route.id)), route.id);
      add(2, codeKey(route.short), route.id);
    }
    routeIndexes.set(network, index);
  }
  return index;
}

/**
 * The GTFS routes of a SIRI line, among `among` when given (the routes of the
 * stop): the first tier that finds some.
 */
export function routesOfLine(network, { lineRef, lineName }, among = null) {
  const index = routeIndex(network);
  const ref = String(lineRef ?? '');
  // A reference of the profile ("X:Line::59:LOC") names the route by its id;
  // a plain code ("59", the CTS's "A") is what the vehicles show.
  const structured = ref.includes(':');
  const attempts = [
    [0, ref.toUpperCase()],
    ...(structured
      ? [
          [1, codeKey(localRef(ref))],
          [2, codeKey(localRef(ref))],
        ]
      : [
          [2, codeKey(ref)],
          [1, codeKey(ref)],
        ]),
    [2, codeKey(lineName)],
  ];
  for (const [tier, key] of attempts) {
    if (!key) {
      continue;
    }
    const found = (index[tier].get(key) ?? []).filter((id) => !among || among.has(id));
    if (found.length > 0) {
      return [...new Set(found)];
    }
  }
  return [];
}

const headsignIndexes = new WeakMap();

/** "route|dir" → normalized destinations of the departures of a stop area. */
function headsignsAt(network, areaId) {
  let byArea = headsignIndexes.get(network);
  if (!byArea) {
    byArea = new Map();
    headsignIndexes.set(network, byArea);
  }
  let index = byArea.get(areaId);
  if (!index) {
    index = new Map();
    for (const { trip } of network.departures.get(areaId) ?? []) {
      const key = `${trip.route}|${trip.dir}`;
      const set = index.get(key) ?? new Set();
      if (trip.headsign) {
        set.add(normalize(trip.headsign));
      }
      index.set(key, set);
    }
    byArea.set(areaId, index);
  }
  return index;
}

const ALLER = /^(0|aller|a|outbound|forward|go)$/i;
const RETOUR = /^(1|retour|r|inbound|backward|back)$/i;

/** The direction (0/1) of a visit at a stop area, null when it cannot be told. */
export function directionOf(network, areaId, routes, visit, pointId = null) {
  const headsigns = headsignsAt(network, areaId);
  const dirs = new Set();
  for (const route of routes) {
    for (const dir of [0, 1]) {
      if (headsigns.has(`${route}|${dir}`)) {
        dirs.add(dir);
      }
    }
  }
  if (dirs.size === 1) {
    return [...dirs][0];
  }
  if (dirs.size === 0) {
    return null;
  }
  // The stop point asked, or the one the server names, serves one direction.
  const points = [pointId, visit.stopPointRef].filter(Boolean);
  for (const point of points) {
    const pointDirs = new Set(
      routes.flatMap((route) => [...(network.pointRouteDirs.get(`${point}|${route}`) ?? [])]),
    );
    if (pointDirs.size === 1) {
      return [...pointDirs][0];
    }
  }
  const destination = normalize(visit.destination);
  if (destination) {
    const matches = [0, 1].filter((dir) =>
      routes.some((route) =>
        [...(headsigns.get(`${route}|${dir}`) ?? [])].some(
          (name) =>
            name === destination || name.includes(destination) || destination.includes(name),
        ),
      ),
    );
    if (matches.length === 1) {
      return matches[0];
    }
  }
  if (ALLER.test(visit.directionRef)) {
    return 0;
  }
  if (RETOUR.test(visit.directionRef)) {
    return 1;
  }
  return null;
}

/**
 * The visits of a StopMonitoring answer for a stop area, matched to its line
 * groups: `{ key, at, aimed, realtime, cancelled, headsign }` ("key" as in
 * lineGroups: short name and direction). Unmatched visits are dropped.
 */
export function matchVisits(network, areaId, visits, pointId = null) {
  const area = network.areas.get(areaId);
  if (!area) {
    return [];
  }
  const served = new Set(area.routes);
  const result = [];
  for (const visit of visits) {
    const at = visit.expected ?? visit.aimed;
    if (at === null) {
      continue;
    }
    const routes = routesOfLine(network, visit, served);
    if (routes.length === 0) {
      continue;
    }
    const dir = directionOf(network, areaId, routes, visit, pointId);
    if (dir === null) {
      continue;
    }
    const short = network.routes.get(routes[0]).short;
    result.push({
      key: `${short.toUpperCase()}|${dir}`,
      journey: visit.journeyRef || null,
      at,
      aimed: visit.aimed,
      realtime: visit.monitored && visit.expected !== null,
      cancelled: visit.cancelled,
      headsign: visit.destination || null,
    });
  }
  return result;
}

/**
 * Disruptions as GTFS-RT alerts (src/alerts.js reads both): a line reference
 * becomes the routes of the line, a stop reference of a watched stop the
 * routes of that stop; a message naming neither concerns the network.
 * @param {Map<string, string>} watchedRefs SIRI reference → watched stop area id
 */
export function situationsToAlerts(network, situations, watchedRefs = new Map()) {
  const agencies = [...new Set([...network.routes.values()].map((route) => route.agency))];
  const networkAgencies = agencies.every(Boolean) && agencies.length > 0 ? agencies : ['siri'];
  const alerts = [];
  for (const situation of situations) {
    let routes = situation.lineRefs.flatMap((lineRef) => routesOfLine(network, { lineRef }));
    if (situation.lineRefs.length === 0 && situation.stopRefs.length > 0) {
      routes = situation.stopRefs.flatMap((ref) => {
        const areaId = watchedRefs.get(ref) ?? watchedRefs.get(codeKey(localRef(ref)));
        return areaId ? (network.areas.get(areaId)?.routes ?? []) : [];
      });
    }
    let entities;
    if (routes.length > 0) {
      entities = [...new Set(routes)].map((routeId) => ({
        agencyId: '',
        routeId,
        routeType: null,
        stopId: '',
        tripId: '',
      }));
    } else if (situation.lineRefs.length === 0 && situation.stopRefs.length === 0) {
      entities = networkAgencies.map((agencyId) => ({
        agencyId,
        routeId: '',
        routeType: null,
        stopId: '',
        tripId: '',
      }));
    } else {
      // Lines or stops the timetable does not know.
      continue;
    }
    const text = situation.header.map((t) => t.text).join('|');
    alerts.push({
      id: situation.id || createHash('sha1').update(text).digest('hex').slice(0, 12),
      periods: situation.periods.map((period) => ({
        start: period.start === null ? null : Math.floor(period.start / 1000),
        end: period.end === null ? null : Math.floor(period.end / 1000),
      })),
      entities,
      cause: null,
      effect: null,
      header: situation.header,
      description: situation.description,
      url: situation.url,
    });
  }
  return alerts;
}

// --- the reader ---------------------------------------------------------------------

class SiriFailure extends Error {
  constructor(message, kind) {
    super(message);
    this.kind = kind; // 'access' | 'reference' | 'unsupported' | 'rate' | 'other'
  }
}

/**
 * The pace of the requests per host, shared by every network of the
 * integration: Okina's gateway serves eight networks and limits by address,
 * a 429 must hold them all.
 */
export class HostGates {
  constructor() {
    this.hosts = new Map(); // host → { blockedUntil, spacing, last, strikes, limitedAt }
    this.urls = new Map(); // url → last request (the transport.data.gouv.fr proxy)
  }

  state(url) {
    const host = hostOf(url);
    let state = this.hosts.get(host);
    if (!state) {
      state = { blockedUntil: 0, spacing: 0, last: null, strikes: 0, limitedAt: null };
      this.hosts.set(host, state);
    }
    return state;
  }

  /** True while the host asked to be left alone (429). */
  blocked(url, now) {
    return now < this.state(url).blockedUntil;
  }

  /** Spends one request on `url` when its host allows one now. */
  take(url, now) {
    const state = this.state(url);
    if (now < state.blockedUntil) {
      return false;
    }
    if (state.spacing > 0 && state.limitedAt !== null && now - state.limitedAt > 3600 * 1000) {
      state.spacing = state.spacing / 2 < RATE_SPACING_MS ? 0 : state.spacing / 2;
      state.strikes = 0;
      state.limitedAt = now;
    }
    if (state.spacing > 0 && state.last !== null && now - state.last < state.spacing) {
      return false;
    }
    if (hostOf(url) === PROXY_HOST) {
      const used = this.urls.get(url);
      if (used !== undefined && now - used < PROXY_MIN_INTERVAL_MS) {
        return false;
      }
      this.urls.set(url, now);
    }
    state.last = now;
    return true;
  }

  /** A 429: the host is left alone for its Retry-After, else longer at each one. */
  limited(url, now, retryAfterMs = null) {
    const state = this.state(url);
    state.strikes += 1;
    state.limitedAt = now;
    state.blockedUntil =
      now + (retryAfterMs ?? Math.min(BACKOFF_MS * 2 ** (state.strikes - 1), BACKOFF_MAX_MS));
    state.spacing = Math.min(Math.max(state.spacing * 2, RATE_SPACING_MS), RATE_SPACING_MAX_MS);
  }
}

// Anshar (Okina) gives a requestor the situations changed since its previous
// call, not all of them: those are kept and updated, not replaced.
const isIncremental = (url) => /\/anshar\//i.test(new URL(url).pathname);

export class SiriReader {
  /**
   * @param {object} options
   * @param {{ id: string, name: string, siri: object[] }} options.info the network
   * @param {typeof fetch} options.fetch
   * @param {HostGates} [options.gates] shared with the other networks
   * @param {string|null} [options.cacheDir] where the stop lists are kept (/data)
   */
  constructor({ info, fetch, gates = new HostGates(), cacheDir = null }) {
    this.info = info;
    this.fetch = fetch;
    this.gates = gates;
    this.cacheDir = cacheDir;
    // The endpoints as the network gives them; a data.gouv.fr link is
    // resolved to the producer's address before any request (`endpoint`).
    this.entries = (info.siri ?? []).filter((entry) => {
      try {
        return Boolean(new URL(entry.url));
      } catch {
        return false;
      }
    });
    this.resolved = new Map(); // index → { endpoint, at } | { error, at }
    this.discovery = new Map(); // endpoint index → { at, points|null, keyed, empty }
    this.mapping = new Map(); // stop id → { signature, refs: [{ endpoint, point, candidates, index, unknownAt }] }
    this.readings = new Map(); // `${stopId}|${ref}` → { at, visits }
    this.lastRead = new Map(); // stop id → ms
    this.alerts = { at: null, list: [], unsupported: new Map() }; // service → until
    this.situations = new Map(); // id → situation (incremental servers)
    this.stopMonitoringOffUntil = 0;
    this.accessError = false;
    this.noData = false;
    this.noStopMonitoring = false;
    this.unknownStops = new Set();
    this.error = null;
    this.timestamp = null;
  }

  get active() {
    return this.entries.length > 0;
  }

  /**
   * The endpoint `index`, at the producer's address. A data.gouv.fr link is
   * resolved by reading its redirection (never followed with a POST), kept a
   * day; a failure is tried again 30 minutes later.
   */
  async endpoint(index, now) {
    const entry = this.entries[index];
    if (!isRedirectHost(entry.url)) {
      return siriEndpoint(entry);
    }
    const known = this.resolved.get(index);
    if (known?.endpoint && now - known.at < DISCOVERY_MAX_AGE_MS) {
      return known.endpoint;
    }
    if (known?.error && now - known.at < RESOLVE_RETRY_MS) {
      throw new SiriFailure(known.error, 'other');
    }
    try {
      const url = await resolveRedirects(this.fetch, entry.url);
      const endpoint = siriEndpoint({ ...entry, url });
      this.resolved.set(index, { endpoint, at: now });
      logger.debug(`${this.info.name}: SIRI server at ${hostOf(url)}`);
      return endpoint;
    } catch (err) {
      const error = err.message;
      this.resolved.set(index, { error, at: now });
      throw new SiriFailure(error, 'other');
    }
  }

  /** One SIRI request, its answer as a tree; failures thrown as SiriFailure. */
  async ask(endpoint, service, { key, now, monitoringRef = null, maxBytes = SIRI_MAX_BYTES }) {
    const { url, init } = siriRequest(endpoint, service, { key, now, monitoringRef });
    const host = hostOf(endpoint.url);
    let tree;
    try {
      const { body } = await getBuffer(this.fetch, url, {
        method: init.method,
        headers: init.headers,
        body: init.body,
        maxBytes,
        errorBody: true,
      });
      tree = parseSiri(body);
    } catch (err) {
      if (err instanceof NotSiriError) {
        // A home page, a proxy's error page: the service is not here.
        throw new SiriFailure(
          `${host}: the server does not answer in SIRI (${err.message})`,
          monitoringRef ? 'other' : 'unsupported',
        );
      }
      if (err.status === 429) {
        this.gates.limited(endpoint.url, now, err.retryAfterMs);
        throw new SiriFailure(`${host}: too many requests (HTTP 429), paused`, 'rate');
      }
      let reported = null;
      if (err.body) {
        try {
          reported = siriError(parseSiri(err.body));
        } catch {
          // Not a SIRI body.
        }
      }
      const message = redact(reported ? `${err.message} (${reported.text})` : err.message, key);
      if (err.status === 401 || err.status === 403 || (reported && isAccessError(reported))) {
        throw new SiriFailure(message, 'access');
      }
      if (reported && isUnsupportedError(reported)) {
        throw new SiriFailure(message, 'unsupported');
      }
      if (reported && isReferenceError(reported)) {
        throw new SiriFailure(message, 'reference');
      }
      if ([400, 404, 405, 501].includes(err.status)) {
        // The catalog names another service (estimated-timetable): a 404 on
        // stop-monitoring says the server has none, not that the stop is unknown.
        const otherService = endpoint.service && endpoint.service !== LITE_SERVICES.stopMonitoring;
        throw new SiriFailure(
          message,
          monitoringRef && !otherService ? 'reference' : 'unsupported',
        );
      }
      throw new SiriFailure(err.status ? message : `${host}: ${redact(err.message, key)}`, 'other');
    }
    const reported = siriError(tree);
    if (reported) {
      const message = `${host}: ${redact(`${reported.code}: ${reported.text}`, key)}`;
      const kind = isAccessError(reported)
        ? 'access'
        : isUnsupportedError(reported)
          ? 'unsupported'
          : monitoringRef && isReferenceError(reported)
            ? 'reference'
            : 'other';
      throw new SiriFailure(message, kind);
    }
    this.timestamp = responseTime(tree) ?? now;
    return tree;
  }

  cachePath(index) {
    return this.cacheDir ? join(this.cacheDir, `siri-stops-${this.info.id}-${index}.json`) : null;
  }

  /** The stop list kept in /data (a day): Okina's weighs 2 MB, not asked again at each start. */
  async cachedPoints(index, endpoint, { keyed, now }) {
    const path = this.cachePath(index);
    if (!path) {
      return undefined;
    }
    try {
      const saved = JSON.parse(await readFile(path, 'utf8'));
      if (
        saved.url === endpoint.url &&
        saved.keyed === keyed &&
        Math.abs(now - saved.at) < DISCOVERY_MAX_AGE_MS &&
        Array.isArray(saved.points)
      ) {
        return { at: saved.at, points: saved.points.length ? saved.points : null };
      }
    } catch {
      // No list yet.
    }
    return undefined;
  }

  async savePoints(index, endpoint, { keyed, now, points }) {
    const path = this.cachePath(index);
    if (!path) {
      return;
    }
    try {
      await mkdir(this.cacheDir, { recursive: true });
      await writeFile(`${path}.tmp`, JSON.stringify({ url: endpoint.url, keyed, at: now, points }));
      await rename(`${path}.tmp`, path);
    } catch (err) {
      logger.debug(`${this.info.name}: SIRI stop list not kept (${err.message})`);
    }
  }

  /** Removes the stop lists kept for this network (network removed). */
  async dropCache() {
    for (let index = 0; index < this.entries.length; index += 1) {
      const path = this.cachePath(index);
      if (path) {
        await rm(path, { force: true }).catch(() => {});
      }
    }
  }

  /** The stop points the server lists (StopPointsDiscovery), read once a day; null when none. */
  async discovered(index, { key, now }) {
    const keyed = Boolean(key);
    const known = this.discovery.get(index);
    if (known && now - known.at < DISCOVERY_MAX_AGE_MS && known.keyed === keyed) {
      return known.points;
    }
    const endpoint = await this.endpoint(index, now);
    if (!known) {
      const cached = await this.cachedPoints(index, endpoint, { keyed, now });
      if (cached) {
        this.discovery.set(index, { ...cached, keyed, empty: !cached.points });
        return cached.points;
      }
    }
    if (!this.gates.take(endpoint.url, now)) {
      if (this.gates.blocked(endpoint.url, now)) {
        throw new SiriFailure(
          `${hostOf(endpoint.url)}: too many requests (HTTP 429), paused`,
          'rate',
        );
      }
      return known?.points ?? null;
    }
    let points = null;
    let empty = false;
    try {
      const tree = await this.ask(endpoint, 'stopPoints', {
        key,
        now,
        maxBytes: DISCOVERY_MAX_BYTES,
      });
      points = readStopPoints(tree);
      empty = points.length === 0;
      logger.debug(`${this.info.name}: ${points.length} SIRI stop points discovered`);
    } catch (err) {
      if (err.kind === 'access') {
        // The key may come later: asked again with it.
        this.accessError = true;
        this.discovery.set(index, { at: now, points: null, keyed, empty: false });
        throw err;
      }
      if (err.kind === 'rate') {
        throw err;
      }
      logger.debug(`${this.info.name}: no SIRI stop discovery (${err.message})`);
    }
    const kept = points?.length ? points : null;
    const listed = (list) => (list ?? []).map((p) => p.ref).join(',');
    if (known && listed(known.points) !== listed(kept)) {
      // Another list: the references are chosen again.
      this.mapping.clear();
    }
    this.discovery.set(index, { at: now, points: kept, keyed, empty });
    if (points) {
      await this.savePoints(index, endpoint, { keyed, now, points });
    }
    return kept;
  }

  /** The references asked for a watched stop: `[{ endpoint, point, candidates, index }]`. */
  async refsOf(stop, network, { key, now }) {
    const area = network.areas.get(stop.id);
    if (!area) {
      return [];
    }
    const typed = (stop.siri ?? []).filter(Boolean);
    const signature = `${typed.join(',')}|${area.points.join(',')}`;
    const known = this.mapping.get(stop.id);
    if (known && known.signature === signature) {
      return known.refs;
    }
    if (known) {
      this.dropReadings(stop.id);
    }
    let refs;
    if (typed.length > 0) {
      refs = typed.slice(0, MAX_REFS_PER_STOP).map((ref) => ({
        endpoint: 0,
        point: null,
        candidates: [ref],
        index: 0,
        unknownAt: null,
      }));
    } else {
      refs = [];
      // Several endpoints (one per operator): the first whose list has the stop.
      for (let e = 0; e < this.entries.length && refs.length === 0; e += 1) {
        const discovered = await this.discovered(e, { key, now });
        if (!discovered) {
          continue;
        }
        for (const point of area.points) {
          let candidates = referenceCandidates(network, point, discovered);
          if (candidates.length === 0) {
            const near = nearestByName(network, point, discovered);
            candidates = near ? [near] : [];
          }
          if (candidates.length > 0) {
            refs.push({ endpoint: e, point, candidates, index: 0, unknownAt: null });
          }
        }
      }
      if (refs.length === 0) {
        // No list, or the stop is not in it: the GTFS codes, on the first endpoint.
        refs = area.points.map((point) => ({
          endpoint: 0,
          point,
          candidates: referenceCandidates(network, point, null),
          index: 0,
          unknownAt: null,
        }));
      }
      // Points without departures here first out: the busiest are kept.
      const departures = network.departures.get(stop.id) ?? [];
      const count = (point) => departures.filter((d) => d.stop === point).length;
      refs = refs.sort((a, b) => count(b.point) - count(a.point)).slice(0, MAX_REFS_PER_STOP);
    }
    this.mapping.set(stop.id, { signature, refs });
    return refs;
  }

  /** SIRI reference → watched stop area id (for the disruptions naming stops). */
  watchedRefs() {
    const refs = new Map();
    for (const [stopId, { refs: list }] of this.mapping) {
      for (const entry of list) {
        const ref = entry.candidates[entry.index];
        if (ref) {
          refs.set(ref, stopId);
          refs.set(codeKey(localRef(ref)), stopId);
        }
      }
    }
    return refs;
  }

  /** Reads the stops of one refresh, the least recently read first (a slow host is shared). */
  async readStops(stops, network, { key, now, busy }) {
    let failures = 0;
    let read = 0;
    let visitsSeen = 0;
    let busyRead = false;
    if (now < this.stopMonitoringOffUntil) {
      return { failures, read, stop: false, visitsSeen, busyRead };
    }
    const order = stops
      .filter((stop) => network.areas.has(stop.id))
      .sort((a, b) => (this.lastRead.get(a.id) ?? -1) - (this.lastRead.get(b.id) ?? -1));
    for (const stop of order) {
      const last = this.lastRead.get(stop.id);
      const due = busy(stop);
      if (last !== undefined && !due && now - last < NIGHT_INTERVAL_MS) {
        continue;
      }
      const refs = await this.refsOf(stop, network, { key, now });
      let unknown = refs.length === 0;
      let asked = false;
      // The stop point asked longest ago first: on a host allowing one request
      // per refresh, each gets its turn.
      const turn = [...refs].sort((a, b) => (a.askedAt ?? -1) - (b.askedAt ?? -1));
      for (const entry of turn) {
        if (entry.index >= entry.candidates.length) {
          if (entry.unknownAt !== null && now - entry.unknownAt < UNKNOWN_RETRY_MS) {
            unknown = true;
            continue;
          }
          entry.index = 0;
          entry.unknownAt = null;
        }
        const ref = entry.candidates[entry.index];
        const endpoint = await this.endpoint(entry.endpoint, now);
        if (!this.gates.take(endpoint.url, now)) {
          if (this.gates.blocked(endpoint.url, now)) {
            failures += 1;
            this.error = `${hostOf(endpoint.url)}: too many requests (HTTP 429), paused`;
            return { failures, read, stop: true, visitsSeen, busyRead };
          }
          continue;
        }
        asked = true;
        entry.askedAt = now;
        try {
          const tree = await this.ask(endpoint, 'stopMonitoring', { key, now, monitoringRef: ref });
          const raw = readStopVisits(tree);
          visitsSeen += raw.length;
          busyRead ||= due;
          this.readings.set(`${stop.id}|${ref}`, {
            at: now,
            visits: matchVisits(network, stop.id, raw, entry.point),
          });
          read += 1;
        } catch (err) {
          if (err.kind === 'reference') {
            entry.index += 1;
            if (entry.index >= entry.candidates.length) {
              entry.unknownAt = now;
              unknown = true;
            }
            continue;
          }
          if (err.kind === 'unsupported') {
            // No stop monitoring on this server: asked again tomorrow.
            this.noStopMonitoring = true;
            this.stopMonitoringOffUntil = now + DISCOVERY_MAX_AGE_MS;
            this.error = err.message;
            return { failures: failures + 1, read, stop: false, visitsSeen, busyRead };
          }
          failures += 1;
          this.error = err.message;
          if (err.kind === 'access') {
            this.accessError = true;
          }
          if (err.kind === 'access' || err.kind === 'rate') {
            return { failures, read, stop: true, visitsSeen, busyRead };
          }
        }
      }
      if (unknown && refs.every((entry) => entry.index >= entry.candidates.length)) {
        this.unknownStops.add(stop.id);
      } else {
        this.unknownStops.delete(stop.id);
      }
      if (asked || unknown) {
        this.lastRead.set(stop.id, now);
      }
    }
    return { failures, read, stop: false, visitsSeen, busyRead };
  }

  /** The situations of an answer; an incremental server's are added to those kept. */
  currentSituations(tree, endpoint, now) {
    const read = readSituations(tree, { keepClosed: true });
    if (!isIncremental(endpoint.url)) {
      return read.filter((situation) => !situation.closed);
    }
    for (const situation of read) {
      const id = situation.id || situation.header.map((t) => t.text).join('|');
      if (situation.closed) {
        this.situations.delete(id);
      } else {
        this.situations.set(id, situation);
      }
    }
    for (const [id, situation] of this.situations) {
      const ends = situation.periods.map((period) => period.end);
      if (ends.length > 0 && ends.every((end) => end !== null && end < now)) {
        this.situations.delete(id);
      }
    }
    return [...this.situations.values()];
  }

  /** Reads the disruptions (GeneralMessage, else SituationExchange) when due. */
  async readAlerts(network, { key, now, busy }) {
    if (
      this.alerts.at !== null &&
      now - this.alerts.at < (busy ? ALERTS_INTERVAL_MS : NIGHT_INTERVAL_MS)
    ) {
      return { failures: 0, read: 0 };
    }
    let endpoint;
    try {
      endpoint = await this.endpoint(0, now);
    } catch (err) {
      this.error = err.message;
      return { failures: 1, read: 0 };
    }
    for (const service of ['generalMessage', 'situationExchange']) {
      const until = this.alerts.unsupported.get(service);
      if (until !== undefined && now < until) {
        continue;
      }
      if (!this.gates.take(endpoint.url, now)) {
        return { failures: 0, read: 0 };
      }
      try {
        const tree = await this.ask(endpoint, service, { key, now });
        const situations = this.currentSituations(tree, endpoint, now);
        this.alerts = {
          ...this.alerts,
          at: now,
          list: situationsToAlerts(network, situations, this.watchedRefs()),
        };
        return { failures: 0, read: 1 };
      } catch (err) {
        if (err.kind === 'unsupported' || err.kind === 'reference') {
          // Not offered by this server: asked again tomorrow.
          this.alerts.unsupported.set(service, now + DISCOVERY_MAX_AGE_MS);
          continue;
        }
        this.error = err.message;
        if (err.kind === 'access') {
          this.accessError = true;
        }
        return { failures: 1, read: 0 };
      }
    }
    // Neither service: no disruption to show, nothing failed.
    this.alerts = { ...this.alerts, at: now, list: [] };
    return { failures: 0, read: 0 };
  }

  /**
   * One refresh: the due stops, then the disruptions.
   * @returns {{ read: number, failures: number }}
   */
  async refresh(stops, network, { key, now, busy }) {
    if (!this.active) {
      return { read: 0, failures: 0 };
    }
    this.error = null;
    this.accessError = false;
    let result;
    try {
      result = await this.readStops(stops, network, { key, now, busy });
    } catch (err) {
      // Discovery refused (key), rate limited, or no server behind the link.
      this.error = err.message;
      if (err.kind === 'access') {
        this.accessError = true;
      }
      return { read: 0, failures: 1 };
    }
    if (result.read > 0 || result.stop) {
      // Answers without a stop nor a departure where some are due: what a
      // server sends without a valid key (Ginko).
      const lists = [...this.discovery.values()];
      this.noData =
        result.busyRead &&
        result.visitsSeen === 0 &&
        lists.length > 0 &&
        lists.every((entry) => entry.empty);
      if (this.noData) {
        result.failures += 1;
        this.error = `${hostOf(this.entries[0].url)}: answers without any stop nor departure`;
      }
    }
    if (!result.stop) {
      const anyBusy = stops.some((stop) => network.areas.has(stop.id) && busy(stop));
      const alerts = await this.readAlerts(network, { key, now, busy: anyBusy });
      result.failures += alerts.failures;
      result.read += alerts.read;
    }
    return result;
  }

  /** The realtime of the network, as src/departures.js reads it (no trip update). */
  realtime(now) {
    const visits = new Map();
    let tracked = 0;
    const seen = new Set();
    for (const [key, reading] of this.readings) {
      if (now - reading.at > STALE_MS) {
        continue;
      }
      const stopId = key.slice(0, key.indexOf('|'));
      const list = visits.get(stopId) ?? [];
      for (const visit of reading.visits) {
        // A server may answer a stop point with its whole stop area: each
        // vehicle once.
        const identity = `${stopId}|${visit.key}|${visit.journey ?? visit.at}`;
        if (seen.has(identity)) {
          continue;
        }
        seen.add(identity);
        list.push({ ...visit, readAt: reading.at });
        tracked += visit.realtime ? 1 : 0;
      }
      visits.set(stopId, list);
    }
    const alerts =
      this.alerts.at !== null && now - this.alerts.at <= 3 * NIGHT_INTERVAL_MS
        ? this.alerts.list
        : [];
    if (visits.size === 0 && alerts.length === 0 && this.alerts.at === null) {
      return null;
    }
    const realtime = indexRealtime({
      timestamp: this.timestamp ? this.timestamp / 1000 : null,
      alerts,
    });
    realtime.visits = visits;
    realtime.tracked = tracked;
    return realtime;
  }

  /** Requests per refresh while departures are scheduled at every stop. */
  requestsPerRefresh() {
    return [...this.mapping.values()].reduce((sum, entry) => sum + entry.refs.length, 0);
  }

  dropReadings(stopId) {
    for (const key of [...this.readings.keys()]) {
      if (key.startsWith(`${stopId}|`)) {
        this.readings.delete(key);
      }
    }
  }

  /** Forgets what was read for a stop no longer watched. */
  forget(stopIds) {
    for (const id of [...this.mapping.keys(), ...this.unknownStops]) {
      if (!stopIds.has(id)) {
        this.mapping.delete(id);
        this.lastRead.delete(id);
        this.unknownStops.delete(id);
      }
    }
    for (const key of [...this.readings.keys()]) {
      if (!stopIds.has(key.slice(0, key.indexOf('|')))) {
        this.readings.delete(key);
      }
    }
  }
}
