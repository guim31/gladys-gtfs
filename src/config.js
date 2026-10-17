// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
//
// The networks and stops are not configuration fields: the configuration
// actions add and remove them (src/service.js), and they live in /data.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Seconds between two refreshes of the departure boards. The integration
// drives its own timer (devices are published with should_poll: false). A
// countdown in minutes needs a minute at most; a realtime feed weighs from a
// few kB to ~2 MB, so the slower paces save bandwidth.
export const REFRESH_INTERVALS = ['30', '60', '120', '300'];

export const DEFAULT_CONFIG = {
  language: 'fr',
  refresh_interval: '60',
  realtime: true,
};

/**
 * The SIRI keys typed in the configuration (a secret field: never logged):
 * one per line or separated by ";", each "network = key" (the network by
 * name or identifier), or a single key alone for the only network that needs
 * one. The key itself may say where it goes ("AccountKey=…", "apikey: …").
 * @param {string} text
 * @param {{ id: string, name: string }} network
 * @param {{ id: string, name: string }[]} networks every network added
 * @param {{ namedOnly?: boolean }} [options] only a key named after the network
 */
export function siriKeyFor(text, network, networks, { namedOnly = false } = {}) {
  const simplify = (value) =>
    String(value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');
  const entries = String(text ?? '')
    .split(/[;\n]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const named = (entry, target) => {
    const match = /^([^=:]+)[=:](.+)$/.exec(entry);
    if (!match) {
      return null;
    }
    const prefix = simplify(match[1]);
    return prefix && (prefix === simplify(target.id) || prefix === simplify(target.name))
      ? match[2].trim()
      : null;
  };
  for (const entry of entries) {
    const key = named(entry, network);
    if (key) {
      return key;
    }
  }
  if (namedOnly) {
    return '';
  }
  const free = entries.filter((entry) => networks.every((other) => named(entry, other) === null));
  return free.length === 1 ? free[0] : '';
}

const isFalse = (value) => value === false || value === 'false' || value === 0 || value === '0';

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const interval = REFRESH_INTERVALS.includes(String(source.refresh_interval))
    ? String(source.refresh_interval)
    : DEFAULT_CONFIG.refresh_interval;
  return {
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
    refreshSeconds: Number(interval),
    realtime: !isFalse(source.realtime),
    // The field left the form in 1.3.0: a value still stored moves to its network.
    siriKeys: typeof source.siri_keys === 'string' ? source.siri_keys : '',
  };
}
