// -----------------------------------------------------------------------------
// The data of one network: its static GTFS (an archive in /data, parsed in one
// streaming pass, src/gtfs.js) and its GTFS-Realtime feeds (trip updates,
// service alerts), read at each refresh while one of its stops is watched.
//
// - The archive is downloaded at most once a day (file age, wall clock), and
//   replaces the previous one only once it has been read completely.
// - Several networks never parse at the same time (`serial`): the sandbox has
//   256 MB, a big timetable takes ~100 MB while it is read.
// - The realtime feeds are read every 15 minutes only while no departure is
//   scheduled within 90 minutes at the network's watched stops (the night).
// -----------------------------------------------------------------------------

import { mkdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createLogger } from '@gladysassistant/integration-sdk';
import { indexRealtime, resolveLines, upcomingDepartures } from './departures.js';
import { decodeFeed } from './gtfsrt.js';
import { parseGtfs } from './gtfs.js';
import { downloadFile, getBuffer, hostOf } from './http.js';
import { localDate } from './time.js';

const logger = createLogger({ name: 'gtfs-feed' });

// The biggest French timetables that fit: SNCF (TGV, Intercités, TER) is
// ~6 MB zipped, Naolib ~26 MB (576 MB of stop times inflated, read as a
// stream). Île-de-France (~100 MB zipped) is left to its own integration.
export const GTFS_MAX_BYTES = 80e6;
export const REALTIME_MAX_BYTES = 30e6;
export const GTFS_MAX_AGE_MS = 24 * 3600 * 1000;
// No departure within this delay on any watched stop: the realtime feeds are
// read every NIGHT_REALTIME_MS only.
export const QUIET_HORIZON_MS = 90 * 60 * 1000;
export const NIGHT_REALTIME_MS = 15 * 60 * 1000;
// A realtime feed older than this is worse than the timetable.
export const REALTIME_STALE_MS = 10 * 60 * 1000;
// The realtime proxy of transport.data.gouv.fr answers 429 ("1 requests per
// 30 seconds") to a feed read again sooner: its feeds are read that seldom at
// most, whatever the refresh interval and the actions in between.
export const PROXY_MIN_INTERVAL_MS = 30 * 1000;
const PROXY_HOST = 'proxy.transport.data.gouv.fr';
const FIRST_DOWNLOAD_RETRY_MS = 2 * 60 * 1000;
const DOWNLOAD_RETRY_MS = 30 * 60 * 1000;

/** Runs the tasks given to it one after the other. */
export function serial() {
  let last = Promise.resolve();
  return (task) => {
    const run = last.then(task, task);
    last = run.catch(() => {});
    return run;
  };
}

export class Feed {
  /**
   * @param {object} options
   * @param {{ id: string, name: string, gtfs: string, realtime: string[] }} options.network
   * @param {typeof fetch} options.fetch
   * @param {() => number} options.now
   * @param {string} options.dataDir
   * @param {() => { id: string, lines: string[] }[]} options.stops the watched stops of the network
   * @param {(task: () => Promise<any>) => Promise<any>} options.queue serializes the parses
   */
  constructor({ network, fetch, now, dataDir, stops, queue }) {
    this.info = network;
    this.fetch = fetch;
    this.now = now;
    this.dataDir = dataDir;
    this.stops = stops;
    this.queue = queue;

    this.network = null;
    this.task = null;
    this.stale = false;
    this.gtfsDate = null;
    this.gtfsError = null;
    this.downloadFailedAt = undefined;

    this.realtime = null;
    this.parts = new Map(); // url → { etag, feed, at }
    this.tried = new Map(); // url → last read attempt
    this.realtimeAt = null;
    this.realtimeError = null;
    this.realtimeBytes = 0;
  }

  get id() {
    return this.info.id;
  }

  get path() {
    return join(this.dataDir, `gtfs-${this.id}.zip`);
  }

  async fileAge() {
    try {
      const info = await stat(this.path);
      // File times are wall-clock times, whatever clock the rest follows.
      return { mtime: info.mtimeMs, age: Date.now() - info.mtimeMs };
    } catch {
      return null;
    }
  }

  /** Forgets everything, the archive included (network removed). */
  async drop() {
    this.dropped = true;
    this.network = null;
    this.realtime = null;
    this.parts.clear();
    await rm(this.path, { force: true }).catch(() => {});
  }

  /**
   * The parsed timetable, downloaded when missing or older than a day, parsed
   * again when the watched stops changed. One task at a time: callers share it.
   */
  ensure({ reparse = false } = {}) {
    if (reparse) {
      this.stale = true;
    }
    if (this.task) {
      // A load in progress may have read the watched stops before the change:
      // once it is over, parse again if it did not take the change in.
      return reparse
        ? this.task.catch(() => {}).then(() => this.ensure({ reparse: this.stale }))
        : this.task;
    }
    this.task = this.queue(() => this.load()).finally(() => {
      this.task = null;
    });
    return this.task;
  }

  watchedIds() {
    return new Set(this.stops().map((stop) => stop.id));
  }

  async load() {
    let downloaded = null;
    const file = await this.fileAge();
    const outdated = !file || file.age > GTFS_MAX_AGE_MS || file.age < -GTFS_MAX_AGE_MS;
    // After a failed download, wait before the next attempt: every action
    // would otherwise start one (2 minutes without archive, 30 with one).
    const backoff = file ? DOWNLOAD_RETRY_MS : FIRST_DOWNLOAD_RETRY_MS;
    const recentFailure =
      this.downloadFailedAt !== undefined && Date.now() - this.downloadFailedAt < backoff;
    if (outdated && recentFailure && !file) {
      throw Object.assign(new Error(this.gtfsError ?? 'download failed'), {
        code: this.gtfsErrorCode,
      });
    }
    if (outdated && !recentFailure) {
      try {
        await mkdir(this.dataDir, { recursive: true });
        const size = await downloadFile(this.fetch, this.info.gtfs, this.path, {
          maxBytes: GTFS_MAX_BYTES,
          validate: async (path) => {
            this.stale = false;
            downloaded = await parseGtfs(path, { watched: this.watchedIds(), now: this.now() });
          },
        });
        if (this.dropped) {
          // Removed while it downloaded: no orphan archive left in /data.
          await rm(this.path, { force: true }).catch(() => {});
          throw new Error('network removed');
        }
        this.gtfsError = null;
        this.gtfsErrorCode = undefined;
        this.downloadFailedAt = undefined;
        logger.info(`${this.info.name}: timetable downloaded (${Math.round(size / 1e5) / 10} MB)`);
      } catch (err) {
        downloaded = null;
        this.gtfsError = err.message;
        this.gtfsErrorCode = err.code;
        this.downloadFailedAt = Date.now();
        logger.warn(`${this.info.name}: timetable download failed: ${err.message}`);
        if (!file) {
          throw err;
        }
      }
    }
    if (this.network && !downloaded && !this.stale && !this.windowEnding()) {
      return this.network;
    }
    do {
      const started = Date.now();
      if (downloaded) {
        // Already read while validating the download.
        this.network = downloaded;
        downloaded = null;
      } else {
        this.stale = false;
        try {
          this.network = await parseGtfs(this.path, {
            watched: this.watchedIds(),
            now: this.now(),
          });
        } catch (err) {
          // Not taken in: the next call parses again.
          this.stale = true;
          this.gtfsError = err.message;
          this.gtfsErrorCode = err.code;
          logger.error(`${this.info.name}: timetable unreadable: ${err.message}`);
          throw err;
        }
      }
      this.gtfsDate = (await this.fileAge())?.mtime ?? this.now();
      logger.debug(
        `${this.info.name}: timetable read in ${Date.now() - started} ms: ${this.network.stats.areas} stop areas, ${this.network.stats.trips} trips over ${this.network.dates.length} days`,
      );
    } while (this.stale);
    return this.network;
  }

  /** True when today is past the middle of the parsed window (parse again). */
  windowEnding() {
    if (!this.network) {
      return true;
    }
    const today = this.network.dates.indexOf(localDate(this.now(), this.network.timeZone));
    return today < 0 || today > 2;
  }

  /** True when a watched stop has a departure scheduled soon (realtime worth reading). */
  busySoon(now) {
    return this.stops().some(
      (stop) =>
        upcomingDepartures(this.network, null, stop.id, {
          now,
          routes: resolveLines(this.network, stop.lines),
          horizonMs: QUIET_HORIZON_MS,
        }).length > 0,
    );
  }

  /** Reads the realtime feeds of the network (conditional requests). */
  async refreshRealtime(now, enabled) {
    const urls = this.info.realtime ?? [];
    if (!enabled || urls.length === 0 || !this.network) {
      this.realtime = null;
      return;
    }
    if (this.realtimeAt && !this.busySoon(now) && now - this.realtimeAt < NIGHT_REALTIME_MS) {
      return;
    }
    const errors = [];
    let bytes = 0;
    for (const url of urls) {
      const part = this.parts.get(url);
      const tried = this.tried.get(url);
      if (
        tried !== undefined &&
        now - tried < PROXY_MIN_INTERVAL_MS &&
        hostOf(url) === PROXY_HOST
      ) {
        continue;
      }
      this.tried.set(url, now);
      try {
        const { body, etag, notModified } = await getBuffer(this.fetch, url, {
          etag: part?.feed ? part.etag : null,
          maxBytes: REALTIME_MAX_BYTES,
        });
        if (!notModified) {
          bytes += body.length;
          this.parts.set(url, { etag, feed: decodeFeed(body), at: now });
        } else {
          part.at = now;
        }
      } catch (err) {
        errors.push(err.message);
      }
    }
    if (bytes > 0) {
      this.realtimeBytes = bytes;
    }
    // A part older than REALTIME_STALE_MS is worse than the timetable.
    const fresh = [...this.parts.values()].filter((p) => now - p.at <= REALTIME_STALE_MS);
    this.realtime =
      fresh.length > 0
        ? indexRealtime({
            timestamp: Math.max(...fresh.map((p) => p.feed.timestamp ?? 0)) || null,
            tripUpdates: fresh.flatMap((p) => p.feed.tripUpdates),
            alerts: fresh.flatMap((p) => p.feed.alerts),
          })
        : null;
    if (errors.length < urls.length) {
      this.realtimeAt = now;
    }
    // Every feed read: what is missing from them has really left.
    this.realtimeComplete = errors.length === 0;
    if (errors.length > 0) {
      if (!this.realtimeError) {
        logger.warn(`${this.info.name}: realtime feed unavailable: ${errors.join(' / ')}`);
      }
      this.realtimeError = errors.join(' / ');
    } else {
      if (this.realtimeError) {
        logger.info(`${this.info.name}: realtime feed back`);
      }
      this.realtimeError = null;
    }
  }
}
