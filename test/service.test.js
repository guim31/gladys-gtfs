// -----------------------------------------------------------------------------
// The integration end to end, against the SDK's fake Gladys and the real
// (reduced) open data: catalog, networks, configuration actions, discovered
// devices, states, scene triggers, persistence, failures of the feeds.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { CATALOG_URL } from '../src/catalog.js';
import { MAX_NETWORKS, TRIGGERS } from '../src/service.js';
import { NO_DEPARTURE_MINUTES } from '../src/devices.js';
import {
  FIXTURE_TIME,
  GTFS_RT_URL,
  GTFS_URL,
  JEAN_JAURES,
  NANTES,
  PADER,
  SNCF,
  SNCF_ALERTS_URL,
  SNCF_TIME,
  SNCF_TRIP_UPDATES_URL,
  TISSEO,
  action,
  captureLogs,
  create,
  createClock,
  createFetch,
  createWorld,
  discovered,
  featureId,
  fixture,
} from './helpers/world.js';
import { encodeFeed } from './helpers/protobuf.js';

const fr = (message) => message.fr;

test('nothing added: no download at all, the actions ask for a network first', async (t) => {
  const world = await createWorld({ networks: [] });
  t.after(() => world.app.stop());
  assert.equal(world.network.calls.length, 0);
  assert.deepEqual(world.fake.discoveredDevices, []);
  const status = await action(world, 'status');
  assert.match(fr(status), /Réseaux : 0/);
  assert.match(fr(status), /Aucun réseau pour l'instant/);
  assert.match(fr(await action(world, 'search_stops', { query: 'x' })), /Ajouter un réseau/);
});

test('find a network in the catalog: brand, city, several timetables, no realtime', async (t) => {
  const world = await createWorld({ networks: [] });
  t.after(() => world.app.stop());
  const tisseo = await action(world, 'search_networks', { query: 'tisseo' });
  assert.match(
    fr(tisseo),
    /^1 réseau\(x\) trouvé\(s\) :\n• Tisséo \[tdg81678\] — Tisseo_GTFS\.zip — temps réel : passages \+ alertes\n/,
  );
  assert.match(tisseo.en, /run "Add a network" with its identifier/);
  const nantes = await action(world, 'search_networks', { query: 'Nantes' });
  assert.match(fr(nantes), /• Naolib \[tdg84101\]/);
  assert.match(fr(nantes), /• Pays de la Loire \[tdg79818\] .* temps réel : aucun/);
  // STAR publishes the current and the next timetable: both listed.
  const star = await action(world, 'search_networks', { query: 'star rennes' });
  assert.match(fr(star), /\[tdg83282\][\s\S]*\[tdg83281\]|\[tdg83281\][\s\S]*\[tdg83282\]/);
  // The catalog is read once, then kept in memory.
  assert.equal(world.network.calls.filter((c) => c.url === CATALOG_URL).length, 1);
  assert.match(
    fr(await action(world, 'search_networks', { query: 'Vélos' })),
    /Rien ne correspond/,
  );
  assert.match(fr(await action(world, 'search_networks', { query: ' ' })), /Saisissez un réseau/);
});

test('the catalog unreachable: said plainly', async (t) => {
  const world = await createWorld({ networks: [], network: createFetch({ [CATALOG_URL]: 502 }) });
  t.after(() => world.app.stop());
  assert.match(
    fr(await action(world, 'search_networks', { query: 'Naolib' })),
    /Le catalogue de transport\.data\.gouv\.fr n'a pas pu être lu \(transport\.data\.gouv\.fr: HTTP 502\)/,
  );
});

test('add a network: by identifier, number or name; ambiguous, known, full, failing', async (t) => {
  const world = await createWorld({ networks: [] });
  t.after(() => world.app.stop());
  const added = await action(world, 'add_network', { network: '81678' });
  assert.equal(
    fr(added),
    [
      'Tisséo ajouté : 7 arrêts, 32 lignes.',
      'Temps réel : 1 flux.',
      'Licence des données : ODbL.',
      'Cherchez maintenant vos arrêts avec « Chercher un arrêt ».',
    ].join('\n'),
  );
  assert.ok((await stat(join(world.dataDir, `gtfs-${TISSEO}.zip`))).size > 100000);
  assert.match(fr(await action(world, 'add_network', { network: 'Tisséo' })), /déjà ajouté/);
  const ambiguous = await action(world, 'add_network', { network: 'STAR' });
  assert.match(fr(ambiguous), /^Plusieurs réseaux correspondent à « STAR »/);
  // A download that fails leaves nothing behind.
  world.network.routes[
    'https://www.data.gouv.fr/api/1/datasets/r/65bdd7e4-a8e7-4a54-893a-808e71c34d68'
  ] = 503;
  const failed = await action(world, 'add_network', { network: 'tdg84101' });
  assert.match(
    fr(failed),
    /^Les horaires de Naolib n'ont pas pu être lus \(www\.data\.gouv\.fr: HTTP 503\)/,
  );
  assert.deepEqual(
    world.service.watch.networks.map((n) => n.id),
    [TISSEO],
  );
  const saved = JSON.parse(await readFile(join(world.dataDir, 'watch.json'), 'utf8'));
  assert.equal(saved.networks[0].gtfs, GTFS_URL);
  assert.deepEqual(saved.networks[0].realtime, [GTFS_RT_URL]);
});

test('a network outside the catalog, by URL, with its realtime feed; too big refused', async (t) => {
  const network = createFetch({
    'https://example.org/gtfs.zip': fixture('gtfs/tisseo-gtfs-sample.zip'),
    'https://example.org/rt.pb': fixture('gtfs/tisseo-gtfsrt-sample.pb'),
    // Undici drops a hand-made content-length: a response-like object.
    'https://example.org/huge.zip': () => ({
      isResponse: true,
      ok: true,
      status: 200,
      headers: new Map([['content-length', '900000000']]),
      body: new Response('PK').body,
    }),
  });
  const world = await createWorld({ networks: [], network });
  t.after(() => world.app.stop());
  const added = await action(world, 'add_network', {
    network: 'https://example.org/gtfs.zip',
    realtime: 'https://example.org/rt.pb not-a-url',
    name: 'Mon réseau',
  });
  assert.match(fr(added), /^Mon réseau ajouté : 7 arrêts, 32 lignes/);
  const [custom] = world.service.watch.networks;
  assert.match(custom.id, /^url[0-9a-f]{8}$/);
  assert.deepEqual(custom.realtime, ['https://example.org/rt.pb']);
  const huge = await action(world, 'add_network', { network: 'https://example.org/huge.zip' });
  assert.match(fr(huge), /trop gros pour les 256 Mo de l'intégration/);
  assert.equal(world.service.watch.networks.length, 1);
});

test(`${MAX_NETWORKS} networks at most`, async (t) => {
  const network = createFetch();
  for (const n of [1, 2, 3]) {
    network.routes[`https://example.org/${n}.zip`] = fixture('gtfs/tisseo-gtfs-sample.zip');
  }
  const world = await createWorld({ network });
  t.after(() => world.app.stop());
  await action(world, 'add_network', { network: 'https://example.org/1.zip' });
  await action(world, 'add_network', { network: 'https://example.org/2.zip' });
  assert.match(
    fr(await action(world, 'add_network', { network: 'https://example.org/3.zip' })),
    /3 réseaux au plus/,
  );
});

test('search: by name (accents and case ignored), around the home, nothing found', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const byName = await action(world, 'search_stops', { query: 'jean jaures' });
  assert.match(fr(byName), /3 arrêt\(s\) trouvé\(s\)/);
  assert.match(
    fr(byName),
    /• Jean Jaurès \[SA_1707\] — A, B, 15, 23, AERO, CIMTR, L1, L9, L14, VILLE — 550 m\n/,
  );
  assert.doesNotMatch(fr(byName), /\(Tisséo\)/, 'a single network is not named');
  assert.match(byName.en, /To watch one/);
  const near = await action(world, 'search_stops', {});
  assert.match(fr(near), /Arrêts les plus proches de Maison/);
  assert.match(fr(near).split('\n')[1], /Jean Jaurès \[SA_1707\].* — 550 m$/);
  const none = await action(world, 'search_stops', { query: 'Zzyzx' });
  assert.equal(fr(none), 'Rien ne correspond à « Zzyzx ».');
  // The timetable was downloaded once, when the network was added.
  assert.equal(world.network.calls.filter((c) => c.url === GTFS_URL).length, 1);
});

test('search around the home without a located house asks for a name', async (t) => {
  const world = await createWorld({
    houses: [{ id: 'h', name: 'Maison', selector: 'm', latitude: null, longitude: null }],
  });
  t.after(() => world.app.stop());
  assert.match(fr(await action(world, 'search_stops', {})), /Saisissez un nom/);
});

test('add a stop: homonyms by identifier, line filter checked, then its device', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const ambiguous = await action(world, 'add_stop', { stop: 'Jean Jaurès' });
  assert.match(fr(ambiguous), /Plusieurs résultats/);
  assert.match(fr(ambiguous), /SA_2224/);
  const wrongLine = await action(world, 'add_stop', { stop: 'SA_1707', lines: 'A, T1' });
  assert.match(
    fr(wrongLine),
    /Ligne\(s\) absente\(s\) de cet arrêt : T1\. Lignes desservies : A, B, 15, 23, AERO, CIMTR, L1, L9, L14, VILLE\./,
  );
  const added = await action(world, 'add_stop', { stop: 'sa_1707', lines: 'a l1' });
  assert.equal(
    fr(added),
    "Jean Jaurès ajouté (A, L1).\nOuvrez l'onglet Découverte pour créer son appareil.",
  );
  const device = discovered(world, 'Jean Jaurès');
  assert.equal(device.name, 'Tisséo · Jean Jaurès (A, L1)');
  assert.deepEqual(device.params.slice(0, 3), [
    { name: 'network', value: TISSEO },
    { name: 'stop_id', value: JEAN_JAURES },
    { name: 'lines', value: 'A,L1' },
  ]);
  assert.equal(device.should_poll, false);
  assert.deepEqual(
    device.features.map((f) => f.name),
    [
      'Métro A → Balma-Gramont',
      'Métro A → Balma-Gramont (suivant)',
      'Métro A → Basso Cambo',
      'Métro A → Basso Cambo (suivant)',
      'Bus L1 → Fonsegrives Entiore',
      'Bus L1 → Fonsegrives Entiore (suivant)',
      'Bus L1 → Sept Deniers - Salvador Dali',
      'Bus L1 → Sept Deniers - Salvador Dali (suivant)',
      'Prochains passages',
      'Info trafic',
    ],
  );
  assert.ok(device.external_id.endsWith(':stop:tdg81678-stop_area-SA_1707'));
  assert.ok(featureId(device, 'a-0-next'));
  // Adding it again changes its lines.
  const updated = await action(world, 'add_stop', { stop: 'SA_1707' });
  assert.match(fr(updated), /Jean Jaurès mis à jour \(toutes les lignes\)/);
  assert.equal(discovered(world, 'Jean Jaurès').name, 'Tisséo · Jean Jaurès');
  const saved = JSON.parse(await readFile(join(world.dataDir, 'watch.json'), 'utf8'));
  assert.deepEqual(saved.stops, [
    { network: TISSEO, id: JEAN_JAURES, name: 'Jean Jaurès', lines: [] },
  ]);
});

test('states: published once the device is created, then only what changed', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await action(world, 'add_stop', { stop: 'Pader' });
  assert.equal(world.fake.states.length, 0, 'nothing for a device not created yet');
  const device = await create(world, 'Pader');
  const next = featureId(device, 'l10-1-next');
  assert.equal(world.fake.lastState(next), 0);
  assert.equal(world.fake.lastState(featureId(device, 'l10-1-following')), 5);
  assert.match(world.fake.lastState(featureId(device, 'board')), /min/);
  assert.equal(world.fake.lastState(featureId(device, 'traffic')), 'Aucune perturbation');
  const count = world.fake.states.length;
  await world.service.refresh();
  assert.equal(world.fake.states.length, count, 'same minute, nothing new');
  world.clock.advance(60_000);
  await world.service.refresh();
  assert.ok(world.fake.states.length > count, 'a minute later, the countdowns moved');
  assert.ok(world.fake.states.length - count < device.features.length);
  assert.equal(
    world.fake.widgetRefreshes.at(-1)?.key ?? world.fake.widgetRefreshes.at(-1),
    'departures',
  );
});

test('a line with no departure in the next 24 hours reads the maximum', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await action(world, 'add_stop', { stop: 'SA_1707', lines: 'CIMTR' });
  const device = await create(world, 'Jean Jaurès');
  for (const feature of device.features.filter((f) => f.category === 'duration')) {
    assert.equal(world.fake.lastState(feature.external_id), NO_DEPARTURE_MINUTES);
  }
  assert.equal(world.fake.lastState(featureId(device, 'board')), 'Aucun passage dans les 24 h');
});

test('the realtime feed: conditional requests, off in the configuration, night pace', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await action(world, 'add_stop', { stop: 'Pader' });
  const rt = () => world.network.calls.filter((c) => c.url === GTFS_RT_URL);
  assert.ok(rt().length >= 1);
  world.network.routes[GTFS_RT_URL] = 304;
  world.clock.advance(60_000);
  await world.service.refresh();
  assert.equal(rt().at(-1).headers['if-none-match'], '"fixture"');
  assert.ok(world.service.feeds.get(TISSEO).realtime, 'a 304 keeps the last feed');

  // At 3 a.m., nothing scheduled within 90 minutes: every 15 minutes only.
  world.clock.time = Date.parse('2026-10-14T01:00:00Z');
  const before = rt().length;
  await world.service.refresh();
  world.clock.advance(5 * 60_000);
  await world.service.refresh();
  assert.equal(rt().length, before + 1);
  world.clock.advance(15 * 60_000);
  await world.service.refresh();
  assert.equal(rt().length, before + 2);

  await world.fake.configUpdated({ realtime: false });
  const off = rt().length;
  world.clock.advance(60_000);
  await world.service.refresh();
  assert.equal(rt().length, off);
  assert.equal(world.service.feeds.get(TISSEO).realtime, null);
  assert.match(fr(await action(world, 'status')), /Temps réel : désactivé/);
});

test('feeds down: the timetable keeps working, the logs say it once, no secret', async (t) => {
  const network = createFetch({ [GTFS_RT_URL]: new TypeError('fetch failed') });
  const world = await createWorld({ network });
  t.after(() => world.app.stop());
  const logs = captureLogs(t, 'warn');
  await action(world, 'add_stop', { stop: 'Pader' });
  const device = await create(world, 'Pader');
  assert.equal(typeof world.fake.lastState(featureId(device, 'l10-1-next')), 'number');
  world.clock.advance(60_000);
  await world.service.refresh();
  const lines = logs.filter((l) => /realtime feed unavailable/.test(l.text));
  assert.equal(lines.length, 1);
  assert.match(fr(await action(world, 'status')), /Dernière erreur : /);
});

test('a corrupted download never replaces a good archive', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await action(world, 'add_stop', { stop: 'Pader' });
  const path = join(world.dataDir, `gtfs-${TISSEO}.zip`);
  const size = (await stat(path)).size;
  // A day later, the portal answers an HTML page.
  const old = new Date(Date.now() - 25 * 3600 * 1000);
  await utimes(path, old, old);
  world.network.routes[GTFS_URL] = Buffer.from('<html>maintenance</html>');
  const feed = world.service.feeds.get(TISSEO);
  await feed.ensure();
  assert.equal((await stat(path)).size, size);
  assert.ok(feed.network.areas.has(PADER));
  assert.match(fr(await action(world, 'status')), /Dernière erreur : /);
});

test('remove a stop, and restore the watch list from the devices after a /data loss', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await action(world, 'add_stop', { stop: 'Pader' });
  await action(world, 'add_stop', { stop: 'SA_1707', lines: 'B' });
  const pader = await create(world, 'Pader');
  const jj = await create(world, 'Jean Jaurès');
  assert.match(fr(await action(world, 'remove', { name: 'pader' })), /^Pader retiré de la liste/);
  assert.match(fr(await action(world, 'remove', { name: 'Nowhere' })), /Rien de surveillé/);
  assert.equal(world.fake.discoveredDevices.length, 1);

  // A restart keeps the removal: the device of Pader still in Gladys does not bring it back.
  const restarted = await createWorld({
    devices: [pader, jj],
    networks: [],
    dataDir: world.dataDir,
  });
  t.after(() => restarted.app.stop());
  assert.deepEqual(
    restarted.service.watch.stops.map((s) => s.id),
    [JEAN_JAURES],
  );
  // /data lost: the networks and stops come back from the device params.
  const again = await createWorld({ devices: [pader, jj], networks: [] });
  t.after(() => again.app.stop());
  assert.deepEqual(
    again.service.watch.networks.map((n) => [n.id, n.name, n.gtfs, n.realtime]),
    [[TISSEO, 'Tisséo', GTFS_URL, [GTFS_RT_URL]]],
  );
  assert.deepEqual(
    again.service.watch.stops.map((s) => [s.network, s.id, s.name, s.lines]),
    [
      [TISSEO, PADER, 'Pader', []],
      [TISSEO, JEAN_JAURES, 'Jean Jaurès', ['B']],
    ],
  );
  // The removal of a network takes its stops and its archive along.
  const removed = await action(again, 'remove', { name: 'tisséo' });
  assert.equal(
    fr(removed),
    'Tisséo retiré, avec ses 2 arrêt(s). Supprimez leurs appareils dans Gladys si besoin.',
  );
  assert.deepEqual(again.service.watch.stops, []);
  await assert.rejects(stat(join(again.dataDir, `gtfs-${TISSEO}.zip`)));
});

test('disruptions: what is there at the first check is not announced, a new one is', async (t) => {
  const network = createFetch();
  const world = await createWorld({ network });
  t.after(() => world.app.stop());
  await action(world, 'add_stop', { stop: 'SA_1707', lines: 'L9, A' });
  assert.deepEqual(world.fake.sceneEvents, [], 'the alerts already published are known');
  const device = await create(world, 'Jean Jaurès');
  assert.match(world.fake.lastState(featureId(device, 'traffic')), /^L9 : /);

  const routes = [...world.service.feeds.get(TISSEO).network.routes.values()];
  const metroA = routes.find((r) => r.short === 'A').id;
  const feed = (alerts) => encodeFeed({ timestamp: FIXTURE_TIME / 1000 + 60, alerts });
  network.routes[GTFS_RT_URL] = feed([
    {
      id: 'A:line_A',
      routes: [metroA],
      header: 'A : Interruption entre Arènes et Mermoz',
      description: '<p>Navettes&nbsp;bus.</p>',
      url: 'https://www.tisseo.fr/info/A',
    },
    { id: 'A:line_X', routes: ['line:999'], header: 'Autre ligne' },
    { id: 'A:strike', agency: 'network:1', header: 'Grève jeudi' },
  ]);
  world.clock.advance(60_000);
  await world.service.refresh();
  const events = world.fake.sceneEvents.filter((e) => e.key === TRIGGERS.DISRUPTION);
  assert.deepEqual(
    events.map((e) => e.data),
    [
      {
        scope: 'line',
        network: 'Tisséo',
        line: 'A',
        title: 'A : Interruption entre Arènes et Mermoz',
        description: 'Navettes bus.',
        url: 'https://www.tisseo.fr/info/A',
      },
      {
        scope: 'network',
        network: 'Tisséo',
        line: '',
        title: 'Grève jeudi',
        description: 'Grève jeudi',
        url: '',
      },
    ],
  );
  assert.equal(
    world.fake.lastState(featureId(device, 'traffic')),
    'A : Interruption entre Arènes et Mermoz',
  );
  // Still there a minute later: announced once.
  world.clock.advance(60_000);
  network.routes[GTFS_RT_URL] = feed([
    { id: 'A:line_A', routes: [metroA], header: 'A : Interruption entre Arènes et Mermoz' },
    { id: 'A:strike', agency: 'network:1', header: 'Grève jeudi' },
  ]);
  await world.service.refresh();
  assert.equal(world.fake.sceneEvents.length, 2);
  // A restart remembers what was announced (/data).
  await world.app.stop();
  const again = await createWorld({
    network,
    dataDir: world.dataDir,
    clock: world.clock,
    devices: [device],
    networks: [],
  });
  t.after(() => again.app.stop());
  assert.equal(again.fake.sceneEvents.length, 0);
});

test('scene actions: the sentence of a stop, of a line', async (t) => {
  const world = await createWorld({ config: { language: 'fr' } });
  t.after(() => world.app.stop());
  await action(world, 'add_stop', { stop: 'Pader' });
  await action(world, 'add_stop', { stop: 'SA_1707', lines: 'A' });
  const pader = await create(world, 'Pader');
  const jj = await create(world, 'Jean Jaurès');

  const all = await world.fake.sceneAction('get_next_departures', { stop: pader.external_id });
  assert.equal(all.success, true);
  const out = all.data.outputs;
  assert.equal(out.stop_name, 'Pader');
  assert.equal(out.line, 'Bus L10');
  assert.equal(out.direction, 'La Vache');
  assert.deepEqual([out.minutes, out.following_minutes, out.realtime], [0, 5, 1]);
  assert.match(out.sentence, /^Bus L10 vers La Vache à Pader : maintenant, puis dans 5 min\. /);

  const metro = await world.fake.sceneAction('get_next_departures', {
    stop: jj.external_id,
    line: 'a',
  });
  assert.match(
    metro.data.outputs.sentence,
    /^Métro A vers (Balma-Gramont|Basso Cambo) à Jean Jaurès : .* min \(théorique\)\. Métro A vers /,
  );
  assert.equal(metro.data.outputs.realtime, 0);

  const none = await world.fake.sceneAction('get_next_departures', {
    stop: jj.external_id,
    line: 'B',
  });
  assert.equal(none.data.outputs.sentence, 'Jean Jaurès : aucun passage dans les 24 h');
  assert.equal(none.data.outputs.minutes, NO_DEPARTURE_MINUTES);

  const unknown = await world.fake.sceneAction('get_next_departures', { stop: 'ext:other:x' });
  assert.equal(unknown.success, false);
  assert.match(unknown.error, /n'est plus surveillé/);
});

test('the language of the configuration names the features and the texts', async (t) => {
  const world = await createWorld({ config: { language: 'es' } });
  t.after(() => world.app.stop());
  await action(world, 'add_stop', { stop: 'SA_1707', lines: 'A' });
  const device = discovered(world, 'Jean Jaurès');
  assert.deepEqual(device.features.map((f) => f.name).slice(-2), [
    'Próximas salidas',
    'Info de tráfico',
  ]);
  assert.equal(device.features[0].name, 'Metro A → Balma-Gramont');
  const created = await create(world, 'Jean Jaurès');
  assert.equal(world.fake.lastState(featureId(created, 'traffic')), 'Sin incidencias');
});

test('SNCF at Nantes: two networks, trains named after their destination, trip alerts', async (t) => {
  const world = await createWorld({
    networks: [TISSEO, SNCF],
    clock: createClock(SNCF_TIME),
    houses: [{ id: 'h', name: 'Maison', selector: 'm', latitude: 47.2135, longitude: -1.5562 }],
  });
  t.after(() => world.app.stop());
  const found = await action(world, 'search_stops', { query: 'nantes' });
  assert.match(fr(found), /• Nantes \[OCE87481002\] — .* — 1,2 km \(SNCF TGV, Intercités et TER\)/);
  assert.match(
    fr(await action(world, 'add_stop', { stop: 'Nantes', network: 'Pau' })),
    /Aucun réseau ajouté ne s'appelle « Pau »\. Réseaux : Tisséo \[tdg81678\], SNCF/,
  );
  const added = await action(world, 'add_stop', { stop: 'OCE87481002', network: SNCF });
  // A big station: the device keeps 12 lines and directions, the message says how to choose.
  assert.match(
    fr(added),
    /\d+ lignes et directions passent ici : l'appareil garde les 12 premières/,
  );
  const device = await create(world, 'Nantes');
  assert.equal(device.name, 'SNCF TGV, Intercités et TER · Nantes');
  assert.ok(device.external_id.endsWith(':stop:tdg83582-StopArea-OCE87481002'));
  for (const feature of device.features) {
    // SNCF puts train numbers in trip_headsign: the destination replaces them.
    assert.doesNotMatch(feature.name, /→ \d+( |$)/, feature.name);
  }
  assert.ok(device.features.some((f) => /^Train .* → /.test(f.name)));
  const board = world.fake.lastState(featureId(device, 'board'));
  assert.match(board, /^\S+ → \D[^·]* \d+ min/, 'a train tracked in real time first');
  // SNCF alerts name trips ("OCESN858054F"), not lines: the lines come from the trips.
  assert.match(world.fake.lastState(featureId(device, 'traffic')), /Cordemais/);
  assert.deepEqual(world.fake.sceneEvents, [], 'what was there at the first check is known');
  const tracked = world.service.feeds.get(SNCF).realtime.trips.size;
  assert.equal(tracked, 74);
  assert.ok(world.network.calls.some((c) => c.url === SNCF_TRIP_UPDATES_URL));
  assert.ok(world.network.calls.some((c) => c.url === SNCF_ALERTS_URL));
  // The proxy of transport.data.gouv.fr allows one read per 30 s and per feed.
  const reads = () => world.network.calls.filter((c) => c.url === SNCF_TRIP_UPDATES_URL).length;
  const before = reads();
  world.clock.advance(20_000);
  await world.service.refresh();
  assert.equal(reads(), before);
  world.clock.advance(10_000);
  await world.service.refresh();
  assert.equal(reads(), before + 1);
  // Tisséo has no watched stop: its realtime feed is never read.
  assert.ok(!world.network.calls.some((c) => c.url === GTFS_RT_URL));
  const status = fr(await action(world, 'status'));
  assert.match(status, /■ SNCF TGV, Intercités et TER \[tdg83582\]\n/);
  assert.match(
    status,
    /Temps réel : mis à jour il y a 0 s, 74 trajet\(s\) suivi\(s\), environ \d+(,\d)? Mo par heure/,
  );
  assert.equal(world.service.watch.stops[0].id, NANTES);
});

test('calm logs: a normal refresh writes nothing at info level', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await action(world, 'add_stop', { stop: 'Pader' });
  await create(world, 'Pader');
  const logs = captureLogs(t, 'info');
  for (let i = 0; i < 3; i += 1) {
    world.clock.advance(60_000);
    await world.service.refresh();
  }
  assert.deepEqual(logs, []);
});

test('an alerts feed down for hours does not announce its old alerts again', async (t) => {
  const network = createFetch();
  const world = await createWorld({ network, networks: [SNCF], clock: createClock(SNCF_TIME) });
  t.after(() => world.app.stop());
  await action(world, 'add_stop', { stop: 'OCE87481002' });
  await create(world, 'Nantes');
  // The alerts proxy fails, the trip updates keep coming.
  const alerts = network.routes[SNCF_ALERTS_URL];
  network.routes[SNCF_ALERTS_URL] = new TypeError('fetch failed');
  for (let hour = 0; hour < 8; hour += 1) {
    world.clock.advance(3600_000);
    await world.service.refresh();
  }
  network.routes[SNCF_ALERTS_URL] = alerts;
  world.clock.advance(60_000);
  await world.service.refresh();
  assert.deepEqual(world.fake.sceneEvents, []);
});
