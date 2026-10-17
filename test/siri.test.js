// -----------------------------------------------------------------------------
// SIRI and SIRI Lite, unit by unit: the XML reader, the requests and where
// the key goes, the reading of the answers of the different platforms
// (test/fixtures/siri), the stop references and the matching to the
// timetable (the Tisséo GTFS fixture, at Pader).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readAlerts } from '../src/alerts.js';
import { siriUrl } from '../src/catalog.js';
import { resolveRedirects } from '../src/http.js';
import { HostGates, SiriReader } from '../src/siri-feed.js';
import { NotSiriError, isAccessError, scanStopPoints, soapEnvelope } from '../src/siri.js';
import { siriKeyFor } from '../src/config.js';
import { parseGtfs } from '../src/gtfs.js';
import {
  SIRI,
  SIRI_LITE,
  codeKey,
  guessFormat,
  keyPlacement,
  localRef,
  parseSiri,
  readSituations,
  readStopPoints,
  readStopVisits,
  redact,
  siriEndpoint,
  siriError,
  siriFormat,
  siriRequest,
  textOf,
} from '../src/siri.js';
import {
  directionOf,
  matchVisits,
  nearestByName,
  referenceCandidates,
  routesOfLine,
  situationsToAlerts,
} from '../src/siri-feed.js';
import { XmlError, parseXml } from '../src/xml.js';
import { FIXTURE_TIME, GTFS_ZIP, PADER, fixture } from './helpers/world.js';

const siri = (name) => parseSiri(fixture(`siri/${name}`));
const network = await parseGtfs(GTFS_ZIP, { watched: new Set([PADER]), now: FIXTURE_TIME });

test('XML: prefixes dropped, repeated elements as arrays, translations, CDATA, entities', () => {
  const tree = parseXml(
    `<?xml version="1.0"?><!-- c --><s:Root xmlns:s="x" a=">"><s:A>1</s:A><s:A>2 &amp; 3</s:A>` +
      `<B xml:lang="fr">Bonjour</B><C><![CDATA[<b>x</b>]]></C><D/><E><F>f</F>text</E></s:Root>`,
  );
  assert.deepEqual(tree, {
    Root: {
      A: ['1', '2 & 3'],
      B: { value: 'Bonjour', lang: 'fr' },
      C: '<b>x</b>',
      D: '',
      E: { F: 'f', value: 'text' },
    },
  });
  assert.throws(() => parseXml('<a><b></a>'), XmlError);
  assert.throws(() => parseXml('<a>'), XmlError);
  assert.throws(() => parseXml('text only'), XmlError);
  // No entity of a DOCTYPE is ever expanded.
  assert.deepEqual(parseXml('<!DOCTYPE a [<!ENTITY x "boom">]><a>&x;</a>'), { a: '&x;' });
});

test('formats: catalog labels, URLs typed by the user, Lite endpoints reduced to their base', () => {
  assert.equal(siriFormat('SIRI'), SIRI);
  assert.equal(siriFormat('SIRI Lite'), SIRI_LITE);
  assert.equal(siriFormat('gtfs-rt'), null);
  assert.equal(guessFormat('https://api.example.org/v1/siri/2.0/stop-monitoring'), SIRI_LITE);
  assert.equal(guessFormat('https://api.example.org/siri-lite/'), SIRI_LITE);
  assert.equal(guessFormat('https://example.org/siri/2.0/ws'), SIRI);
  const lite = siriEndpoint({
    url: 'https://x.mecatran.com/utw/ws/siri/2.0/bordeaux/stop-monitoring.json?AccountKey=KEY&MonitoringRef=1',
    format: SIRI_LITE,
  });
  assert.equal(lite.base, 'https://x.mecatran.com/utw/ws/siri/2.0/bordeaux');
  assert.equal(lite.ext, '.json');
  assert.equal(lite.query.toString(), 'AccountKey=KEY');
  assert.equal(
    siriEndpoint({ url: 'https://api.cts-strasbourg.eu/v1/siri/2.0/', format: SIRI_LITE }).base,
    'https://api.cts-strasbourg.eu/v1/siri/2.0',
  );
});

test('the key goes where each platform wants it, or where the user says', () => {
  const cts = siriEndpoint({
    url: 'https://api.cts-strasbourg.eu/v1/siri/2.0/',
    format: SIRI_LITE,
  });
  const mecatran = siriEndpoint({
    url: 'https://bdx.mecatran.com/utw/ws/siri/2.0/bordeaux/',
    format: SIRI_LITE,
  });
  const templated = siriEndpoint({
    url: 'https://rt.example.org/siri-lite/stop-monitoring?apiKey=YOUR_KEY',
    format: SIRI_LITE,
  });
  const unknown = siriEndpoint({ url: 'https://rt.example.org/siri-lite/', format: SIRI_LITE });
  const soap = siriEndpoint({ url: 'https://soap.example.org/siri', format: SIRI });
  assert.deepEqual(keyPlacement(cts, ' k1 '), { type: 'basic', value: 'k1' });
  assert.deepEqual(keyPlacement(mecatran, 'k1'), {
    type: 'query',
    name: 'AccountKey',
    value: 'k1',
  });
  assert.deepEqual(keyPlacement(templated, 'k1'), { type: 'query', name: 'apiKey', value: 'k1' });
  assert.deepEqual(keyPlacement(unknown, 'k1'), { type: 'basic+header', value: 'k1' });
  assert.deepEqual(keyPlacement(soap, 'k1'), { type: 'requestor', value: 'k1' });
  // Ginko, SOAP: the key goes in the URL (checked against its server, 17/10).
  const ginko = siriEndpoint({ url: 'https://api.ginko.voyage/Siri/Siri.do', format: SIRI });
  assert.deepEqual(keyPlacement(ginko, 'k1'), { type: 'query', name: 'apiKey', value: 'k1' });
  assert.deepEqual(keyPlacement(unknown, 'token=k1'), {
    type: 'query',
    name: 'token',
    value: 'k1',
  });
  assert.deepEqual(keyPlacement(soap, 'X-Api-Key: k1'), {
    type: 'header',
    name: 'X-Api-Key',
    value: 'k1',
  });
  assert.deepEqual(keyPlacement(soap, ''), { type: 'none' });

  const ctsRequest = siriRequest(cts, 'stopMonitoring', {
    key: 'k1',
    now: 0,
    monitoringRef: '43A',
  });
  assert.equal(
    ctsRequest.url,
    'https://api.cts-strasbourg.eu/v1/siri/2.0/stop-monitoring?MonitoringRef=43A',
  );
  assert.equal(
    ctsRequest.init.headers.authorization,
    `Basic ${Buffer.from('k1:').toString('base64')}`,
  );
  assert.equal(
    siriRequest(mecatran, 'generalMessage', { key: 'k1', now: 0 }).url,
    'https://bdx.mecatran.com/utw/ws/siri/2.0/bordeaux/general-message?AccountKey=k1',
  );
  const soapRequest = siriRequest(soap, 'stopMonitoring', {
    key: 'k&1',
    now: FIXTURE_TIME,
    monitoringRef: 'A:StopPoint:Q:1:LOC',
  });
  assert.equal(soapRequest.url, 'https://soap.example.org/siri');
  assert.equal(soapRequest.init.method, 'POST');
  assert.match(soapRequest.init.body, /<sw:GetStopMonitoring /);
  assert.match(soapRequest.init.body, /<siri:RequestorRef>k&amp;1<\/siri:RequestorRef>/);
  assert.match(
    soapRequest.init.body,
    /<siri:MonitoringRef>A:StopPoint:Q:1:LOC<\/siri:MonitoringRef>/,
  );
  assert.match(soapRequest.init.body, /<siri:RequestTimestamp>2026-10-13T15:19:07\.000Z/);
  // The public RequestorRef of the catalog when no key is typed.
  const open = siriEndpoint({
    url: 'https://soap.example.org/siri',
    format: SIRI,
    requestorRef: 'open-data',
  });
  assert.match(
    siriRequest(open, 'stopPoints', { key: '', now: 0 }).init.body,
    /<sw:StopPointsDiscovery [^>]*><Request version="2.0"><siri:RequestTimestamp>[^<]+<\/siri:RequestTimestamp><siri:RequestorRef>open-data</,
  );
  assert.equal(redact('RequestorRef k1-secret refused', 'k1-secret'), 'RequestorRef *** refused');
  assert.equal(redact('apikey abcd1234 refused', 'apikey: abcd1234'), 'apikey *** refused');
});

test('stop visits: CTS-like JSON, {value} wrappers, SOAP XML read alike', () => {
  const [first, second, unmonitored] = readStopVisits(siri('lite-stop-monitoring-5780.json'));
  assert.deepEqual(first, {
    monitoringRef: '5780',
    stopPointRef: '',
    lineRef: '29',
    lineName: '29',
    directionRef: '0',
    destination: 'Fonbeauzard Mermoz',
    journeyRef: '29-0-1721',
    aimed: null,
    expected: Date.parse('2026-10-13T17:21:40+02:00'),
    cancelled: false,
    monitored: true,
  });
  assert.equal(second.lineRef, 'L10');
  assert.equal(unmonitored.monitored, false, 'Extension.IsRealTime false');
  const [cancelled, delayed] = readStopVisits(siri('lite-stop-monitoring-5781.json'));
  assert.equal(cancelled.cancelled, true);
  assert.equal(delayed.aimed, Date.parse('2026-10-13T15:20:00Z'));
  assert.equal(delayed.expected, Date.parse('2026-10-13T15:22:30Z'));
  assert.equal(delayed.destination, 'La Vache');
  const [soap, timetable] = readStopVisits(siri('soap-stop-monitoring-5780.xml'));
  assert.equal(soap.lineRef, 'TEST:Line::209:LOC');
  assert.equal(soap.lineName, 'Linéo 10');
  assert.equal(soap.stopPointRef, 'TEST:StopPoint:BP:5780:LOC');
  assert.equal(soap.expected - soap.aimed, 190000);
  assert.equal(timetable.monitored, false);
  assert.equal(timetable.destination, 'Fonbeauzard & Mermoz');
});

test('disruptions: GeneralMessage (Profil France, JSON and XML) and SituationExchange', () => {
  const lite = readSituations(siri('lite-general-message.json'));
  assert.deepEqual(
    lite.map((s) => [s.id, s.lineRefs, s.header[0].text]),
    [
      ['TEST:InfoMessage::L10-travaux:LOC', ['L10'], 'L10 : arrêt Borderouge déplacé'],
      ['TEST:InfoMessage::agence:LOC', [], 'Agence commerciale fermée le 1er novembre'],
      ['TEST:InfoMessage::fini:LOC', ['29'], '29 : déviation terminée'],
    ],
  );
  assert.match(lite[0].description[0].text, /déplacé de 50 m/);
  assert.equal(lite[0].periods[0].end, Date.parse('2026-10-20T22:00:00Z'));
  const [soap] = readSituations(siri('soap-general-message.xml'));
  assert.deepEqual(soap.lineRefs, ['TEST:Line::84:LOC']);
  assert.match(soap.description[0].text, /<b>déviée<\/b>/);
  const exchanged = readSituations(siri('situation-exchange.xml'));
  assert.equal(exchanged.length, 1, 'a closed situation is dropped');
  assert.deepEqual(exchanged[0].lineRefs, ['59']);
  assert.deepEqual(
    exchanged[0].header.map((t) => t.language),
    ['fr', 'en'],
  );
  assert.equal(exchanged[0].url[0].text, 'https://example.org/info/59');
});

test('discovery, errors, references', () => {
  const points = readStopPoints(siri('soap-stop-points-discovery.xml'));
  assert.equal(points.length, 4);
  assert.deepEqual(points[0], {
    ref: 'TEST:StopPoint:BP:5780:LOC',
    name: 'Pader',
    lat: 43.63712,
    lon: 1.43338,
  });
  assert.ok(Number.isNaN(points[3].lat), 'no location');
  assert.deepEqual(siriError(siri('soap-fault-access.xml')), {
    code: 'AccessNotAllowedError',
    text: 'RequestorRef KEY-PLACEHOLDER is not allowed',
  });
  assert.equal(siriError(siri('lite-general-message.json')), null);
  assert.deepEqual(
    siriError(
      parseSiri('<Envelope><Body><Fault><faultstring>Bad</faultstring></Fault></Body></Envelope>'),
    ),
    { code: 'Fault', text: 'Bad' },
  );
  assert.equal(localRef('SAE_HANOVER:StopPoint:BP:STA1A2:LOC'), 'STA1A2');
  assert.equal(localRef('STIF:StopPoint:Q:473921:'), '473921');
  assert.equal(localRef('STIF:Line::C01742:'), 'C01742');
  assert.equal(localRef('bordeaux:Line:59:LOC'), '59');
  assert.equal(localRef('line:84'), '84');
  assert.equal(localRef('43A'), '43A');
  assert.equal(codeKey('04'), '4');
  assert.equal(codeKey(' l10 '), 'L10');
  assert.equal(
    textOf(
      [
        { value: 'Hello', lang: 'en' },
        { value: 'Bonjour', lang: 'fr' },
      ],
      'fr',
    ),
    'Bonjour',
  );
  assert.equal(textOf({ Value: 'x' }), 'x');
});

test('stop references: GTFS codes without discovery, the server list with it', () => {
  assert.deepEqual(referenceCandidates(network, 'stop_point:SP_327'), [
    '5780',
    'stop_point:SP_327',
    'SP_327',
  ]);
  const discovered = readStopPoints(siri('soap-stop-points-discovery.xml'));
  assert.deepEqual(referenceCandidates(network, 'stop_point:SP_327', discovered), [
    'TEST:StopPoint:BP:5780:LOC',
  ]);
  // Not by code: by name (case and accents aside) within 100 m.
  assert.deepEqual(referenceCandidates(network, 'stop_point:SP_2028', discovered), []);
  assert.equal(
    nearestByName(network, 'stop_point:SP_2028', discovered),
    'TEST:StopPoint:BP:PADER3:LOC',
  );
});

test('lines and directions of the visits, matched to the line groups of the stop', () => {
  const served = new Set(network.areas.get(PADER).routes);
  assert.deepEqual(routesOfLine(network, { lineRef: 'TEST:Line::209:LOC' }, served), ['line:209']);
  assert.deepEqual(routesOfLine(network, { lineRef: 'L10' }, served), ['line:209']);
  assert.deepEqual(routesOfLine(network, { lineRef: 'x', lineName: 'l10' }, served), ['line:209']);
  assert.deepEqual(routesOfLine(network, { lineRef: 'T9' }, served), []);
  // Destination, stop point, Aller/Retour.
  assert.equal(directionOf(network, PADER, ['line:209'], { destination: 'La Vache' }), 1);
  assert.equal(
    directionOf(network, PADER, ['line:209'], { destination: '' }, 'stop_point:SP_327'),
    0,
  );
  assert.equal(
    directionOf(network, PADER, ['line:209'], { destination: '?', directionRef: 'Retour' }),
    1,
  );
  assert.equal(
    directionOf(network, PADER, ['line:209'], { destination: '?', directionRef: '' }),
    null,
  );

  const lite = matchVisits(
    network,
    PADER,
    readStopVisits(siri('lite-stop-monitoring-5780.json')),
    'stop_point:SP_327',
  );
  assert.deepEqual(
    lite.map((v) => [v.key, new Date(v.at).toISOString().slice(11, 19), v.realtime]),
    [
      ['29|0', '15:21:40', true],
      ['L10|0', '15:24:30', true],
      ['169|0', '15:27:00', false],
      ['L10|0', '15:32:10', true],
    ],
    'the T9 tram is not in the timetable of the stop',
  );
  const soap = matchVisits(network, PADER, readStopVisits(siri('soap-stop-monitoring-5780.xml')));
  assert.deepEqual(
    soap.map((v) => [v.key, v.realtime, v.aimed !== null]),
    [
      ['L10|0', true, true],
      ['29|0', false, true],
    ],
  );
});

test('disruptions become alerts of the routes (or of the network) that src/alerts.js reads', () => {
  const alerts = situationsToAlerts(network, [
    ...readSituations(siri('lite-general-message.json')),
    ...readSituations(siri('soap-general-message.xml')),
    ...readSituations(siri('situation-exchange.xml')),
  ]);
  const readable = readAlerts(alerts, { now: FIXTURE_TIME, language: 'fr' });
  assert.deepEqual(
    readable.map((a) => [a.routes, a.network, a.title]),
    [
      [['line:209'], false, 'L10 : arrêt Borderouge déplacé'],
      [[], true, 'Agence commerciale fermée le 1er novembre'],
      [['line:84'], false, "Ligne 29 : déviation rue de l'Industrie"],
      [['line:32'], false, '59 : arrêt Pader non desservi'],
    ],
    'the message of last week is over',
  );
  assert.equal(
    readable[2].description,
    'Manifestation : la ligne 29 est déviée entre Pader et Borderouge.',
  );
  assert.equal(
    readAlerts(alerts, { now: FIXTURE_TIME, language: 'en' })[3].title,
    '59: Pader stop not served',
  );
  // A stop of a watched stop: the lines of that stop.
  const [byStop] = situationsToAlerts(
    network,
    [
      {
        id: 's',
        lineRefs: [],
        stopRefs: ['TEST:StopPoint:BP:5780:LOC'],
        periods: [],
        header: [{ text: 'Arrêt fermé', language: 'fr' }],
        description: [],
        url: [],
      },
    ],
    new Map([['TEST:StopPoint:BP:5780:LOC', PADER]]),
  );
  assert.deepEqual(
    byStop.entities.map((e) => e.routeId).sort(),
    [...network.areas.get(PADER).routes].sort(),
  );
});

test('SIRI keys of the configuration: by network name or id, or one key alone', () => {
  const ginko = { id: 'tdg81742', name: 'Ginko' };
  const cts = { id: 'tdg80000', name: 'CTS' };
  const both = [ginko, cts];
  assert.equal(siriKeyFor('Ginko = abc; cts=def', ginko, both), 'abc');
  assert.equal(siriKeyFor('Ginko = abc\nTDG80000: def', cts, both), 'def');
  assert.equal(siriKeyFor('  solo-key  ', ginko, both), 'solo-key');
  // A key alone that says where it goes is a key alone.
  assert.equal(siriKeyFor('AccountKey=xyz', cts, both), 'AccountKey=xyz');
  assert.equal(siriKeyFor('Ginko = abc; AccountKey=xyz', cts, both), 'AccountKey=xyz');
  assert.equal(siriKeyFor('Ginko = abc; other; again', cts, both), '', 'two keys alone: none');
  assert.equal(siriKeyFor('solo-key', ginko, both, { namedOnly: true }), '');
  assert.equal(siriKeyFor('', ginko, both), '');
  assert.equal(siriKeyFor(undefined, ginko, both), '');
});

test('a server answering a stop point with its whole area: each vehicle counted once', async () => {
  const { SiriReader } = await import('../src/siri-feed.js');
  const reader = new SiriReader({ info: { name: 'x', siri: [] }, fetch: null });
  const visits = matchVisits(
    network,
    PADER,
    readStopVisits(siri('lite-stop-monitoring-5780.json')),
  );
  reader.readings.set(`${PADER}|5780`, { at: FIXTURE_TIME, visits });
  reader.readings.set(`${PADER}|5781`, { at: FIXTURE_TIME, visits });
  const realtime = reader.realtime(FIXTURE_TIME);
  assert.equal(realtime.visits.get(PADER).length, visits.length);
  assert.equal(realtime.tracked, 3);
  assert.equal(reader.realtime(FIXTURE_TIME + 11 * 60_000), null, 'too old');
});

test('data.gouv.fr links: the producer address of the catalog, else the redirection', async () => {
  const link = 'https://www.data.gouv.fr/api/1/datasets/r/408b10c9';
  assert.equal(
    siriUrl({ url: link, original_url: 'https://api.ginko.voyage/Siri/Siri.do' }),
    'https://api.ginko.voyage/Siri/Siri.do',
  );
  assert.equal(siriUrl({ url: link, original_url: link }), link);
  assert.equal(siriUrl({ url: link }), link);
  assert.equal(siriUrl({ url: 'ftp://x' }), null);
  const seen = [];
  const fetch = async (url, init) => {
    seen.push([url, init.method, init.redirect]);
    if (url === link) {
      return new Response(null, { status: 302, headers: { location: '/api/1/next' } });
    }
    if (url === 'https://www.data.gouv.fr/api/1/next') {
      return new Response(null, {
        status: 301,
        headers: {
          location:
            'https://api.okina.fr/gateway/nam/realtime/anshar/ws/services/?datasetId=CA_DU_NIORTAIS',
        },
      });
    }
    return new Response('?', { status: 404 });
  };
  assert.equal(
    await resolveRedirects(fetch, link),
    'https://api.okina.fr/gateway/nam/realtime/anshar/ws/services/?datasetId=CA_DU_NIORTAIS',
  );
  assert.deepEqual(
    seen.map(([, method, redirect]) => `${method} ${redirect}`),
    ['GET manual', 'GET manual'],
    'the server itself is never asked',
  );
  assert.equal(
    await resolveRedirects(fetch, 'https://api.ginko.voyage/Siri/Siri.do'),
    'https://api.ginko.voyage/Siri/Siri.do',
  );
  await assert.rejects(resolveRedirects(fetch, 'https://www.data.gouv.fr/gone'), /HTTP 404/);
});

test('IRYS (TUB): every request carries the version its XSD requires; its refusal is read', () => {
  for (const service of ['stopPoints', 'stopMonitoring', 'generalMessage', 'situationExchange']) {
    assert.match(
      soapEnvelope(service, { requestorRef: 'r', now: 0, monitoringRef: 'X' }),
      /<Request version="2\.0">/,
      service,
    );
  }
  assert.deepEqual(siriError(siri('irys-invalid-request.xml')), {
    code: 'OtherError',
    text: '[BAD_REQUEST] : Invalid Request Structure',
  });
});

test('an HTML page or an unreadable body is not SIRI, said so', () => {
  assert.throws(() => parseSiri(fixture('siri/html-home-page.html')), NotSiriError);
  assert.throws(() => parseSiri('<html><body>x</body></html>'), /an HTML page, not SIRI/);
  assert.throws(() => parseSiri('{ not json'), /unreadable answer/);
  assert.deepEqual(readStopPoints(siri('soap-empty-answers.xml')), []);
  assert.deepEqual(readStopVisits(siri('soap-empty-answers.xml')), []);
});

test('hosts: a 429 holds every network of the host, then spaces its requests', () => {
  const gates = new HostGates();
  const a = 'https://gateway.example.org/realtime/anshar/ws/services/?datasetId=A';
  const b = 'https://gateway.example.org/realtime/anshar/ws/services/?datasetId=B';
  const other = 'https://api.ginko.voyage/Siri/Siri.do';
  assert.ok(gates.take(a, 0));
  assert.ok(gates.take(b, 0), 'no limit before a 429');
  gates.limited(a, 0, 120_000);
  assert.equal(gates.take(b, 60_000), false, 'the same host, another dataset');
  assert.ok(gates.take(other, 60_000));
  assert.ok(gates.take(b, 120_000));
  assert.equal(gates.take(a, 125_000), false, '10 s between two requests now');
  assert.ok(gates.take(a, 130_000));
  // Without Retry-After: 5 minutes doubled at each 429 (this is the second).
  gates.limited(a, 200_000);
  assert.equal(gates.blocked(b, 200_000 + 599_000), true);
  assert.equal(gates.blocked(b, 200_000 + 600_000), false);
  gates.limited(a, 900_000);
  assert.equal(gates.blocked(a, 900_000 + 1_199_000), true, 'then 20 minutes');
  // An hour without 429: the spacing halves.
  assert.equal(gates.state(a).spacing, 40_000, '10, 20, 40 s after three 429');
  assert.ok(gates.take(a, 900_000 + 3600_000 + 1));
  assert.equal(gates.state(a).spacing, 20_000);
});

test('Anshar gives the changes since the last call: situations kept until closed or over', () => {
  const reader = new SiriReader({ info: { name: 'x', siri: [] }, fetch: null });
  const anshar = { url: 'https://api.okina.fr/gateway/pdl/realtime/anshar/ws/services' };
  const plain = { url: 'https://api.example.org/siri' };
  const situation = (id, { closed = false, end = null } = {}) => ({
    Siri: {
      ServiceDelivery: {
        SituationExchangeDelivery: {
          Situations: {
            PtSituationElement: {
              SituationNumber: id,
              Progress: closed ? 'closed' : 'open',
              ValidityPeriod: {
                StartTime: '2026-10-14T00:00:00Z',
                ...(end ? { EndTime: end } : {}),
              },
              Summary: `Message ${id}`,
            },
          },
        },
      },
    },
  });
  const now = Date.parse('2026-10-14T12:00:00Z');
  const ids = (list) => list.map((item) => item.id).sort();
  assert.deepEqual(ids(reader.currentSituations(situation('A'), anshar, now)), ['A']);
  assert.deepEqual(ids(reader.currentSituations(situation('B'), anshar, now)), ['A', 'B']);
  assert.deepEqual(ids(reader.currentSituations(situation('A', { closed: true }), anshar, now)), [
    'B',
  ]);
  assert.deepEqual(
    ids(reader.currentSituations(situation('C', { end: '2026-10-14T11:00:00Z' }), anshar, now)),
    ['B'],
    'over',
  );
  // Another server gives all of them each time.
  assert.deepEqual(ids(reader.currentSituations(situation('D'), plain, now)), ['D']);
  assert.deepEqual(ids(reader.currentSituations(situation('D', { closed: true }), plain, now)), []);
});

test("Okina's gateway: 35 s between two requests from the start, never less", () => {
  const gates = new HostGates();
  const pdl = 'https://api.okina.fr/gateway/pdl/realtime/anshar/ws/services';
  const nam = 'https://api.okina.fr/gateway/nam/realtime/anshar/ws/services/?datasetId=X';
  assert.ok(gates.take(pdl, 0));
  assert.equal(gates.take(nam, 34_000), false);
  assert.ok(gates.take(nam, 35_000));
  gates.limited(nam, 40_000, 30_000);
  assert.equal(gates.state(pdl).spacing, 70_000);
  assert.ok(gates.take(pdl, 40_000 + 3600_000 + 2_000));
  assert.equal(gates.state(pdl).spacing, 35_000, 'back to its floor, not below');
});

test('a big stop list (IRYS: 16,560 points, 5.6 MB) read block by block, like the tree', () => {
  const block = (i) =>
    `<siri:AnnotatedStopPointRef><siri:StopPointRef>SBA:StopPoint:BP:${i}:LOC</siri:StopPointRef>` +
    `<siri:StopName>Plaintel &amp; Eglise</siri:StopName><siri:Lines><siri:LineRef>SBA:Line::1:LOC</siri:LineRef></siri:Lines>` +
    `<siri:Location><siri:Longitude>-2.8</siri:Longitude><siri:Latitude>48.4</siri:Latitude></siri:Location></siri:AnnotatedStopPointRef>`;
  const body = Buffer.from(
    `<S:Envelope xmlns:S="x"><S:Body><Answer>${Array.from({ length: 3000 }, (_, i) => block(i)).join('')}</Answer></S:Body></S:Envelope>`,
  );
  const scanned = scanStopPoints(body);
  assert.deepEqual(scanned, readStopPoints(parseSiri(body)));
  assert.equal(scanned.length, 3000);
  assert.deepEqual(scanned[7], {
    ref: 'SBA:StopPoint:BP:7:LOC',
    name: 'Plaintel & Eglise',
    lat: 48.4,
    lon: -2.8,
  });
  assert.deepEqual(
    scanStopPoints(fixture('siri/soap-stop-points-discovery.xml')),
    readStopPoints(siri('soap-stop-points-discovery.xml')),
  );
  assert.equal(
    scanStopPoints(fixture('siri/irys-invalid-request.xml')),
    null,
    'an error: read whole',
  );
  assert.equal(scanStopPoints('{"Siri":{}}'), null, 'JSON: read whole');
  assert.deepEqual(scanStopPoints(fixture('siri/soap-empty-answers.xml')), []);
});

test('Ginko: its JSON key errors under HTTP 200 are access errors, not an empty answer', () => {
  for (const msg of [
    "Une clé API est nécessaire pour utiliser l'API, plus d'information sur api.ginko.voyage",
    'La clé donnée en paramètre est invalide',
  ]) {
    const error = siriError(parseSiri(JSON.stringify({ ok: false, msg })));
    assert.deepEqual(error, { code: 'AccessNotAllowedError', text: msg });
    assert.ok(isAccessError(error));
  }
});
