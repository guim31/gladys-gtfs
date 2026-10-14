# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

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
