// -----------------------------------------------------------------------------
// Scene actions (manifest `scene_actions`, Gladys 5.1+).
//
// - get_next_departures: the next departures of a watched stop, as numbers
//   for a "Continue only if" step and as a sentence ready for a message or a
//   speaker ("Métro A vers Basso Cambo à Jean Jaurès : dans 3 et 7 min").
//
// A scene action does not receive the user's language: the sentences follow
// the `language` of the configuration. Outputs are numbers, never booleans:
// the core's "Continue only if" compares with ===, and its value field only
// produces numbers and strings (Gladys 5.2.0).
// -----------------------------------------------------------------------------

import { NO_DEPARTURE_MINUTES, lineLabel } from './devices.js';
import { TEXT, say } from './messages.js';

// Groups in the sentence of a stop without line filter.
export const MAX_SENTENCE_GROUPS = 4;

export class SceneError extends Error {}

function notReady(service) {
  return new SceneError(say(TEXT, service.config.language, 'unavailable'));
}

export const SCENE_ACTIONS = {
  async get_next_departures(service, { fields }) {
    const language = service.config.language;
    const found = service.boardOf(fields.stop);
    if (!found) {
      throw service.stopOfDevice(fields.stop)
        ? notReady(service)
        : new SceneError(say(TEXT, language, 'gone'));
    }
    const { stop, board } = found;
    const line = String(fields.line ?? '')
      .trim()
      .toUpperCase();
    const groups = board
      .filter((group) => !line || group.route.short.toUpperCase() === line)
      .filter((group) => group.departures.length > 0)
      .sort((a, b) => a.departures[0].at - b.departures[0].at);
    const first = groups[0];
    if (!first) {
      return {
        sentence: say(TEXT, language, 'nothingAt', { stop: stop.name }),
        stop_name: stop.name,
        line: line || '',
        direction: '',
        minutes: NO_DEPARTURE_MINUTES,
        following_minutes: NO_DEPARTURE_MINUTES,
        realtime: 0,
        count: 0,
      };
    }
    const [next, following] = first.departures;
    return {
      sentence: groups
        .slice(0, MAX_SENTENCE_GROUPS)
        .map((group) => service.sentence(stop, group, language))
        .join('. '),
      stop_name: stop.name,
      line: lineLabel(first.route, language),
      direction: next.headsign,
      minutes: next.minutes,
      following_minutes: following ? following.minutes : NO_DEPARTURE_MINUTES,
      realtime: next.realtime ? 1 : 0,
      count: groups.length,
    };
  },
};
