// -----------------------------------------------------------------------------
// The departure board of a stop: theoretical departures from the static GTFS,
// corrected by the GTFS-Realtime trip updates when the vehicle is tracked.
//
// - A tracked trip gives the predicted time at the stop (`time`, or the
//   scheduled time plus `delay`); a stop it no longer lists is behind it, and
//   a stop without its own update inherits the delay of the previous one
//   (GTFS-RT propagation rule).
// - A canceled trip, or a skipped stop, removes the departure.
// - An ADDED trip (Tisséo's Téléo publishes its cabins that way) adds a departure, its
//   direction recognized from the stop point or the order of the stops.
// - Everything else stays theoretical, and is flagged so (Tisséo never tracks
//   its metro, many networks publish no realtime at all).
// -----------------------------------------------------------------------------

import { STOP_RELATIONSHIP, TRIP_RELATIONSHIP } from './gtfsrt.js';
import { localDate, serviceDayStart } from './time.js';

// A trip id runs at most once a day: its realtime update applies to the
// occurrence close to now only.
const REALTIME_BEFORE_MS = 2 * 3600 * 1000;
const REALTIME_AFTER_MS = 6 * 3600 * 1000;
// A departure stays on the board this long after its time (a bus at the stop).
export const GRACE_MS = 30 * 1000;
export const HORIZON_MS = 24 * 3600 * 1000;

/** The realtime feed, indexed for the board: trip updates by trip id, added trips apart. */
export function indexRealtime(feed) {
  const trips = new Map();
  const added = [];
  for (const update of feed?.tripUpdates ?? []) {
    if (update.trip.relationship === TRIP_RELATIONSHIP.ADDED) {
      added.push(update);
    } else if (update.trip.tripId) {
      trips.set(update.trip.tripId, update);
    }
  }
  return { timestamp: feed?.timestamp ?? null, trips, added, alerts: feed?.alerts ?? [] };
}

/** Route ids of a line filter (short names, case-insensitive); null = every line. */
export function resolveLines(network, lines) {
  if (!lines || lines.length === 0) {
    return null;
  }
  const wanted = new Set(lines.map((line) => line.toUpperCase()));
  const ids = new Set();
  for (const route of network.routes.values()) {
    if (wanted.has(route.short.toUpperCase())) {
      ids.add(route.id);
    }
  }
  return ids;
}

const MODE_ORDER = {
  train: 0,
  metro: 1,
  tram: 2,
  cable: 3,
  trolleybus: 4,
  bus: 5,
  coach: 6,
  ferry: 7,
};

/** Natural order of lines: train, metro, tram, cable car, buses, coaches, boats; then by name. */
export function compareRoutes(a, b) {
  return (
    (MODE_ORDER[a.mode] ?? 9) - (MODE_ORDER[b.mode] ?? 9) ||
    a.short.localeCompare(b.short, 'fr', { numeric: true })
  );
}

/**
 * The lines and directions served at a stop area (in the timetable window),
 * each named after its most frequent destination.
 * @returns {{ key: string, route: object, dir: number, headsign: string }[]}
 */
export function lineGroups(network, areaId, routeFilter = null) {
  const counts = new Map();
  for (const departure of network.departures.get(areaId) ?? []) {
    const { trip } = departure;
    if (routeFilter && !routeFilter.has(trip.route)) {
      continue;
    }
    const key = `${trip.route}|${trip.dir}`;
    let group = counts.get(key);
    if (!group) {
      group = { key, route: network.routes.get(trip.route), dir: trip.dir, headsigns: new Map() };
      counts.set(key, group);
    }
    group.headsigns.set(trip.headsign, (group.headsigns.get(trip.headsign) ?? 0) + 1);
  }
  return [...counts.values()]
    .map(({ key, route, dir, headsigns }) => ({
      key,
      route,
      dir,
      headsign: [...headsigns.entries()].sort(
        (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1),
      )[0][0],
    }))
    .sort((a, b) => compareRoutes(a.route, b.route) || a.dir - b.dir);
}

function eventTime(update) {
  return update.departure ?? update.arrival;
}

/**
 * The realtime time of a scheduled departure: a number (epoch ms), null when
 * the trip is not tracked at this stop, or 'gone' when it will not stop.
 */
function realtimeOf(update, departure, scheduledAt) {
  if (update.trip.relationship === TRIP_RELATIONSHIP.CANCELED) {
    return 'gone';
  }
  const stops = update.stops;
  if (stops.length === 0) {
    return update.delay === null ? null : scheduledAt + update.delay * 1000;
  }
  const own =
    stops.find((stop) => stop.stopId === departure.stop) ??
    stops.find((stop) => stop.seq !== null && stop.seq === departure.seq);
  if (own) {
    if (own.relationship === STOP_RELATIONSHIP.SKIPPED) {
      return 'gone';
    }
    if (own.relationship === STOP_RELATIONSHIP.NO_DATA) {
      return null;
    }
    const event = eventTime(own);
    if (event?.time) {
      return event.time * 1000;
    }
    if (event?.delay !== null && event?.delay !== undefined) {
      return scheduledAt + event.delay * 1000;
    }
    return null;
  }
  if (stops.some((stop) => stop.seq === null)) {
    return null;
  }
  // Updates only for stops after this one: the vehicle has passed it.
  const before = stops.filter((stop) => stop.seq < departure.seq);
  if (before.length === 0) {
    return 'gone';
  }
  const previous = before.reduce((a, b) => (b.seq > a.seq ? b : a));
  if (previous.relationship === STOP_RELATIONSHIP.NO_DATA) {
    return null;
  }
  const delay = eventTime(previous)?.delay;
  return delay === null || delay === undefined ? null : scheduledAt + delay * 1000;
}

/** Direction of an added trip at a stop point, or null when it cannot be told. */
function addedDirection(network, update, stopIndex) {
  const routeId = update.trip.routeId;
  const point = update.stops[stopIndex].stopId;
  const dirs = network.pointRouteDirs.get(`${point}|${routeId}`);
  if (dirs?.size === 1) {
    return [...dirs][0];
  }
  // The stop point serves both directions: compare with the next (or the
  // previous) stop of the trip in the known stop order of each direction.
  const other = update.stops[stopIndex + 1] ?? update.stops[stopIndex - 1];
  if (!other) {
    return null;
  }
  const forward = Boolean(update.stops[stopIndex + 1]);
  for (const dir of [0, 1]) {
    const order = network.stopOrder.get(`${routeId}|${dir}`);
    const here = order?.get(point);
    const there = order?.get(other.stopId);
    if (here !== undefined && there !== undefined && here < there === forward) {
      return dir;
    }
  }
  return null;
}

/**
 * Upcoming departures of a stop area, soonest first.
 * @param {object} network from parseGtfs
 * @param {object|null} realtime from indexRealtime, null when unavailable
 * @param {string} areaId
 * @param {{ now: number, routes?: Set<string>|null, horizonMs?: number }} options
 * @returns {{ trip: string, route: string, dir: number, headsign: string|null, at: number, realtime: boolean }[]}
 */
export function upcomingDepartures(network, realtime, areaId, options) {
  const { now, routes = null, horizonMs = HORIZON_MS } = options;
  const area = network.areas.get(areaId);
  const scheduled = network.departures.get(areaId);
  if (!area || !scheduled) {
    return [];
  }
  const { timeZone } = network;
  const today = localDate(now, timeZone);
  const dateIndex = network.dates.indexOf(today);
  const results = [];
  // Yesterday's service day still runs after midnight (times past 24:00).
  for (const offset of [-1, 0, 1]) {
    const index = dateIndex + offset;
    if (dateIndex < 0 || index < 0 || index >= network.dates.length) {
      continue;
    }
    const bit = 1 << index;
    const dayStart = serviceDayStart(network.dates[index], timeZone);
    for (const departure of scheduled) {
      const { trip } = departure;
      if (!(network.services.get(trip.service) & bit)) {
        continue;
      }
      if (routes && !routes.has(trip.route)) {
        continue;
      }
      const scheduledAt = dayStart + departure.secs * 1000;
      if (scheduledAt < now - REALTIME_BEFORE_MS || scheduledAt > now + horizonMs) {
        continue;
      }
      let at = scheduledAt;
      let tracked = false;
      const update = realtime?.trips.get(trip.id);
      if (update && scheduledAt <= now + REALTIME_AFTER_MS) {
        const value = realtimeOf(update, departure, scheduledAt);
        if (value === 'gone') {
          continue;
        }
        if (value !== null) {
          at = value;
          tracked = true;
        }
      }
      if (at < now - GRACE_MS || at > now + horizonMs) {
        continue;
      }
      results.push({
        trip: trip.id,
        route: trip.route,
        dir: trip.dir,
        headsign: trip.headsign,
        at,
        realtime: tracked,
      });
    }
  }

  if (realtime) {
    const points = new Set(area.points);
    for (const update of realtime.added) {
      const routeId = update.trip.routeId;
      if (!network.routes.has(routeId) || (routes && !routes.has(routeId))) {
        continue;
      }
      update.stops.forEach((stop, index) => {
        if (!points.has(stop.stopId) || stop.relationship === STOP_RELATIONSHIP.SKIPPED) {
          return;
        }
        // The last stop of a trip is not a departure.
        if (index === update.stops.length - 1 && update.stops.length > 1) {
          return;
        }
        const time = eventTime(stop)?.time;
        const dir = addedDirection(network, update, index);
        if (!time || dir === null) {
          return;
        }
        const at = time * 1000;
        if (at < now - GRACE_MS || at > now + horizonMs) {
          return;
        }
        results.push({
          trip: update.trip.tripId,
          route: routeId,
          dir,
          headsign: null,
          at,
          realtime: true,
        });
      });
    }
  }

  return results.sort((a, b) => a.at - b.at);
}

/** Whole minutes to wait, never negative ("0" = at the stop). */
export function minutesUntil(at, now) {
  return Math.max(0, Math.floor((at - now) / 60000));
}

/**
 * The board of a watched stop: each of its line groups with its next two
 * departures.
 * @param {object} network
 * @param {object|null} realtime
 * @param {{ id: string, lines: string[] }} stop
 * @param {number} now
 */
export function buildBoard(network, realtime, stop, now) {
  const routes = resolveLines(network, stop.lines);
  const groups = lineGroups(network, stop.id, routes);
  const departures = upcomingDepartures(network, realtime, stop.id, { now, routes });
  return groups.map((group) => {
    const next = departures
      .filter((departure) => departure.route === group.route.id && departure.dir === group.dir)
      .slice(0, 2)
      .map((departure) => ({
        at: departure.at,
        minutes: minutesUntil(departure.at, now),
        realtime: departure.realtime,
        headsign: departure.headsign ?? group.headsign,
      }));
    return { ...group, departures: next };
  });
}
