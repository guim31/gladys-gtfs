# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration**: a Node.js service (Node 22+, ESM,
no build step) that runs in its own sandboxed Docker container and talks to
Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. It started from the official JavaScript template.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/service.test.js          # one file
node --test --test-name-pattern "plug"    # tests whose name matches
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## Architecture

```
index.js                          SDK wiring only: registerHandlers() then connect()
src/app.js                        every SDK handler -> service; configuration actions
src/service.js                    networks and stops, timers, devices/states, trigger, actions
src/catalog.js                    transport.data.gouv.fr catalog: one entry per GTFS resource, search
src/feed.js                       one network: GTFS download + parse (serialized), GTFS-RT reads
src/gtfs.js                       static GTFS: one streaming pass, watched stops kept
src/zip.js, src/csv.js            ZIP and CSV stream readers (no dependency)
src/gtfsrt.js                     GTFS-Realtime decoder (minimal protobuf reader)
src/siri.js                       SIRI / SIRI Lite: requests, key placement, tolerant answer readers
src/siri-feed.js                  SIRI of one network: stop references, pace, visits → line groups
src/xml.js                        minimal XML reader (SIRI answers), JSON-like output
src/departures.js                 departure board: timetable + realtime corrections
src/alerts.js                     service alerts: plain text, followed lines, trip-only alerts
src/devices.js                    the Gladys device of a stop, its states
src/scenes.js                     scene action handlers (manifest `scene_actions`)
src/widgets.js                    dashboard widget handlers (manifest `widgets`)
src/search.js                     search by name, distances
src/http.js                       downloads: timeouts, size caps, ETag, file download
src/time.js                       GTFS service days in the agency's time zone
src/messages.js                   texts sent from the container (en, fr, de, es)
src/store.js                      /data/watch.json (atomic, coalesced writes)
src/config.js                     DEFAULT_CONFIG (mirrors the manifest defaults) + normalization
gladys-assistant-integration.json manifest: config, actions, widget, scene trigger and action
docs/{en,fr,de,es}.md             user documentation, re-hosted by Gladys (en and fr mandatory)
test/                             node --test, against the SDK's fake Gladys (integration-sdk/testing)
test/helpers/world.js             fake Gladys + fake fetch on the fixtures + manual clock + /data
test/helpers/protobuf.js          GTFS-RT encoder for the edge cases
scripts/probe-siri.mjs            read-only probe of a real SIRI server (key from an env var)
test/fixtures/catalog, gtfs       reduced real catalog and feeds (see test/fixtures/README.md)
.github/scripts/release.mjs       release helpers (manifest bump, changelog), tested in test/
```

## Rules

- **External ids are forever.** Build them with
  `gladys.externalIds(type, platformId)`, `platformId` being the unique id the
  platform gives the device (serial, cloud id, MAC), never a label. Gladys keys
  devices, their history, scenes and dashboards on them: changing one creates a
  new device and orphans the old one. The same goes for every key users store:
  manifest `config_schema`, `actions`, widget and scene keys, feature keys.
- **The container rootfs is read-only.** Write only under `/data`, the one
  writable volume. Never log tokens, passwords or API keys.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand — except on the README's hand-pushed tag path, which bumps all three
  together before tagging. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`).
  Never write a version heading: the Release workflow moves the section, and it
  becomes the notes of the GitHub Release.
- **Manifest.** Texts are multi-language objects `{ "en": ..., "fr": ... }`:
  `label`, `description` and `placeholder` alike, never a plain string. The
  catalog `description` holds 10 to 100 characters per language. A field the
  older cores do not know needs a higher `gladys_version` minimum
  (`categories`: 4.86.0; `widgets`, `scene_triggers`, `scene_actions`,
  `type: "provider"`: 5.1.0). `test/manifest.test.js` ties the manifest to the
  code (defaults, action, scene and widget handlers): change both sides
  together.
- **User-facing text** is in four languages (English, French, German with
  "du", Spanish with "usted"): action messages, manifest texts, widget and
  scene texts, and `docs/{en,fr,de,es}.md` with the same sections, kept in
  sync. `test/i18n.test.js` checks them.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network.

---

# Notes du mainteneur (guim31)

Ce qui suit complète les règles du template ci-dessus. Ce sont des faits vérifiés dans le code du
cœur Gladys ou payés sur les intégrations déjà publiées par guim31. Ils ne se lisent pas dans le
code de ce dépôt. Compléter ce fichier quand un nouveau piège est découvert.

## Travailler sur ce dépôt

- Mêmes étapes que la CI, dans le même ordre : `npm ci`, `npm run format:check`, `npm run lint`,
  `npm test`. Prettier contrôle **aussi le Markdown** : lancer `npm run format` après avoir
  modifié ce fichier, le README ou la documentation, sinon la CI tombe.
- Une session de code n'a **ni instance Gladys ni appareil réel**. La suite de tests, le lint et
  le validateur du store sont les seules vérifications possibles : le test réel se fait ailleurs.
  Le dire, plutôt que de conclure que « ça marche ».
- **Tout le code de démonstration du template disparaît** : station météo, prise, lampe, caméra,
  capteur de mouvement, `src/weather.js`, leurs tests, leurs entrées du manifeste et de la
  documentation. Il ne reste que ce que l'intégration fait vraiment.
- **Publier n'est jamais le travail d'une session de code** : ni Release, ni tag, ni topic, ni
  version modifiée à la main. L'orchestrateur s'en charge une fois la PR fusionnée. Les workflows
  sont ceux du template : ne pas les modifier.
- Le dépôt est **public** : aucun secret, aucune adresse ni détail d'infrastructure privée, ni
  ici, ni dans les tests, ni dans les captures.

## Pièges du cœur Gladys

**Appareils et fonctionnalités**

- **Polling** : le planificateur n'interroge un appareil que si `should_poll: true` **et**
  `poll_frequency` vaut une valeur de la liste fixe, **en millisecondes** (1000, 2000, 10000,
  15000, 30000, 60000). Le template publie `poll_frequency: 300` sans `should_poll` : c'est faux,
  le cœur répond 400 à la découverte. Pour une cadence hors liste, publier `should_poll: false` et
  pousser les états depuis le conteneur, en gardant un `onPoll` de repli.
  **Piège du 5.2.0** (GladysAssistant/Gladys#3198, correctif #3199, relevé sur gladys-ping-wol) :
  un appareil **créé sans `should_poll`** n'est jamais sondé, même après correction du cœur (valeur
  stockée à la création), et la 5.2.1 du 13/10/2026 ne le corrige pas. **Le conteneur sonde donc
  lui-même** par un minuteur, qui saute un appareil sondé il y a moins d'une demi-période, en gardant
  `onPoll` comme repli ; seuls les appareils ajoutés (`gladys.devices`) sont lus. Un test le prouve
  sans appeler `onPoll`.
- **`min` et `max` sont NOT NULL** dans `t_device_feature`, y compris pour `text/text` : sans eux,
  « Ajouter à Gladys » échoue en HTTP 422. Mettre 0/0, comme Zigbee2MQTT.
- Un état publié sur une fonctionnalité **pas encore ajoutée** dans Gladys reçoit un 200 puis est
  jeté (simple ligne de log) : republier les états dans `onDeviceCreated`.
- `level-sensor/decimal` n'existe pas côté serveur. `light-sensor/binary` n'a pas de libellé dans
  le front (pastille vide) : préférer `input/binary`. Un `text/text` reçoit `{ text }`, jamais
  vide, sinon l'état est ignoré.
- **Détecteur d'ouverture (`opening-sensor`) : 0 = ouvert, 1 = fermé** (`OPENING_SENSOR_STATE`), à
  l'inverse de l'intuition et des autres détecteurs (mouvement, fuite, fumée : 1 = détecté). Une
  porte ouverte publiée à 1 s'affiche « Fermé » et fausse scènes et historique. Le figer par un test.
- **Un `external_id` de fonctionnalité ne change jamais d'appareil** d'une version à l'autre. UniFi
  1.5.2 avait sorti les ports PoE dans un appareil dédié, la 1.6.0 les a remis dans la passerelle avec
  les mêmes identifiants : ceux qui avaient ajouté l'appareil dédié ne peuvent plus « Mettre à jour » la
  passerelle (409 `external_id must be unique`). Pour regrouper, garder l'appareil existant
  (`gladys.getDevices()`) ou changer d'identifiant.
- Les **noms de fonctionnalités sont figés à la création**. Et quand une fonctionnalité est seule
  de son type sur l'appareil, le tableau de bord affiche le libellé générique du type à la place
  du nom publié.
- **Aucune commande d'appareil ne permet un choix multiple** : un `text/select` n'a qu'un choix
  actif.
- Un changement de structure fait proposer « Mettre à jour » dans l'onglet Découverte
  (`structure_changed`). Un changement des seules `supported_options` ne le déclenche pas.
- **Jauge** : l'aiguille se place par `(value - min) / (max - min)` des bornes de la
  fonctionnalité. `gauge_min`/`gauge_max` ne pilotent que les couleurs, et le cœur n'applique
  jamais `min`/`max` en écriture : ce sont des bornes d'affichage. Une valeur signée exige des
  bornes symétriques.
- Le cœur plafonne à **300 états par minute** et réévalue les scènes à chaque état : ne publier
  que les changements.
- Une intégration `device` ne reçoit pas la langue de l'utilisateur, une action de scène non
  plus (un widget, si) : prévoir un champ de config `language` si des textes partent du
  conteneur. Le superviseur injecte `TZ`, le fuseau de Gladys. La sandbox est limitée à 256 Mo.

**Formulaires de configuration et actions**

- Les champs `number` sont rendus **sans `step`** : le navigateur n'accepte alors que `min + k`.
  Min et défaut **entiers** seulement ; une valeur décimale passe par un `select` ou par un
  `string` parsé (virgule acceptée).
- Un champ `secret` dans les `fields` d'une **action** est impossible à remplir, et une action
  n'applique **aucun `default`** tout en exigeant les champs `required` (422). Issues
  GladysAssistant/Gladys#3154 et #3155.

**SDK 0.15 et journaux**

- SDK `@gladysassistant/integration-sdk` **^0.15.0** (12/10/2026) : `DEVICE_POLL_FREQUENCIES`, faux
  Gladys de test (`@gladysassistant/integration-sdk/testing`, à préférer à un faux maison),
  déduplication des états, `parseMdnsTxt`. Lire son README et son CHANGELOG.
- **Journaux calmes** (demande de Guilhem, 13/10/2026) : rien au niveau info pour un cycle normal de
  lecture, un état publié ou un message reçu. L'info ne garde que le cycle de vie : démarrage,
  connexion, perte et retour d'un appareil ou d'un service, erreurs utiles, une ligne par action de
  l'utilisateur. Le reste passe en debug (`LOG_LEVEL=debug`). Une erreur qui se répète écrit une ligne
  au premier échec et une au rétablissement, pas une par tentative. Jamais de secret ni d'adresse
  avec identifiants. Un test vérifie qu'un cycle normal n'écrit rien en info.
- **Plafond de 12 lignes et directions par arrêt** (`MAX_GROUPS`) : une gare sans filtre en compte
  40 (SNCF Nantes), soit 80 comptes à rebours changeant chaque minute, contre 300 états/minute au
  cœur. Les routes de même nom court sont fusionnées (`lineGroups`) : la clé d'une ligne ne dépend
  jamais des autres routes de la fenêtre.
- **Restauration** seulement si `watch.json` n'a pas de liste de réseaux (perdu) : un arrêt retiré
  dont l'appareil reste dans Gladys ne revient pas au redémarrage.
- **Alertes** : une alerte disparue n'est oubliée (puis annonçable à nouveau) que si tous les flux
  temps réel de son réseau ont été lus à ce tour (`realtimeComplete`) : une panne du proxy des
  alertes SNCF ne fait pas ressortir les anciennes au retour.
- **Heartbeat** : republier au moins toutes les 12 h une valeur qui ne change pas, sinon le front
  affiche « Pas de valeur récente » au-delà de 48 h.

**Widgets, déclencheurs, actions de scène (SDK ≥ 0.14, Gladys ≥ 5.1)**

- **Cibler la dernière version publiée du cœur, pas `master`** : la spec de `master` décrit des
  fonctions non publiées. Les boutons de widget qui ouvrent un formulaire (#3168, commit 3feb2cf8)
  sont absents de la 5.1.4 mais **livrés dans la 5.2.0** (sortie le 12/10/2026) : `gladys_version`
  `>=5.2.0` si on s'en sert, ou un bouton direct en repli. Vérifier par `git tag --contains`.

- Un réglage de widget ne propose en liste que les **appareils** de l'intégration
  (`source: "devices"`, seule source dynamique).
- Budget du cœur : **8 composants par widget, dont 2 textes au plus**, appliqué **avant** la
  résolution des références ; un contenu amputé reste en cache jusqu'au TTL. Appeler
  `requestWidgetRefresh` à la création d'un appareil. `validateWidgetContent` est exporté pour les
  tests, mais ne vérifie pas que les `external_id` liés existent : les croiser avec `buildDevice`.
- Une ligne de `status` exige un `value` (nombre ou texte ≤ 40).
- Le cœur **jette un bouton dont la clé d'action est déjà prise** : clés numérotées.
- Le vocabulaire des widgets n'a ni liste ni curseur, **par choix** du cœur. Seul un bouton
  `device_feature` numérique a un état actif natif.
- **En mode sombre, le style `primary` d'un bouton de widget ne se voit pas** (#3153) : signaler
  un choix courant par l'icône (`check-circle`), jamais par le style.
- Dans une grille `card-list`, la `date` s'affiche **à la place** du sous-titre.
- `onWidgetAction` fait recharger le widget dès la résolution, alors que `requestWidgetRefresh`
  est plafonné à un appel toutes les 10 s. Un toast d'action est tronqué à 200 caractères.
- Le cœur met le contenu d'un widget en cache par (réglages, langue, unités) : pré-localiser
  d'après `language` est correct.
- Les filtres de scène ne font qu'égalité et appartenance : un seuil reste le travail d'un capteur.
- **Les clés de widgets, de déclencheurs et d'actions sont figées une fois publiées.**
- `gladys_version` `>=5.1.0` dès qu'il y a widgets, déclencheurs ou actions de scène.

## Store

- Validateur officiel, depuis la racine : `npx -y github:GladysAssistant/integration-store .`
  (schéma, `description` **100 caractères au plus par langue**, documentation de 300 caractères
  au moins, image Docker, cover de **150 Ko au plus**). Il demande Node ≥ 24 mais tourne sous
  Node 22 avec un avertissement.
- L'indexeur lit le manifeste de la **dernière release**, pas celui de `main` : une correction du
  manifeste (catégorie, description…) n'atteint le store qu'avec une release.
- L'indexeur rejette **en silence** : la raison n'apparaît que dans `rejected.json`, à côté de
  `https://integration-store-storage.gladysassistant.com/index.json`.
- **Image de base** : `FROM public.ecr.aws/docker/library/node:…` (miroir officiel ECR Public, même
  empreinte) et non `node:…` de Docker Hub, qui refuse en 429 les pulls anonymes des runners GitHub
  dès qu'il y a plusieurs builds à la fois. Un échec 429 dans le job « Docker build » n'est pas un bug
  du code. Même parade dans `.github/workflows/build.yml` (posée par l'orchestrateur, ne pas la
  retirer) : QEMU et BuildKit tirés de `mirror.gcr.io`.
- La règle `data/` du `.gitignore` du template (pour le volume `/data`) exclut aussi `src/data/` :
  l'ancrer en `/data/`, dans `.prettierignore` aussi.

### Langues (depuis le 11/10/2026)

Tout texte montré à l'utilisateur existe en **`en`, `fr`, `de` et `es`** : manifeste, contenu des widgets, messages,
noms de fonctionnalités. L'allemand **tutoie** (« du »), l'espagnol **vouvoie** (« usted ») : décision de Guilhem,
appliquée à ses 21 intégrations. `test/i18n.test.js` doit échouer sur une langue manquante, un texte vide ou trop
long, et sur un « Sie »/« Ihr… » de politesse en allemand. Le store exige `docs/en.md` et `docs/fr.md`
(`DOCS_LANGUAGES`) et publie aussi `docs/de.md` et `docs/es.md` quand ils existent
(`DOCS_OPTIONAL_LANGUAGES` d'integration-store) : écrire les quatre, avec les mêmes sections.

## Choix par défaut de Guilhem (12/10/2026)

- Langue par défaut des noms de fonctionnalités et des textes produits par le conteneur : **`fr`**.
- Fichier `LICENSE` Apache-2.0 (texte complet) à la racine.
- `transports` : `local` seul quand le cloud n'est qu'une option annexe.
- Docs `en`, `fr`, `de`, `es` avec les mêmes sections.
- Chauffe, ouverture, sécurité : ne rien rendre pilotable « comme un thermostat » ou par un assistant
  vocal quand une erreur serait dangereuse (leçon d'OctoPrint).

# Intégration GTFS (notes de développement, 14/10/2026)

Reprise généralisée de `gladys-tisseo` (lecteurs ZIP/CSV en flux, décodeur GTFS-RT, tableau des
départs, alertes, widget, déclencheur, action : mêmes pièges, voir son CLAUDE.md). Ce qui change :

## Sources

- **Catalogue** : `GET https://transport.data.gouv.fr/api/datasets` (public, sans clé, ~800 jeux,
  2,5 Mo, tout d'un coup). Un réseau = **une ressource GTFS** (`tdg<id de ressource>`) : un jeu peut
  en publier plusieurs (STAR : horaires « en cours » et « à venir » ; Aix-Marseille : un par
  réseau, plus l'agrégat). Ressources GTFS-RT gardées si `features` contient `trip_updates` ou
  `service_alerts` (ou est vide) ; `vehicle_positions` seul ne sert à rien. Nom : le réseau unique
  déclaré dans `metadata.networks`, sinon la marque unique de `offers`, sinon le titre raccourci.
- Les URL `www.data.gouv.fr/api/1/datasets/r/<uuid>` sont des redirections stables ; les flux
  temps réel passent souvent par `proxy.transport.data.gouv.fr`, qui répond **429** « Rate limit
  exceeded ! You reach the limit of 1 requests per 30 seconds » (corps texte, pas du protobuf) à un
  flux relu avant 30 s : `PROXY_MIN_INTERVAL_MS` de `src/feed.js` espace ses lectures, même quand
  une action relance un rafraîchissement.
- Certaines `original_url` contiennent une **clé d'API** (mecatran `?apiKey=`) : on utilise `url`,
  et les journaux ne montrent que l'hôte (`hostOf`). Une URL saisie à la main peut aussi en
  contenir : elle va dans `/data` et dans les paramètres de l'appareil, jamais dans les logs.

## Pièges découverts

- **SNCF** : `trip_headsign` = **numéro du train** (« 105241 ») : un en-tête purement numérique
  est remplacé par le nom du dernier arrêt. Les TripUpdates ont `route_id` vide et
  `stop_sequence` absent : on retrouve l'arrêt par `stop_id` (déjà géré par le code Tisséo).
  Les **alertes SNCF ne citent que des trajets**, avec un identifiant court (« OCESN858054F »)
  préfixe de celui du GTFS (« OCESN858054F1187_F:TER:… ») : `tripStem` + `routesFromTrips`
  rattachent l'alerte aux lignes des départs connus. Les traductions arrivent en fr/en/de.
- **Clés de fonctionnalités** : nom court de ligne + direction (`c1-0-next`), comme Tisséo ; si
  deux routes partagent un nom court au même arrêt et dans la même direction (agrégats
  régionaux), l'identifiant de route s'ajoute (`c1-r2-0-next`). `stopPlatformId` = id du réseau +
  id d'arrêt assaini (`tdg83582-StopArea-OCE87481002`) : les `:` casseraient `device:feature`.
- **Mémoire** (mesurée dans le conteneur verrouillé 256 Mo, Alpine) : SNCF + Naolib (576 Mo de
  `stop_times.txt` décompressé, 4,6 M lignes, 15 s) + Aix-Marseille (201 000 trajets) : pic cgroup
  138 Mo. Hors conteneur (glibc) le RSS paraît bien plus haut (tas engagé par V8 non rendu) : ne pas
  conclure sur une mesure locale. Les lectures de réseaux sont **sérialisées** (`serial()` de
  `src/feed.js`). Refus propres : archive > 80 Mo (`content-length` ou en flux) ou plus de 400 000
  trajets sur 9 jours (IDFM : 158 Mo, refusé en 1 s).
- **Alertes « réseau »** d'un agrégat multi-opérateurs : rattachées seulement si leur `agency_id`
  exploite une ligne suivie.
- **Restauration** : les paramètres de l'appareil portent `network`, `network_name`, `gtfs_url`,
  `realtime_urls` : un `/data` perdu se reconstruit sans le catalogue.
- **Plafond de 12 lignes et directions par arrêt** (`MAX_GROUPS`) : une gare sans filtre en compte
  40 (SNCF Nantes), soit 80 comptes à rebours changeant chaque minute, contre 300 états/minute au
  cœur. Les routes de même nom court sont fusionnées (`lineGroups`) : la clé d'une ligne ne dépend
  jamais des autres routes de la fenêtre.
- **Restauration** seulement si `watch.json` n'a pas de liste de réseaux (perdu) : un arrêt retiré
  dont l'appareil reste dans Gladys ne revient pas au redémarrage.
- **Alertes** : une alerte disparue n'est oubliée (puis annonçable à nouveau) que si tous les flux
  temps réel de son réseau ont été lus à ce tour (`realtimeComplete`) : une panne du proxy des
  alertes SNCF ne fait pas ressortir les anciennes au retour.
- **Heartbeat** : `publishChangedStates(states, { heartbeat: 6 h })` (« Aucune perturbation » reste
  identique des jours entiers).

## Vérifié (14/10/2026)

- Tests : fixtures réduites du catalogue, de Tisséo (13/10) et de la SNCF à Nantes (14/10, 74
  trajets suivis, 5 alertes).
- Réel, depuis la session et dans le conteneur verrouillé : recherche dans le catalogue, ajout de
  Naolib, SNCF, Aix-Marseille, refus d'IDFM, arrêts Commerce et Nantes, états, phrase de scène.

## Temps réel SIRI (14/10/2026, retour de StephaneB, Ginko)

Une vingtaine de réseaux du catalogue publient du SIRI ou du SIRI Lite **sans GTFS-RT** : on les lit
arrêt par arrêt (`src/siri.js`, `src/siri-feed.js`), **seulement si le réseau n'a aucun GTFS-RT
utile** (`Feed.usesSiri`). Constaté, d'où, et ce qui reste à vérifier :

- **Session sans réseau** : le proxy de la session n'a laissé passer que GitHub (git) et PyPI ;
  transport.data.gouv.fr, data.gouv.fr et tous les serveurs SIRI répondaient 403. Aucune réponse
  réelle n'a pu être enregistrée : les fixtures `test/fixtures/siri/` sont **écrites** d'après les
  formats documentés (voir leur README). `scripts/probe-siri.mjs --catalog --probe` liste les jeux
  SIRI sans GTFS-RT et interroge chacun (sans clé) : **à lancer d'une machine qui a le réseau**
  avant de croire la liste de couverture, puis enregistrer de vraies réponses en fixtures.
- **Catalogue** (`/api/datasets`, lu dans le code d'etalab/transport-site,
  `datasets_controller.ex`) : formats exacts `"SIRI"` et `"SIRI Lite"` ; une ressource `SIRI` porte
  `requestor_ref` quand il est public (tag du jeu de données, le même pour toutes ses ressources
  SIRI). `is_available` ne vaut rien pour SIRI : la sonde du catalogue compte 401/405 comme
  disponible. Les ressources SIRI sont gardées sans regarder `is_available`.
- **SOAP** (« SIRI ») : une URL, un POST par opération, l'enveloppe du requêteur de
  transport.data.gouv.fr (`lib/siri_queries.ex`, AGPL : rien copié, l'enveloppe suit le WSDL) :
  `sw:` = `http://wsdl.siri.org.uk`, `siri:` = `http://www.siri.org.uk/siri`, `ServiceRequestInfo`
  puis `Request`, `RequestExtension` vide ; `StopPointsDiscovery` n'a que `Request`. Pas de
  `SOAPAction` (le requêteur n'en envoie pas). Le **RequestorRef est la clé** (Profil SIRI France :
  « à considérer comme des clés d'accès »).
- **SIRI Lite** : `<base>/stop-monitoring?MonitoringRef=…`, `general-message`,
  `situation-exchange`, `stoppoints-discovery` ; une URL de catalogue qui nomme un service est
  ramenée à sa base (suffixe `.json` gardé). **La clé n'a pas d'emplacement standard** : CTS = HTTP
  Basic (clé en utilisateur, mot de passe vide, vérifié dans le client `siri-lite` de PyPI) ;
  Mecatran = `AccountKey` ; PRIM = en-tête `apikey`. Hôte inconnu : Basic + `X-Siri-RequestorRef`
  (en-tête recommandé par le profil), ou le paramètre de l'URL du catalogue qui ressemble à une
  clé. L'utilisateur peut forcer `nom=clé` (paramètre) ou `En-Tête: clé`.
- **Clé** : champ de config `siri_keys` **secret** (un `secret` dans une action est impossible à
  remplir, #3154) : `réseau = clé` par ligne ou « ; », une clé seule vaut pour tous. Jamais dans
  `/data`, les paramètres d'appareil ni les journaux ; `redact()` retire la clé des `ErrorText`
  qui la recopient. Une URL Lite porte parfois la clé : ne journaliser que `hostOf`.
- **Formats de réponse** : enveloppe SOAP ou `<Siri>` nu, préfixes variables, `{ "value": … }`
  (PRIM), chaînes simples (CTS), tableau ou objet seul. `src/xml.js` rend le XML dans la forme du
  JSON Lite, puis lecture **par nom, insensible à la casse, à toute profondeur** (`findAll`). CTS
  n'envoie pas d'`AimedDepartureTime` et dit le temps réel dans `Extension.IsRealTime` ; ailleurs
  `Monitored=false` = horaire théorique. Erreurs dans le corps (`ErrorCondition`, `Status=false`,
  SOAP `Fault`, parfois en HTTP 500) : `AccessNotAllowedError` = clé.
- **Arrêts** : références du profil `XXX:StopPoint:BP:<local>:LOC` (Hanover), `STIF:StopPoint:Q:…:`,
  codes CTS `43A`/`399A`. Ordre : identifiant tapé (`siri_ref` d'« Ajouter un arrêt ») ;
  `StopPointsDiscovery` (une fois par jour) relié par code/partie locale, sinon même nom à 100 m ;
  sinon `stop_code` (désormais lu dans `stops.txt`, `network.codes`), `stop_id`, sa partie locale.
  Un `InvalidDataReferences`/400/404 passe au candidat suivant (une requête par cycle) ; tout épuisé
  → « arrêt inconnu » dans l'état, nouvel essai 6 h plus tard. **On interroge les quais** (points
  GTFS), au plus 4 par arrêt, les plus desservis d'abord.
- **Rapprochement** : pas par trajet (les `DatedVehicleJourneyRef` ne sont pas les `trip_id`), mais
  par **groupe ligne + direction** (`lineGroups`, clé `COURT|dir`) : les passages du serveur
  remplacent l'horaire du groupe jusqu'au dernier d'entre eux, puis l'horaire reprend
  (`mergeVisits`). Ligne : **un code simple (« 59 ») se compare d'abord au nom court**, une
  référence structurée (`X:Line::59:LOC`) d'abord à l'id de route — piège réel du fixture Tisséo, où
  `line:59` (nom court 82) volait la ligne 59. Direction : seule desservie, puis quai, puis
  destination, puis `Aller`/`Retour`.
- **Sobriété** : `busy` par arrêt (passage à moins de 90 min) sinon toutes les 15 min ;
  perturbations toutes les 5 min ; 429 → plus rien pendant `Retry-After` (5 min par défaut) ; proxy
  transport.data.gouv.fr : 30 s par URL (une URL SOAP sert tous les arrêts : un arrêt par 30 s).
  Aucun quota réseau par réseau n'a pu être lu (pages inaccessibles) : à compléter.
- **Pas de migration** : les appareils gardent leurs `external_id` et fonctionnalités ; aucun
  paramètre d'appareil n'est ajouté pour un réseau du catalogue (seulement `siri_url` d'un réseau
  ajouté par URL, `siri_ref` d'un arrêt qui en a un). Un réseau du catalogue ajouté avant (pas de
  champ `siri` dans `watch.json`) reçoit ses ressources SIRI du catalogue au démarrage suivant
  (`fillSiriEndpoints`).
