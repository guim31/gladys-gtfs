// -----------------------------------------------------------------------------
// The catalog of transport.data.gouv.fr, on a reduced copy of the real answer
// of /api/datasets (14 October 2026): one entry per GTFS resource of a public
// transit dataset, its usable realtime feeds, a short name, the search.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { licenceName, reduceCatalog, searchCatalog } from '../src/catalog.js';
import { fixtureJson } from './helpers/world.js';

const entries = reduceCatalog(fixtureJson('catalog/datasets-sample.json'));
const byId = new Map(entries.map((entry) => [entry.id, entry]));

test('one entry per GTFS resource of a public transit dataset', () => {
  assert.deepEqual([...byId.keys()].sort(), [
    'tdg79818',
    'tdg81177',
    'tdg81678',
    'tdg83281',
    'tdg83282',
    'tdg83582',
    'tdg84101',
  ]);
  assert.equal(reduceCatalog(null).length, 0);
  assert.equal(reduceCatalog([{ type: 'public-transit' }]).length, 0);
});

test('names: the network the GTFS declares, else the brand, else the shortened title', () => {
  assert.equal(byId.get('tdg81678').name, 'Tisséo');
  assert.equal(byId.get('tdg84101').name, 'Naolib');
  assert.equal(byId.get('tdg83582').name, 'SNCF TGV, Intercités et TER');
  assert.equal(byId.get('tdg79818').name, 'Pays de la Loire');
});

test('realtime: trip updates and alerts kept, vehicle positions alone dropped', () => {
  assert.deepEqual(byId.get('tdg81678').realtime, [
    {
      url: 'https://www.data.gouv.fr/api/1/datasets/r/b2343456-4e73-4e5e-bf0f-e8cab63357a8',
      features: ['service_alerts', 'trip_updates'],
    },
  ]);
  // STAR: trip updates, alerts, and vehicle positions (not kept).
  const star = byId.get('tdg83282').realtime.map((r) => r.features.join());
  assert.deepEqual(star.sort(), ['service_alerts', 'trip_updates']);
  assert.deepEqual(byId.get('tdg79818').realtime, []);
  assert.equal(byId.get('tdg83582').licence, 'ODbL');
  assert.equal(licenceName('fr-lo'), 'Licence Ouverte');
});

test('search: brand, city, operator; accents and case ignored; exact names first', () => {
  assert.deepEqual(
    searchCatalog(entries, 'TISSEO').map((e) => e.id),
    ['tdg81678'],
  );
  const nantes = searchCatalog(entries, 'nantes').map((e) => e.id);
  assert.ok(nantes.includes('tdg84101'));
  assert.equal(searchCatalog(entries, 'naolib')[0].id, 'tdg84101');
  assert.deepEqual(searchCatalog(entries, ''), []);
  assert.deepEqual(searchCatalog(entries, 'zzz'), []);
});
