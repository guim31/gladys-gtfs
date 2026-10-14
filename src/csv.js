// -----------------------------------------------------------------------------
// GTFS CSV reading, chunk by chunk from a stream (RFC 4180: quoted fields,
// doubled quotes, a quoted field may span lines). The first row is the header;
// each row reaches the callback as an object restricted to the columns asked
// for, so a 90 MB stop_times.txt never materializes more than one chunk.
//
// Not readline: its async iterator buffers lines faster than an async
// consumer takes them, and the 256 MB sandbox paid for it (260 MB RSS on the
// real Tisséo feed). Iterating the stream itself keeps the backpressure: the
// next chunk is only inflated once the previous one is processed.
// -----------------------------------------------------------------------------

// A quoted field longer than this is a stray quote, not a field: without a
// cap, every following line would be glued to it and re-scanned (quadratic).
export const MAX_RECORD = 64 * 1024;
export const MAX_RECORD_LINES = 50;

export class CsvError extends Error {}

/** Splits one CSV record; returns null when a quoted field is still open. */
export function splitRecord(line) {
  const fields = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      fields.push(field);
      field = '';
    } else {
      field += char;
    }
  }
  if (quoted) {
    return null;
  }
  fields.push(field);
  return fields;
}

/**
 * Calls `onRow` with every row of a CSV stream, as `{ column: value }` holding
 * the requested columns only (a missing column reads as '').
 * @param {AsyncIterable<Buffer|string>} stream
 * @param {string[]} columns
 * @param {(row: Record<string, string>) => void} onRow
 */
export async function eachRow(stream, columns, onRow) {
  const decoder = new TextDecoder('utf-8');
  let indexes = null;
  let rest = '';
  let pending = '';
  let pendingLines = 0;

  const record = (fields) => {
    if (indexes === null) {
      const header = fields.map((name, i) => (i === 0 ? name.replace(/^\uFEFF/, '') : name).trim());
      indexes = columns.map((column) => header.indexOf(column));
      return;
    }
    const row = {};
    for (let i = 0; i < columns.length; i += 1) {
      const index = indexes[i];
      row[columns[i]] = index >= 0 ? (fields[index] ?? '').trim() : '';
    }
    onRow(row);
  };

  const line = (raw) => {
    const text = pending ? `${pending}\n${raw}` : raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (!pending && text === '') {
      return;
    }
    if (!text.includes('"')) {
      pending = '';
      // Fast path: the vast majority of GTFS lines have no quote at all.
      record(text.split(','));
      return;
    }
    const fields = splitRecord(text.endsWith('\r') ? text.slice(0, -1) : text);
    if (fields === null) {
      pendingLines += 1;
      if (text.length > MAX_RECORD || pendingLines > MAX_RECORD_LINES) {
        throw new CsvError('unbalanced quote in a CSV record');
      }
      pending = text;
      return;
    }
    pending = '';
    pendingLines = 0;
    record(fields);
  };

  for await (const chunk of stream) {
    const text =
      rest + (typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true }));
    let start = 0;
    let end = text.indexOf('\n', start);
    while (end >= 0) {
      line(text.slice(start, end));
      start = end + 1;
      end = text.indexOf('\n', start);
    }
    rest = text.slice(start);
  }
  rest += decoder.decode();
  if (rest !== '') {
    line(rest);
  }
  if (pending) {
    // An unterminated quote at the end of the file: keep what can be read.
    const fields = splitRecord(`${pending}"`);
    if (fields) {
      record(fields);
    }
  }
}
