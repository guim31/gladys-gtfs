// -----------------------------------------------------------------------------
// SIRI, the other realtime format of transport.data.gouv.fr (a network that
// publishes no GTFS-RT may publish SIRI): the requests and the reading of the
// answers, whatever the server.
//
// Two flavours, as the catalog labels them:
// - "SIRI" (2.0): XML over SOAP, one URL, an operation per request
//   (GetStopMonitoring, GetGeneralMessage, …); the RequestorRef of the request
//   is the access key (Profil SIRI France). The catalog publishes it when it
//   is public (`requestor_ref`). Envelopes as transport.data.gouv.fr's own
//   SIRI querier sends them (etalab/transport-site, lib/siri_queries.ex).
// - "SIRI Lite": REST, a GET per service ("…/stop-monitoring?MonitoringRef=…",
//   "…/general-message"), JSON most of the time. The key goes wherever the
//   platform wants it (HTTP Basic for the CTS, `AccountKey` for Mecatran,
//   an `apikey` header for PRIM): see `keyPlacement`.
//
// The answers vary between platforms: SOAP envelopes or a bare <Siri>,
// namespace prefixes, `{ "value": … }` wrappers (PRIM), plain strings (CTS),
// arrays or single objects. They are read by name, case-insensitively and
// at any depth, and only the few fields the board needs are kept.
// -----------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';
import { hostOf } from './http.js';
import { parseXml } from './xml.js';

export const SIRI = 'siri';
export const SIRI_LITE = 'siri-lite';

// SIRI Lite services, as the French profile names them in the URL.
export const LITE_SERVICES = {
  stopMonitoring: 'stop-monitoring',
  generalMessage: 'general-message',
  situationExchange: 'situation-exchange',
  stopPoints: 'stoppoints-discovery',
};
const LITE_PATH =
  /\/(stop-monitoring|general-message|situation-exchange|stoppoints-discovery|lines-discovery|estimated-timetable|vehicle-monitoring|check-status)(\.json|\.xml)?\/?$/i;

// SOAP operations, and the element carrying the request of each.
const SOAP_OPERATIONS = {
  stopMonitoring: 'GetStopMonitoring',
  generalMessage: 'GetGeneralMessage',
  situationExchange: 'GetSituationExchange',
  stopPoints: 'StopPointsDiscovery',
};

// Lite hosts whose key placement is known (documented by the platform).
const KNOWN_HOSTS = [
  { host: /(^|\.)cts-strasbourg\.eu$/i, place: { type: 'basic' } },
  { host: /(^|\.)mecatran\.com$/i, place: { type: 'query', name: 'AccountKey' } },
  { host: /(^|\.)iledefrance-mobilites\.fr$/i, place: { type: 'header', name: 'apikey' } },
  // Ginko (Besançon), SOAP: the key is the apiKey parameter of the URL, as
  // for its own API; a key in RequestorRef reads as no key at all (17/10).
  { host: /(^|\.)ginko\.voyage$/i, place: { type: 'query', name: 'apiKey' } },
];
const KEY_PARAM = /^(api_?key|account_?key|key|token|access_?token|requestor_?ref|cle)$/i;

/** "SIRI" / "SIRI Lite" (catalog formats) → SIRI / SIRI_LITE; null otherwise. */
export function siriFormat(format) {
  const value = String(format ?? '')
    .trim()
    .toLowerCase();
  if (value === 'siri') {
    return SIRI;
  }
  if (value === 'siri lite' || value === 'siri-lite' || value === 'sirilite') {
    return SIRI_LITE;
  }
  return null;
}

/** The flavour of a URL typed by the user: REST when it names a Lite service. */
export function guessFormat(url) {
  try {
    const { pathname } = new URL(url);
    return LITE_PATH.test(pathname) || /lite/i.test(pathname) ? SIRI_LITE : SIRI;
  } catch {
    return SIRI;
  }
}

/**
 * A SIRI endpoint: `{ url, format, requestorRef }`, the URL of a Lite one
 * reduced to the base its services hang from ("…/2.0/stop-monitoring.json?
 * AccountKey=x" → base "…/2.0", ext ".json", query "AccountKey=x").
 */
export function siriEndpoint({ url, format, requestorRef = null }) {
  const kind = format === SIRI_LITE ? SIRI_LITE : SIRI;
  const endpoint = { url, format: kind, requestorRef: requestorRef || null };
  if (kind === SIRI_LITE) {
    const parsed = new URL(url);
    const match = LITE_PATH.exec(parsed.pathname);
    endpoint.ext = match?.[2] ?? '';
    // The service the catalog URL names: "estimated-timetable" says the
    // server may offer no stop monitoring at all (BlaBlaCar Bus).
    endpoint.service = match?.[1]?.toLowerCase() ?? null;
    endpoint.base = `${parsed.origin}${parsed.pathname.replace(LITE_PATH, '').replace(/\/+$/, '')}`;
    // Parameters of a request, never kept from the catalog URL.
    for (const name of ['MonitoringRef', 'LineRef', 'MaximumStopVisits', 'StopVisitTypes']) {
      parsed.searchParams.delete(name);
    }
    endpoint.query = parsed.searchParams;
  }
  return endpoint;
}

/**
 * The key of a GTFS-RT feed of the network (Ginko publishes one beside its
 * SIRI, behind the same apiKey, forum t/11150/18): sent only where it is
 * known to go — a host of KNOWN_HOSTS, a key parameter already in the URL,
 * or the form the user wrote ("name=value", "Name: value"). Never to an
 * unknown host as a guess: the feeds of the catalog are often public.
 * @returns {{ url: string, headers: object }}
 */
export function realtimeRequest(url, key) {
  const plain = { url, headers: {} };
  const raw = String(key ?? '').trim();
  if (!raw) {
    return plain;
  }
  let target;
  try {
    target = new URL(url);
  } catch {
    return plain;
  }
  const place = keyPlacement({ url, format: SIRI_LITE, query: target.searchParams }, raw);
  const forced = /^[A-Za-z][\w-]*\s*:\s*\S|^[A-Za-z][\w.-]*=./.test(raw);
  const known = KNOWN_HOSTS.some((entry) => entry.host.test(hostOf(url)));
  const inUrl = [...target.searchParams.keys()].some((name) => KEY_PARAM.test(name));
  if (!forced && !known && !inUrl) {
    return plain;
  }
  if (place.type === 'query') {
    target.searchParams.set(place.name, place.value);
    return { url: target.toString(), headers: {} };
  }
  if (place.type === 'header') {
    return { url, headers: { [place.name]: place.value } };
  }
  return plain;
}

/**
 * Where the key goes. The user may say it: "name=value" is a query parameter,
 * "Name: value" a header. A bare key goes to the RequestorRef of a SOAP
 * request; for a Lite server, to the parameter of the catalog URL that holds
 * a key, else where its platform wants it, else HTTP Basic (the CTS way, the
 * most common) and the X-Siri-RequestorRef header of the French profile.
 */
export function keyPlacement(endpoint, key) {
  const raw = String(key ?? '').trim();
  if (!raw) {
    return { type: 'none' };
  }
  const header = /^([A-Za-z][\w-]*)\s*:\s*(\S.*)$/.exec(raw);
  if (header && !/^https?$/i.test(header[1])) {
    return { type: 'header', name: header[1], value: header[2].trim() };
  }
  const param = /^([A-Za-z][\w.-]*)=(.+)$/.exec(raw);
  if (param) {
    return { type: 'query', name: param[1], value: param[2] };
  }
  const known = KNOWN_HOSTS.find((entry) => entry.host.test(hostOf(endpoint.url)));
  if (known) {
    return { ...known.place, value: raw };
  }
  if (endpoint.format === SIRI) {
    return { type: 'requestor', value: raw };
  }
  const existing = [...(endpoint.query?.keys() ?? [])].find((name) => KEY_PARAM.test(name));
  if (existing) {
    return { type: 'query', name: existing, value: raw };
  }
  return { type: 'basic+header', value: raw };
}

const escapeXml = (text) =>
  String(text).replace(
    /[<>&"']/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c],
  );

/** The SOAP envelope of a request (the transport.data.gouv.fr querier's). */
export function soapEnvelope(service, { requestorRef, now, monitoringRef = null }) {
  const operation = SOAP_OPERATIONS[service];
  const timestamp = new Date(now).toISOString();
  const id = `gladys-gtfs:${randomUUID()}`;
  const head = `<siri:RequestTimestamp>${timestamp}</siri:RequestTimestamp><siri:RequestorRef>${escapeXml(requestorRef)}</siri:RequestorRef><siri:MessageIdentifier>${id}</siri:MessageIdentifier>`;
  const body =
    service === 'stopPoints'
      ? `<Request version="2.0">${head}</Request>`
      : `<ServiceRequestInfo>${head}</ServiceRequestInfo><Request version="2.0"><siri:RequestTimestamp>${timestamp}</siri:RequestTimestamp><siri:MessageIdentifier>${id}</siri:MessageIdentifier>${
          monitoringRef
            ? `<siri:MonitoringRef>${escapeXml(monitoringRef)}</siri:MonitoringRef><siri:StopVisitTypes>departures</siri:StopVisitTypes>`
            : ''
        }</Request>`;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<S:Envelope xmlns:S="http://schemas.xmlsoap.org/soap/envelope/"><S:Body>',
    `<sw:${operation} xmlns:sw="http://wsdl.siri.org.uk" xmlns:siri="http://www.siri.org.uk/siri">`,
    `${body}<RequestExtension/></sw:${operation}></S:Body></S:Envelope>`,
  ].join('');
}

/**
 * The HTTP request of a SIRI service: `{ url, init }` for fetch. The key is
 * only in there: never log the URL of a Lite request.
 */
export function siriRequest(endpoint, service, { key, now, monitoringRef = null }) {
  const place = keyPlacement(endpoint, key);
  const headers = {};
  if (place.type === 'header') {
    headers[place.name] = place.value;
  } else if (place.type === 'basic' || place.type === 'basic+header') {
    headers.authorization = `Basic ${Buffer.from(`${place.value}:`).toString('base64')}`;
    if (place.type === 'basic+header') {
      headers['x-siri-requestorref'] = place.value;
    }
  }
  if (endpoint.format === SIRI) {
    const url = new URL(endpoint.url);
    if (place.type === 'query') {
      url.searchParams.set(place.name, place.value);
    }
    return {
      url: url.toString(),
      init: {
        method: 'POST',
        headers: { ...headers, 'content-type': 'text/xml; charset=utf-8', accept: 'text/xml' },
        body: soapEnvelope(service, {
          requestorRef:
            place.type === 'requestor' ? place.value : endpoint.requestorRef || 'gladys-gtfs',
          now,
          monitoringRef,
        }),
      },
    };
  }
  const query = new URLSearchParams(endpoint.query);
  if (place.type === 'query') {
    query.set(place.name, place.value);
  }
  if (monitoringRef) {
    query.set('MonitoringRef', monitoringRef);
  }
  const search = query.toString();
  return {
    url: `${endpoint.base}/${LITE_SERVICES[service]}${endpoint.ext}${search ? `?${search}` : ''}`,
    init: { method: 'GET', headers: { ...headers, accept: 'application/json, text/xml' } },
  };
}

/** Removes the key from a text coming back from the server (an error that echoes it). */
export function redact(text, key) {
  let value = String(text ?? '');
  for (const secret of [key, String(key ?? '').replace(/^[^=:]+[=:]\s*/, '')]) {
    if (secret && secret.length >= 4) {
      value = value.split(secret).join('***');
    }
  }
  return value;
}

// --- reading -------------------------------------------------------------------

export class NotSiriError extends Error {}

/** A SIRI answer, JSON or XML, as a tree; NotSiriError for anything else (an HTML page). */
export function parseSiri(body) {
  const text = Buffer.isBuffer(body) ? body.toString('utf8') : String(body);
  const start = text.trimStart();
  if (/^<(!doctype\s+html|html[\s>])/i.test(start)) {
    throw new NotSiriError('an HTML page, not SIRI');
  }
  try {
    return start.startsWith('<') ? parseXml(start) : JSON.parse(start);
  } catch (err) {
    throw new NotSiriError(`unreadable answer (${err.message})`);
  }
}

const lower = (name) => String(name).toLowerCase();

/** The value of the child `name` of a node (case-insensitive), the first one of an array. */
export function child(node, name) {
  const value = Array.isArray(node) ? node[0] : node;
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const wanted = lower(name);
  for (const key of Object.keys(value)) {
    if (lower(key) === wanted) {
      return value[key];
    }
  }
  return undefined;
}

const asList = (value) => (value === undefined || value === null ? [] : [value].flat());

/** Every value of the children `name` of a node, as a list. */
export const children = (node, name) => asList(child(node, name));

/** Every value found under the key `name` at any depth (not inside a match). */
export function findAll(node, name, found = []) {
  if (Array.isArray(node)) {
    for (const item of node) {
      findAll(item, name, found);
    }
  } else if (node && typeof node === 'object') {
    const wanted = lower(name);
    for (const [key, value] of Object.entries(node)) {
      if (lower(key) === wanted) {
        found.push(...asList(value));
      } else {
        findAll(value, name, found);
      }
    }
  }
  return found;
}

/**
 * The text of a value: a string, `{ value }`/`{ Value }`, or a list of
 * translations (the one in `language` when there is a choice).
 */
export function textOf(value, language = 'fr') {
  if (value === undefined || value === null) {
    return '';
  }
  if (typeof value !== 'object') {
    return String(value).trim();
  }
  if (Array.isArray(value)) {
    const texts = value
      .map((item) => ({ text: textOf(item, language), lang: lower(langOf(item)) }))
      .filter((item) => item.text);
    const chosen =
      texts.find((item) => item.lang === language) ??
      texts.find((item) => !item.lang || item.lang === 'fr') ??
      texts[0];
    return chosen?.text ?? '';
  }
  const inner = child(value, 'value') ?? child(value, '_') ?? child(value, '#text');
  return inner === undefined ? '' : textOf(inner, language);
}

function langOf(value) {
  return value && typeof value === 'object' ? (child(value, 'lang') ?? '') : '';
}

/** Every translation of a value: `[{ text, language }]`. */
export function translations(value) {
  return asList(value)
    .map((item) => ({ text: textOf(item), language: lower(langOf(item)) }))
    .filter((item) => item.text);
}

/** An ISO 8601 date-time → epoch ms; null when absent or invalid. */
export function timeOf(value) {
  const text = textOf(value);
  if (!text) {
    return null;
  }
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? ms : null;
}

const truthy = (value) => /^(true|1|yes)$/i.test(textOf(value));
const falsy = (value) => /^(false|0|no)$/i.test(textOf(value));

/**
 * An error the server reports in the body: `{ code, text }` (code: the name
 * of the SIRI error, "AccessNotAllowedError"…), null when none.
 */
export function siriError(tree) {
  // Ginko answers its key errors in JSON, under an HTTP 200:
  // { "ok": false, "msg": "La clé donnée en paramètre est invalide" }.
  if (tree && typeof tree === 'object' && tree.ok === false && typeof tree.msg === 'string') {
    return {
      code: /cl[ée]|key/i.test(tree.msg) ? 'AccessNotAllowedError' : 'Error',
      text: tree.msg,
    };
  }
  const conditions = findAll(tree, 'ErrorCondition');
  for (const condition of conditions) {
    if (!condition || typeof condition !== 'object') {
      continue;
    }
    const code = Object.keys(condition).find((key) => /error$/i.test(key)) ?? 'Error';
    const text =
      textOf(findAll(condition, 'ErrorText')[0]) || textOf(child(condition, 'Description')) || code;
    return { code, text };
  }
  const fault = findAll(tree, 'Fault')[0];
  if (fault) {
    return { code: 'Fault', text: textOf(findAll(fault, 'faultstring')[0]) || 'SOAP fault' };
  }
  return null;
}

/** A SIRI error meaning the key is missing or refused. */
export const isAccessError = (error) =>
  /AccessNotAllowed|UnknownSubscriber|UnknownParticipant|Unauthori[sz]ed|Forbidden|apikey|api key/i.test(
    `${error?.code} ${error?.text}`,
  );

/** A SIRI error meaning the stop is not known under this reference. */
export const isReferenceError = (error) =>
  /InvalidDataReferences|UnknownStop|Unknown.*(Monitoring|Stop)|not found|introuvable|inconnu/i.test(
    `${error?.code} ${error?.text}`,
  );

/** A SIRI error meaning the service is not offered at all. */
export const isUnsupportedError = (error) =>
  /CapabilityNotSupported|ServiceNotAvailable|NotSupported|not implemented/i.test(
    `${error?.code} ${error?.text}`,
  );

/** The time of the answer (ResponseTimestamp), epoch ms. */
export const responseTime = (tree) => timeOf(findAll(tree, 'ResponseTimestamp')[0]);

/**
 * The stop visits of a StopMonitoring answer.
 * @returns {{ monitoringRef: string, stopPointRef: string, lineRef: string, lineName: string,
 *   directionRef: string, destination: string, journeyRef: string, aimed: number|null,
 *   expected: number|null, cancelled: boolean, monitored: boolean }[]}
 */
export function readStopVisits(tree) {
  const visits = [];
  for (const visit of findAll(tree, 'MonitoredStopVisit')) {
    const journey = child(visit, 'MonitoredVehicleJourney');
    if (!journey) {
      continue;
    }
    const call = child(journey, 'MonitoredCall') ?? {};
    const pick = (...names) => {
      for (const name of names) {
        const value = child(call, name);
        if (value !== undefined) {
          return value;
        }
      }
      return undefined;
    };
    const aimed = timeOf(pick('AimedDepartureTime')) ?? timeOf(pick('AimedArrivalTime'));
    const expected = timeOf(pick('ExpectedDepartureTime')) ?? timeOf(pick('ExpectedArrivalTime'));
    const status = `${textOf(pick('DepartureStatus'))} ${textOf(pick('ArrivalStatus'))}`;
    const framed = child(journey, 'FramedVehicleJourneyRef');
    // "Monitored": false says the times are the timetable's; the CTS says
    // so in its Extension (IsRealTime).
    const monitoredFlag = child(journey, 'Monitored');
    const realTimeFlag = child(child(call, 'Extension'), 'IsRealTime');
    visits.push({
      monitoringRef: textOf(child(visit, 'MonitoringRef')),
      stopPointRef: textOf(child(call, 'StopPointRef')),
      lineRef: textOf(child(journey, 'LineRef')),
      lineName: textOf(child(journey, 'PublishedLineName')),
      directionRef: textOf(child(journey, 'DirectionRef')),
      destination:
        textOf(child(journey, 'DestinationName')) ||
        textOf(child(call, 'DestinationDisplay')) ||
        textOf(child(journey, 'DestinationShortName')),
      journeyRef:
        textOf(child(framed, 'DatedVehicleJourneyRef')) ||
        textOf(child(journey, 'DatedVehicleJourneyRef')),
      aimed,
      expected,
      cancelled: /cancel/i.test(status) || truthy(child(journey, 'Cancellation')),
      monitored: !falsy(monitoredFlag) && !falsy(realTimeFlag),
    });
  }
  return visits;
}

const lineRefsOf = (node) => [
  ...new Set(
    [...findAll(node, 'LineRef'), ...findAll(node, 'ImpactedLineRef')]
      .map((ref) => textOf(ref))
      .filter(Boolean),
  ),
];

const stopRefsOf = (node) => [
  ...new Set(
    findAll(node, 'StopPointRef')
      .map((ref) => textOf(ref))
      .filter(Boolean),
  ),
];

/**
 * The messages of a GeneralMessage answer (Profil France: a short and a long
 * text, lines and stops in its Content), as situations.
 */
function generalMessages(tree) {
  const situations = [];
  const messages = [...findAll(tree, 'GeneralMessage'), ...findAll(tree, 'InfoMessage')].filter(
    (message) => message && typeof message === 'object' && child(message, 'Content') !== undefined,
  );
  for (const message of messages) {
    const content = child(message, 'Content');
    const parts = typeof content === 'object' ? findAll(content, 'Message') : [];
    const byType = (pattern) =>
      parts
        .filter((part) => pattern.test(textOf(child(part, 'MessageType'))))
        .flatMap((part) => translations(child(part, 'MessageText')));
    const all = parts.flatMap((part) => translations(child(part, 'MessageText') ?? part));
    const shortText = byType(/short/i);
    const longText = byType(/long|textonly|text_only/i);
    const header = shortText.length > 0 ? shortText : longText.length > 0 ? longText : all;
    const plain = typeof content === 'string' ? [{ text: content, language: '' }] : [];
    const start =
      timeOf(child(content, 'ImpactStartDateTime')) ?? timeOf(child(message, 'StartTime'));
    const end =
      timeOf(child(content, 'ImpactEndDateTime')) ?? timeOf(child(message, 'ValidUntilTime'));
    situations.push({
      id:
        textOf(child(message, 'InfoMessageIdentifier')) ||
        textOf(child(message, 'ItemIdentifier')) ||
        '',
      lineRefs: typeof content === 'object' ? lineRefsOf(content) : [],
      stopRefs: typeof content === 'object' ? stopRefsOf(content) : [],
      periods: start || end ? [{ start, end }] : [],
      header: header.length > 0 ? header : plain,
      description: longText.length > 0 && shortText.length > 0 ? longText : [],
      url: [],
    });
  }
  return situations;
}

/** The situations of a SituationExchange answer. */
function exchangedSituations(tree) {
  const situations = [];
  for (const element of findAll(tree, 'PtSituationElement')) {
    const closed = /closed/i.test(textOf(child(element, 'Progress')));
    const affects = child(element, 'Affects') ?? {};
    const consequences = child(element, 'Consequences') ?? {};
    situations.push({
      closed,
      id: textOf(child(element, 'SituationNumber')),
      lineRefs: lineRefsOf([affects, consequences]),
      stopRefs: stopRefsOf([affects, consequences]),
      periods: children(element, 'ValidityPeriod').map((period) => ({
        start: timeOf(child(period, 'StartTime')),
        end: timeOf(child(period, 'EndTime')),
      })),
      header: translations(child(element, 'Summary')),
      description: [
        ...translations(child(element, 'Description')),
        ...translations(child(element, 'Detail')),
        ...translations(child(element, 'Advice')),
      ],
      url: findAll(element, 'InfoLink')
        .map((link) => textOf(child(link, 'Uri')))
        .filter((uri) => /^https?:\/\//.test(uri))
        .map((text) => ({ text, language: '' })),
    });
  }
  return situations;
}

/**
 * The disruptions of a GeneralMessage or SituationExchange answer:
 * `{ id, lineRefs, stopRefs, periods: [{ start, end }] (epoch ms), header,
 * description, url }` (texts as `[{ text, language }]`). A closed situation
 * is left out, or kept with `closed: true` for `keepClosed` (an incremental
 * server says so to remove it).
 */
export function readSituations(tree, { keepClosed = false } = {}) {
  return [...generalMessages(tree), ...exchangedSituations(tree)].filter((situation) =>
    situation.closed ? keepClosed : situation.header.length > 0,
  );
}

/**
 * The stop points of a StopPointsDiscovery answer read block by block,
 * without the tree of the whole answer: IRYS (TUB) sends 5.6 MB for 16,560
 * points, Okina 2.2 MB; the sandbox has 256 MB. JSON (SIRI Lite) and
 * answers carrying an error are read whole.
 * @param {Buffer|string} body
 * @returns {{ ref: string, name: string, lat: number, lon: number }[] | null} null: read it whole
 */
export function scanStopPoints(body) {
  const text = Buffer.isBuffer(body) ? body.toString('utf8') : String(body);
  const start = text.trimStart();
  if (
    !start.startsWith('<') ||
    /ErrorCondition|Fault>/.test(text) ||
    /^<(!doctype\s+html|html[\s>])/i.test(start)
  ) {
    return null;
  }
  const points = [];
  const open = /<([\w.-]+:)?AnnotatedStopPointRef[\s>]/g;
  let match;
  while ((match = open.exec(text)) !== null) {
    const closing = `</${match[1] ?? ''}AnnotatedStopPointRef>`;
    const end = text.indexOf(closing, match.index);
    if (end < 0) {
      throw new NotSiriError('unreadable answer (unclosed AnnotatedStopPointRef)');
    }
    const block = text.slice(match.index, end + closing.length);
    open.lastIndex = end + closing.length;
    let tree;
    try {
      tree = parseXml(block);
    } catch (err) {
      throw new NotSiriError(`unreadable answer (${err.message})`);
    }
    points.push(...readStopPoints(tree));
  }
  // Copies: the values must not keep the whole answer alive.
  return points.map((point) => ({
    ref: `${point.ref}`.split('').join(''),
    name: `${point.name}`.split('').join(''),
    lat: point.lat,
    lon: point.lon,
  }));
}

/** The stop points of a StopPointsDiscovery answer: `[{ ref, name, lat, lon }]`. */
export function readStopPoints(tree) {
  return findAll(tree, 'AnnotatedStopPointRef')
    .map((point) => {
      const location = child(point, 'Location');
      const number = (value) => (textOf(value) === '' ? NaN : Number(textOf(value)));
      return {
        ref: textOf(child(point, 'StopPointRef')),
        name: textOf(child(point, 'StopName')),
        lat: number(child(location, 'Latitude')),
        lon: number(child(location, 'Longitude')),
      };
    })
    .filter((point) => point.ref);
}

// --- identifiers ----------------------------------------------------------------

/**
 * The local part of a reference of the French profile:
 * "SAE_HANOVER:StopPoint:BP:STA1A2:LOC" → "STA1A2", "STIF:Line::C01742:" →
 * "C01742", "bordeaux:Line:59:LOC" → "59"; a plain code stays as it is.
 */
export function localRef(ref) {
  const parts = String(ref ?? '').split(':');
  const index = parts.findIndex((part) =>
    /^(StopPoint|StopArea|Line|Quay|StopPlace|ServiceJourney|VehicleJourney|Operator|Network)$/i.test(
      part,
    ),
  );
  if (index < 0) {
    return String(ref ?? '');
  }
  const rest = parts.slice(index + 1);
  if (/^(StopPoint|StopArea)$/i.test(parts[index]) && rest.length >= 2) {
    // A type comes first: Q (quay), BP (boarding position), SP…
    return rest[1] || rest[0];
  }
  return rest.find(Boolean) ?? String(ref);
}

/** A comparable form of a code: upper case, leading zeros dropped ("04" = "4"). */
export function codeKey(code) {
  return String(code ?? '')
    .trim()
    .toUpperCase()
    .replace(/^0+(?=\w)/, '');
}
