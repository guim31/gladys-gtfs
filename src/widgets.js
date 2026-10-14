// -----------------------------------------------------------------------------
// Dashboard widgets (manifest `widgets`, Gladys 5.1+).
//
// - departures: the board of one watched stop — a status row per line and
//   direction ("A → Basso Cambo" / "3 · 7 min"), green when the vehicle is
//   tracked in real time, grey with "≈" for a timetable time; the heading is
//   the stop, the caption its disruptions (or the legend).
//
// Budget of the core: 8 components, 2 texts, 1 status (10 rows).
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { clip, lineLabel } from './devices.js';
import { TEXT, say } from './messages.js';

export const MAX_ROWS = 10;
const MAX_LABEL = 40;

const t = (language, key, params) => say(TEXT, language, key, params);

/** "≈ 3 · 7 min", "0 min", "—". */
export function departureValue(group) {
  const [next, following] = group.departures;
  if (!next) {
    return '—';
  }
  const mark = next.realtime ? '' : '≈ ';
  const minutes = following ? `${next.minutes} · ${following.minutes}` : `${next.minutes}`;
  return `${mark}${minutes} min`;
}

function departuresContent(service, { settings, language }) {
  const ttl = Math.max(30, service.config.refreshSeconds);
  if (!settings?.stop) {
    return { ttl_seconds: ttl, components: [{ type: 'text', text: t(language, 'pickStop') }] };
  }
  const found = service.boardOf(settings.stop);
  if (!found) {
    const key = service.stopOfDevice(settings.stop) ? 'loading' : 'gone';
    return { ttl_seconds: ttl, components: [{ type: 'text', text: t(language, key) }] };
  }
  const { stop, board } = found;
  // Lines with a departure first (in their natural order), then the others.
  const rows = [
    ...board.filter((group) => group.departures.length > 0),
    ...board.filter((group) => group.departures.length === 0),
  ].slice(0, MAX_ROWS);
  const disruptions = service.trafficOf(stop);
  const components = [
    { type: 'text', variant: 'heading', text: clip(stop.name, 40) },
    {
      type: 'text',
      variant: 'caption',
      text:
        disruptions.length > 0
          ? clip(`⚠ ${disruptions.map((alert) => alert.title).join(' · ')}`, 80)
          : t(language, 'legend'),
    },
  ];
  if (rows.length === 0) {
    components.push({ type: 'text', variant: 'body', text: t(language, 'noDeparture') });
  } else {
    components.push({
      type: 'status',
      items: rows.map((group) => ({
        label: clip(
          `${lineLabel(group.route, language)} → ${group.departures[0]?.headsign ?? group.headsign}`,
          MAX_LABEL,
        ),
        value: departureValue(group),
        color:
          group.departures.length === 0
            ? WIDGET_COLORS.NEUTRAL
            : group.departures[0].realtime
              ? WIDGET_COLORS.SUCCESS
              : WIDGET_COLORS.INFO,
      })),
    });
  }
  return { ttl_seconds: ttl, components };
}

export const WIDGETS = {
  departures: { get: departuresContent },
};
