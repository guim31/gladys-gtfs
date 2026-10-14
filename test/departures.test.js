// -----------------------------------------------------------------------------
// The departure board: the real timetable and realtime feed of 13 October
// 2026, 17:19, then encoded feeds for each realtime rule (cancellation,
// skipped stop, delay propagation, passed vehicle, added trips).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBoard, indexRealtime, minutesUntil, upcomingDepartures } from '../src/departures.js';
import { decodeFeed } from '../src/gtfsrt.js';
import { parseGtfs } from '../src/gtfs.js';
import { FIXTURE_TIME, GTFS_ZIP, JEAN_JAURES, PADER, RANGUEIL, fixture } from './helpers/world.js';
import { encodeFeed } from './helpers/protobuf.js';

const network = await parseGtfs(GTFS_ZIP, {
  watched: new Set([JEAN_JAURES, PADER, RANGUEIL]),
  now: FIXTURE_TIME,
});
const realtime = indexRealtime(decodeFeed(fixture('gtfs/tisseo-gtfsrt-sample.pb')));
const now = FIXTURE_TIME;
const route = (short) => [...network.routes.values()].find((r) => r.short === short);
const group = (board, short, dir) =>
  board.find((g) => g.route.short === short && (dir === undefined || g.dir === dir));

test('Jean Jaurès: the metro is timetable only, the Linéo is tracked', () => {
  const board = buildBoard(network, realtime, { id: JEAN_JAURES, lines: [] }, now);
  const metro = group(board, 'A', 0);
  assert.equal(metro.headsign, 'Balma-Gramont');
  assert.equal(metro.departures.length, 2);
  assert.ok(metro.departures.every((d) => d.realtime === false));
  assert.ok(metro.departures[1].minutes <= 5, 'a metro every few minutes at 17:19');
  const lineo = group(board, 'L1');
  assert.ok(lineo.departures.some((d) => d.realtime));
  // Natural order: metro first, then Linéo, then buses.
  const modes = board.map((g) => g.route.mode);
  assert.deepEqual(modes.slice(0, 4), ['metro', 'metro', 'metro', 'metro']);
  assert.ok(modes.indexOf('bus') > modes.lastIndexOf('lineo'));
});

test('a line filter keeps only these lines, case-insensitive', () => {
  const board = buildBoard(network, realtime, { id: JEAN_JAURES, lines: ['a', 'L1'] }, now);
  assert.deepEqual([...new Set(board.map((g) => g.route.short))], ['A', 'L1']);
  assert.equal(board.length, 4);
});

test('Pader: the buses carry their realtime times, soonest first', () => {
  const list = upcomingDepartures(network, realtime, PADER, { now });
  assert.ok(list.length > 10);
  assert.ok(list.filter((d) => d.realtime).length >= 5);
  for (let i = 1; i < list.length; i += 1) {
    assert.ok(list[i - 1].at <= list[i].at);
  }
  assert.ok(list.every((d) => d.at >= now - 30000 && d.at <= now + 24 * 3600 * 1000));
});

test('Téléo: added cabins show at Rangueil in both directions', () => {
  const board = buildBoard(network, realtime, { id: RANGUEIL, lines: [] }, now);
  assert.equal(board.length, 2);
  for (const g of board) {
    assert.ok(g.departures.length > 0, `direction ${g.dir}`);
    assert.ok(g.departures.every((d) => d.realtime));
  }
});

test('without realtime, the same stop shows the timetable, flagged', () => {
  const board = buildBoard(network, null, { id: PADER, lines: [] }, now);
  assert.ok(board.flatMap((g) => g.departures).every((d) => d.realtime === false));
});

test('minutes: rounded down, never negative', () => {
  assert.equal(minutesUntil(now + 59000, now), 0);
  assert.equal(minutesUntil(now + 61000, now), 1);
  assert.equal(minutesUntil(now - 20000, now), 0);
});

// --- encoded feeds, on one real scheduled departure at Pader ---------------------

// A departure 10 minutes away or more, as the timetable has it.
const scheduled = upcomingDepartures(network, null, PADER, { now }).find(
  (d) => d.at > now + 10 * 60000,
);
const tripId = scheduled.trip;
const departure = network.departures.get(PADER).find((d) => d.trip.id === tripId);
const at = (feed) =>
  upcomingDepartures(network, indexRealtime(decodeFeed(encodeFeed(feed))), PADER, {
    now,
  }).find((d) => d.trip === tripId);
const update = (stops, relationship = 0) => ({
  timestamp: now / 1000,
  tripUpdates: [{ trip: { tripId, routeId: departure.trip.route, relationship }, stops }],
});
const seconds = (ms) => Math.round(ms / 1000);

test('a tracked stop update gives the predicted time', () => {
  const predicted = scheduled.at + 180000;
  const d = at(
    update([
      { seq: departure.seq, stopId: departure.stop, departure: { time: seconds(predicted) } },
    ]),
  );
  assert.equal(d.at, predicted);
  assert.equal(d.realtime, true);
});

test('a delay without time shifts the scheduled time', () => {
  const d = at(update([{ seq: departure.seq, stopId: departure.stop, arrival: { delay: -60 } }]));
  assert.equal(d.at, scheduled.at - 60000);
  assert.equal(d.realtime, true);
});

test('a stop without its own update inherits the delay of the previous one', () => {
  const d = at(
    update([{ seq: departure.seq - 1, stopId: 'stop_point:SP_X', departure: { delay: 240 } }]),
  );
  assert.equal(d.at, scheduled.at + 240000);
  assert.equal(d.realtime, true);
});

test('updates for later stops only: the vehicle has passed, the departure goes', () => {
  const d = at(
    update([{ seq: departure.seq + 1, stopId: 'stop_point:SP_X', departure: { delay: 0 } }]),
  );
  assert.equal(d, undefined);
});

test('a canceled trip or a skipped stop removes the departure', () => {
  assert.equal(at(update([], 3)), undefined);
  assert.equal(
    at(update([{ seq: departure.seq, stopId: departure.stop, relationship: 1 }])),
    undefined,
  );
  // Another trip's update leaves this departure on the timetable.
  assert.equal(at({ timestamp: now / 1000, tripUpdates: [] }).realtime, false);
});

test('an added trip without a known line or direction is ignored', () => {
  const feed = {
    timestamp: now / 1000,
    tripUpdates: [
      {
        trip: { tripId: 'new_1', relationship: 1 },
        stops: [{ stopId: departure.stop, departure: { time: seconds(now + 120000) } }],
      },
    ],
  };
  const list = upcomingDepartures(network, indexRealtime(decodeFeed(encodeFeed(feed))), PADER, {
    now,
  });
  assert.ok(list.every((d) => d.trip !== 'new_1'));
  assert.ok(route('29'));
});
