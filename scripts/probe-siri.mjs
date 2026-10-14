#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Asks a real SIRI or SIRI Lite server what the integration would ask, read
// only, and prints what it understood: the stop points it lists, the next
// departures at two stops, the disruptions. Never prints the key, nor a URL
// carrying it (hosts and paths only).
//
//   node scripts/probe-siri.mjs <url> [--key-env VAR] [--format siri|lite]
//        [--requestor-ref REF] [--stops REF1,REF2]
//   node scripts/probe-siri.mjs --catalog [--probe] [--key-env VAR]
//
// <url>            the SIRI endpoint (SOAP) or a SIRI Lite URL (base or service)
// --key-env VAR    the key is read from the environment variable VAR
// --format         forced flavour (guessed from the URL otherwise)
// --requestor-ref  public RequestorRef (the catalog's), when no key
// --stops          MonitoringRefs to ask (else the first two discovered)
// --catalog        lists the transport.data.gouv.fr datasets that publish SIRI
//                  and no GTFS-RT; with --probe, asks each one (without key
//                  unless --key-env) whether it answers, one second apart.
// -----------------------------------------------------------------------------

import { CATALOG_URL } from '../src/catalog.js';
import { getBuffer, getJson, hostOf } from '../src/http.js';
import {
  SIRI,
  SIRI_LITE,
  guessFormat,
  isAccessError,
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

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const flag = (name) => args.includes(name);
const key = option('--key-env') ? (process.env[option('--key-env')] ?? '') : '';
if (option('--key-env') && !key) {
  console.error(`The environment variable ${option('--key-env')} is empty.`);
  process.exit(2);
}

/** Where a request goes, without its query string (it may hold the key). */
const shown = (url) => {
  try {
    const { host, pathname } = new URL(url);
    return `${host}${pathname}`;
  } catch {
    return hostOf(url);
  }
};
const time = (ms) =>
  ms === null
    ? '—'
    : new Date(ms).toLocaleTimeString('fr-FR', { timeZone: process.env.TZ || 'Europe/Paris' });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** One request: `{ tree }` or `{ error, access }`, the key removed from any text. */
async function ask(endpoint, service, monitoringRef = null) {
  const { url, init } = siriRequest(endpoint, service, { key, now: Date.now(), monitoringRef });
  const started = Date.now();
  try {
    const { body } = await getBuffer(fetch, url, {
      method: init.method,
      headers: init.headers,
      body: init.body,
      maxBytes: 20e6,
      errorBody: true,
      timeoutMs: 30000,
    });
    const tree = parseSiri(body);
    const error = siriError(tree);
    const ms = Date.now() - started;
    if (error) {
      return {
        error: redact(`${error.code}: ${error.text}`, key),
        access: isAccessError(error),
        ms,
      };
    }
    return { tree, bytes: body.length, ms };
  } catch (err) {
    let reported = null;
    try {
      reported = err.body ? siriError(parseSiri(err.body)) : null;
    } catch {
      // Not SIRI.
    }
    return {
      error: redact(
        reported ? `${err.message} (${reported.code}: ${reported.text})` : err.message,
        key,
      ),
      access: err.status === 401 || err.status === 403 || (reported && isAccessError(reported)),
      ms: Date.now() - started,
    };
  }
}

async function probe(entry, { brief = false } = {}) {
  const endpoint = siriEndpoint(entry);
  console.log(
    `\n== ${shown(entry.url)} (${endpoint.format === SIRI ? 'SIRI SOAP' : 'SIRI Lite'})${
      key
        ? ', key given'
        : entry.requestorRef
          ? `, RequestorRef "${entry.requestorRef}"`
          : ', no key'
    }`,
  );
  const discovery = await ask(endpoint, 'stopPoints');
  let points = [];
  if (discovery.tree) {
    points = readStopPoints(discovery.tree);
    console.log(
      `StopPointsDiscovery: ${points.length} stop points (${discovery.ms} ms, ${discovery.bytes} bytes)`,
    );
    for (const point of points.slice(0, 3)) {
      console.log(`  ${point.ref} — ${point.name}`);
    }
  } else {
    console.log(
      `StopPointsDiscovery: ${discovery.access ? 'ACCESS REFUSED' : 'unavailable'} — ${discovery.error}`,
    );
  }
  const wanted =
    option('--stops')?.split(',').filter(Boolean) ?? points.slice(0, 2).map((p) => p.ref);
  for (const ref of brief ? wanted.slice(0, 1) : wanted.slice(0, 2)) {
    const answer = await ask(endpoint, 'stopMonitoring', ref);
    if (!answer.tree) {
      console.log(
        `StopMonitoring ${ref}: ${answer.access ? 'ACCESS REFUSED' : 'error'} — ${answer.error}`,
      );
      continue;
    }
    const visits = readStopVisits(answer.tree);
    console.log(`StopMonitoring ${ref}: ${visits.length} visit(s) (${answer.ms} ms)`);
    for (const visit of visits.slice(0, 8)) {
      console.log(
        `  ${visit.lineRef || visit.lineName} → ${visit.destination || '?'} ` +
          `aimed ${time(visit.aimed)} expected ${time(visit.expected)}` +
          `${visit.monitored ? '' : ' (not monitored)'}${visit.cancelled ? ' CANCELLED' : ''}` +
          ` [dir ${visit.directionRef || '-'}, stop ${visit.stopPointRef || visit.monitoringRef || '-'}]`,
      );
    }
  }
  for (const service of ['generalMessage', 'situationExchange']) {
    const answer = await ask(endpoint, service);
    if (!answer.tree) {
      console.log(
        `${service}: ${answer.access ? 'ACCESS REFUSED' : 'unavailable'} — ${answer.error}`,
      );
      continue;
    }
    const situations = readSituations(answer.tree);
    console.log(`${service}: ${situations.length} message(s)`);
    for (const situation of situations.slice(0, brief ? 1 : 5)) {
      console.log(
        `  [${situation.lineRefs.join(', ') || 'network'}] ${textOf(situation.header[0]?.text)}`,
      );
    }
    break;
  }
  return { discovery };
}

if (flag('--catalog')) {
  const datasets = await getJson(fetch, CATALOG_URL, { maxBytes: 50e6, timeoutMs: 60000 });
  const found = [];
  for (const dataset of datasets) {
    if (dataset.type !== 'public-transit') {
      continue;
    }
    const resources = dataset.resources ?? [];
    const siri = resources.filter((r) => siriFormat(r.format));
    if (siri.length === 0 || resources.some((r) => r.format === 'gtfs-rt')) {
      continue;
    }
    found.push({ dataset, siri, gtfs: resources.some((r) => r.format === 'GTFS') });
  }
  console.log(`${found.length} datasets publish SIRI and no GTFS-RT:`);
  for (const { dataset, siri, gtfs } of found) {
    for (const resource of siri) {
      console.log(
        `- ${dataset.title} [${dataset.slug}] — ${resource.format} — ${shown(resource.url)}` +
          `${resource.requestor_ref ? ' — public RequestorRef' : ''}${gtfs ? '' : ' — NO GTFS'}`,
      );
    }
  }
  if (flag('--probe')) {
    for (const { siri } of found) {
      for (const resource of siri) {
        await probe(
          {
            url: resource.url,
            format: siriFormat(resource.format),
            requestorRef: resource.requestor_ref,
          },
          { brief: true },
        );
        await sleep(1000);
      }
    }
  }
} else {
  const url = args.find((arg) => /^https?:\/\//.test(arg));
  if (!url) {
    console.error('Usage: node scripts/probe-siri.mjs <url> [--key-env VAR] [--format siri|lite]');
    console.error('       node scripts/probe-siri.mjs --catalog [--probe]');
    process.exit(2);
  }
  const forced = option('--format');
  const format = forced ? (/lite/i.test(forced) ? SIRI_LITE : SIRI) : guessFormat(url);
  await probe({ url, format, requestorRef: option('--requestor-ref') ?? null });
}
