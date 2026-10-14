# Public transport (GTFS) for Gladys Assistant

Next departures at your stops and traffic alerts, in
[Gladys Assistant](https://gladysassistant.com), for **any French public transport network**
that publishes its timetable as GTFS on [transport.data.gouv.fr](https://transport.data.gouv.fr):
TER and TGV (SNCF), Naolib, STAR, TaM, M, Ilévia, Stan and hundreds more, with real time
(GTFS-RT) when the network publishes it. Open data only: no account, no API key.

For Toulouse, Lyon, Île-de-France or Bordeaux, the dedicated integrations (Tisséo, TCL, IDFM, TBM)
go further; Île-de-France is too big for this one.

## Features

- **Find a network** in the national catalog of transport.data.gouv.fr (by brand, city or region),
  with what it publishes in real time; or **add any GTFS file by URL**, with its GTFS-RT feeds.
  Up to three networks.
- **One device per stop** (up to twenty, by name or around your home): for each line and
  direction, the minutes before the next and the following departure; the three soonest departures
  as text; the traffic info of its lines.
- **Real time** from GTFS-RT TripUpdates (delays, cancellations, skipped stops, added trips);
  otherwise the timetable, marked "≈".
- **Dashboard widget** "Next departures".
- **Scene trigger** "Disruption on a followed line" (a line of your stops, or the whole network),
  from GTFS-RT ServiceAlerts — including the SNCF alerts, which name trips rather than lines.
- **Scene action** "Read the next departures", with a sentence ready to send ("Tram 1 towards
  François Mitterrand at Commerce: in 3 and 7 min").
- Texts in English, French, German and Spanish.

## Requirements

- Gladys Assistant 5.1.0 or later, with Internet access.
- Optional: the position of your house in Gladys, to list the stops around it.

## Installation

1. In Gladys: **Integrations → Install from GitHub**, then enter
   `https://github.com/guim31/gladys-gtfs`.
2. In the **Configuration** tab, run **Find a network**, then **Add a network** with its
   identifier (`tdg…`).
3. Run **Find a stop** and **Add a stop**, then create the device in the **Discover** tab.

The full guide, in four languages, is in [`docs/`](docs/en.md).

## How it works

- The catalog (`/api/datasets`, public, no key, ~2.5 MB) is read on demand and kept a day in memory.
- Each network's GTFS archive is downloaded to `/data` at most once a day and read in **one
  streaming pass** (own ZIP and CSV readers, no dependency): stop areas and routes are kept for the
  whole network, departures only for the watched stops over nine days. Measured in the locked
  container (256 MB): SNCF (TGV, Intercités, TER), Naolib (576 MB of stop times inflated) and
  Aix-Marseille together peak at ~140 MB. Archives above 80 MB or networks above 400,000 trips a
  week are refused with a clear message (Île-de-France).
- The GTFS-RT feeds of the networks with a watched stop are read at each refresh (1 minute by
  default, conditional requests), every 15 minutes when nothing runs within 90 minutes at the
  watched stops. The status action shows the volume per hour (SNCF: ~90 MB/h at 1 minute).
- Devices are published with `should_poll: false`: the integration runs its own timer and only
  publishes the states that changed (with a 6-hour heartbeat).

## Limitations

- Networks without GTFS on transport.data.gouv.fr can only be added by URL.
- Île-de-France and the heaviest regional aggregates do not fit the 256 MB sandbox.
- Real time depends on each network; some publish only alerts, or track part of their vehicles.
- Line and direction names are those of the network's GTFS (SNCF line codes, for example).
- Developed and tested against the real feeds (SNCF, Naolib, Tisséo, Aix-Marseille) and the SDK's
  fake Gladys, without a real Gladys instance: feedback welcome.

## Development

Node.js 22+, ESM, no build step. The only runtime dependency is
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).

```bash
npm install
npm test              # node --test: real (reduced) catalog, Tisséo and SNCF data + the SDK's fake Gladys
npm run lint
npm run format:check
npx github:GladysAssistant/integration-store --skip-image-check .   # store validator
```

```
index.js              SDK wiring (src/app.js registers the handlers)
src/app.js            handlers → service, configuration actions
src/service.js        networks and stops, timers, devices and states, trigger, actions
src/catalog.js        transport.data.gouv.fr catalog: reduction, search
src/feed.js           one network: GTFS download and parse, GTFS-RT reads
src/gtfs.js           streaming parse of the static GTFS
src/zip.js, csv.js    ZIP and CSV readers (streams)
src/gtfsrt.js         GTFS-Realtime decoder (protobuf)
src/departures.js     departure board: timetable + realtime corrections
src/alerts.js         service alerts: plain text, followed lines
src/devices.js        Gladys devices and states
src/scenes.js         scene action
src/widgets.js        dashboard widget
src/search.js         search by name, distance
src/http.js           downloads (timeouts, size caps, conditional requests)
src/time.js           GTFS service days in the agency's time zone
src/messages.js       texts sent from the container, four languages
src/store.js          /data persistence
src/config.js         configuration defaults and normalization
```

## Credits

- Data: the transport networks, published on [transport.data.gouv.fr](https://transport.data.gouv.fr)
  under the [Licence Ouverte](https://www.etalab.gouv.fr/licence-ouverte-open-licence/) or the
  [Open Database License](https://opendatacommons.org/licenses/odbl/) depending on the dataset. The
  test fixtures are reduced extracts of the catalog and of the Tisséo and SNCF feeds (ODbL), see
  [`test/fixtures/README.md`](test/fixtures/README.md).
- The code started from [gladys-tisseo](https://github.com/guim31/gladys-tisseo) (same author).
- The [TCL integration](https://github.com/prohand/gladys-transport-commun-lyonnais) of prohand
  (Apache-2.0) for the shape of a transit integration in Gladys.
- [Home Assistant](https://www.home-assistant.io)'s GTFS integrations and
  [gtfs-realtime-bindings](https://github.com/MobilityData/gtfs-realtime-bindings) (Apache-2.0) for
  the GTFS-Realtime semantics.
- Cover: a home-made pictogram, no third-party logo.

Not affiliated with transport.data.gouv.fr, SNCF or any transport network.

## License

Apache-2.0, see [LICENSE](LICENSE).
