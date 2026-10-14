# Test fixtures

Reduced extracts of real open data, public transit only: nothing personal in
them.

- `catalog/datasets-sample.json`: the answer of
  `https://transport.data.gouv.fr/api/datasets` on **14 October 2026**, reduced
  to six public transit datasets (SNCF, Pays de la Loire aggregate, Tisséo,
  Naolib, STAR, the Giverny shuttle) and their GTFS, GTFS-RT, NeTEx and GBFS
  resources, plus one made-up bike dataset that must be ignored. Fields kept
  as published, the others dropped.
- `gtfs/tisseo-gtfs-sample.zip` and `gtfs/tisseo-gtfsrt-sample.pb`: the Tisséo
  GTFS and GTFS-Realtime feeds captured on **13 October 2026 at 17:19
  (Toulouse time)**, under the
  [Open Database License](https://opendatacommons.org/licenses/odbl/) (Tisséo,
  Toulouse Métropole), reduced to seven stop areas (the three "Jean Jaurès",
  Pader, the three Téléo stations), the trips serving them from 12 to 15
  October, their stop times there (all of them for Téléo), and the realtime
  entities of these trips, two network alerts and eight line alerts. Taken
  from gladys-tisseo.
- `gtfs/sncf-gtfs-sample.zip`: the SNCF GTFS (TGV, Intercités, TER, coaches),
  ODbL, of 14 October 2026, reduced to Nantes station: the trips serving it
  from 13 to 15 October, their stop times at Nantes and at their last stop,
  their routes, stops, agencies and calendar dates. Original rows, filtered.
- `gtfs/sncf-gtfsrt-trip-updates-sample.pb` and
  `gtfs/sncf-gtfsrt-alerts-sample.pb`: the SNCF GTFS-Realtime feeds of the
  transport.data.gouv.fr proxy captured on **14 October 2026 at 08:53 (Paris
  time)**: the 74 trip updates of the trips of the GTFS sample (as decoded),
  and five service alerts naming these trips, with their French translation
  only. Re-encoded with `test/helpers/protobuf.js`.
- `gladys-feature-table.json`: the category/type couples, units and poll
  frequencies the Gladys core knows (extracted from its code).
