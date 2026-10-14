// -----------------------------------------------------------------------------
// Service alerts (GTFS-RT ServiceAlerts): plain text out of the HTML
// the operator writes, which ones concern a watched line, and which ones are
// new since the last check (the "disruption on a followed line" trigger).
//
// Two kinds in the real feeds: line alerts (informed entity with a route id:
// "L9 : Déviation…") and network alerts (agency only: strikes, closures of
// the Tisséo shops, a park-and-ride under works).
// -----------------------------------------------------------------------------

const ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", rsquo: '’' };

/** The text of an HTML fragment: tags dropped, entities decoded, blank lines squeezed. */
export function htmlToText(html) {
  return (
    String(html ?? '')
      // Line breaks of the source are not significant in HTML, the tags are.
      .replace(/[\r\n]+/g, ' ')
      .replace(/<\s*(br|\/p|\/h\d|\/li|\/div)\b[^>]*>/gi, '\n')
      .replace(/<[^>]*>/g, '')
      .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code) => {
        if (code[0] === '#') {
          const value =
            code[1] === 'x' || code[1] === 'X'
              ? parseInt(code.slice(2), 16)
              : parseInt(code.slice(1));
          return Number.isFinite(value) && value > 0 && value < 0x110000
            ? String.fromCodePoint(value)
            : '';
        }
        return ENTITIES[code.toLowerCase()] ?? match;
      })
      .replace(/[ \t\u00a0]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

/** The translation to show: the configured language, else the untagged or first one. */
export function pickTranslation(translations, language) {
  if (!translations?.length) {
    return '';
  }
  return (
    translations.find((t) => t.language === language) ??
    translations.find((t) => !t.language) ??
    translations[0]
  ).text;
}

/** Active now: no period, or one that contains now (seconds). */
export function isActive(alert, now) {
  if (!alert.periods?.length) {
    return true;
  }
  const seconds = now / 1000;
  return alert.periods.some(
    (period) =>
      (!period.start || period.start <= seconds) && (!period.end || seconds <= period.end),
  );
}

/**
 * The alerts of the feed, readable: `{ id, routes: string[], agencies: string[], trips: string[], network: boolean,
 * title, description, url }`, active ones only.
 */
export function readAlerts(feedAlerts, { now, language }) {
  const result = [];
  for (const alert of feedAlerts ?? []) {
    if (!isActive(alert, now)) {
      continue;
    }
    const routes = [...new Set(alert.entities.map((e) => e.routeId).filter(Boolean))];
    const agencies = [...new Set(alert.entities.map((e) => e.agencyId).filter(Boolean))];
    const trips = [...new Set(alert.entities.map((e) => e.tripId).filter(Boolean))];
    const network =
      routes.length === 0 &&
      alert.entities.some((e) => e.agencyId && !e.stopId && !e.tripId && e.routeType === null);
    const title = htmlToText(pickTranslation(alert.header, language));
    if (!title || (routes.length === 0 && !network && trips.length === 0)) {
      continue;
    }
    const url = pickTranslation(alert.url, language);
    result.push({
      id: alert.id,
      routes,
      agencies,
      trips,
      network,
      title,
      description: htmlToText(pickTranslation(alert.description, language)),
      url: /^https?:\/\//.test(url) ? url : '',
    });
  }
  return result;
}

/**
 * The short form of a trip id, for the alerts that name trips by another id
 * than the timetable: SNCF alerts say "OCESN849606F" for the trip
 * "OCESN849606F1187_F:OUI:…" of the GTFS.
 */
export function tripStem(tripId) {
  return /^[A-Za-z]*\d+[A-Za-z]?/.exec(tripId)?.[0] ?? tripId;
}

/**
 * Gives the alerts that only name trips the routes of these trips, among the
 * departures known (those of the watched stops).
 * @param {object[]} alerts from readAlerts
 * @param {Iterable<{ id: string, route: string }>} trips
 */
export function routesFromTrips(alerts, trips) {
  if (!alerts.some((alert) => alert.routes.length === 0 && alert.trips.length > 0)) {
    return alerts;
  }
  const byId = new Map();
  const byStem = new Map();
  for (const trip of trips) {
    byId.set(trip.id, trip.route);
    byStem.set(tripStem(trip.id), trip.route);
  }
  return alerts.map((alert) => {
    if (alert.routes.length > 0 || alert.trips.length === 0) {
      return alert;
    }
    const routes = new Set();
    for (const id of alert.trips) {
      const route = byId.get(id) ?? byStem.get(tripStem(id));
      if (route) {
        routes.add(route);
      }
    }
    return { ...alert, routes: [...routes] };
  });
}

/** The traffic info of a set of routes: the titles of their line alerts. */
export function trafficText(alerts, routeIds) {
  return alerts
    .filter((alert) => alert.routes.some((route) => routeIds.has(route)))
    .map((alert) => alert.title)
    .join(' · ');
}

/** The identity of an alert for the "new disruption" trigger: its id and its title. */
export const alertKey = (alert) => `${alert.id}|${alert.title}`;
