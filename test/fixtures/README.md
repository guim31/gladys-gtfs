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
- `siri/`: answers of SIRI servers **written for the tests**, not captured: the
  session that added SIRI had no network access to any SIRI server nor to
  transport.data.gouv.fr. They follow the formats as documented: the SIRI
  France profile (SOAP envelopes with `siri:` prefixes, `XXX:StopPoint:BP:…:LOC`
  references, GeneralMessage with short and long messages), the JSON layout of
  the CTS SIRI Lite API (plain strings, `Extension.IsRealTime`, as read by the
  `siri-lite` Python client) and PRIM's `{ "value": … }` wrappers. Their times
  match the Tisséo fixture at Pader (13 October 2026, 17:19); stop codes and
  line names are those of that fixture, the producer is "TEST". The official
  examples of SIRI-CEN were not copied (no licence stated for them).
  `scripts/probe-siri.mjs` asks a real server, to check these shapes against.
  Three reproduce what the probe of 14 October 2026 met on real servers (no
  body was recorded, the answers were described): `irys-invalid-request.xml`
  (the refusal of an IRYS server, TUB, built from IRYS's own code),
  `soap-empty-answers.xml` (an answer with nothing in it, as Ginko gives
  without a key) and `html-home-page.html` (a home page where SIRI was
  expected, évolitY).
