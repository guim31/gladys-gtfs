// -----------------------------------------------------------------------------
// Minimal ZIP reader: lists the entries of an archive on disk and streams one
// of them, inflated, without ever holding the archive or the entry in memory.
//
// The Tisséo GTFS is a 15 MB archive whose stop_times.txt inflates to ~90 MB:
// the 256 MB sandbox cannot afford an in-memory unzip library. Only what GTFS
// archives use is supported: "stored" (0) and "deflate" (8) entries, no
// encryption, no ZIP64 (entries and archive under 4 GB).
// -----------------------------------------------------------------------------

import { createReadStream } from 'node:fs';
import { open } from 'node:fs/promises';
import { Readable, pipeline } from 'node:stream';
import { createInflateRaw } from 'node:zlib';

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_FILE_HEADER = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;
// The end record is 22 bytes, followed by a comment of 65535 bytes at most.
const MAX_END_SEARCH = 22 + 0xffff;

export class ZipError extends Error {}

/**
 * Entries of the archive, by name: `{ name, method, compressedSize, size, offset }`.
 * @param {string} path
 */
export async function listEntries(path) {
  const file = await open(path, 'r');
  try {
    const { size } = await file.stat();
    const tailLength = Math.min(size, MAX_END_SEARCH);
    const tail = Buffer.alloc(tailLength);
    await file.read(tail, 0, tailLength, size - tailLength);
    let end = -1;
    for (let i = tailLength - 22; i >= 0; i -= 1) {
      if (tail.readUInt32LE(i) === END_OF_CENTRAL_DIRECTORY) {
        end = i;
        break;
      }
    }
    if (end < 0) {
      throw new ZipError('not a ZIP archive (no end of central directory)');
    }
    const count = tail.readUInt16LE(end + 10);
    const directorySize = tail.readUInt32LE(end + 12);
    const directoryOffset = tail.readUInt32LE(end + 16);
    if (count === 0xffff || directoryOffset === 0xffffffff) {
      throw new ZipError('ZIP64 archives are not supported');
    }
    if (directoryOffset + directorySize > size) {
      throw new ZipError('truncated ZIP archive');
    }
    const directory = Buffer.alloc(directorySize);
    await file.read(directory, 0, directorySize, directoryOffset);

    const entries = new Map();
    let at = 0;
    for (let index = 0; index < count; index += 1) {
      if (at + 46 > directory.length || directory.readUInt32LE(at) !== CENTRAL_FILE_HEADER) {
        throw new ZipError('corrupted ZIP central directory');
      }
      const flags = directory.readUInt16LE(at + 8);
      const method = directory.readUInt16LE(at + 10);
      const compressedSize = directory.readUInt32LE(at + 20);
      const uncompressedSize = directory.readUInt32LE(at + 24);
      const nameLength = directory.readUInt16LE(at + 28);
      const extraLength = directory.readUInt16LE(at + 30);
      const commentLength = directory.readUInt16LE(at + 32);
      const offset = directory.readUInt32LE(at + 42);
      const name = directory.toString(
        flags & 0x800 ? 'utf8' : 'latin1',
        at + 46,
        at + 46 + nameLength,
      );
      entries.set(name, {
        name,
        method,
        encrypted: Boolean(flags & 1),
        compressedSize,
        size: uncompressedSize,
        offset,
      });
      at += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
  } finally {
    await file.close();
  }
}

/**
 * A readable stream of the inflated content of one entry.
 * @param {string} path
 * @param {{ name: string, method: number, encrypted: boolean, compressedSize: number, offset: number }} entry
 */
export async function openEntry(path, entry) {
  if (entry.encrypted) {
    throw new ZipError(`${entry.name}: encrypted entries are not supported`);
  }
  if (entry.method !== 0 && entry.method !== 8) {
    throw new ZipError(`${entry.name}: compression method ${entry.method} is not supported`);
  }
  const file = await open(path, 'r');
  let start;
  try {
    const header = Buffer.alloc(30);
    await file.read(header, 0, 30, entry.offset);
    if (header.readUInt32LE(0) !== LOCAL_FILE_HEADER) {
      throw new ZipError(`${entry.name}: corrupted local header`);
    }
    // The local name and extra lengths may differ from the central ones.
    start = entry.offset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
  } finally {
    await file.close();
  }
  if (entry.compressedSize === 0) {
    return Readable.from([]);
  }
  const raw = createReadStream(path, { start, end: start + entry.compressedSize - 1 });
  if (entry.method === 0) {
    return raw;
  }
  // pipeline: an inflate error, or a consumer that stops early, also closes
  // the file (raw.pipe() left one descriptor open per corrupt entry).
  return pipeline(raw, createInflateRaw(), () => {});
}
