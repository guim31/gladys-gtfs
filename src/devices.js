// -----------------------------------------------------------------------------
// The Gladys devices of the integration and their states.
//
// - A stop (one per watched stop area of a network): for each line and
//   direction served,
//   the minutes before the next departure and before the following one; plus
//   the three soonest departures as text ("≈" marks a timetable time, the
//   others are real time) and the traffic info of its lines.
//
// Read-only, no polling: the integration refreshes everything on its own
// timer (src/service.js), Gladys never polls (`should_poll: false`).
// Countdowns and texts keep no history: a value re-read every minute whose
// past means nothing would write thousands of rows a day per stop.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import { NAMES, TEXT, say } from './messages.js';

export const STOP_TYPE = 'stop';
// Published when nothing leaves in the next 24 hours (the countdown's max).
export const NO_DEPARTURE_MINUTES = 1440;
export const MAX_FEATURE_NAME = 60;
export const MAX_TEXT_STATE = 200;
const BOARD_ENTRIES = 3;

/**
 * The platform id of a watched stop: the network id and the stop id, the
 * characters a Gladys external id cannot hold replaced ("tdg81678",
 * "stop_area:SA_1707" → "tdg81678-stop_area-SA_1707").
 */
export function stopPlatformId(networkId, stopId) {
  return `${networkId}-${String(stopId).replace(/[^A-Za-z0-9_-]/g, '-')}`;
}

/** How a stop id is shown and typed: "SA_1707" for "stop_area:SA_1707". */
export function stopCode(stopId) {
  return String(stopId).split(':').pop();
}

/** Feature key part of a line: "L1" → "l1", "TELEO" → "teleo". */
export function lineSlug(short) {
  return String(short)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * The feature key of a line and direction: its short name ("l1-0"), which
 * survives the yearly renumbering of route ids better than the id itself.
 * Two routes sharing a short name at a stop (a regional dataset aggregates
 * several operators) are told apart by their route id.
 */
export function groupKey(group, groups) {
  const slug = lineSlug(group.route.short).slice(0, 40) || lineSlug(group.route.id).slice(0, 40);
  const shared = groups.some(
    (other) =>
      other.route.id !== group.route.id &&
      other.dir === group.dir &&
      lineSlug(other.route.short) === lineSlug(group.route.short),
  );
  return shared
    ? `${slug}-${lineSlug(group.route.id).slice(0, 40)}-${group.dir}`
    : `${slug}-${group.dir}`;
}

export const BOARD_KEY = 'board';
export const TRAFFIC_KEY = 'traffic';

/** "Métro A", "Tram T1", "Bus 15", "Train TER 12345"; a long name as it is. */
export function lineLabel(route, language) {
  const names = NAMES[language] ?? NAMES.en;
  const prefix = names[route.mode];
  // A long name used as short name ("Nantes - Angers") reads better alone.
  if (
    !prefix ||
    route.short.length > 12 ||
    route.short.toLowerCase().startsWith(prefix.toLowerCase())
  ) {
    return route.short;
  }
  return `${prefix} ${route.short}`;
}

/** The line as written on the vehicles: "A", "L1", "TER". */
export const lineShort = (route) => route.short;

/** Shortens a text to `max` characters, with an ellipsis. */
export function clip(text, max) {
  const value = String(text ?? '');
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}

/** "Métro A → Basso Cambo" (with `suffix` kept whole when the name is cut). */
function groupName(group, language, suffix = '') {
  const head = `${lineLabel(group.route, language)} → `;
  const tail = suffix ? ` ${suffix}` : '';
  return `${head}${clip(group.headsign, MAX_FEATURE_NAME - head.length - tail.length)}${tail}`;
}

const countdown = (name, externalId) => ({
  name,
  external_id: externalId,
  category: DEVICE_FEATURE_CATEGORIES.DURATION,
  type: DEVICE_FEATURE_TYPES.DURATION.INTEGER,
  unit: DEVICE_FEATURE_UNITS.MINUTES,
  min: 0,
  max: NO_DEPARTURE_MINUTES,
  read_only: true,
  has_feedback: false,
  keep_history: false,
});

const text = (name, externalId) => ({
  name,
  external_id: externalId,
  category: DEVICE_FEATURE_CATEGORIES.TEXT,
  type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
  // NOT NULL in the core, even for a text (422 on "Add to Gladys" without).
  min: 0,
  max: 0,
  read_only: true,
  has_feedback: false,
  keep_history: false,
});

/**
 * The device of a watched stop.
 * @param {object} gladys
 * @param {{ network: string, id: string, name: string, lines: string[] }} stop
 * @param {{ route: object, dir: number, headsign: string }[]} groups from lineGroups
 * @param {string} language
 * @param {string} networkName shown before the stop name
 */
export function buildStopDevice(gladys, stop, groups, language, networkName) {
  const ids = gladys.externalIds(STOP_TYPE, stopPlatformId(stop.network, stop.id));
  const names = NAMES[language] ?? NAMES.en;
  const features = [];
  const used = new Set();
  const unique = (name) => {
    let candidate = name;
    for (let n = 2; used.has(candidate); n += 1) {
      candidate = `${clip(name, MAX_FEATURE_NAME - 3)} ${n}`;
    }
    used.add(candidate);
    return candidate;
  };
  for (const group of groups) {
    features.push(
      countdown(unique(groupName(group, language)), ids.feature(`${groupKey(group, groups)}-next`)),
      countdown(
        unique(groupName(group, language, names.following)),
        ids.feature(`${groupKey(group, groups)}-following`),
      ),
    );
  }
  features.push(text(unique(names.board), ids.feature(BOARD_KEY)));
  features.push(text(unique(names.traffic), ids.feature(TRAFFIC_KEY)));
  const filter = stop.lines.length > 0 ? ` (${stop.lines.join(', ')})` : '';
  return {
    name: clip(`${networkName} · ${stop.name}${filter}`, 80),
    external_id: ids.device,
    should_poll: false,
    // What is needed to watch the stop again when /data is lost.
    params: [
      { name: 'network', value: stop.network },
      { name: 'stop_id', value: stop.id },
      { name: 'lines', value: stop.lines.join(',') },
    ],
    features,
  };
}

/** "dans 3 et 7 min", "maintenant", "aucun passage dans les 24 h"... */
export function whenText(departures, language) {
  const [first, second] = departures;
  if (!first) {
    return say(TEXT, language, 'noDeparture').toLowerCase();
  }
  if (!second) {
    return first.minutes === 0
      ? say(TEXT, language, 'now')
      : say(TEXT, language, 'in', { minutes: first.minutes });
  }
  return first.minutes === 0
    ? say(TEXT, language, 'nowThen', { second: second.minutes })
    : say(TEXT, language, 'inTwo', { first: first.minutes, second: second.minutes });
}

/** The three soonest departures of the board: "L1 → Gare 2 min · A → Basso Cambo ≈4 min". */
export function boardText(board, language) {
  const soonest = board
    .flatMap((group) => group.departures.slice(0, 1).map((departure) => ({ group, departure })))
    .sort((a, b) => a.departure.at - b.departure.at)
    .slice(0, BOARD_ENTRIES);
  if (soonest.length === 0) {
    return say(TEXT, language, 'noDeparture');
  }
  return clip(
    soonest
      .map(({ group, departure }) => {
        const route = clip(group.route.short, 16);
        const mark = departure.realtime ? '' : '≈';
        return `${route} → ${clip(departure.headsign, 24)} ${mark}${departure.minutes} min`;
      })
      .join(' · '),
    MAX_TEXT_STATE,
  );
}

/**
 * The states of a stop device.
 * @param {object} gladys
 * @param {{ id: string }} stop
 * @param {object[]} board from buildBoard
 * @param {string} traffic the traffic info text
 * @param {string} language
 */
export function stopStates(gladys, stop, board, traffic, language) {
  const ids = gladys.externalIds(STOP_TYPE, stopPlatformId(stop.network, stop.id));
  const states = [];
  for (const group of board) {
    const [next, following] = group.departures;
    states.push(
      {
        device_feature_external_id: ids.feature(`${groupKey(group, board)}-next`),
        state: next ? Math.min(next.minutes, NO_DEPARTURE_MINUTES) : NO_DEPARTURE_MINUTES,
      },
      {
        device_feature_external_id: ids.feature(`${groupKey(group, board)}-following`),
        state: following ? Math.min(following.minutes, NO_DEPARTURE_MINUTES) : NO_DEPARTURE_MINUTES,
      },
    );
  }
  states.push(
    { device_feature_external_id: ids.feature(BOARD_KEY), text: boardText(board, language) },
    {
      device_feature_external_id: ids.feature(TRAFFIC_KEY),
      text: clip(traffic || say(TEXT, language, 'noDisruption'), MAX_TEXT_STATE),
    },
  );
  return states;
}
