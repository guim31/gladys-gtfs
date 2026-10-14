// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, a fake `fetch` serving the
// real (reduced) catalog of transport.data.gouv.fr and Tisséo feeds, a manual
// clock set to the
// moment the realtime fixture was captured, a temporary /data, and the
// integration wired on top through registerHandlers. Nothing touches the
// network.
// -----------------------------------------------------------------------------

import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { CATALOG_URL } from '../../src/catalog.js';
import { Store } from '../../src/store.js';

process.env.LOG_LEVEL ??= 'silent';

export const fixture = (name) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url));
export const fixtureJson = (name) => JSON.parse(fixture(name).toString('utf8'));
export const GTFS_ZIP = new URL('../fixtures/gtfs/tisseo-gtfs-sample.zip', import.meta.url)
  .pathname;

// 2026-10-13 17:19:07 in Toulouse: the header timestamp of the realtime fixture.
export const FIXTURE_TIME = 1791904747000;

// The Tisséo network in the catalog fixture, and its feeds.
export const TISSEO = 'tdg81678';
export const GTFS_URL =
  'https://www.data.gouv.fr/api/1/datasets/r/64318177-f5b5-4144-a6be-2d0f22d26c77';
export const GTFS_RT_URL =
  'https://www.data.gouv.fr/api/1/datasets/r/b2343456-4e73-4e5e-bf0f-e8cab63357a8';

// The SNCF network (TGV, Intercités, TER) in the catalog fixture, reduced to
// Nantes station; its realtime feeds were captured on 2026-10-14 at 08:53.
export const SNCF = 'tdg83582';
export const SNCF_GTFS_URL =
  'https://www.data.gouv.fr/api/1/datasets/r/9ae758ec-cd7a-40cd-a890-bb3963224942';
export const SNCF_TRIP_UPDATES_URL =
  'https://proxy.transport.data.gouv.fr/resource/sncf-gtfs-rt-trip-updates';
export const SNCF_ALERTS_URL =
  'https://proxy.transport.data.gouv.fr/resource/sncf-gtfs-rt-service-alerts';
export const SNCF_TIME = 1791961000000; // 2026-10-14 08:56:40 in Nantes
export const NANTES = 'StopArea:OCE87481002';

// Stop areas of the GTFS fixture.
export const JEAN_JAURES = 'stop_area:SA_1707'; // metro A and B, Linéo, buses (Toulouse)
export const PADER = 'stop_area:SA_1802'; // buses tracked in real time
export const RANGUEIL = 'stop_area:SA_2450'; // Téléo, both directions

/**
 * A fake `fetch`: `routes[url]` is a Buffer, a JSON value, a status number,
 * an Error (network failure), a Response (or a response-like object with
 * `isResponse`) or a function of the request returning one of them. Every call is recorded in `calls`.
 */
export function createFetch(overrides = {}) {
  const routes = {
    [GTFS_URL]: fixture('gtfs/tisseo-gtfs-sample.zip'),
    [GTFS_RT_URL]: fixture('gtfs/tisseo-gtfsrt-sample.pb'),
    [CATALOG_URL]: fixtureJson('catalog/datasets-sample.json'),
    [SNCF_GTFS_URL]: fixture('gtfs/sncf-gtfs-sample.zip'),
    [SNCF_TRIP_UPDATES_URL]: fixture('gtfs/sncf-gtfsrt-trip-updates-sample.pb'),
    [SNCF_ALERTS_URL]: fixture('gtfs/sncf-gtfsrt-alerts-sample.pb'),
    ...overrides,
  };
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, headers: init.headers ?? {} });
    let route = routes[url];
    if (typeof route === 'function') {
      route = await route(url, init);
    }
    if (route instanceof Error) {
      throw route;
    }
    if (route === undefined) {
      return new Response('not found', { status: 404 });
    }
    if (route instanceof Response || route?.isResponse) {
      return route;
    }
    if (typeof route === 'number') {
      return new Response(route === 304 ? null : 'error', { status: route });
    }
    if (Buffer.isBuffer(route) || route instanceof Uint8Array) {
      return new Response(route, { status: 200, headers: { etag: '"fixture"' } });
    }
    return new Response(JSON.stringify(route), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { fetch, calls, routes };
}

/** A manual clock. */
export function createClock(start = FIXTURE_TIME) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

export const HOUSE = {
  id: 'h1',
  name: 'Maison',
  selector: 'maison',
  latitude: 43.6012,
  longitude: 1.4512,
};

/**
 * @param {object} [options]
 * @param {object} [options.config] raw integration config
 * @param {object} [options.network] from createFetch
 * @param {Array} [options.devices] devices already created in Gladys
 * @param {Array} [options.houses]
 * @param {object} [options.saved] content of /data/watch.json before the start
 * @param {boolean} [options.connect]
 * @param {string[]} [options.networks] networks added once connected (Tisséo by default)
 */
export async function createWorld({
  config = {},
  network = createFetch(),
  devices = [],
  houses = [HOUSE],
  saved,
  connect = true,
  clock = createClock(),
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-gtfs-')),
  networks = [TISSEO],
} = {}) {
  const gladys = createFakeGladys({ config, devices, houses });
  const store = new Store(dataDir);
  if (saved) {
    await store.save(saved);
    await store.flush();
  }
  const app = registerHandlers(gladys, {
    store,
    fetch: network.fetch,
    timers: false,
    now: clock.now,
    dataDir,
  });
  const world = {
    gladys,
    fake: gladys.fake,
    app,
    service: app.service,
    network,
    clock,
    store,
    dataDir,
  };
  if (connect) {
    await gladys.connect();
    await app.ready;
    await app.service.loading;
    for (const id of networks) {
      await action(world, 'add_network', { network: id });
    }
  }
  return world;
}

/** Run a configuration action; resolves with its message (multi-language). */
export async function action(world, key, fields = {}) {
  const ack = await world.fake.action(key, fields);
  if (!ack.success) {
    throw new Error(`${key} failed: ${ack.error}`);
  }
  return ack.data.message;
}

/** The device published for an external id prefix, from the last discovery list. */
export const discovered = (world, predicate) =>
  world.fake.discoveredDevices.find(
    typeof predicate === 'function' ? predicate : (d) => d.name.includes(predicate),
  );

/** Create a discovered device in Gladys, as the user would. */
export async function create(world, predicate) {
  const device = discovered(world, predicate);
  if (!device) {
    throw new Error(`${predicate} is not in the discovered devices`);
  }
  await world.fake.deviceCreated(device);
  return device;
}

/** External id of one feature of a device. */
export const featureId = (device, key) =>
  device.features.find((feature) => feature.external_id.endsWith(`:${key}`))?.external_id;

/**
 * Capture the integration's log lines at `level` and above (LOG_LEVEL is read
 * at every call). Returns the lines as `{ level, text }`.
 */
export function captureLogs(t, level = 'info') {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  const lines = [];
  const record = (...args) => {
    const text = args.map((arg) => (arg instanceof Error ? arg.message : String(arg))).join(' ');
    const match = /^\[[^\]]+\] \[(\w+)\]/.exec(text);
    lines.push({ level: match ? match[1].toLowerCase() : 'raw', text });
  };
  t.mock.method(console, 'log', record);
  t.mock.method(console, 'error', record);
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  return lines;
}
