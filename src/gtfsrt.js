// -----------------------------------------------------------------------------
// GTFS-Realtime decoding: a minimal protobuf reader for the fields the
// integration uses (trip updates and service alerts), instead of
// gtfs-realtime-bindings and its protobufjs runtime.
//
// The Tisséo feed (api.tisseo.fr/opendata/gtfsrt/GtfsRt.pb, ~1.7 MB, rebuilt
// every ~20 s) carries TripUpdates for the buses, the tram and Téléo, and the
// network's ServiceAlerts; no VehiclePositions, and nothing for the metro
// (fully automatic, timetable only). Field numbers: gtfs-realtime.proto.
// -----------------------------------------------------------------------------

export class ProtobufError extends Error {}

class Reader {
  constructor(buffer, start = 0, end = buffer.length) {
    this.buffer = buffer;
    this.pos = start;
    this.end = end;
  }

  get done() {
    return this.pos >= this.end;
  }

  /** A varint, as a Number (exact up to 2^53) or, beyond, a signed 64-bit value. */
  varint() {
    let low = 0;
    let shift = 0;
    let byte;
    // The first 4 bytes (28 bits) fit a 32-bit integer.
    do {
      if (this.pos >= this.end) {
        throw new ProtobufError('truncated varint');
      }
      byte = this.buffer[this.pos++];
      low |= (byte & 0x7f) << shift;
      shift += 7;
    } while (byte & 0x80 && shift < 28);
    if (!(byte & 0x80)) {
      return low >>> 0;
    }
    // Longer: BigInt, then back to a Number — negative int32/int64 values are
    // sent as 10-byte two's complement varints.
    let value = BigInt(low >>> 0);
    let bigShift = 28n;
    do {
      if (this.pos >= this.end) {
        throw new ProtobufError('truncated varint');
      }
      byte = this.buffer[this.pos++];
      value |= BigInt(byte & 0x7f) << bigShift;
      bigShift += 7n;
      if (bigShift > 70n) {
        throw new ProtobufError('varint too long');
      }
    } while (byte & 0x80);
    return Number(BigInt.asIntN(64, value));
  }

  /** A length-delimited field: a sub-reader over its bytes. */
  sub() {
    const length = this.varint();
    // A negative (10-byte) or oversized length would move backwards and loop
    // forever on the same field: refused before moving.
    if (!Number.isSafeInteger(length) || length < 0 || length > this.end - this.pos) {
      throw new ProtobufError('truncated message');
    }
    const start = this.pos;
    this.pos += length;
    return new Reader(this.buffer, start, start + length);
  }

  string() {
    const sub = this.sub();
    return this.buffer.toString('utf8', sub.pos, sub.end);
  }

  skip(wireType) {
    switch (wireType) {
      case 0:
        this.varint();
        return;
      case 1:
        this.pos += 8;
        break;
      case 2:
        this.sub();
        return;
      case 5:
        this.pos += 4;
        break;
      default:
        throw new ProtobufError(`unsupported wire type ${wireType}`);
    }
    if (this.pos > this.end) {
      throw new ProtobufError('truncated field');
    }
  }

  /**
   * Calls `onField(number, wireType)` for every field, with the reader as
   * `this`; the callback reads the value, or returns false to skip it.
   */
  fields(onField) {
    while (!this.done) {
      const key = this.varint();
      if (key < 8) {
        throw new ProtobufError('invalid field key');
      }
      const number = Math.floor(key / 8);
      const wireType = key & 7;
      if (onField.call(this, number, wireType) === false) {
        this.skip(wireType);
      }
    }
  }
}

// The decoders below return false for the fields they do not read, so the
// reader skips them (protobuf readers must ignore unknown fields).

function translatedString(reader) {
  const translations = [];
  reader.fields((number, wire) => {
    if (number !== 1 || wire !== 2) {
      return false;
    }
    const translation = { text: '', language: '' };
    reader.sub().fields(function (n, w) {
      if (n === 1 && w === 2) {
        translation.text = this.string();
      } else if (n === 2 && w === 2) {
        translation.language = this.string();
      } else {
        return false;
      }
    });
    translations.push(translation);
  });
  return translations;
}

function tripDescriptor(reader) {
  const trip = { tripId: '', routeId: '', directionId: null, startDate: '', relationship: 0 };
  reader.fields(function (n, w) {
    if (n === 1 && w === 2) {
      trip.tripId = this.string();
    } else if (n === 3 && w === 2) {
      trip.startDate = this.string();
    } else if (n === 4 && w === 0) {
      trip.relationship = this.varint();
    } else if (n === 5 && w === 2) {
      trip.routeId = this.string();
    } else if (n === 6 && w === 0) {
      trip.directionId = this.varint();
    } else {
      return false;
    }
  });
  return trip;
}

function stopTimeEvent(reader) {
  const event = { delay: null, time: null };
  reader.fields(function (n, w) {
    if (n === 1 && w === 0) {
      // int32: a negative delay arrives as a sign-extended 64-bit varint.
      event.delay = this.varint() | 0;
    } else if (n === 2 && w === 0) {
      event.time = this.varint();
    } else {
      return false;
    }
  });
  return event;
}

function stopTimeUpdate(reader) {
  const update = { seq: null, stopId: '', arrival: null, departure: null, relationship: 0 };
  reader.fields(function (n, w) {
    if (n === 1 && w === 0) {
      update.seq = this.varint();
    } else if (n === 2 && w === 2) {
      update.arrival = stopTimeEvent(this.sub());
    } else if (n === 3 && w === 2) {
      update.departure = stopTimeEvent(this.sub());
    } else if (n === 4 && w === 2) {
      update.stopId = this.string();
    } else if (n === 5 && w === 0) {
      update.relationship = this.varint();
    } else {
      return false;
    }
  });
  return update;
}

function tripUpdate(reader) {
  const update = { trip: null, stops: [], timestamp: null, delay: null };
  reader.fields(function (n, w) {
    if (n === 1 && w === 2) {
      update.trip = tripDescriptor(this.sub());
    } else if (n === 2 && w === 2) {
      update.stops.push(stopTimeUpdate(this.sub()));
    } else if (n === 4 && w === 0) {
      update.timestamp = this.varint();
    } else if (n === 5 && w === 0) {
      update.delay = this.varint() | 0;
    } else {
      return false;
    }
  });
  return update;
}

function timeRange(reader) {
  const range = { start: null, end: null };
  reader.fields(function (n, w) {
    if (n === 1 && w === 0) {
      range.start = this.varint();
    } else if (n === 2 && w === 0) {
      range.end = this.varint();
    } else {
      return false;
    }
  });
  return range;
}

function entitySelector(reader) {
  const selector = { agencyId: '', routeId: '', routeType: null, stopId: '', tripId: '' };
  reader.fields(function (n, w) {
    if (n === 1 && w === 2) {
      selector.agencyId = this.string();
    } else if (n === 2 && w === 2) {
      selector.routeId = this.string();
    } else if (n === 3 && w === 0) {
      selector.routeType = this.varint();
    } else if (n === 4 && w === 2) {
      selector.tripId = tripDescriptor(this.sub()).tripId;
    } else if (n === 5 && w === 2) {
      selector.stopId = this.string();
    } else {
      return false;
    }
  });
  return selector;
}

function alert(reader) {
  const value = {
    periods: [],
    entities: [],
    cause: null,
    effect: null,
    url: [],
    header: [],
    description: [],
  };
  reader.fields(function (n, w) {
    if (n === 1 && w === 2) {
      value.periods.push(timeRange(this.sub()));
    } else if (n === 5 && w === 2) {
      value.entities.push(entitySelector(this.sub()));
    } else if (n === 6 && w === 0) {
      value.cause = this.varint();
    } else if (n === 7 && w === 0) {
      value.effect = this.varint();
    } else if (n === 8 && w === 2) {
      value.url = translatedString(this.sub());
    } else if (n === 10 && w === 2) {
      value.header = translatedString(this.sub());
    } else if (n === 11 && w === 2) {
      value.description = translatedString(this.sub());
    } else {
      return false;
    }
  });
  return value;
}

/**
 * Decodes a GTFS-Realtime FeedMessage.
 * @param {Uint8Array} bytes
 * @returns {{ timestamp: number|null, tripUpdates: object[], alerts: object[] }}
 */
export function decodeFeed(bytes) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const feed = { timestamp: null, version: '', tripUpdates: [], alerts: [] };
  new Reader(buffer).fields(function (n, w) {
    if (n === 1 && w === 2) {
      this.sub().fields(function (hn, hw) {
        if (hn === 1 && hw === 2) {
          feed.version = this.string();
        } else if (hn === 3 && hw === 0) {
          feed.timestamp = this.varint();
        } else {
          return false;
        }
      });
    } else if (n === 2 && w === 2) {
      let id = '';
      let deleted = false;
      let update = null;
      let info = null;
      this.sub().fields(function (en, ew) {
        if (en === 1 && ew === 2) {
          id = this.string();
        } else if (en === 2 && ew === 0) {
          deleted = this.varint() === 1;
        } else if (en === 3 && ew === 2) {
          update = tripUpdate(this.sub());
        } else if (en === 5 && ew === 2) {
          info = alert(this.sub());
        } else {
          return false;
        }
      });
      if (deleted) {
        return;
      }
      if (update?.trip) {
        feed.tripUpdates.push({ id, ...update });
      }
      if (info) {
        feed.alerts.push({ id, ...info });
      }
    } else {
      return false;
    }
  });
  return feed;
}

// Trip and stop schedule relationships (gtfs-realtime.proto).
export const TRIP_RELATIONSHIP = { SCHEDULED: 0, ADDED: 1, UNSCHEDULED: 2, CANCELED: 3 };
export const STOP_RELATIONSHIP = { SCHEDULED: 0, SKIPPED: 1, NO_DATA: 2 };
