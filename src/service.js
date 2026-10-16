// -----------------------------------------------------------------------------
// The integration at runtime: the networks and stops watched, the data behind
// them (one Feed per network, src/feed.js), the refresh timers, the published
// devices and states, the configuration actions and the scene triggers.
//
// Data flow:
//   - catalog of transport.data.gouv.fr: read on demand (search, add a
//     network), kept a day in memory (src/catalog.js);
//   - static GTFS of each network: downloaded to /data at most once a day,
//     parsed in one streaming pass; parsed again when a stop is added;
//   - GTFS-RT of each network with a watched stop: read at each refresh,
//     every 15 minutes only when no departure is scheduled within 90 minutes;
//   - SIRI of a network without GTFS-RT: asked stop by stop, same rhythm
//     (src/siri-feed.js), with the key of the configuration when it needs one.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { createLogger } from '@gladysassistant/integration-sdk';
import { alertKey, readAlerts, routesFromTrips } from './alerts.js';
import { Catalog, catalogNetworkId, searchCatalog } from './catalog.js';
import { DEFAULT_CONFIG, normalizeConfig, siriKeyFor } from './config.js';
import {
  MAX_GROUPS,
  buildBoard,
  compareRoutes,
  goesTowards,
  lineGroups,
  resolveLines,
  stopGroups,
} from './departures.js';
import {
  STOP_TYPE,
  buildStopDevice,
  clip,
  lineLabel,
  lineLabels,
  stopCode,
  stopPlatformId,
  stopStates,
  whenText,
} from './devices.js';
import { Feed, serial } from './feed.js';
import { HostGates } from './siri-feed.js';
import { hostOf } from './http.js';
import { REPORTS, TEXT, lines, render, say } from './messages.js';
import { formatDistance, nearest, normalize, searchByName } from './search.js';
import { SIRI_LITE, guessFormat } from './siri.js';
import { dataDirectory } from './store.js';

const logger = createLogger({ name: 'gtfs' });

export const MAX_NETWORKS = 3;
export const MAX_STOPS = 20;
export const SEARCH_RESULTS = 10;
// An announced alert that left the feed this long ago may be announced again.
export const ALERT_MEMORY_MS = 6 * 3600 * 1000;
// Unchanged states (a stop without disruption for days) are sent again this
// often, or the dashboard shows "no recent value" after 48 hours.
export const HEARTBEAT_MS = 6 * 3600 * 1000;
const DAILY_CHECK_MS = 3600 * 1000;

export const TRIGGERS = {
  DISRUPTION: 'line_disruption',
};

/** An error whose message is already written for the user, in every language. */
export class UserError extends Error {
  constructor(messages) {
    super(messages.en);
    this.messages = messages;
  }
}

const reportError = (key, params) => new UserError(render(REPORTS, key, params));

/**
 * "A, L1, 15" or "A L1 15" → ["A", "L1", "15"]. With a comma, only commas
 * separate: a line named after its route ("Nantes - Angers") stays whole.
 */
export function parseLineList(value) {
  const text = String(value ?? '');
  return [
    ...new Set(
      text
        .split(/[,;|]/.test(text) ? /[,;|]+/ : /\s+/)
        .map((line) => line.trim())
        .filter(Boolean),
    ),
  ];
}

const ARROW = /\s*(?:->|→|>)\s*/;

/**
 * The "Lines" field: "A, 3 > Chazal" → [{ line: 'A', text: '' }, { line: '3',
 * text: 'Chazal' }]. Without a comma, a field with an arrow is one entry
 * ("3 > Hauts du Chazal").
 */
export function parseLineField(value) {
  const text = String(value ?? '').trim();
  const entries = ARROW.test(text) && !/[,;|]/.test(text) ? [text] : parseLineList(text);
  return entries
    .map((entry) => {
      const [line, ...rest] = entry.split(ARROW);
      return { line: line.trim(), text: rest.join(' ').trim() };
    })
    .filter((entry) => entry.line);
}

/** "3>Chazal,3>Gare" (device parameter) → [{ line, text }]. */
export function parseTowards(value) {
  return parseLineList(value)
    .map((entry) => entry.split('>'))
    .filter(([line, text]) => line?.trim() && text?.trim())
    .map(([line, text]) => ({ line: line.trim(), text: text.trim() }));
}

/** "https://a/b.pb, https://c/d.pb" → the http(s) URLs. */
export function parseUrlList(value) {
  return [
    ...new Set(
      String(value ?? '')
        .split(/[\s,;|]+/)
        .map((url) => url.trim())
        .filter((url) => /^https?:\/\/\S+$/i.test(url)),
    ),
  ];
}

/** SIRI endpoints typed by the user: `[{ url, format, requestorRef }]`. */
export const parseSiriUrls = (value) =>
  parseUrlList(value)
    .slice(0, 3)
    .map((url) => ({ url, format: guessFormat(url), requestorRef: null }));

/** SIRI references typed for a stop ("A:StopPoint:Q:12:LOC, 4012" → two). */
export const parseRefList = (value) =>
  [
    ...new Set(
      String(value ?? '')
        .split(/[\s,;|]+/)
        .map((ref) => ref.trim())
        .filter(Boolean),
    ),
  ].slice(0, 4);

/** The id of a network added by URL: "url" and a hash of the URL. */
export const customNetworkId = (url) =>
  `url${createHash('sha1').update(url).digest('hex').slice(0, 8)}`;

export class Transit {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake)
   * @param {object} options.store persistence of the watch list (src/store.js)
   * @param {typeof fetch} [options.fetch]
   * @param {() => number} [options.now]
   * @param {boolean} [options.timers] false in the tests: they call the refreshes
   * @param {string} [options.dataDir]
   * @param {string} [options.catalogUrl]
   */
  constructor({
    gladys,
    store,
    fetch = globalThis.fetch,
    now = Date.now,
    timers = true,
    dataDir = dataDirectory(),
    catalogUrl,
  }) {
    this.gladys = gladys;
    this.store = store;
    this.fetch = fetch;
    this.now = now;
    this.useTimers = timers;
    this.dataDir = dataDir;
    this.catalog = new Catalog({ fetch, now, url: catalogUrl });
    this.queue = serial();
    // One pace per SIRI host for every network (Okina serves eight).
    this.siriGates = new HostGates();
    this.config = normalizeConfig(DEFAULT_CONFIG);
    this.watch = { networks: [], stops: [], alerts: { seen: {}, followed: null } };
    this.feeds = new Map();
    this.alerts = new Map(); // network id → readable alerts
    this.boards = new Map(); // stop key → board

    this.publishFailed = false;
    this.timer = null;
    this.dailyTimer = null;
    this.stopped = false;
    this.refreshing = null;
  }

  // --- lifecycle --------------------------------------------------------------

  async start(config) {
    this.config = config;
    const saved = await this.store.load();
    const networks = Array.isArray(saved.networks)
      ? saved.networks.filter((n) => n?.id && n.gtfs)
      : [];
    this.watch = {
      networks,
      stops: Array.isArray(saved.stops)
        ? saved.stops.filter((s) => s?.id && networks.some((n) => n.id === s.network))
        : [],
      alerts: {
        seen: saved.alerts?.seen && typeof saved.alerts.seen === 'object' ? saved.alerts.seen : {},
        followed: Array.isArray(saved.alerts?.followed) ? saved.alerts.followed : null,
      },
    };
    // Only when /data lost its list: a stop removed by the user keeps its
    // device in Gladys, and must not come back at the next start.
    if (!Array.isArray(saved.networks)) {
      await this.restoreFromDevices();
    }
    for (const network of this.watch.networks) {
      this.addFeed(network);
    }
    await this.publishDiscovered();
    this.schedule();
    // Data loads in the background (a big timetable takes a minute): actions
    // wait for it, widgets and scene actions say so.
    this.loading = this.loadData().catch((err) => logger.error('Data load failed', err));
  }

  /** Gladys restarted: everything again, the states included. */
  async resync(config) {
    this.config = config;
    this.gladys.forgetPublishedStates?.();
    await this.publishDiscovered();
    await this.publishAllStates();
  }

  async reconfigure(config) {
    const previous = this.config;
    this.config = config;
    if (previous.language !== config.language) {
      this.gladys.forgetPublishedStates?.();
    }
    this.schedule();
    await this.publishDiscovered();
    await this.refresh();
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    clearTimeout(this.dailyTimer);
    await this.store.flush();
  }

  schedule() {
    if (!this.useTimers || this.stopped) {
      return;
    }
    clearTimeout(this.timer);
    clearTimeout(this.dailyTimer);
    // A callback still running when the schedule changes must not start a
    // second chain: each chain only continues while it is the current one.
    this.generation = (this.generation ?? 0) + 1;
    const generation = this.generation;
    const current = () => !this.stopped && this.generation === generation;
    const tick = () => {
      this.timer = setTimeout(async () => {
        await this.refresh().catch((err) => logger.warn(`Refresh failed: ${err.message}`));
        if (current()) {
          tick();
        }
      }, this.config.refreshSeconds * 1000);
      this.timer.unref?.();
    };
    tick();
    const daily = () => {
      this.dailyTimer = setTimeout(async () => {
        await this.dailyCheck().catch((err) => logger.warn(`Daily check failed: ${err.message}`));
        if (current()) {
          daily();
        }
      }, DAILY_CHECK_MS);
      this.dailyTimer.unref?.();
    };
    daily();
  }

  /** The networks with a watched stop. */
  activeFeeds() {
    return [...this.feeds.values()].filter((feed) =>
      this.watch.stops.some((stop) => stop.network === feed.id),
    );
  }

  /** First load: the timetable of every network with a stop, then a refresh. */
  async loadData() {
    for (const feed of this.activeFeeds()) {
      await feed.ensure().catch(() => {});
    }
    await this.fillSiriEndpoints();
    // Names restored from the devices carry the network and the line filter:
    // the timetable has the real ones.
    let renamed = false;
    for (const stop of this.watch.stops) {
      const area = this.feeds.get(stop.network)?.network?.areas.get(stop.id);
      if (area && area.name !== stop.name) {
        stop.name = area.name;
        renamed = true;
      }
    }
    if (renamed) {
      await this.save();
    }
    await this.publishDiscovered();
    await this.refresh();
  }

  /** Hourly: timetables older than a day are downloaded again. */
  async dailyCheck() {
    for (const feed of this.activeFeeds()) {
      await feed.ensure().catch(() => {});
    }
    await this.publishDiscovered();
  }

  /**
   * The SIRI endpoints of the catalog networks added before the integration
   * read SIRI (no `siri` saved) and publishing no GTFS-RT: asked once.
   */
  async fillSiriEndpoints() {
    const missing = this.watch.networks.filter(
      (network) =>
        network.siri === undefined &&
        network.source !== 'url' &&
        /^tdg\d+$/.test(network.id) &&
        (network.realtime ?? []).length === 0,
    );
    if (missing.length === 0) {
      return;
    }
    let entries;
    try {
      entries = await this.catalog.load();
    } catch (err) {
      logger.debug(`Catalog unavailable, SIRI endpoints not checked: ${err.message}`);
      return;
    }
    for (const network of missing) {
      const entry = entries.find((e) => e.id === network.id);
      network.siri = entry && entry.realtime.length === 0 ? entry.siri : [];
      if (network.siri.length > 0) {
        logger.info(`${network.name}: realtime available by SIRI`);
      }
    }
    await this.save();
  }

  /** The networks and stops of the devices created in Gladys but missing from /data. */
  async restoreFromDevices() {
    let devices;
    try {
      devices = await this.gladys.getDevices();
    } catch (err) {
      logger.warn(`Cannot read the devices of the integration: ${err.message}`);
      return;
    }
    const param = (device, name) => device.params?.find((p) => p.name === name)?.value;
    let changed = false;
    for (const device of devices ?? []) {
      const networkId = param(device, 'network');
      const stopId = param(device, 'stop_id');
      const gtfs = param(device, 'gtfs_url');
      if (!networkId || !stopId) {
        continue;
      }
      if (!this.watch.networks.some((n) => n.id === networkId)) {
        if (!gtfs) {
          continue;
        }
        const siriUrls = parseSiriUrls(param(device, 'siri_url'));
        this.watch.networks.push({
          id: networkId,
          name: param(device, 'network_name') || hostOf(gtfs),
          gtfs,
          realtime: parseUrlList(param(device, 'realtime_urls')),
          source: /^url/.test(networkId) ? 'url' : 'catalog',
          // A catalog network gets its SIRI endpoints from the catalog again.
          ...(siriUrls.length > 0 ? { siri: siriUrls } : {}),
        });
      }
      if (!this.watch.stops.some((s) => s.network === networkId && s.id === stopId)) {
        this.watch.stops.push({
          network: networkId,
          id: stopId,
          name: String(device.name ?? stopId).replace(/^[^·]*· /, ''),
          lines: parseLineList(param(device, 'lines')),
        });
        const refs = parseRefList(param(device, 'siri_ref'));
        if (refs.length > 0) {
          this.watch.stops.at(-1).siri = refs;
        }
        const towards = parseTowards(param(device, 'towards'));
        if (towards.length > 0) {
          this.watch.stops.at(-1).towards = towards;
        }
        changed = true;
      }
    }
    if (changed) {
      logger.info('Watched stops restored from the Gladys devices');
      await this.save();
    }
  }

  save() {
    return this.store.save(this.watch);
  }

  addFeed(network) {
    const feed = new Feed({
      network,
      fetch: this.fetch,
      now: this.now,
      dataDir: this.dataDir,
      stops: () => this.watch.stops.filter((stop) => stop.network === network.id),
      queue: this.queue,
      key: () => this.siriKeyOf(network),
      gates: this.siriGates,
    });
    this.feeds.set(network.id, feed);
    return feed;
  }

  /** The timetable of a network for an action: waits for a load, explains a failure. */
  async timetableForAction(feed) {
    try {
      return await feed.ensure();
    } catch (err) {
      throw err.code === 'TOO_BIG'
        ? reportError('tooBig', { name: feed.info.name, reason: err.message })
        : reportError('gtfsFailed', { name: feed.info.name, reason: err.message });
    }
  }

  // --- devices ----------------------------------------------------------------

  stopKey(stop) {
    return `${stop.network}|${stop.id}`;
  }

  stopDevice(stop) {
    const feed = this.feeds.get(stop.network);
    const network = feed?.network;
    if (!network?.areas.has(stop.id)) {
      return null;
    }
    const groups = stopGroups(network, stop.id, resolveLines(network, stop.lines), stop.towards);
    const device = buildStopDevice(this.gladys, stop, groups, this.config.language, feed.info.name);
    device.params.push(
      { name: 'network_name', value: feed.info.name },
      { name: 'gtfs_url', value: feed.info.gtfs },
      { name: 'realtime_urls', value: (feed.info.realtime ?? []).join(' ') },
    );
    // Only when set: the devices of the networks without SIRI stay as they were.
    if (feed.info.source === 'url' && feed.info.siri?.length) {
      device.params.push({ name: 'siri_url', value: feed.info.siri.map((e) => e.url).join(' ') });
    }
    if (stop.siri?.length) {
      device.params.push({ name: 'siri_ref', value: stop.siri.join(' ') });
    }
    return device;
  }

  stopDeviceId(stop) {
    return this.gladys.externalIds(STOP_TYPE, stopPlatformId(stop.network, stop.id)).device;
  }

  async publishDiscovered() {
    const devices = this.watch.stops.map((stop) => this.stopDevice(stop)).filter(Boolean);
    try {
      await this.gladys.publishDiscoveredDevices(devices);
    } catch (err) {
      logger.warn(`Cannot publish the discovered devices: ${err.message}`);
    }
  }

  isCreated(externalId) {
    return (this.gladys.devices ?? []).some((device) => device.external_id === externalId);
  }

  stopOfDevice(externalId) {
    return this.watch.stops.find((stop) => this.stopDeviceId(stop) === externalId);
  }

  async publish(states) {
    if (states.length === 0) {
      return;
    }
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: HEARTBEAT_MS });
      if (this.publishFailed) {
        this.publishFailed = false;
        logger.info('States published again');
      }
    } catch (err) {
      // Gladys restarting: said once, the next refresh sends them again.
      if (!this.publishFailed) {
        logger.warn(`Cannot publish ${states.length} state(s): ${err.message}`);
      }
      this.publishFailed = true;
    }
  }

  stopStatesOf(stop) {
    const board = this.boards.get(this.stopKey(stop));
    if (!board) {
      return [];
    }
    const traffic = this.trafficOf(stop)
      .map((alert) => alert.title)
      .join(' · ');
    return stopStates(this.gladys, stop, board, traffic, this.config.language);
  }

  async publishAllStates() {
    const states = [];
    for (const stop of this.watch.stops) {
      if (this.isCreated(this.stopDeviceId(stop))) {
        states.push(...this.stopStatesOf(stop));
      }
    }
    await this.publish(states);
  }

  /** A device was just added in Gladys: its states, all of them, now. */
  async onDeviceCreated(device) {
    const stop = this.stopOfDevice(device?.external_id);
    if (!stop) {
      return;
    }
    const feed = this.feeds.get(stop.network);
    if (!this.boards.has(this.stopKey(stop)) && feed?.network) {
      this.boards.set(
        this.stopKey(stop),
        buildBoard(feed.network, feed.realtime, stop, this.now()),
      );
    }
    await this.publish(this.stopStatesOf(stop));
    this.gladys.requestWidgetRefresh?.('departures')?.catch?.(() => {});
  }

  // --- refresh ------------------------------------------------------------------

  /** One refresh of everything watched; concurrent calls share it. */
  refresh() {
    if (!this.refreshing) {
      this.refreshing = this.refreshAll()
        .catch((err) => logger.warn(`Refresh failed: ${err.message}`))
        .finally(() => {
          this.refreshing = null;
        });
    }
    return this.refreshing;
  }

  async refreshAll() {
    // Each network first in turn: networks on one SIRI host share its pace.
    const feeds = this.activeFeeds();
    this.turn = ((this.turn ?? -1) + 1) % Math.max(feeds.length, 1);
    for (const feed of [...feeds.slice(this.turn), ...feeds.slice(0, this.turn)]) {
      if (feed.network) {
        await this.refreshFeed(feed);
      }
    }
  }

  async refreshFeed(feed) {
    const now = this.now();
    await feed.refreshRealtime(now, this.config.realtime);
    // The network may have been removed while its feeds were read.
    if (this.feeds.get(feed.id) !== feed || !feed.network) {
      return;
    }
    const alerts = feed.realtime
      ? readAlerts(feed.realtime.alerts, { now, language: this.config.language })
      : [];
    this.alerts.set(
      feed.id,
      routesFromTrips(
        alerts,
        [...feed.network.departures.values()].flatMap((list) => list.map((d) => d.trip)),
      ),
    );
    const states = [];
    for (const stop of this.watch.stops) {
      if (stop.network !== feed.id || !feed.network.areas.has(stop.id)) {
        continue;
      }
      this.boards.set(this.stopKey(stop), buildBoard(feed.network, feed.realtime, stop, now));
      if (this.isCreated(this.stopDeviceId(stop))) {
        states.push(...this.stopStatesOf(stop));
      }
    }
    await this.publish(states);
    if (feed.realtime) {
      await this.checkAlerts(now);
    }
  }

  /** The routes a stop follows: its line filter, or every line serving it. */
  followedRoutesOf(stop) {
    const network = this.feeds.get(stop.network)?.network;
    if (!network) {
      return new Set();
    }
    return resolveLines(network, stop.lines) ?? new Set(network.areas.get(stop.id)?.routes ?? []);
  }

  /**
   * True when a network alert (no route, an agency) concerns a stop: its
   * agency runs one of the followed lines, or the alert names none.
   */
  concernsAgency(alert, network, routes) {
    if (alert.agencies.length === 0) {
      return true;
    }
    const agencies = new Set([...routes].map((id) => network.routes.get(id)?.agency));
    return agencies.has(null) || agencies.has(undefined)
      ? true
      : alert.agencies.some((agency) => agencies.has(agency));
  }

  /** The alerts of the lines of a stop (line alerts only: the traffic info). */
  trafficOf(stop) {
    const routes = this.followedRoutesOf(stop);
    return (this.alerts.get(stop.network) ?? []).filter((alert) =>
      alert.routes.some((route) => routes.has(route)),
    );
  }

  /** Fires `line_disruption` for every alert not announced yet on a followed line. */
  async checkAlerts(now) {
    const followed = new Set();
    const networkScopes = new Map(); // network id → routes followed
    for (const stop of this.watch.stops) {
      const routes = networkScopes.get(stop.network) ?? new Set();
      for (const route of this.followedRoutesOf(stop)) {
        followed.add(`${stop.network}|${route}`);
        routes.add(route);
      }
      networkScopes.set(stop.network, routes);
    }
    const memory = this.watch.alerts;
    const firstCheck = memory.followed === null;
    const known = new Set(memory.followed ?? []);
    const events = [];
    const present = new Set();
    for (const [networkId, alerts] of this.alerts) {
      const feed = this.feeds.get(networkId);
      const routes = networkScopes.get(networkId);
      if (!feed?.network || !routes) {
        continue;
      }
      for (const alert of alerts) {
        const targets = alert.network
          ? this.concernsAgency(alert, feed.network, routes)
            ? [null]
            : []
          : alert.routes.filter((route) => routes.has(route));
        for (const route of targets) {
          const scopeKey = `${networkId}|${route ?? 'network'}`;
          const key = `${alertKey(alert)}|${scopeKey}`;
          present.add(key);
          if (key in memory.seen) {
            continue;
          }
          // Not announced: what was already there at the first check, or on a
          // line that was not followed yet (the stop has just been added).
          const followedBefore =
            route === null
              ? [...known].some((k) => k.startsWith(`${networkId}|`))
              : known.has(scopeKey);
          if (!firstCheck && followedBefore) {
            const short = route ? feed.network.routes.get(route)?.short : null;
            events.push({
              scope: route ? 'line' : 'network',
              network: feed.info.name,
              line: short ?? '',
              title: clip(alert.title, 300),
              description: clip(alert.description || alert.title, 1000),
              url: alert.url || '',
            });
          }
        }
      }
    }
    let changed =
      firstCheck || JSON.stringify([...followed].sort()) !== JSON.stringify([...known].sort());
    for (const key of present) {
      // Refreshed hourly only: /data is often an SD card, not worth a write a minute.
      if (memory.seen[key] === undefined || now - memory.seen[key] > 3600 * 1000) {
        memory.seen[key] = now;
        changed = true;
      }
    }
    // Only the alerts of networks read just now can have left their feed: a
    // feed down for hours must not make its alerts new again when it is back.
    const read = [...this.feeds.values()]
      .filter((feed) => feed.realtime && feed.realtimeComplete && feed.realtimeAt === now)
      .map((feed) => `|${feed.id}|`);
    for (const [key, seenAt] of Object.entries(memory.seen)) {
      if (!read.some((marker) => key.includes(marker))) {
        continue;
      }
      if (!present.has(key) && now - seenAt > ALERT_MEMORY_MS) {
        delete memory.seen[key];
        changed = true;
      }
    }
    memory.followed = [...followed].sort();
    if (changed) {
      await this.save();
    }
    for (const data of events) {
      await this.fire(TRIGGERS.DISRUPTION, data);
    }
  }

  async fire(key, data) {
    try {
      await this.gladys.publishSceneEvent(key, data);
    } catch (err) {
      logger.warn(`Cannot fire the ${key} trigger: ${err.message}`);
    }
  }

  // --- configuration actions: networks ----------------------------------------------

  async catalogForAction() {
    try {
      return await this.catalog.load();
    } catch (err) {
      throw reportError('catalogFailed', { reason: err.message });
    }
  }

  /** "Passages + alertes" / "aucun": the realtime feeds of a catalog entry. */
  realtimeLabel(entry, language) {
    if (entry.realtime.length === 0 && entry.siri?.length > 0) {
      return say(REPORTS, language, 'siriShort');
    }
    if (entry.realtime.length === 0) {
      return say(REPORTS, language, 'noRealtime');
    }
    const features = new Set(entry.realtime.flatMap((r) => r.features));
    const parts = [];
    if (features.has('trip_updates') || features.size === 0) {
      parts.push(say(REPORTS, language, 'tripUpdates'));
    }
    if (features.has('service_alerts')) {
      parts.push(say(REPORTS, language, 'serviceAlerts'));
    }
    return parts.join(' + ');
  }

  networkLine(entry, language) {
    const detail = [entry.resource && entry.resource !== entry.name ? entry.resource : entry.title]
      .filter(Boolean)
      .map((text) => clip(text, 70));
    return `• ${entry.name} [${entry.id}] — ${detail.join('')} — ${say(REPORTS, language, 'realtimeShort')} : ${this.realtimeLabel(entry, language)}`;
  }

  async searchNetworks({ query } = {}) {
    if (!normalize(query)) {
      throw reportError('noNetworkQuery');
    }
    const found = searchCatalog(await this.catalogForAction(), query).slice(0, SEARCH_RESULTS);
    if (found.length === 0) {
      throw reportError('noMatch', { query });
    }
    return Object.fromEntries(
      Object.keys(REPORTS).map((language) => [
        language,
        [
          say(REPORTS, language, 'foundNetworks', { count: found.length }),
          ...found.map((entry) => this.networkLine(entry, language)),
          say(REPORTS, language, 'addNetworkHint'),
        ].join('\n'),
      ]),
    );
  }

  /** The network meant by an action: a catalog id, a catalog name, or a GTFS URL. */
  async resolveNetwork({ network: query, realtime, name, siri }) {
    const wanted = String(query ?? '').trim();
    const typedSiri = parseSiriUrls(siri);
    if (/^https?:\/\//i.test(wanted)) {
      return {
        id: customNetworkId(wanted),
        name: clip(String(name ?? '').trim() || hostOf(wanted), 40),
        gtfs: wanted,
        realtime: parseUrlList(realtime).slice(0, 3),
        siri: typedSiri,
        source: 'url',
      };
    }
    const entries = await this.catalogForAction();
    const id = /^\d+$/.test(wanted) ? catalogNetworkId(wanted) : wanted;
    let entry = entries.find((e) => e.id.toLowerCase() === id.toLowerCase());
    if (!entry) {
      const matches = searchCatalog(entries, wanted);
      const exact = matches.filter((e) => normalize(e.name) === normalize(wanted));
      const candidates = exact.length > 0 ? exact : matches;
      if (candidates.length === 0) {
        throw reportError('noMatch', { query: wanted });
      }
      if (candidates.length > 1) {
        throw new UserError(
          Object.fromEntries(
            Object.keys(REPORTS).map((language) => [
              language,
              [
                say(REPORTS, language, 'ambiguousNetwork', { query: wanted }),
                ...candidates
                  .slice(0, SEARCH_RESULTS)
                  .map((candidate) => this.networkLine(candidate, language)),
              ].join('\n'),
            ]),
          ),
        );
      }
      [entry] = candidates;
    }
    const extra = parseUrlList(realtime);
    return {
      id: entry.id,
      name: clip(String(name ?? '').trim() || entry.name, 40),
      gtfs: entry.gtfs,
      realtime: [...new Set([...entry.realtime.map((r) => r.url), ...extra])].slice(0, 3),
      siri: typedSiri.length > 0 ? typedSiri : entry.siri,
      source: 'catalog',
      licence: entry.licence,
      page: entry.page,
    };
  }

  async addNetwork(fields = {}) {
    const network = await this.resolveNetwork(fields);
    // A secret field: never logged, kept in /data with the network.
    const key = String(fields.siri_key ?? '').trim();
    const existing = this.watch.networks.find((n) => n.id === network.id);
    if (existing) {
      return this.updateNetwork(existing, network, fields, key);
    }
    if (key) {
      network.siriKey = key;
    }
    if (this.watch.networks.length >= MAX_NETWORKS) {
      throw reportError('tooManyNetworks', { max: MAX_NETWORKS });
    }
    const feed = this.addFeed(network);
    let timetable;
    try {
      timetable = await this.timetableForAction(feed);
    } catch (err) {
      this.feeds.delete(network.id);
      await feed.drop();
      throw err;
    }
    this.watch.networks.push(network);
    await this.save();
    logger.info(`Network added: ${network.name} (${network.id})`);
    return Object.fromEntries(
      Object.keys(REPORTS).map((language) => [
        language,
        [
          say(REPORTS, language, 'networkAdded', {
            name: network.name,
            areas: timetable.stats.areas,
            routes: timetable.stats.routes,
          }),
          network.realtime.length > 0
            ? say(REPORTS, language, 'networkRealtime', { count: network.realtime.length })
            : network.siri?.length > 0
              ? say(REPORTS, language, 'networkSiri', { format: this.siriFormatName(network) })
              : say(REPORTS, language, 'networkNoRealtime'),
          this.needsKeyHint(network) ? say(REPORTS, language, 'siriKeyHint') : null,
          network.licence ? say(REPORTS, language, 'licence', { licence: network.licence }) : null,
          say(REPORTS, language, 'searchStopHint'),
        ]
          .filter(Boolean)
          .join('\n'),
      ]),
    );
  }

  /**
   * "Add a network" on a network already added: what was typed replaces what
   * it had (name, realtime feeds, SIRI URL, SIRI key); its stops stay.
   */
  async updateNetwork(existing, network, fields, key) {
    const changes = [];
    const differs = (a, b) => JSON.stringify(a ?? []) !== JSON.stringify(b ?? []);
    if (String(fields.name ?? '').trim() && network.name !== existing.name) {
      existing.name = network.name;
      changes.push('changeName');
    }
    if (parseUrlList(fields.realtime).length > 0 && differs(network.realtime, existing.realtime)) {
      existing.realtime = network.realtime;
      changes.push('changeRealtime');
    }
    if (parseSiriUrls(fields.siri).length > 0 && differs(network.siri, existing.siri)) {
      existing.siri = network.siri;
      changes.push('changeSiri');
    }
    if (key && key !== existing.siriKey) {
      existing.siriKey = key;
      changes.push('changeKey');
    }
    if (changes.length === 0) {
      return render(REPORTS, 'networkKnown', { name: existing.name });
    }
    await this.save();
    logger.info(`Network updated: ${existing.name} (${existing.id})`);
    // The feed reads the network it was given: the next refresh uses the change.
    await this.publishDiscovered();
    await this.refresh();
    return Object.fromEntries(
      Object.keys(REPORTS).map((language) => [
        language,
        say(REPORTS, language, 'networkUpdated', {
          name: existing.name,
          changes: changes.map((change) => say(REPORTS, language, change)).join(', '),
        }),
      ]),
    );
  }

  siriFormatName(network) {
    return network.siri?.some((e) => e.format === SIRI_LITE) ? 'SIRI Lite' : 'SIRI';
  }

  /**
   * The SIRI key of a network: the one typed when adding it, else the one
   * named after it in the configuration, else the key typed alone there,
   * unless the catalog publishes its RequestorRef (an open server must not
   * get the key of another network).
   */
  siriKeyOf(network) {
    if (network.siriKey) {
      return network.siriKey;
    }
    const named = siriKeyFor(this.config.siriKeys, network, this.watch.networks, {
      namedOnly: true,
    });
    if (named || network.siri?.every((endpoint) => endpoint.requestorRef)) {
      return named;
    }
    return siriKeyFor(this.config.siriKeys, network, this.watch.networks);
  }

  /** A SIRI network whose key is not public and not typed yet. */
  needsKeyHint(network) {
    return (
      (network.realtime ?? []).length === 0 &&
      network.siri?.length > 0 &&
      !network.siri.some((e) => e.requestorRef) &&
      !this.siriKeyOf(network)
    );
  }

  // --- configuration actions: stops ---------------------------------------------------

  /** The located houses of Gladys: `{ name, lat, lon }[]`. */
  async houses() {
    try {
      const houses = await this.gladys.getHouses();
      return (houses ?? [])
        .filter((h) => Number.isFinite(h.latitude) && Number.isFinite(h.longitude))
        .map((h) => ({ name: h.name, lat: h.latitude, lon: h.longitude }));
    } catch (err) {
      logger.warn(`Cannot read the position of the houses: ${err.message}`);
      return [];
    }
  }

  /** The house named (or the first located one): `{ name, lat, lon }` or null. */
  async home(name) {
    const houses = await this.houses();
    const wanted = normalize(name);
    if (!wanted) {
      return houses[0] ?? null;
    }
    const house = houses.find((h) => normalize(h.name) === wanted);
    if (!house) {
      throw reportError('unknownHouse', {
        query: String(name).trim(),
        houses: houses.map((h) => h.name).join(', ') || '-',
      });
    }
    return house;
  }

  routeNames(network, routeIds) {
    return [
      ...new Set(
        routeIds
          .map((id) => network.routes.get(id))
          .filter(Boolean)
          .sort(compareRoutes)
          .map((route) => route.short),
      ),
    ];
  }

  stopLine({ feed, area }, distance, withNetwork) {
    const routes = this.routeNames(feed.network, area.routes);
    const shown = routes.length > 12 ? `${routes.slice(0, 12).join(', ')}…` : routes.join(', ');
    const where =
      distance === null || distance === undefined
        ? ''
        : ` — ${formatDistance(distance, this.config.language)}`;
    const network = withNetwork ? ` (${feed.info.name})` : '';
    return `• ${area.name} [${stopCode(area.id)}] — ${shown || '-'}${where}${network}`;
  }

  /** The networks an action targets: all of them, or the one named in `network`. */
  feedsFor(query) {
    if (this.watch.networks.length === 0) {
      throw reportError('noNetwork');
    }
    const wanted = normalize(query);
    if (!wanted) {
      return [...this.feeds.values()];
    }
    const feeds = [...this.feeds.values()].filter(
      (feed) => normalize(feed.id) === wanted || normalize(feed.info.name) === wanted,
    );
    if (feeds.length === 0) {
      throw reportError('unknownNetwork', {
        query: String(query),
        networks: this.watch.networks.map((n) => `${n.name} [${n.id}]`).join(', '),
      });
    }
    return feeds;
  }

  /** Stop areas served by at least one line in the timetable window, of the given networks. */
  async servedAreas(feeds) {
    const items = [];
    for (const feed of feeds) {
      const network = await this.timetableForAction(feed);
      for (const area of network.areas.values()) {
        if (area.routes.length > 0) {
          items.push({ name: area.name, lat: area.lat, lon: area.lon, feed, area });
        }
      }
    }
    return items;
  }

  async searchStops({ query, network, house } = {}) {
    const feeds = this.feedsFor(network);
    const items = await this.servedAreas(feeds);
    const home = await this.home(house);
    let found;
    let header;
    let footer = null;
    if (normalize(query)) {
      found = searchByName(items, query, { near: home }).slice(0, SEARCH_RESULTS);
      if (found.length === 0) {
        throw reportError('noMatch', { query });
      }
      header = render(REPORTS, 'foundStops', { count: found.length });
    } else {
      if (!home) {
        throw reportError('noQuery');
      }
      found = nearest(items, home, SEARCH_RESULTS);
      header = render(REPORTS, 'closestStops', { house: home.name });
      const others = (await this.houses()).filter((h) => h.name !== home.name);
      if (others.length > 0) {
        footer = render(REPORTS, 'otherHouses', { houses: others.map((h) => h.name).join(', ') });
      }
    }
    const withNetwork = feeds.length > 1;
    return lines(
      header,
      found.map(({ item, distance }) => this.stopLine(item, distance, withNetwork)).join('\n'),
      footer,
      render(REPORTS, 'addStopHint'),
    );
  }

  /** The stop area meant by a name or an identifier: `{ feed, area }`. */
  async resolveStop(query, networkQuery) {
    const feeds = this.feedsFor(networkQuery);
    const items = await this.servedAreas(feeds);
    const wanted = String(query ?? '').trim();
    const withNetwork = feeds.length > 1;
    const ambiguous = (candidates) =>
      new UserError(
        lines(
          render(REPORTS, 'ambiguous', { query: wanted }),
          candidates
            .slice(0, SEARCH_RESULTS)
            .map(({ item, distance }) => this.stopLine(item, distance, withNetwork))
            .join('\n'),
        ),
      );
    const byId = items.filter(
      ({ area }) => area.id === wanted || stopCode(area.id).toLowerCase() === wanted.toLowerCase(),
    );
    if (byId.length === 1) {
      return byId[0];
    }
    if (byId.length > 1) {
      throw ambiguous(byId.map((item) => ({ item, distance: null })));
    }
    const home = await this.home();
    const matches = searchByName(items, wanted, { near: home });
    const exact = matches.filter(({ item }) => normalize(item.name) === normalize(wanted));
    const candidates = exact.length > 0 ? exact : matches;
    if (candidates.length === 1) {
      return candidates[0].item;
    }
    if (candidates.length === 0) {
      throw reportError('noMatch', { query: wanted });
    }
    throw ambiguous(candidates);
  }

  async addStop({ stop: query, lines: lineField, network: networkQuery, siri_ref: siriRef } = {}) {
    const { feed, area } = await this.resolveStop(query, networkQuery);
    const served = this.routeNames(feed.network, area.routes);
    // "Nantes - Angers" typed without a comma is one line, not three.
    const whole = String(lineField ?? '').trim();
    const typed = served.some((short) => short.toUpperCase() === whole.toUpperCase())
      ? [{ line: whole, text: '' }]
      : parseLineField(lineField);
    const wanted = [...new Set(typed.map((entry) => entry.line))];
    const unknown = wanted.filter(
      (line) => !served.some((short) => short.toUpperCase() === line.toUpperCase()),
    );
    if (unknown.length > 0) {
      throw reportError('unknownLines', {
        lines: unknown.join(', '),
        available: served.join(', '),
      });
    }
    const chosen = served.filter((short) =>
      wanted.some((line) => line.toUpperCase() === short.toUpperCase()),
    );
    // "3 > Chazal": only the directions of line 3 whose destination says so
    // (checked once the departures of the stop are read, below).
    const towards = typed
      .filter((entry) => entry.text)
      .map(({ line, text }) => ({
        line: served.find((name) => name.toUpperCase() === line.toUpperCase()),
        text,
      }));
    const existing = this.watch.stops.find(
      (stop) => stop.network === feed.id && stop.id === area.id,
    );
    if (!existing && this.watch.stops.length >= MAX_STOPS) {
      throw reportError('tooMany', { max: MAX_STOPS });
    }
    // Empty: found automatically (src/siri-feed.js).
    const refs = parseRefList(siriRef);
    const before = existing ? { ...existing } : null;
    if (existing) {
      existing.lines = chosen;
      existing.name = area.name;
      if (towards.length > 0) {
        existing.towards = towards;
      } else {
        delete existing.towards;
      }
      if (refs.length > 0) {
        existing.siri = refs;
      } else {
        delete existing.siri;
      }
    } else {
      this.watch.stops.push({
        network: feed.id,
        id: area.id,
        name: area.name,
        lines: chosen,
        ...(towards.length > 0 ? { towards } : {}),
        ...(refs.length > 0 ? { siri: refs } : {}),
      });
    }
    await this.save();
    // Its departures are only kept by a new pass over the timetable.
    if (!existing) {
      await feed.ensure({ reparse: true }).catch(() => {});
    }
    const all = lineGroups(feed.network, area.id);
    const astray = towards.find(
      (entry) =>
        !all.some(
          (group) =>
            group.route.short.toUpperCase() === entry.line.toUpperCase() &&
            goesTowards(group, [entry]),
        ),
    );
    if (astray) {
      // Back to what it was.
      if (existing) {
        for (const field of ['towards', 'siri']) {
          delete existing[field];
        }
        Object.assign(existing, before);
      } else {
        this.watch.stops = this.watch.stops.filter(
          (stop) => !(stop.network === feed.id && stop.id === area.id),
        );
      }
      await this.save();
      const ofLine = all.filter(
        (group) => group.route.short.toUpperCase() === astray.line.toUpperCase(),
      );
      throw reportError('unknownDirection', {
        line: astray.line,
        text: astray.text,
        available: [...new Set(ofLine.map((group) => group.headsign))].join(', '),
      });
    }
    logger.info(`Stop ${existing ? 'updated' : 'added'}: ${area.name} (${feed.info.name})`);
    await this.publishDiscovered();
    await this.refresh();
    const groups = lineGroups(feed.network, area.id, resolveLines(feed.network, chosen)).filter(
      (group) => goesTowards(group, towards),
    ).length;
    const label = (language) =>
      chosen.length > 0
        ? lineLabels({ lines: chosen, towards }).join(', ')
        : say(REPORTS, language, 'allLines');
    const directions = all.map((group) => `${group.route.short} → ${group.headsign}`);
    const shownDirections =
      directions.length > 24 ? `${directions.slice(0, 24).join(', ')}…` : directions.join(', ');
    return Object.fromEntries(
      Object.keys(REPORTS).map((language) => [
        language,
        [
          say(REPORTS, language, existing ? 'stopUpdated' : 'stopAdded', {
            name: area.name,
            lines: label(language),
          }),
          groups > MAX_GROUPS
            ? say(REPORTS, language, 'tooManyLines', { count: groups, max: MAX_GROUPS })
            : null,
          all.length > 1
            ? say(REPORTS, language, 'servedDirections', {
                list: shownDirections,
                example: `${all[0].route.short} > ${all[0].headsign}`,
              })
            : null,
          refs.length > 0
            ? say(REPORTS, language, feed.usesSiri ? 'siriRef' : 'siriRefUnused', {
                refs: refs.join(', '),
              })
            : null,
          say(REPORTS, language, 'toDiscovery'),
        ]
          .filter(Boolean)
          .join('\n'),
      ]),
    );
  }

  async remove({ name: query } = {}) {
    const wanted = normalize(query);
    const stop = wanted
      ? this.watch.stops.find(
          (entry) =>
            normalize(entry.name) === wanted ||
            normalize(entry.id) === wanted ||
            normalize(stopCode(entry.id)) === wanted,
        )
      : null;
    const network =
      wanted && !stop
        ? this.watch.networks.find(
            (entry) => normalize(entry.name) === wanted || normalize(entry.id) === wanted,
          )
        : null;
    if (!stop && !network) {
      throw reportError('notWatched', { query: String(query ?? '') });
    }
    if (stop) {
      this.watch.stops = this.watch.stops.filter((entry) => entry !== stop);
      this.boards.delete(this.stopKey(stop));
      await this.save();
      await this.publishDiscovered();
      logger.info(`Stop removed: ${stop.name}`);
      return render(REPORTS, 'removed', { name: stop.name });
    }
    const count = this.watch.stops.filter((entry) => entry.network === network.id).length;
    this.watch.stops = this.watch.stops.filter((entry) => entry.network !== network.id);
    this.watch.networks = this.watch.networks.filter((entry) => entry !== network);
    for (const key of this.boards.keys()) {
      if (key.startsWith(`${network.id}|`)) {
        this.boards.delete(key);
      }
    }
    this.alerts.delete(network.id);
    await this.feeds.get(network.id)?.drop();
    this.feeds.delete(network.id);
    await this.save();
    await this.publishDiscovered();
    logger.info(`Network removed: ${network.name}`);
    return render(REPORTS, 'networkRemoved', { name: network.name, count });
  }

  status() {
    const now = this.now();
    const language = this.config.language;
    const date = (ms, timeZone) =>
      new Intl.DateTimeFormat(language, {
        dateStyle: 'short',
        timeZone: timeZone ?? 'Europe/Paris',
      }).format(ms);
    const day = (yyyymmdd, timeZone) =>
      date(
        Date.UTC(+yyyymmdd.slice(0, 4), +yyyymmdd.slice(4, 6) - 1, +yyyymmdd.slice(6, 8), 12),
        timeZone,
      );
    const blocks = [render(REPORTS, 'watchedNetworks', { count: this.watch.networks.length })];
    for (const network of this.watch.networks) {
      const feed = this.feeds.get(network.id);
      const stops = this.watch.stops.filter((stop) => stop.network === network.id);
      const timetable = feed?.network;
      const megabytesPerHour =
        Math.round(((feed?.realtimeBytes ?? 0) * (3600 / this.config.refreshSeconds)) / 1e5) / 10;
      blocks.push(
        `■ ${network.name} [${network.id}]`,
        timetable
          ? render(REPORTS, 'timetable', {
              date: date(feed.gtfsDate, timetable.timeZone),
              until: day(timetable.dates.at(-1), timetable.timeZone),
            })
          : render(REPORTS, 'timetableMissing'),
        feed?.usesSiri
          ? this.siriStatus(feed, now)
          : network.realtime.length === 0
            ? render(REPORTS, 'networkNoRealtime')
            : !this.config.realtime
              ? render(REPORTS, 'realtimeOff')
              : feed?.realtimeAt
                ? render(REPORTS, 'realtime', {
                    age: Math.round((now - feed.realtimeAt) / 1000),
                    tracked: feed.realtime
                      ? new Set([
                          ...feed.realtime.trips.keys(),
                          ...feed.realtime.added.map((u) => u.id),
                        ]).size
                      : 0,
                    volume: megabytesPerHour.toLocaleString(language),
                  })
                : render(REPORTS, 'realtimeWaiting'),
        render(REPORTS, 'watchedStops', { count: stops.length }),
        stops
          .map(
            (stop) =>
              `• ${stop.name} [${stopCode(stop.id)}]${stop.lines.length ? ` (${lineLabels(stop).join(', ')})` : ''}`,
          )
          .join('\n') || null,
        [feed?.gtfsError, feed?.realtimeError].some(Boolean)
          ? render(REPORTS, 'lastError', {
              error: [feed.gtfsError, feed.realtimeError].filter(Boolean).join(' / '),
            })
          : null,
      );
    }
    if (this.watch.networks.length === 0) {
      blocks.push(render(REPORTS, 'noNetwork'));
    }
    return lines(...blocks);
  }

  /** The SIRI lines of the status of a network. */
  siriStatus(feed, now) {
    if (!this.config.realtime) {
      return render(REPORTS, 'realtimeOff');
    }
    const unknown = (feed.siriUnknownStops ?? [])
      .map((id) => this.watch.stops.find((stop) => stop.network === feed.id && stop.id === id))
      .filter(Boolean)
      .map((stop) => stop.name);
    const reader = feed.reader;
    return lines(
      feed.siriAccessError
        ? render(REPORTS, 'siriKeyRefused')
        : reader?.noData
          ? render(REPORTS, 'siriNoData')
          : reader?.noStopMonitoring
            ? render(REPORTS, 'siriNoStopMonitoring')
            : feed.realtimeAt
              ? render(REPORTS, 'siriRealtime', {
                  format: this.siriFormatName(feed.info),
                  age: Math.round((now - feed.realtimeAt) / 1000),
                  tracked: feed.realtime?.tracked ?? 0,
                  requests: feed.reader?.requestsPerRefresh() ?? 0,
                })
              : render(REPORTS, 'siriWaiting', { format: this.siriFormatName(feed.info) }),
      this.needsKeyHint(feed.info) && (!feed.realtimeAt || reader?.noData)
        ? render(REPORTS, 'siriKeyHint')
        : null,
      unknown.length > 0
        ? render(REPORTS, 'siriUnknownStops', { stops: unknown.join(', ') })
        : null,
    );
  }

  // --- reads for the widgets and the scene actions ----------------------------------

  /** The board of the stop of a device, computed now. */
  boardOf(deviceId) {
    const stop = this.stopOfDevice(deviceId);
    const feed = stop && this.feeds.get(stop.network);
    if (!feed?.network?.areas.has(stop.id)) {
      return null;
    }
    return { stop, board: buildBoard(feed.network, feed.realtime, stop, this.now()) };
  }

  /** "Métro A vers Basso Cambo à Jean Jaurès : dans 3 et 7 min (théorique)". */
  sentence(stop, group, language) {
    const text = say(TEXT, language, 'sentence', {
      line: lineLabel(group.route, language),
      direction: group.departures[0]?.headsign ?? group.headsign,
      stop: stop.name,
      when: whenText(group.departures, language),
    });
    const scheduled = group.departures.length > 0 && !group.departures[0].realtime;
    return scheduled ? `${text} (${say(TEXT, language, 'scheduled')})` : text;
  }
}
