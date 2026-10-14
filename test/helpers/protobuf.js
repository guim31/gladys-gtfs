// -----------------------------------------------------------------------------
// A tiny GTFS-Realtime encoder for the tests: builds the feeds the decoder and
// the board must handle (canceled trips, skipped stops, propagated delays,
// added trips) without a protobuf library. Field numbers: gtfs-realtime.proto.
// -----------------------------------------------------------------------------

function varint(value) {
  let v = BigInt.asUintN(64, BigInt(value));
  const bytes = [];
  do {
    let byte = Number(v & 0x7fn);
    v >>= 7n;
    if (v > 0n) {
      byte |= 0x80;
    }
    bytes.push(byte);
  } while (v > 0n);
  return Buffer.from(bytes);
}

const key = (number, wire) => varint(number * 8 + wire);
const int = (number, value) =>
  value === undefined || value === null
    ? Buffer.alloc(0)
    : Buffer.concat([key(number, 0), varint(value)]);
const bytes = (number, payload) => Buffer.concat([key(number, 2), varint(payload.length), payload]);
const str = (number, value) =>
  value === undefined || value === null
    ? Buffer.alloc(0)
    : bytes(number, Buffer.from(value, 'utf8'));
const msg = (number, parts) => bytes(number, Buffer.concat(parts));

const event = (number, value) =>
  value ? msg(number, [int(1, value.delay), int(2, value.time)]) : Buffer.alloc(0);

const translated = (number, text, language) =>
  text === undefined ? Buffer.alloc(0) : msg(number, [msg(1, [str(1, text), str(2, language)])]);

/**
 * @param {{ timestamp: number, tripUpdates?: object[], alerts?: object[] }} feed
 *   trip update: { id, trip: { tripId, routeId, relationship }, stops: [{ seq, stopId, arrival, departure, relationship }] }
 *   alert: { id, routes?: string[], agency?: string, trips?: string[], start?, end?, header, description, url }
 */
export function encodeFeed({ timestamp, tripUpdates = [], alerts = [], unknown = false }) {
  const parts = [msg(1, [str(1, '2.0'), int(2, 0), int(3, timestamp)])];
  for (const update of tripUpdates) {
    const trip = msg(1, [
      str(1, update.trip.tripId),
      int(4, update.trip.relationship),
      str(5, update.trip.routeId),
    ]);
    const stops = (update.stops ?? []).map((stop) =>
      msg(2, [
        int(1, stop.seq),
        event(2, stop.arrival),
        event(3, stop.departure),
        str(4, stop.stopId),
        int(5, stop.relationship),
      ]),
    );
    const extra = unknown ? [str(99, 'ignored'), int(98, 7)] : [];
    parts.push(
      msg(2, [str(1, update.id ?? update.trip.tripId), msg(3, [trip, ...stops, ...extra])]),
    );
  }
  for (const alert of alerts) {
    const entities = (alert.routes ?? []).map((route) =>
      msg(5, [str(1, 'network:1'), str(2, route)]),
    );
    if (alert.agency) {
      entities.push(msg(5, [str(1, alert.agency)]));
    }
    for (const tripId of alert.trips ?? []) {
      entities.push(msg(5, [msg(4, [str(1, tripId)])]));
    }
    const period =
      alert.start || alert.end ? [msg(1, [int(1, alert.start), int(2, alert.end)])] : [];
    parts.push(
      msg(2, [
        str(1, alert.id),
        msg(5, [
          ...period,
          ...entities,
          int(6, 10),
          int(7, 4),
          translated(8, alert.url, alert.language),
          translated(10, alert.header, alert.language),
          translated(11, alert.description, alert.language),
        ]),
      ]),
    );
  }
  return Buffer.concat(parts);
}
