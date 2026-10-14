// -----------------------------------------------------------------------------
// Tisséo service alerts: the operator's HTML made readable, active periods,
// line and network alerts, on the real feed.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  htmlToText,
  isActive,
  pickTranslation,
  readAlerts,
  routesFromTrips,
  trafficText,
  tripStem,
} from '../src/alerts.js';
import { decodeFeed } from '../src/gtfsrt.js';
import { FIXTURE_TIME, fixture } from './helpers/world.js';

const feed = decodeFeed(fixture('gtfs/tisseo-gtfsrt-sample.pb'));

test('the HTML of the operator becomes plain text', () => {
  assert.equal(
    htmlToText(
      '<h1>🟠 Perturbations</h1><p><strong>🚇&nbsp;METRO</strong><br />\r\nLes lignes <strong>A</strong> et&nbsp;<strong>B</strong> fonctionnent.</p>',
    ),
    '🟠 Perturbations\n🚇 METRO\nLes lignes A et B fonctionnent.',
  );
  assert.equal(htmlToText('L&#39;Union &amp; Balma &#x2192; ici'), "L'Union & Balma → ici");
  assert.equal(htmlToText('a &unknown; b'), 'a &unknown; b');
});

test('translations and active periods', () => {
  assert.equal(pickTranslation([{ text: 'Grève', language: '' }], 'en'), 'Grève');
  assert.equal(
    pickTranslation(
      [
        { text: 'Strike', language: 'en' },
        { text: 'Grève', language: 'fr' },
      ],
      'fr',
    ),
    'Grève',
  );
  const now = FIXTURE_TIME;
  assert.equal(isActive({ periods: [] }, now), true);
  assert.equal(isActive({ periods: [{ start: now / 1000 + 60, end: null }] }, now), false);
  assert.equal(isActive({ periods: [{ start: null, end: now / 1000 - 60 }] }, now), false);
  assert.equal(
    isActive({ periods: [{ start: now / 1000 - 60, end: now / 1000 + 60 }] }, now),
    true,
  );
});

test('the real alerts: line alerts with their routes, network alerts flagged', () => {
  const alerts = readAlerts(feed.alerts, { now: FIXTURE_TIME, language: 'fr' });
  assert.equal(alerts.length, 10);
  const network = alerts.filter((alert) => alert.network);
  assert.equal(network.length, 2);
  const l9 = alerts.find((alert) => alert.routes.includes('line:174'));
  assert.match(l9.title, /^L9 : /);
  assert.ok(l9.description.length > 50);
  assert.ok(!/<[a-z]/i.test(l9.description), 'no HTML left');
  assert.match(l9.url, /^https:\/\/www\.tisseo\.fr\//);
  assert.equal(trafficText(alerts, new Set(['line:174'])), l9.title);
  assert.equal(trafficText(alerts, new Set(['line:none'])), '');
});

test('alerts naming trips only get the routes of these trips (SNCF short trip ids)', () => {
  const alerts = [
    { id: '1', routes: [], trips: ['OCESN858054F'], network: false, title: 'Cordemais' },
    { id: '2', routes: [], trips: ['OCESN1F'], network: false, title: 'Ailleurs' },
    { id: '3', routes: ['r9'], trips: [], network: false, title: 'Ligne' },
  ];
  const trips = [
    { id: 'OCESN858054F1187_F:TER:FR:Line::X::87481002:87481614:3:1012:20261014', route: 'r1' },
    { id: 'exact-id', route: 'r2' },
  ];
  assert.equal(tripStem(trips[0].id), 'OCESN858054F');
  const resolved = routesFromTrips(alerts, trips);
  assert.deepEqual(
    resolved.map((alert) => alert.routes),
    [['r1'], [], ['r9']],
  );
  // Nothing to resolve: the same list, untouched.
  const plain = alerts.slice(2);
  assert.equal(routesFromTrips(plain, trips), plain);
});
