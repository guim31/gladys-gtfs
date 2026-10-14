// -----------------------------------------------------------------------------
// Static GTFS of a network: one streaming pass over the archive kept in /data,
// reduced to what the integration needs.
//
// Kept for the whole network (small): routes, stop areas with their name,
// position, stop points and the lines that serve them — what the stop search
// shows. Kept for the watched stops only: their departures over a window of a
// few days, with the calendar of the services involved. stop_times.txt
// (up to ~600 MB inflated for Naolib) is read line by line and never held.
// -----------------------------------------------------------------------------

import { eachRow } from './csv.js';
import { addDays, localDate, parseGtfsTime, weekday } from './time.js';
import { listEntries, openEntry } from './zip.js';

export const DEFAULT_TIME_ZONE = 'Europe/Paris';
// Days of timetable kept from yesterday on: a failed daily download leaves a
// week of theoretical departures.
export const WINDOW_DAYS = 9;
// Trips sampled per line and direction to learn the order of its stops.
const SAMPLE_TRIPS = 3;
// Trips running in the window above which the network does not fit the
// 256 MB sandbox (Naolib, among the biggest, runs ~60,000).
export const MAX_TRIPS = 400000;

export class GtfsError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

/** Streams the rows of one file of the archive; false when the file is absent. */
async function eachRowOf(path, entries, name, columns, onRow, { required = true } = {}) {
  const entry = entries.get(name);
  if (!entry) {
    if (required) {
      throw new GtfsError(`${name} is missing from the GTFS archive`);
    }
    return false;
  }
  await eachRow(await openEntry(path, entry), columns, onRow);
  return true;
}

/** GTFS route_type (basic and extended) → the mode names of the integration. */
export function routeMode(type) {
  const value = Number(type);
  if (value === 1 || value === 12 || (value >= 400 && value < 500)) {
    return 'metro';
  }
  if (value === 0 || (value >= 900 && value < 1000)) {
    return 'tram';
  }
  if (value === 2 || (value >= 100 && value < 200)) {
    return 'train';
  }
  if (value === 4 || (value >= 1000 && value < 1300)) {
    return 'ferry';
  }
  if (value === 5 || value === 6 || value === 7 || (value >= 1300 && value < 1500)) {
    return 'cable';
  }
  if (value === 11 || value === 800) {
    return 'trolleybus';
  }
  if (value === 200 || (value >= 200 && value < 300)) {
    return 'coach';
  }
  return 'bus';
}

/**
 * @param {string} path the GTFS archive
 * @param {object} options
 * @param {Set<string>} [options.watched] stop area ids whose departures are kept
 * @param {number} [options.now] epoch ms, start of the window (yesterday on)
 */
export async function parseGtfs(
  path,
  { watched = new Set(), now = Date.now(), maxTrips = MAX_TRIPS } = {},
) {
  const entries = await listEntries(path);

  // --- agency: the time zone of every stop time ---
  let timeZone = DEFAULT_TIME_ZONE;
  await eachRowOf(
    path,
    entries,
    'agency.txt',
    ['agency_timezone'],
    (row) => {
      if (row.agency_timezone) {
        timeZone = row.agency_timezone;
      }
    },
    { required: false },
  );
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
  } catch {
    timeZone = DEFAULT_TIME_ZONE;
  }

  // --- routes ---
  const routes = new Map();
  const routeColumns = [
    'route_id',
    'route_short_name',
    'route_long_name',
    'route_type',
    'route_color',
    'agency_id',
  ];
  await eachRowOf(path, entries, 'routes.txt', routeColumns, (row) => {
    if (!row.route_id) {
      return;
    }
    const short = row.route_short_name || row.route_long_name || row.route_id;
    routes.set(row.route_id, {
      id: row.route_id,
      short,
      long: row.route_long_name,
      type: Number(row.route_type),
      mode: routeMode(row.route_type),
      agency: row.agency_id || null,
      color: /^[0-9a-f]{6}$/i.test(row.route_color) ? row.route_color.toLowerCase() : null,
    });
  });

  // --- stops: areas (location_type 1) and the points under them ---
  const areas = new Map();
  const pointArea = new Map();
  const orphanPoints = [];
  // The public codes of the stops (stop_code): what a SIRI server often
  // knows them by (src/siri-feed.js).
  const codes = new Map();
  const stopColumns = [
    'stop_id',
    'stop_code',
    'stop_name',
    'stop_lat',
    'stop_lon',
    'location_type',
    'parent_station',
  ];
  await eachRowOf(path, entries, 'stops.txt', stopColumns, (row) => {
    const type = row.location_type || '0';
    const point = {
      id: row.stop_id,
      name: row.stop_name,
      lat: Number(row.stop_lat),
      lon: Number(row.stop_lon),
    };
    if (row.stop_code && row.stop_code !== row.stop_id && (type === '0' || type === '1')) {
      codes.set(row.stop_id, row.stop_code);
    }
    if (type === '1') {
      areas.set(row.stop_id, { ...point, points: [], routes: new Set() });
    } else if (type === '0') {
      if (row.parent_station) {
        pointArea.set(row.stop_id, row.parent_station);
      } else {
        orphanPoints.push(point);
      }
    }
  });
  // A stop point without a parent station is a stop area of its own.
  for (const point of orphanPoints) {
    if (!areas.has(point.id)) {
      areas.set(point.id, { ...point, points: [], routes: new Set() });
    }
    pointArea.set(point.id, point.id);
  }
  for (const [pointId, areaId] of pointArea) {
    const area = areas.get(areaId);
    if (area) {
      area.points.push(pointId);
    } else {
      pointArea.delete(pointId);
    }
  }

  // --- calendar: which service runs on which date of the window ---
  // One bit per date of the window: Tisséo declares ~40,000 services, a Set of
  // dates each would cost 12 MB of the 256 MB sandbox.
  const today = localDate(now, timeZone);
  const dates = Array.from({ length: WINDOW_DAYS }, (_, i) => addDays(today, i - 1));
  const dateBits = new Map(dates.map((date, i) => [date, 1 << i]));
  const services = new Map();
  const activate = (service, date) => {
    services.set(service, (services.get(service) ?? 0) | dateBits.get(date));
  };
  const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const calendar = await eachRowOf(
    path,
    entries,
    'calendar.txt',
    ['service_id', ...days, 'start_date', 'end_date'],
    (row) => {
      for (const date of dates) {
        if (date >= row.start_date && date <= row.end_date && row[days[weekday(date)]] === '1') {
          activate(row.service_id, date);
        }
      }
    },
    { required: false },
  );
  const exceptions = await eachRowOf(
    path,
    entries,
    'calendar_dates.txt',
    ['service_id', 'date', 'exception_type'],
    (row) => {
      const bit = dateBits.get(row.date);
      if (bit === undefined) {
        return;
      }
      if (row.exception_type === '1') {
        activate(row.service_id, row.date);
      } else if (row.exception_type === '2' && services.has(row.service_id)) {
        services.set(row.service_id, services.get(row.service_id) & ~bit);
      }
    },
    { required: false },
  );
  if (!calendar && !exceptions) {
    throw new GtfsError('the GTFS archive has neither calendar.txt nor calendar_dates.txt');
  }

  // --- trips: only those running in the window ---
  const trips = new Map();
  const samples = new Map(); // "route|dir" → trip ids sampled for the stop order
  const tripColumns = ['route_id', 'service_id', 'trip_id', 'direction_id', 'trip_headsign'];
  await eachRowOf(path, entries, 'trips.txt', tripColumns, (row) => {
    const route = routes.get(row.route_id);
    if (!route || !services.get(row.service_id)) {
      return;
    }
    const dir = row.direction_id === '1' ? 1 : 0;
    if (trips.size >= maxTrips) {
      throw new GtfsError(`more than ${maxTrips} trips in ${WINDOW_DAYS} days`, 'TOO_BIG');
    }
    trips.set(row.trip_id, {
      id: row.trip_id,
      route: route.id,
      dir,
      // SNCF puts the train number there: the destination is then its last stop.
      headsign: /^\d+$/.test(row.trip_headsign) ? '' : row.trip_headsign,
      service: row.service_id,
    });
    const key = `${row.route_id}|${dir}`;
    const sampled = samples.get(key) ?? [];
    if (sampled.length < SAMPLE_TRIPS) {
      sampled.push(row.trip_id);
      samples.set(key, sampled);
    }
  });
  const sampledTrips = new Map();
  for (const ids of samples.values()) {
    for (const id of ids) {
      sampledTrips.set(id, []);
    }
  }

  // --- stop_times: the big one ---
  const watchedPoints = new Set();
  for (const areaId of watched) {
    for (const pointId of areas.get(areaId)?.points ?? []) {
      watchedPoints.add(pointId);
    }
  }
  const departures = new Map([...watched].filter((id) => areas.has(id)).map((id) => [id, []]));
  const pointRouteDirs = new Map(); // "point|route" → Set(dir), watched points only
  const lastStops = new Map(); // trip id → [seq, point], for trips without headsign
  let rows = 0;
  const stopTimeColumns = [
    'trip_id',
    'departure_time',
    'arrival_time',
    'stop_id',
    'stop_sequence',
    'pickup_type',
  ];
  // The stop ids read from stop_times.txt are slices of its 64 KB chunks: a
  // departure keeping one would keep its whole chunk alive (35 MB on the real
  // feed). Kept values use the copies read from stops.txt instead.
  const canonical = new Map([...pointArea.keys()].map((id) => [id, id]));
  await eachRowOf(path, entries, 'stop_times.txt', stopTimeColumns, (row) => {
    rows += 1;
    const trip = trips.get(row.trip_id);
    if (!trip) {
      return;
    }
    const stop = canonical.get(row.stop_id);
    if (stop === undefined) {
      return;
    }
    const areaId = pointArea.get(stop);
    areas.get(areaId).routes.add(trip.route);
    const seq = Number(row.stop_sequence);
    const sample = sampledTrips.get(row.trip_id);
    if (sample) {
      sample.push([seq, stop]);
    }
    if (!trip.headsign) {
      const last = lastStops.get(trip.id);
      if (!last || seq > last[0]) {
        lastStops.set(trip.id, [seq, stop]);
      }
    }
    if (!watchedPoints.has(stop)) {
      return;
    }
    const routeDirKey = `${stop}|${trip.route}`;
    let dirs = pointRouteDirs.get(routeDirKey);
    if (!dirs) {
      dirs = new Set();
      pointRouteDirs.set(routeDirKey, dirs);
    }
    dirs.add(trip.dir);
    // No boarding there (the terminus of the trip, a drop-off only stop).
    if (row.pickup_type === '1') {
      return;
    }
    const secs = parseGtfsTime(row.departure_time || row.arrival_time);
    if (secs === null) {
      return;
    }
    departures.get(areaId).push({ trip, secs, seq, stop });
  });
  if (rows === 0) {
    throw new GtfsError('stop_times.txt is empty');
  }

  for (const [tripId, [, pointId]] of lastStops) {
    const trip = trips.get(tripId);
    trip.headsign = areas.get(pointArea.get(pointId))?.name ?? '';
  }
  for (const list of departures.values()) {
    list.sort((a, b) => a.secs - b.secs);
  }

  // Order of the stops of each line and direction, from its longest sample.
  const stopOrder = new Map();
  for (const [key, ids] of samples) {
    let longest = [];
    for (const id of ids) {
      const stops = sampledTrips.get(id);
      if (stops.length > longest.length) {
        longest = stops;
      }
    }
    longest.sort((a, b) => a[0] - b[0]);
    stopOrder.set(key, new Map(longest.map(([, pointId], index) => [pointId, index])));
  }

  for (const area of areas.values()) {
    area.routes = [...area.routes];
  }

  return {
    timeZone,
    builtAt: now,
    dates,
    routes,
    areas,
    pointArea,
    codes,
    pointRouteDirs,
    stopOrder,
    services,
    departures,
    stats: { areas: areas.size, routes: routes.size, trips: trips.size, stopTimes: rows },
  };
}
