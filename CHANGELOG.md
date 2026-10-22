# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.3.3] - 2026-10-22

### Security

- Rebuilt on Node.js 24.22.1, the October 2026 security release (remote code
  execution in the Brotli decoder, CVE-2026-111497; TLS hostname and DNS
  fixes).

## [1.3.2] - 2026-10-18

### Fixed

- The key of a network was only used for its SIRI real time: it now also goes
  to the GTFS-RT feeds of the platforms that need it (Ginko, whose GTFS-RT
  feed is outside the catalog), and the field is named "Network API key".

## [1.3.1] - 2026-10-17

### Fixed

- Ginko (Besançon): real time stayed empty even with a valid key. Its SIRI
  server wants the key as the `apiKey` parameter of the URL, and answers its
  key errors in JSON: the key now goes there, and a refused key is said as
  such.

## [1.3.0] - 2026-10-17

### Changed

- The SIRI keys left the configuration: each one goes with its network ("Add a
  network", field "SIRI API key"). A key typed there before moves to its
  network by itself.
- "Find a stop": the house is picked from a list. Requires Gladys 5.2.0.
- The lines and directions listed by "Add a stop" are written as "Lines"
  expects them ("3 > Chazal"), ready to copy.

## [1.2.0] - 2026-10-16

### Added

- "Add a network" has a "SIRI API key" field: the key of a SIRI network is
  typed with it, no longer in the configuration (which still works).
- Adding a network already added changes it: name shown, realtime feeds, SIRI
  URL, SIRI key. Its stops stay.
- "Find a stop" has a "House" field to search around another house than the
  first one, and says which other houses there are.
- One direction of a line: "3 > Chazal" in "Lines" keeps only the direction of
  line 3 whose destination contains "Chazal".
- "Add a stop" lists the lines and directions of the stop, to choose them.

## [1.1.0] - 2026-10-14

### Added

- Real time for the networks that publish SIRI or SIRI Lite instead of GTFS-RT (Ginko in Besançon,
  CTS in Strasbourg, the Pays de la Loire aggregate, Idelis, TUB, évolitY, Tanlib…): the next
  departures are asked stop by stop (StopMonitoring) and replace the timetable of their line and
  direction, the disruptions (GeneralMessage, else SituationExchange) feed the traffic info and the
  scene trigger. Same devices, features, widget and trigger as with GTFS-RT; networks already added
  get it at the next start when the catalog lists a SIRI feed for them.
- "SIRI API keys" in the configuration (secret, never logged), for the servers that ask for a key;
  "SIRI or SIRI Lite URL" in "Add a network" for a network outside the catalog; "SIRI identifier"
  in "Add a stop" when the server does not recognise a stop.
- `scripts/probe-siri.mjs`: asks a real SIRI server, read only, what the integration would ask.

## [1.0.0] - 2026-10-14

### Added

- Next departures at the stops you choose, for any French public transport
  network publishing a GTFS timetable on transport.data.gouv.fr (TER and TGV,
  Naolib, STAR, TaM, M, Ilévia, Stan…), or any GTFS file by URL: one device per
  stop, with the minutes before the next departure and the following one for
  each line and direction, the three soonest departures as text, and the
  traffic info of its lines.
- Real time from the network's GTFS-Realtime feeds when it publishes them
  (delays, cancellations, skipped stops, added trips); otherwise the
  timetable, marked "≈".
- Configuration actions to search the national catalog, add up to three
  networks (with optional GTFS-RT URLs), find stops by name or around your
  home, add up to twenty stops (with an optional line filter), remove a stop
  or a network, and show the state of each feed with its realtime volume.
- Dashboard widget "Next departures".
- Scene trigger "Disruption on a followed line" (line or whole network).
- Scene action "Read the next departures", with a sentence ready to send.
- Texts in English, French, German and Spanish.

[Unreleased]: https://github.com/guim31/gladys-gtfs/compare/v1.3.3...HEAD
[1.3.3]: https://github.com/guim31/gladys-gtfs/compare/v1.3.2...v1.3.3
[1.3.2]: https://github.com/guim31/gladys-gtfs/compare/v1.3.1...v1.3.2
[1.3.1]: https://github.com/guim31/gladys-gtfs/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/guim31/gladys-gtfs/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/guim31/gladys-gtfs/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/guim31/gladys-gtfs/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/guim31/gladys-gtfs/releases/tag/v1.0.0
