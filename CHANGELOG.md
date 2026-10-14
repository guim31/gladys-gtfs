# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

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

[Unreleased]: https://github.com/guim31/gladys-gtfs/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/guim31/gladys-gtfs/releases/tag/v1.0.0
