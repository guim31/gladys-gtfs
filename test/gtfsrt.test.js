// -----------------------------------------------------------------------------
// The GTFS-Realtime decoder, on the real Tisséo feed (reduced) and on encoded
// edge cases: negative delays, unknown fields, truncated data.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProtobufError, TRIP_RELATIONSHIP, decodeFeed } from '../src/gtfsrt.js';
import { FIXTURE_TIME, fixture } from './helpers/world.js';
import { encodeFeed } from './helpers/protobuf.js';

test('decodes the real Tisséo feed: trip updates and alerts, no vehicle positions', () => {
  const feed = decodeFeed(fixture('gtfs/tisseo-gtfsrt-sample.pb'));
  assert.equal(feed.timestamp * 1000, FIXTURE_TIME);
  assert.equal(feed.version, '2.0');
  assert.equal(feed.tripUpdates.length, 487);
  assert.equal(feed.alerts.length, 10);

  const teleo = feed.tripUpdates.filter((u) => u.trip.routeId === 'line:204');
  assert.ok(teleo.some((u) => u.trip.relationship === TRIP_RELATIONSHIP.ADDED));
  assert.ok(teleo.some((u) => u.trip.relationship === TRIP_RELATIONSHIP.CANCELED));

  const bus = feed.tripUpdates.find(
    (u) => u.trip.relationship === TRIP_RELATIONSHIP.SCHEDULED && u.stops.length > 1,
  );
  const stop = bus.stops[0];
  assert.match(stop.stopId, /^stop_point:SP_\d+$/);
  assert.equal(typeof stop.seq, 'number');
  assert.equal(typeof (stop.departure ?? stop.arrival).time, 'number');

  // Real negative delays (vehicles ahead of time) decode as negative numbers.
  const delays = feed.tripUpdates.flatMap((u) => u.stops).map((s) => s.arrival?.delay);
  assert.ok(delays.some((delay) => delay < 0 && delay > -3600));

  const [network] = feed.alerts.filter((a) => a.entities.every((e) => !e.routeId));
  assert.ok(network.header[0].text.length > 0);
  assert.ok(feed.alerts.some((a) => a.entities.some((e) => e.routeId === 'line:174')));
});

test('decodes negative delays, 64-bit times and skips unknown fields', () => {
  const bytes = encodeFeed({
    timestamp: 1791904747,
    unknown: true,
    tripUpdates: [
      {
        trip: { tripId: 't1', routeId: 'line:1', relationship: 0 },
        stops: [
          { seq: 3, stopId: 'stop_point:SP_1', arrival: { delay: -45 }, departure: { delay: -1 } },
          { seq: 4, stopId: 'stop_point:SP_2', departure: { time: 4102444800, delay: 120 } },
        ],
      },
    ],
  });
  const feed = decodeFeed(bytes);
  const [update] = feed.tripUpdates;
  assert.equal(update.trip.tripId, 't1');
  assert.equal(update.stops[0].arrival.delay, -45);
  assert.equal(update.stops[0].departure.delay, -1);
  assert.equal(update.stops[1].departure.time, 4102444800);
  assert.equal(update.stops[1].departure.delay, 120);
});

test('a truncated or garbage feed is refused, never half read', () => {
  const bytes = fixture('gtfs/tisseo-gtfsrt-sample.pb');
  assert.throws(() => decodeFeed(bytes.subarray(0, bytes.length - 7)), ProtobufError);
  assert.throws(() => decodeFeed(Buffer.from('<html>Service unavailable</html>')), ProtobufError);
  assert.deepEqual(decodeFeed(Buffer.alloc(0)).tripUpdates, []);
});

test('a negative or oversized length is refused instead of looping forever', () => {
  // Field 2 (entity), length = varint(-11): ten bytes of two's complement.
  const negative = Buffer.from([0x12, 0xf5, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01]);
  assert.throws(() => decodeFeed(negative), ProtobufError);
  assert.throws(() => decodeFeed(Buffer.from([0x12, 0x7f, 0x00])), ProtobufError);
  assert.throws(() => decodeFeed(Buffer.from([0x00, 0x00])), ProtobufError);
});
