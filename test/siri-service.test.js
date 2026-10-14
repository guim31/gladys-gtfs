// -----------------------------------------------------------------------------
// SIRI end to end, against the SDK's fake Gladys: a network without GTFS-RT
// read stop by stop (SIRI Lite in JSON, SIRI over SOAP), its key, its stop
// references, the board and the disruptions, the pace of the requests, the
// failures (key refused, 429), and the catalog networks that publish SIRI.
//
// The timetable is the Tisséo fixture (Pader, 13 October 2026 at 17:19); the
// SIRI servers answer with test/fixtures/siri, timed for that moment.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CATALOG_URL } from '../src/catalog.js';
import { customNetworkId } from '../src/service.js';
import { TRIGGERS } from '../src/service.js';
import {
  FIXTURE_TIME,
  GTFS_URL,
  PADER,
  action,
  captureLogs,
  create,
  createFetch,
  createWorld,
  featureId,
  fixture,
  fixtureJson,
} from './helpers/world.js';

const fr = (message) => message.fr;
const LITE = 'https://rt.example.org/siri-lite/';
const SOAP = 'https://soap.example.org/siri/2.0/ws';
const KEY = 'secret-key-123';

const json = (value, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const xml = (text, status = 200) =>
  new Response(text, { status, headers: { 'content-type': 'text/xml' } });
const emptyLite = () =>
  json({ Siri: { ServiceDelivery: { StopMonitoringDelivery: [{ Status: 'true' }] } } });

/** A SIRI Lite server for Pader: stop 5782 is only known by its GTFS stop_id. */
function liteRoutes(overrides = {}) {
  const sm = `${LITE}stop-monitoring?MonitoringRef=`;
  return {
    [`${LITE}stoppoints-discovery`]: 404,
    [`${sm}5780`]: () => json(fixtureJson('siri/lite-stop-monitoring-5780.json')),
    [`${sm}5781`]: () => json(fixtureJson('siri/lite-stop-monitoring-5781.json')),
    [`${sm}5782`]: () =>
      json({
        Siri: {
          ServiceDelivery: {
            StopMonitoringDelivery: [
              {
                Status: 'false',
                ErrorCondition: {
                  InvalidDataReferencesError: { ErrorText: 'Unknown MonitoringRef 5782' },
                },
              },
            ],
          },
        },
      }),
    [`${sm}stop_point%3ASP_2028`]: emptyLite,
    [`${LITE}general-message`]: () => json(fixtureJson('siri/lite-general-message.json')),
    ...overrides,
  };
}

/** Pader on a SIRI Lite network, its device created, the key in the configuration. */
async function liteWorld(t, { config = { siri_keys: `Tisséo = ${KEY}` }, routes = {} } = {}) {
  const network = createFetch(liteRoutes(routes));
  const world = await createWorld({ networks: [], network, config });
  t.after(() => world.app.stop());
  const added = await action(world, 'add_network', {
    network: GTFS_URL,
    name: 'Tisséo',
    siri: LITE,
  });
  const stop = await action(world, 'add_stop', { stop: 'Pader' });
  const device = await create(world, 'Pader');
  return { world, network, added, stop, device };
}

const siriCalls = (network, base = LITE) => network.calls.filter((c) => c.url.startsWith(base));

test('SIRI Lite: the board shows the server visits in place of the timetable', async (t) => {
  const { world, network, added, device } = await liteWorld(t);
  assert.equal(
    fr(added),
    [
      'Tisséo ajouté : 7 arrêts, 32 lignes.',
      'Temps réel : SIRI Lite, interrogé arrêt par arrêt.',
      'Cherchez maintenant vos arrêts avec « Chercher un arrêt ».',
    ].join('\n'),
  );
  const state = (key) => world.fake.lastState(featureId(device, key));
  // 17:19:07. Line 29: the server's 17:21:40, then the timetable after it.
  assert.equal(state('29-0-next'), 2);
  assert.equal(state('29-0-following'), 23);
  // L10 towards Fenouillet: two buses tracked (17:24:30, 17:32:10).
  assert.equal(state('l10-0-next'), 5);
  assert.equal(state('l10-0-following'), 13);
  // 169: the server gives its timetable time (not tracked).
  assert.equal(state('169-0-next'), 7);
  // L10 towards La Vache: the 17:24 is cancelled, the 17:19 has left; the
  // timetable takes over after the cancelled one (17:33, 17:37).
  assert.equal(state('l10-1-next'), 13);
  assert.equal(state('l10-1-following'), 17);
  // 59 towards La Vache: 17:20 expected 17:22:30.
  assert.equal(state('59-1-next'), 3);
  // Stop 5782 answered nothing (known as stop_point:SP_2028): timetable.
  assert.equal(state('59-0-next'), 2);
  assert.equal(
    state('board'),
    '29 → Fonbeauzard Mermoz 2 min · 59 → Saint-Jory Collège ≈2 min · 59 → La Vache 3 min',
  );
  assert.equal(state('traffic'), 'L10 : arrêt Borderouge déplacé');

  // The key, as HTTP Basic (an unknown platform) and the profile's header.
  const sm = siriCalls(network).filter((c) => c.url.includes('stop-monitoring'));
  assert.ok(sm.length >= 3);
  for (const call of sm) {
    assert.equal(call.headers.authorization, `Basic ${Buffer.from(`${KEY}:`).toString('base64')}`);
    assert.equal(call.headers['x-siri-requestorref'], KEY);
  }
  // 5782 unknown, then its stop_id: remembered.
  assert.deepEqual(
    sm.map((c) => decodeURIComponent(c.url.split('MonitoringRef=')[1])).sort(),
    ['5780', '5781', '5782'].sort(),
    'the first refresh asks the stop codes',
  );
  const before = network.calls.length;
  world.clock.advance(60_000);
  await world.service.refresh();
  assert.deepEqual(
    network.calls
      .slice(before)
      .map((c) => decodeURIComponent(c.url.replace(LITE, '')))
      .sort(),
    [
      'stop-monitoring?MonitoringRef=5780',
      'stop-monitoring?MonitoringRef=5781',
      'stop-monitoring?MonitoringRef=stop_point:SP_2028',
    ],
    'one request per stop point, the disruptions every 5 minutes only',
  );
  const status = fr(await action(world, 'status'));
  assert.match(
    status,
    /Temps réel \(SIRI Lite\) : mis à jour il y a 0 s, \d+ passage\(s\) suivi\(s\), 3 requête\(s\) par rafraîchissement/,
  );
  // The device is the one of a GTFS-RT network: same keys, same features.
  assert.deepEqual(
    device.params.map((p) => p.name),
    ['network', 'stop_id', 'lines', 'network_name', 'gtfs_url', 'realtime_urls', 'siri_url'],
  );
  const saved = JSON.parse(await readFile(join(world.dataDir, 'watch.json'), 'utf8'));
  assert.deepEqual(saved.networks[0].siri, [
    { url: LITE, format: 'siri-lite', requestorRef: null },
  ]);
  assert.ok(!JSON.stringify(saved).includes(KEY), 'the key stays in the configuration');
});

test('SIRI Lite: the key never reaches the logs, a normal cycle writes nothing at info', async (t) => {
  const debug = captureLogs(t, 'debug');
  const { world } = await liteWorld(t);
  const info = debug.filter((l) => ['info', 'warn', 'error'].includes(l.level));
  assert.deepEqual(
    info.map((l) => l.text.replace(/^.*\[(gtfs[\w-]*)\] /, '')),
    [
      'Tisséo: timetable downloaded (0.2 MB)',
      `Network added: Tisséo (${customNetworkId(GTFS_URL)})`,
      'Stop added: Pader (Tisséo)',
    ],
    'one line per action of the user, nothing about SIRI',
  );
  const count = debug.length;
  for (let i = 0; i < 3; i += 1) {
    world.clock.advance(60_000);
    await world.service.refresh();
  }
  assert.deepEqual(
    debug.slice(count).filter((l) => l.level !== 'debug'),
    [],
  );
  assert.ok(debug.every((l) => !l.text.includes(KEY)));
});

test('SIRI Lite: a new disruption on a followed line fires the trigger', async (t) => {
  const message = fixtureJson('siri/lite-general-message.json');
  const { world, network } = await liteWorld(t);
  assert.deepEqual(world.fake.sceneEvents, [], 'what was there at the first check is known');
  const [first] = message.Siri.ServiceDelivery.GeneralMessageDelivery[0].InfoMessage;
  message.Siri.ServiceDelivery.GeneralMessageDelivery[0].InfoMessage.push({
    ...first,
    InfoMessageIdentifier: { value: 'TEST:InfoMessage::29-deviation:LOC' },
    Content: {
      LineRef: [{ value: '29' }],
      Message: [
        { MessageType: 'shortMessage', MessageText: { value: '29 : déviation', lang: 'fr' } },
      ],
    },
  });
  network.routes[`${LITE}general-message`] = () => json(message);
  world.clock.advance(60_000);
  await world.service.refresh();
  assert.deepEqual(world.fake.sceneEvents, [], 'read every 5 minutes');
  world.clock.advance(4 * 60_000);
  await world.service.refresh();
  const events = world.fake.sceneEvents.filter((e) => e.key === TRIGGERS.DISRUPTION);
  assert.deepEqual(
    events.map((e) => [e.data.scope, e.data.line, e.data.title]),
    [['line', '29', '29 : déviation']],
  );
});

test('SIRI: the stops without departure soon are asked every 15 minutes only', async (t) => {
  const { world, network } = await liteWorld(t);
  // 01:30 at night: nothing at Pader before the morning.
  world.clock.advance(8 * 3600_000 + 11 * 60_000);
  await world.service.refresh();
  const night = network.calls.length;
  for (let i = 0; i < 10; i += 1) {
    world.clock.advance(60_000);
    await world.service.refresh();
  }
  assert.equal(network.calls.length, night, 'nothing for 10 minutes');
  world.clock.advance(5 * 60_000);
  await world.service.refresh();
  assert.ok(network.calls.length > night);
});

test('SIRI: 429 stops every request for its Retry-After, an unknown stop is said', async (t) => {
  const unknown = () => json({}, 404);
  const sm = `${LITE}stop-monitoring?MonitoringRef=`;
  const { world, network, device } = await liteWorld(t, {
    routes: Object.fromEntries(
      ['5780', '5781', 'stop_point%3ASP_327', 'stop_point%3ASP_97', 'stop_point%3ASP_2028']
        .concat(['SP_327', 'SP_97', 'SP_2028'])
        .map((ref) => [`${sm}${ref}`, unknown]),
    ),
  });
  // Every candidate of every stop point refused: the timetable, and the
  // status says so; asked again in 6 hours.
  world.clock.advance(60_000);
  await world.service.refresh();
  world.clock.advance(60_000);
  await world.service.refresh();
  assert.match(
    fr(await action(world, 'status')),
    /Arrêts inconnus du serveur SIRI : Pader\. Donnez leur identifiant SIRI avec « Ajouter un arrêt »\./,
  );
  assert.match(world.fake.lastState(featureId(device, 'board')), /^[^·]*≈/);
  const quiet = network.calls.length;
  world.clock.advance(60_000);
  await world.service.refresh();
  assert.equal(
    network.calls.slice(quiet).filter((c) => c.url.includes('stop-monitoring')).length,
    0,
  );
  network.routes[`${sm}5780`] = () => json(fixtureJson('siri/lite-stop-monitoring-5780.json'));
  world.clock.advance(6 * 3600_000);
  await world.service.refresh();
  network.routes[`${LITE}stop-monitoring?MonitoringRef=5780`] = () =>
    new Response('Rate limit exceeded', { status: 429, headers: { 'retry-after': '120' } });
  world.clock.advance(60_000);
  await world.service.refresh();
  const blocked = network.calls.length;
  world.clock.advance(60_000);
  await world.service.refresh();
  assert.equal(network.calls.length, blocked, 'nothing during the 2 minutes asked');
  world.clock.advance(70_000);
  await world.service.refresh();
  assert.ok(network.calls.length > blocked);
});

test('SIRI Lite: the stop reference typed by the user is the one asked', async (t) => {
  const { world, network, device } = await liteWorld(t, {
    routes: {
      [`${LITE}stop-monitoring?MonitoringRef=PADER-ALL`]: () =>
        json(fixtureJson('siri/lite-stop-monitoring-5780.json')),
    },
  });
  const message = await action(world, 'add_stop', { stop: 'Pader', siri_ref: 'PADER-ALL' });
  assert.match(fr(message), /Identifiant SIRI : PADER-ALL\./);
  const before = network.calls.length;
  world.clock.advance(60_000);
  await world.service.refresh();
  assert.deepEqual(
    network.calls.slice(before).map((c) => c.url),
    [`${LITE}stop-monitoring?MonitoringRef=PADER-ALL`],
  );
  assert.equal(world.fake.lastState(featureId(device, 'l10-0-next')), 4);
  const again = await action(world, 'add_stop', { stop: 'Pader' });
  assert.doesNotMatch(fr(again), /SIRI/);
  assert.equal(world.service.watch.stops[0].siri, undefined, 'empty: found automatically');
});

/** A SOAP server: discovery, stop monitoring, general message; every body recorded. */
function soapServer(bodies, { refuse = false } = {}) {
  return async (url, init) => {
    const body = String(init.body);
    bodies.push(body);
    if (refuse) {
      const fault = fixture('siri/soap-fault-access.xml')
        .toString('utf8')
        .replace('KEY-PLACEHOLDER', 'ABCD-1234');
      return xml(fault, 500);
    }
    if (body.includes('<sw:StopPointsDiscovery')) {
      return xml(fixture('siri/soap-stop-points-discovery.xml'));
    }
    if (body.includes('<sw:GetGeneralMessage')) {
      return xml(fixture('siri/soap-general-message.xml'));
    }
    if (body.includes('<siri:MonitoringRef>TEST:StopPoint:BP:5780:LOC<')) {
      return xml(fixture('siri/soap-stop-monitoring-5780.xml'));
    }
    if (body.includes('<sw:GetStopMonitoring')) {
      return xml(
        '<S:Envelope xmlns:S="x"><S:Body><Answer><StopMonitoringDelivery><Status>true</Status></StopMonitoringDelivery></Answer></S:Body></S:Envelope>',
      );
    }
    return xml(
      '<S:Envelope xmlns:S="x"><S:Body><S:Fault><faultstring>?</faultstring></S:Fault></S:Body></S:Envelope>',
      500,
    );
  };
}

test('SIRI over SOAP: discovery maps the stops, the key is the RequestorRef', async (t) => {
  const bodies = [];
  const network = createFetch({ [SOAP]: soapServer(bodies) });
  const world = await createWorld({ networks: [], network, config: { siri_keys: 'ABCD-1234' } });
  t.after(() => world.app.stop());
  await action(world, 'add_network', { network: GTFS_URL, name: 'Tisséo', siri: SOAP });
  await action(world, 'add_stop', { stop: 'Pader' });
  const device = await create(world, 'Pader');
  assert.ok(
    bodies.every((body) => body.includes('<siri:RequestorRef>ABCD-1234</siri:RequestorRef>')),
  );
  const asked = bodies
    .map((body) => /<siri:MonitoringRef>([^<]+)</.exec(body)?.[1])
    .filter(Boolean)
    .sort();
  // 5780 and 5781 by their code, the third point by its name within 100 m.
  assert.deepEqual(asked, [
    'TEST:StopPoint:BP:5780:LOC',
    'TEST:StopPoint:BP:5781:LOC',
    'TEST:StopPoint:BP:PADER3:LOC',
  ]);
  assert.equal(bodies.filter((body) => body.includes('<sw:StopPointsDiscovery')).length, 1);
  // L10 towards Fenouillet: 17:22 expected 17:25:10 (6 min); line 29 not tracked: ≈.
  assert.equal(world.fake.lastState(featureId(device, 'l10-0-next')), 6);
  assert.equal(world.fake.lastState(featureId(device, '29-0-next')), 1);
  assert.match(
    world.fake.lastState(featureId(device, 'board')),
    /29 → Fonbeauzard & Mermoz ≈1 min/,
  );
  assert.equal(
    world.fake.lastState(featureId(device, 'traffic')),
    "Ligne 29 : déviation rue de l'Industrie",
  );
});

test('SIRI over SOAP: a refused key is said once, without the key, and the timetable stays', async (t) => {
  const bodies = [];
  const network = createFetch({ [SOAP]: soapServer(bodies) });
  const world = await createWorld({ networks: [], network, config: { siri_keys: 'ABCD-1234' } });
  t.after(() => world.app.stop());
  await action(world, 'add_network', { network: GTFS_URL, name: 'Tisséo', siri: SOAP });
  await action(world, 'add_stop', { stop: 'Pader' });
  const device = await create(world, 'Pader');
  const logs = captureLogs(t, 'debug');
  network.routes[SOAP] = soapServer(bodies, { refuse: true });
  for (let i = 0; i < 3; i += 1) {
    world.clock.advance(60_000);
    await world.service.refresh();
  }
  const warnings = logs.filter((l) => l.level === 'warn');
  assert.equal(warnings.length, 1);
  assert.match(
    warnings[0].text,
    /Tisséo: realtime \(SIRI\) unavailable: soap\.example\.org: HTTP 500 \(RequestorRef \*\*\* is not allowed\)/,
  );
  assert.ok(logs.every((l) => !l.text.includes('ABCD-1234')));
  const status = fr(await action(world, 'status'));
  assert.match(status, /Temps réel \(SIRI\) : accès refusé par le serveur\. Vérifiez la clé d'API/);
  assert.ok(!status.includes('ABCD-1234'));
  // Ten minutes later the visits are too old: the timetable, marked so.
  world.clock.advance(10 * 60_000);
  await world.service.refresh();
  assert.match(world.fake.lastState(featureId(device, 'board')), /≈/);
  assert.doesNotMatch(
    world.fake.lastState(featureId(device, 'board')),
    /\d min ·.*(?<!≈)\b\d+ min$/,
  );
});

// --- the catalog -----------------------------------------------------------------------

const GINKO_GTFS = 'https://example.org/ginko-like/gtfs.zip';
// The shape of a dataset of https://transport.data.gouv.fr/api/datasets that
// publishes SIRI and no GTFS-RT (fields as the API gives them); its timetable
// is the Tisséo fixture.
const SIRI_DATASET = {
  id: 'test-siri-dataset',
  slug: 'test-siri',
  title: 'Réseau urbain Testbus',
  type: 'public-transit',
  licence: 'odc-odbl',
  page_url: 'https://transport.data.gouv.fr/datasets/test-siri',
  covered_area: [{ nom: 'Testville' }],
  offers: [{ nom_commercial: 'Testbus', nom_aom: 'Testville Métropole' }],
  legal_owners: [],
  resources: [
    { id: 990001, format: 'GTFS', title: 'GTFS Testbus', url: GINKO_GTFS, is_available: true },
    {
      id: 990002,
      format: 'SIRI',
      title: 'API SIRI',
      url: SOAP,
      original_url: SOAP,
      is_available: true,
      requestor_ref: 'opendata',
    },
    { id: 990003, format: 'NeTEx', title: 'NeTEx', url: 'https://example.org/netex.zip' },
  ],
};

function catalogFetch(overrides = {}) {
  return createFetch({
    [CATALOG_URL]: [...fixtureJson('catalog/datasets-sample.json'), SIRI_DATASET],
    [GINKO_GTFS]: fixture('gtfs/tisseo-gtfs-sample.zip'),
    ...overrides,
  });
}

test('catalog: a network publishing SIRI only is listed and added with it', async (t) => {
  const bodies = [];
  const world = await createWorld({
    networks: [],
    network: catalogFetch({ [SOAP]: soapServer(bodies) }),
    // The key of another network, typed alone: never sent to an open server.
    config: { siri_keys: 'KEY-OF-GINKO' },
  });
  t.after(() => world.app.stop());
  assert.match(
    fr(await action(world, 'search_networks', { query: 'Testbus' })),
    /• Testbus \[tdg990001\] — GTFS Testbus — temps réel : passages arrêt par arrêt \(SIRI\)/,
  );
  const added = await action(world, 'add_network', { network: 'tdg990001' });
  assert.match(fr(added), /Temps réel : SIRI, interrogé arrêt par arrêt\./);
  assert.doesNotMatch(fr(added), /clé/, 'the RequestorRef of the catalog is public');
  await action(world, 'add_stop', { stop: 'Pader' });
  assert.ok(bodies.length > 0);
  assert.ok(
    bodies.every((body) => body.includes('<siri:RequestorRef>opendata</siri:RequestorRef>')),
  );
});

test('catalog: a SIRI Lite network without public key says where the key goes', async (t) => {
  const lite = structuredClone(SIRI_DATASET);
  lite.resources[1] = { id: 990004, format: 'SIRI Lite', title: 'SIRI Lite', url: LITE };
  const world = await createWorld({
    networks: [],
    network: catalogFetch({ [CATALOG_URL]: [lite], ...liteRoutes() }),
  });
  t.after(() => world.app.stop());
  const added = await action(world, 'add_network', { network: 'tdg990001' });
  assert.match(
    fr(added),
    /Temps réel : SIRI Lite, interrogé arrêt par arrêt\.\nSi le réseau demande une clé d'API, saisissez-la dans la configuration de l'intégration \(« Clés d'API SIRI »\)\./,
  );
});

test('a catalog network added before SIRI gets its endpoints at the next start', async (t) => {
  const bodies = [];
  const world = await createWorld({
    networks: [],
    network: catalogFetch({ [SOAP]: soapServer(bodies) }),
    saved: {
      networks: [
        { id: 'tdg990001', name: 'Testbus', gtfs: GINKO_GTFS, realtime: [], source: 'catalog' },
      ],
      stops: [{ network: 'tdg990001', id: PADER, name: 'Pader', lines: [] }],
    },
  });
  t.after(() => world.app.stop());
  assert.deepEqual(world.service.watch.networks[0].siri, [
    { url: SOAP, format: 'siri', requestorRef: 'opendata' },
  ]);
  assert.ok(world.service.feeds.get('tdg990001').usesSiri);
  assert.ok(bodies.some((body) => body.includes('<sw:GetStopMonitoring')));
});

test('a network with GTFS-RT never asks SIRI', async (t) => {
  const both = structuredClone(SIRI_DATASET);
  both.resources.push({
    id: 990005,
    format: 'gtfs-rt',
    url: 'https://example.org/rt.pb',
    features: ['trip_updates'],
  });
  const world = await createWorld({
    networks: [],
    network: catalogFetch({ [CATALOG_URL]: [both] }),
  });
  t.after(() => world.app.stop());
  await action(world, 'add_network', { network: 'tdg990001' });
  await action(world, 'add_stop', { stop: 'Pader' });
  assert.equal(world.service.feeds.get('tdg990001').usesSiri, false);
  assert.equal(world.network.calls.filter((c) => c.url === SOAP).length, 0);
  assert.equal(FIXTURE_TIME, world.clock.now());
});
