// -----------------------------------------------------------------------------
// HTTP downloads of the open data feeds: a timeout on every request, a size
// cap on every body (the sandbox has 256 MB), conditional requests when the
// server supports them, and the big GTFS archive streamed straight to /data.
//
// `fetch` is injectable: the tests never touch the network.
// -----------------------------------------------------------------------------

import { createWriteStream } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const USER_AGENT = 'gladys-gtfs (+https://github.com/guim31/gladys-gtfs)';

export class HttpError extends Error {
  constructor(message, status = null) {
    super(message);
    this.status = status;
  }
}

/** Host of a URL, for messages and logs (never the query string). */
export function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return 'unknown host';
  }
}

async function request(fetchImpl, url, { timeoutMs, headers = {} }) {
  let response;
  try {
    response = await fetchImpl(url, {
      headers: { 'user-agent': USER_AGENT, ...headers },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const reason = err?.name === 'TimeoutError' ? 'timeout' : (err?.cause?.code ?? err?.message);
    throw new HttpError(`${hostOf(url)}: ${reason}`);
  }
  return response;
}

async function readCapped(response, url, maxBytes) {
  const declared = Number(response.headers?.get?.('content-length'));
  if (declared > maxBytes) {
    await response.body?.cancel?.().catch(() => {});
    throw new HttpError(`${hostOf(url)}: response too large (${declared} bytes)`);
  }
  if (!response.body?.getReader) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) {
      throw new HttpError(`${hostOf(url)}: response too large`);
    }
    return buffer;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    size += value.length;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new HttpError(`${hostOf(url)}: response too large`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, size);
}

/**
 * GET a body into memory. With `etag`, a 304 resolves `{ notModified: true }`.
 * @returns {Promise<{ body: Buffer|null, etag: string|null, notModified: boolean }>}
 */
export async function getBuffer(
  fetchImpl,
  url,
  { timeoutMs = 20000, maxBytes = 20e6, etag = null } = {},
) {
  const response = await request(fetchImpl, url, {
    timeoutMs,
    headers: etag ? { 'if-none-match': etag } : {},
  });
  if (response.status === 304) {
    await response.body?.cancel?.().catch(() => {});
    return { body: null, etag, notModified: true };
  }
  if (!response.ok) {
    await response.body?.cancel?.().catch(() => {});
    throw new HttpError(`${hostOf(url)}: HTTP ${response.status}`, response.status);
  }
  const body = await readCapped(response, url, maxBytes);
  return { body, etag: response.headers?.get?.('etag') ?? null, notModified: false };
}

/** GET a JSON document. */
export async function getJson(fetchImpl, url, options = {}) {
  const { body } = await getBuffer(fetchImpl, url, { maxBytes: 5e6, ...options });
  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    throw new HttpError(`${hostOf(url)}: invalid JSON`);
  }
}

/**
 * GET a (big) body straight to a file: written to `<path>.download`, renamed
 * over `path` only once complete and accepted by `validate`.
 */
export async function downloadFile(
  fetchImpl,
  url,
  path,
  { timeoutMs = 300000, maxBytes = 200e6, validate = async () => {} } = {},
) {
  const response = await request(fetchImpl, url, { timeoutMs });
  if (!response.ok) {
    await response.body?.cancel?.().catch(() => {});
    throw new HttpError(`${hostOf(url)}: HTTP ${response.status}`, response.status);
  }
  if (!response.body) {
    throw new HttpError(`${hostOf(url)}: empty response`);
  }
  const declared = Number(response.headers?.get?.('content-length'));
  if (declared > maxBytes) {
    await response.body.cancel?.().catch(() => {});
    throw Object.assign(new HttpError(`${hostOf(url)}: download too large (${declared} bytes)`), {
      code: 'TOO_BIG',
    });
  }
  const temporary = `${path}.download`;
  let size = 0;
  const cap = new Transform({
    transform(chunk, _encoding, callback) {
      size += chunk.length;
      if (size > maxBytes) {
        callback(
          Object.assign(new HttpError(`${hostOf(url)}: download too large`), { code: 'TOO_BIG' }),
        );
        return;
      }
      callback(null, chunk);
    },
  });
  try {
    const source = response.body.getReader ? Readable.fromWeb(response.body) : response.body;
    await pipeline(source, cap, createWriteStream(temporary));
    await validate(temporary);
    await rename(temporary, path);
  } catch (err) {
    await rm(temporary, { force: true }).catch(() => {});
    if (err instanceof HttpError || err?.code === 'TOO_BIG') {
      throw err;
    }
    const reason = err?.name === 'TimeoutError' ? 'timeout' : err?.message;
    throw new HttpError(`${hostOf(url)}: ${reason}`);
  }
  return size;
}
