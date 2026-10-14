// -----------------------------------------------------------------------------
// Device building details that the end-to-end tests do not reach: identifiers
// of stops whose id carries colons, lines sharing a short name, line labels.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupKey, lineLabel, stopCode, stopPlatformId } from '../src/devices.js';

test('stop identifiers: the network, then the stop id made safe for Gladys', () => {
  assert.equal(stopPlatformId('tdg83582', 'StopArea:OCE87481002'), 'tdg83582-StopArea-OCE87481002');
  assert.equal(
    stopPlatformId('url1a2b3c4d', 'FR_NAOLIB:StopPlace:20'),
    'url1a2b3c4d-FR_NAOLIB-StopPlace-20',
  );
  assert.equal(stopCode('FR_NAOLIB:StopPlace:20'), '20');
  assert.equal(stopCode('1707'), '1707');
});

test('two routes with the same short name at a stop keep distinct feature keys', () => {
  const group = (id, short, dir = 0) => ({ route: { id, short }, dir });
  const groups = [group('r1', 'C1'), group('r2', 'C1'), group('r1', 'C1', 1), group('r3', '15')];
  assert.deepEqual(
    groups.map((g) => groupKey(g, groups)),
    ['c1-r1-0', 'c1-r2-0', 'c1-1', '15-0'],
  );
});

test('line labels: the mode before a short name, a long name alone', () => {
  const route = (short, mode) => ({ short, mode });
  assert.equal(lineLabel(route('A', 'metro'), 'fr'), 'Métro A');
  assert.equal(lineLabel(route('C30', 'train'), 'de'), 'Zug C30');
  assert.equal(lineLabel(route('Nantes - Angers', 'train'), 'fr'), 'Nantes - Angers');
  assert.equal(lineLabel(route('Bus 12', 'bus'), 'fr'), 'Bus 12');
  assert.equal(lineLabel(route('7', 'ferry'), 'es'), 'Barco 7');
});
