// -----------------------------------------------------------------------------
// Static GTFS: the ZIP reader, the CSV reader, the time arithmetic and the
// streaming parse, on reduced copies of the real Tisséo and SNCF archives.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { deflateRawSync } from 'node:zlib';
import { CsvError, eachRow, splitRecord } from '../src/csv.js';
import { GtfsError, parseGtfs, routeMode } from '../src/gtfs.js';
import { addDays, localDate, parseGtfsTime, serviceDayStart, weekday } from '../src/time.js';
import { ZipError, listEntries } from '../src/zip.js';
import {
  FIXTURE_TIME,
  GTFS_ZIP,
  JEAN_JAURES,
  NANTES,
  PADER,
  RANGUEIL,
  SNCF_TIME,
} from './helpers/world.js';

const network = await parseGtfs(GTFS_ZIP, {
  watched: new Set([JEAN_JAURES, PADER, RANGUEIL]),
  now: FIXTURE_TIME,
});

/** A minimal ZIP archive (deflate) of the given files, for edge cases. */
function makeZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text, 'utf8');
    const packed = deflateRawSync(data);
    const nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, packed);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + packed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const temp = (name, content) => {
  const path = join(mkdtempSync(join(tmpdir(), 'gladys-gtfs-')), name);
  writeFileSync(path, content);
  return path;
};

test('the ZIP reader lists the GTFS files and refuses what is not an archive', async () => {
  const entries = await listEntries(GTFS_ZIP);
  for (const name of ['agency.txt', 'routes.txt', 'stops.txt', 'trips.txt', 'stop_times.txt']) {
    assert.ok(entries.has(name), name);
  }
  await assert.rejects(listEntries(temp('x.zip', '<html>maintenance</html>')), ZipError);
});

test('CSV: quoted fields, doubled quotes, line breaks inside quotes, BOM, CRLF', async () => {
  assert.deepEqual(splitRecord('a,"b, c","d ""e"""'), ['a', 'b, c', 'd "e"']);
  assert.equal(splitRecord('a,"open'), null);
  const text =
    '\uFEFFid,name,extra\r\n1,"Arènes, quai ""B""",x\r\n2,"two\r\nlines",y\r\n\r\n3,plain,z';
  // Cut in awkward places, like the chunks of an inflate stream.
  const chunks = [text.slice(0, 5), text.slice(5, 23), text.slice(23)].map((part) =>
    Buffer.from(part, 'utf8'),
  );
  const rows = [];
  await eachRow(Readable.from(chunks), ['name', 'id', 'missing'], (row) => rows.push(row));
  assert.deepEqual(rows, [
    { name: 'Arènes, quai "B"', id: '1', missing: '' },
    { name: 'two\nlines', id: '2', missing: '' },
    { name: 'plain', id: '3', missing: '' },
  ]);
});

test('time: Paris dates, GTFS times past midnight, service days across DST', () => {
  const tz = 'Europe/Paris';
  assert.equal(localDate(FIXTURE_TIME, tz), '20261013');
  assert.equal(parseGtfsTime('25:10:00'), 90600);
  assert.equal(parseGtfsTime('7:05:00'), 25500);
  assert.equal(parseGtfsTime('bad'), null);
  assert.equal(addDays('20261231', 1), '20270101');
  assert.equal(weekday('20261013'), 1); // a Tuesday
  // An ordinary day starts at local midnight (UTC+2 in October).
  assert.equal(new Date(serviceDayStart('20261013', tz)).toISOString(), '2026-10-12T22:00:00.000Z');
  // The day the clocks go back (25 October 2026): noon minus 12 h, per GTFS.
  assert.equal(new Date(serviceDayStart('20261025', tz)).toISOString(), '2026-10-24T23:00:00.000Z');
  // A winter day: midnight is UTC+1.
  assert.equal(new Date(serviceDayStart('20261026', tz)).toISOString(), '2026-10-25T23:00:00.000Z');
});

test('routes: modes and colors of the Tisséo lines', () => {
  const byShort = new Map([...network.routes.values()].map((route) => [route.short, route]));
  assert.equal(byShort.get('A').mode, 'metro');
  assert.equal(byShort.get('B').mode, 'metro');
  assert.equal(byShort.get('TELEO').mode, 'cable');
  assert.equal(byShort.get('L1').mode, 'bus');
  assert.equal(byShort.get('29').mode, 'bus');
  assert.match(byShort.get('A').color, /^[0-9a-f]{6}$/);
  // Basic and extended route types.
  const modes = { 0: 'tram', 1: 'metro', 2: 'train', 3: 'bus', 4: 'ferry', 5: 'cable', 6: 'cable' };
  Object.assign(modes, { 7: 'cable', 11: 'trolleybus', 12: 'metro', 106: 'train', 200: 'coach' });
  Object.assign(modes, { 401: 'metro', 700: 'bus', 900: 'tram', 1200: 'ferry', 1300: 'cable' });
  for (const [type, mode] of Object.entries(modes)) {
    assert.equal(routeMode(type), mode, type);
  }
});

test('SNCF: train numbers in trip_headsign give way to the last stop, agencies kept', async () => {
  const sncf = await parseGtfs(
    new URL('./fixtures/gtfs/sncf-gtfs-sample.zip', import.meta.url).pathname,
    {
      watched: new Set([NANTES]),
      now: SNCF_TIME,
    },
  );
  const departures = sncf.departures.get(NANTES);
  assert.ok(departures.length > 250);
  for (const { trip } of departures) {
    assert.doesNotMatch(trip.headsign, /^\d*$/, trip.id);
  }
  assert.ok(departures.some(({ trip }) => trip.headsign === 'Paris Montparnasse Hall 1 - 2'));
  assert.ok([...sncf.routes.values()].every((route) => route.agency));
  assert.ok([...sncf.routes.values()].some((route) => route.mode === 'train'));
});

test('a network too big for the sandbox is refused while it is read', async () => {
  await assert.rejects(
    parseGtfs(GTFS_ZIP, { watched: new Set(), now: FIXTURE_TIME, maxTrips: 100 }),
    (err) => err instanceof GtfsError && err.code === 'TOO_BIG',
  );
});

test('stop areas: names, positions, points and the lines that serve them', () => {
  assert.equal(network.timeZone, 'Europe/Paris');
  const area = network.areas.get(JEAN_JAURES);
  assert.equal(area.name, 'Jean Jaurès');
  assert.ok(Math.abs(area.lat - 43.6059) < 0.001);
  assert.ok(area.points.length >= 4);
  const shorts = area.routes.map((id) => network.routes.get(id).short);
  for (const line of ['A', 'B', 'L1', '15']) {
    assert.ok(shorts.includes(line), line);
  }
  // Three areas share the name, in three towns.
  assert.equal([...network.areas.values()].filter((a) => a.name === 'Jean Jaurès').length, 3);
});

test('departures: kept for the watched stops only, sorted, boarding only', () => {
  assert.deepEqual([...network.departures.keys()].sort(), [JEAN_JAURES, PADER, RANGUEIL].sort());
  const list = network.departures.get(PADER);
  assert.ok(list.length > 100);
  for (let i = 1; i < list.length; i += 1) {
    assert.ok(list[i - 1].secs <= list[i].secs);
  }
  assert.ok(list.every((d) => network.pointArea.get(d.stop) === PADER));
  assert.equal(network.dates[1], '20261013');
  assert.equal(network.dates.length, 9);
  // Every kept departure runs on at least one day of the window.
  assert.ok(list.every((d) => network.services.get(d.trip.service) > 0));
});

test('the stop order of each line and direction is learned (Téléo)', () => {
  const teleo = [...network.routes.values()].find((route) => route.short === 'TELEO');
  const order = network.stopOrder.get(`${teleo.id}|0`);
  assert.ok(order.size >= 3);
});

test('an archive without stop times or calendar is refused', async () => {
  const base = {
    'agency.txt': 'agency_id,agency_name,agency_url,agency_timezone\n1,T,https://t,Europe/Paris\n',
    'routes.txt': 'route_id,route_short_name,route_type\nr1,1,3\n',
    'stops.txt': 'stop_id,stop_name,stop_lat,stop_lon\ns1,Stop,43.6,1.44\n',
    'trips.txt': 'route_id,service_id,trip_id\nr1,s,t1\n',
  };
  await assert.rejects(
    parseGtfs(temp('a.zip', makeZip({ ...base, 'stop_times.txt': 'trip_id\n' }))),
    GtfsError,
  );
  const noTimes = {
    ...base,
    'calendar_dates.txt': 'service_id,date,exception_type\ns,20261013,1\n',
  };
  await assert.rejects(parseGtfs(temp('b.zip', makeZip(noTimes))), /stop_times\.txt is missing/);
});

test('a minimal feed: calendar.txt, a stop point without parent, empty headsigns', async () => {
  const zip = makeZip({
    'routes.txt': 'route_id,route_short_name,route_type\nr1,12,3\n',
    'stops.txt': 'stop_id,stop_name,stop_lat,stop_lon\ns1,Alpha,43.6,1.44\ns2,Omega,43.7,1.45\n',
    'calendar.txt':
      'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nweek,1,1,1,1,1,0,0,20260101,20261231\n',
    'trips.txt': 'route_id,service_id,trip_id,direction_id\nr1,week,t1,0\n',
    'stop_times.txt':
      'trip_id,arrival_time,departure_time,stop_id,stop_sequence\nt1,08:00:00,08:00:00,s1,1\nt1,08:20:00,08:20:00,s2,2\n',
  });
  const parsed = await parseGtfs(temp('c.zip', zip), {
    watched: new Set(['s1']),
    now: FIXTURE_TIME,
  });
  assert.equal(parsed.timeZone, 'Europe/Paris');
  assert.equal(parsed.areas.get('s1').name, 'Alpha');
  const [departure] = parsed.departures.get('s1');
  assert.equal(departure.secs, 8 * 3600);
  assert.equal(departure.trip.headsign, 'Omega');
  // Tuesday 13 runs, Saturday 17 does not.
  const mask = parsed.services.get('week');
  assert.ok(mask & (1 << parsed.dates.indexOf('20261013')));
  assert.equal(mask & (1 << parsed.dates.indexOf('20261017')), 0);
});

test('CSV: a stray quote fails fast instead of gluing the rest of the file', async () => {
  const lines = [
    'id,name',
    '1,"broken',
    ...Array.from({ length: 5000 }, (_, i) => `${i},stop ${i}`),
  ];
  const started = Date.now();
  await assert.rejects(
    eachRow(Readable.from([Buffer.from(lines.join('\n'))]), ['id'], () => {}),
    CsvError,
  );
  assert.ok(Date.now() - started < 2000);
});
