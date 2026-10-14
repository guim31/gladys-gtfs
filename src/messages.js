// -----------------------------------------------------------------------------
// Texts sent from the container (feature names, states, action messages,
// widget contents, scene outputs), in the four languages of the Gladys
// interface. Entries are strings or functions of one parameter object.
// German says "du", Spanish "usted". Brand and place names never translate.
// -----------------------------------------------------------------------------

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

// Feature names (frozen when the device is created, in the configured language)
// and the words put before a line name, by mode.
export const NAMES = {
  en: {
    metro: 'Metro',
    tram: 'Tram',
    bus: 'Bus',
    train: 'Train',
    coach: 'Coach',
    ferry: 'Ferry',
    cable: 'Cable car',
    trolleybus: 'Trolleybus',
    following: '(next)',
    board: 'Next departures',
    traffic: 'Traffic info',
  },
  fr: {
    metro: 'Métro',
    tram: 'Tram',
    bus: 'Bus',
    train: 'Train',
    coach: 'Car',
    ferry: 'Bateau',
    cable: 'Téléphérique',
    trolleybus: 'Trolleybus',
    following: '(suivant)',
    board: 'Prochains passages',
    traffic: 'Info trafic',
  },
  de: {
    metro: 'Metro',
    tram: 'Tram',
    bus: 'Bus',
    train: 'Zug',
    coach: 'Reisebus',
    ferry: 'Fähre',
    cable: 'Seilbahn',
    trolleybus: 'Oberleitungsbus',
    following: '(danach)',
    board: 'Nächste Abfahrten',
    traffic: 'Verkehrsinfo',
  },
  es: {
    metro: 'Metro',
    tram: 'Tranvía',
    bus: 'Bus',
    train: 'Tren',
    coach: 'Autocar',
    ferry: 'Barco',
    cable: 'Teleférico',
    trolleybus: 'Trolebús',
    following: '(siguiente)',
    board: 'Próximas salidas',
    traffic: 'Info de tráfico',
  },
};

// Texts of the published states, of the widgets and of the scene outputs.
export const TEXT = {
  en: {
    noDisruption: 'No disruption',
    noDeparture: 'No departure in the next 24 hours',
    nothingAt: ({ stop }) => `${stop}: no departure in the next 24 hours`,
    scheduled: 'scheduled',
    now: 'now',
    in: ({ minutes }) => `in ${minutes} min`,
    inTwo: ({ first, second }) => `in ${first} and ${second} min`,
    nowThen: ({ second }) => `now, then in ${second} min`,
    sentence: ({ line, direction, stop, when }) =>
      `${line} towards ${direction} at ${stop}: ${when}`,
    legend: '≈ timetable, otherwise real time',
    disrupted: ({ count }) => `${count} disruption(s) on these lines`,
    loading: 'The timetable is loading: try again in a minute.',
    pickStop: 'Choose a stop in the settings of this widget.',
    gone: 'This stop is no longer watched by the integration.',
    unavailable: 'Data unavailable for now',
  },
  fr: {
    noDisruption: 'Aucune perturbation',
    noDeparture: 'Aucun passage dans les 24 h',
    nothingAt: ({ stop }) => `${stop} : aucun passage dans les 24 h`,
    scheduled: 'théorique',
    now: 'maintenant',
    in: ({ minutes }) => `dans ${minutes} min`,
    inTwo: ({ first, second }) => `dans ${first} et ${second} min`,
    nowThen: ({ second }) => `maintenant, puis dans ${second} min`,
    sentence: ({ line, direction, stop, when }) => `${line} vers ${direction} à ${stop} : ${when}`,
    legend: '≈ horaire théorique, sinon temps réel',
    disrupted: ({ count }) => `${count} perturbation(s) sur ces lignes`,
    loading: 'Les horaires sont en cours de chargement : réessayez dans une minute.',
    pickStop: 'Choisissez un arrêt dans les réglages de ce widget.',
    gone: "Cet arrêt n'est plus surveillé par l'intégration.",
    unavailable: 'Données indisponibles pour le moment',
  },
  de: {
    noDisruption: 'Keine Störung',
    noDeparture: 'Keine Abfahrt in den nächsten 24 Stunden',
    nothingAt: ({ stop }) => `${stop}: keine Abfahrt in den nächsten 24 Stunden`,
    scheduled: 'laut Fahrplan',
    now: 'jetzt',
    in: ({ minutes }) => `in ${minutes} Min.`,
    inTwo: ({ first, second }) => `in ${first} und ${second} Min.`,
    nowThen: ({ second }) => `jetzt, dann in ${second} Min.`,
    sentence: ({ line, direction, stop, when }) =>
      `${line} Richtung ${direction} ab ${stop}: ${when}`,
    legend: '≈ laut Fahrplan, sonst Echtzeit',
    disrupted: ({ count }) => `${count} Störung(en) auf diesen Linien`,
    loading: 'Der Fahrplan wird geladen: Versuch es in einer Minute noch einmal.',
    pickStop: 'Wähle eine Haltestelle in den Einstellungen dieses Widgets.',
    gone: 'Diese Haltestelle wird von der Integration nicht mehr überwacht.',
    unavailable: 'Daten derzeit nicht verfügbar',
  },
  es: {
    noDisruption: 'Sin incidencias',
    noDeparture: 'Ninguna salida en las próximas 24 horas',
    nothingAt: ({ stop }) => `${stop}: ninguna salida en las próximas 24 horas`,
    scheduled: 'horario teórico',
    now: 'ahora',
    in: ({ minutes }) => `dentro de ${minutes} min`,
    inTwo: ({ first, second }) => `dentro de ${first} y ${second} min`,
    nowThen: ({ second }) => `ahora, luego dentro de ${second} min`,
    sentence: ({ line, direction, stop, when }) => `${line} hacia ${direction} en ${stop}: ${when}`,
    legend: '≈ horario teórico; si no, tiempo real',
    disrupted: ({ count }) => `${count} incidencia(s) en estas líneas`,
    loading: 'Los horarios se están cargando: vuelva a intentarlo en un minuto.',
    pickStop: 'Elija una parada en los ajustes de este widget.',
    gone: 'La integración ya no vigila esta parada.',
    unavailable: 'Datos no disponibles por ahora',
  },
};

// Messages of the configuration actions.
export const REPORTS = {
  en: {
    catalogFailed: ({ reason }) =>
      `The transport.data.gouv.fr catalog could not be read (${reason}). Try again later.`,
    gtfsFailed: ({ name, reason }) =>
      `The timetable of ${name} could not be read (${reason}). Try again later.`,
    tooBig: ({ name, reason }) =>
      `The timetable of ${name} is too big for the 256 MB of the integration (${reason}). For Île-de-France, Lyon or Bordeaux, use their dedicated integration.`,
    noNetworkQuery: 'Type a network, a city or a region, e.g. "Naolib", "Rennes" or "TER".',
    noNetwork: 'No network yet: run "Add a network" first.',
    unknownNetwork: ({ query, networks }) =>
      `No added network is called "${query}". Networks: ${networks}.`,
    foundNetworks: ({ count }) => `${count} network(s) found:`,
    realtimeShort: 'real time',
    noRealtime: 'none (timetable only)',
    tripUpdates: 'departures',
    serviceAlerts: 'alerts',
    addNetworkHint: 'To add one, run "Add a network" with its identifier (tdg…).',
    ambiguousNetwork: ({ query }) =>
      `Several networks match "${query}": add it by its identifier (tdg…).`,
    networkAdded: ({ name, areas, routes }) => `${name} added: ${areas} stops, ${routes} lines.`,
    networkRealtime: ({ count }) => `Real time: ${count} feed(s).`,
    networkNoRealtime: 'Real time: none published, timetable only.',
    licence: ({ licence }) => `Data licence: ${licence}.`,
    networkKnown: ({ name }) => `${name} is already added.`,
    tooManyNetworks: ({ max }) => `${max} networks at most: remove one first.`,
    searchStopHint: 'Now find your stops with "Find a stop".',
    noQuery:
      'Type a name, or set the position of your home in Gladys (Settings → Houses) to list the closest ones.',
    noMatch: ({ query }) => `Nothing matches "${query}".`,
    foundStops: ({ count }) => `${count} stop(s) found:`,
    closestStops: ({ house }) => `Closest stops to ${house}:`,
    addStopHint: 'To watch one, run "Add a stop" with its name or its identifier (in brackets).',
    ambiguous: ({ query }) => `Several matches for "${query}": add it by its identifier.`,
    stopAdded: ({ name, lines }) => `${name} added (${lines}).`,
    stopUpdated: ({ name, lines }) => `${name} updated (${lines}).`,
    tooManyLines: ({ count, max }) =>
      `${count} lines and directions stop here: the device keeps the first ${max}. Add the stop again with your lines to choose them.`,
    allLines: 'all lines',
    unknownLines: ({ lines, available }) =>
      `No such line at this stop: ${lines}. Lines here: ${available}.`,
    toDiscovery: 'Open the Discover tab to create its device.',
    removed: ({ name }) => `${name} removed from the list. Delete its device in Gladys if needed.`,
    networkRemoved: ({ name, count }) =>
      `${name} removed, with its ${count} stop(s). Delete their devices in Gladys if needed.`,
    notWatched: ({ query }) => `Nothing watched is named "${query}" or has this identifier.`,
    tooMany: ({ max }) => `The list is full (${max} stops at most).`,
    watchedNetworks: ({ count }) => `Networks: ${count}`,
    watchedStops: ({ count }) => `Watched stops: ${count}`,
    timetable: ({ date, until }) => `Timetable: downloaded on ${date}, departures until ${until}.`,
    timetableMissing: 'Timetable: not read yet.',
    realtime: ({ age, tracked, volume }) =>
      `Real time: updated ${age} s ago, ${tracked} trip(s) tracked, about ${volume} MB per hour while departures are scheduled.`,
    realtimeOff: 'Real time: turned off in the configuration (timetable only).',
    realtimeWaiting: 'Real time: not read yet.',
    siriShort: 'departures stop by stop (SIRI)',
    networkSiri: ({ format }) => `Real time: ${format}, asked stop by stop.`,
    siriKeyHint:
      'If the network asks for an API key, type it in the integration configuration ("SIRI API keys").',
    siriRealtime: ({ format, age, tracked, requests }) =>
      `Real time (${format}): updated ${age} s ago, ${tracked} departure(s) tracked, ${requests} request(s) per refresh while departures are scheduled.`,
    siriWaiting: ({ format }) => `Real time (${format}): not read yet.`,
    siriKeyRefused:
      'Real time (SIRI): access refused by the server. Check the API key in the configuration ("SIRI API keys").',
    siriUnknownStops: ({ stops }) =>
      `Stops unknown to the SIRI server: ${stops}. Give their SIRI identifier with "Add a stop".`,
    siriRef: ({ refs }) => `SIRI identifier: ${refs}.`,
    siriRefUnused: 'This network is not read by SIRI: the SIRI identifier is not used.',
    siriNoData:
      'Real time (SIRI): the server answers, but without any stop nor departure. It most likely needs an API key, or refuses the one given.',
    siriNoStopMonitoring:
      'Real time (SIRI): this server offers no next departures by stop (StopMonitoring), only other services. Timetable only.',
    lastError: ({ error }) => `Last error: ${error}`,
  },
  fr: {
    catalogFailed: ({ reason }) =>
      `Le catalogue de transport.data.gouv.fr n'a pas pu être lu (${reason}). Réessayez plus tard.`,
    gtfsFailed: ({ name, reason }) =>
      `Les horaires de ${name} n'ont pas pu être lus (${reason}). Réessayez plus tard.`,
    tooBig: ({ name, reason }) =>
      `Les horaires de ${name} sont trop gros pour les 256 Mo de l'intégration (${reason}). Pour l'Île-de-France, Lyon ou Bordeaux, utilisez leur intégration dédiée.`,
    noNetworkQuery:
      'Saisissez un réseau, une ville ou une région, par exemple « Naolib », « Rennes » ou « TER ».',
    noNetwork: "Aucun réseau pour l'instant : lancez d'abord « Ajouter un réseau ».",
    unknownNetwork: ({ query, networks }) =>
      `Aucun réseau ajouté ne s'appelle « ${query} ». Réseaux : ${networks}.`,
    foundNetworks: ({ count }) => `${count} réseau(x) trouvé(s) :`,
    realtimeShort: 'temps réel',
    noRealtime: 'aucun (horaires théoriques)',
    tripUpdates: 'passages',
    serviceAlerts: 'alertes',
    addNetworkHint: 'Pour en ajouter un, lancez « Ajouter un réseau » avec son identifiant (tdg…).',
    ambiguousNetwork: ({ query }) =>
      `Plusieurs réseaux correspondent à « ${query} » : ajoutez-le par son identifiant (tdg…).`,
    networkAdded: ({ name, areas, routes }) =>
      `${name} ajouté : ${areas} arrêts, ${routes} lignes.`,
    networkRealtime: ({ count }) => `Temps réel : ${count} flux.`,
    networkNoRealtime: 'Temps réel : aucun publié, horaires théoriques seuls.',
    licence: ({ licence }) => `Licence des données : ${licence}.`,
    networkKnown: ({ name }) => `${name} est déjà ajouté.`,
    tooManyNetworks: ({ max }) => `${max} réseaux au plus : retirez-en un d'abord.`,
    searchStopHint: 'Cherchez maintenant vos arrêts avec « Chercher un arrêt ».',
    noQuery:
      'Saisissez un nom, ou renseignez la position de votre maison dans Gladys (Paramètres → Maisons) pour lister les plus proches.',
    noMatch: ({ query }) => `Rien ne correspond à « ${query} ».`,
    foundStops: ({ count }) => `${count} arrêt(s) trouvé(s) :`,
    closestStops: ({ house }) => `Arrêts les plus proches de ${house} :`,
    addStopHint:
      'Pour en surveiller un, lancez « Ajouter un arrêt » avec son nom ou son identifiant (entre crochets).',
    ambiguous: ({ query }) =>
      `Plusieurs résultats pour « ${query} » : ajoutez-le par son identifiant.`,
    stopAdded: ({ name, lines }) => `${name} ajouté (${lines}).`,
    stopUpdated: ({ name, lines }) => `${name} mis à jour (${lines}).`,
    tooManyLines: ({ count, max }) =>
      `${count} lignes et directions passent ici : l'appareil garde les ${max} premières. Ajoutez de nouveau l'arrêt avec vos lignes pour les choisir.`,
    allLines: 'toutes les lignes',
    unknownLines: ({ lines, available }) =>
      `Ligne(s) absente(s) de cet arrêt : ${lines}. Lignes desservies : ${available}.`,
    toDiscovery: "Ouvrez l'onglet Découverte pour créer son appareil.",
    removed: ({ name }) =>
      `${name} retiré de la liste. Supprimez son appareil dans Gladys si besoin.`,
    networkRemoved: ({ name, count }) =>
      `${name} retiré, avec ses ${count} arrêt(s). Supprimez leurs appareils dans Gladys si besoin.`,
    notWatched: ({ query }) =>
      `Rien de surveillé ne s'appelle « ${query} » ni n'a cet identifiant.`,
    tooMany: ({ max }) => `La liste est pleine (${max} arrêts au plus).`,
    watchedNetworks: ({ count }) => `Réseaux : ${count}`,
    watchedStops: ({ count }) => `Arrêts surveillés : ${count}`,
    timetable: ({ date, until }) =>
      `Horaires : téléchargés le ${date}, passages connus jusqu'au ${until}.`,
    timetableMissing: 'Horaires : pas encore lus.',
    realtime: ({ age, tracked, volume }) =>
      `Temps réel : mis à jour il y a ${age} s, ${tracked} trajet(s) suivi(s), environ ${volume} Mo par heure quand des passages sont prévus.`,
    realtimeOff: 'Temps réel : désactivé dans la configuration (horaires théoriques seuls).',
    realtimeWaiting: 'Temps réel : pas encore lu.',
    siriShort: 'passages arrêt par arrêt (SIRI)',
    networkSiri: ({ format }) => `Temps réel : ${format}, interrogé arrêt par arrêt.`,
    siriKeyHint:
      "Si le réseau demande une clé d'API, saisissez-la dans la configuration de l'intégration (« Clés d'API SIRI »).",
    siriRealtime: ({ format, age, tracked, requests }) =>
      `Temps réel (${format}) : mis à jour il y a ${age} s, ${tracked} passage(s) suivi(s), ${requests} requête(s) par rafraîchissement quand des passages sont prévus.`,
    siriWaiting: ({ format }) => `Temps réel (${format}) : pas encore lu.`,
    siriKeyRefused:
      "Temps réel (SIRI) : accès refusé par le serveur. Vérifiez la clé d'API dans la configuration (« Clés d'API SIRI »).",
    siriUnknownStops: ({ stops }) =>
      `Arrêts inconnus du serveur SIRI : ${stops}. Donnez leur identifiant SIRI avec « Ajouter un arrêt ».`,
    siriRef: ({ refs }) => `Identifiant SIRI : ${refs}.`,
    siriRefUnused: "Ce réseau n'est pas lu en SIRI : l'identifiant SIRI ne sert pas.",
    siriNoData:
      "Temps réel (SIRI) : le serveur répond, mais sans aucun arrêt ni passage. Il demande très probablement une clé d'API, ou refuse celle donnée.",
    siriNoStopMonitoring:
      'Temps réel (SIRI) : ce serveur ne propose pas les prochains passages par arrêt (StopMonitoring), seulement d’autres services. Horaires théoriques seuls.',
    lastError: ({ error }) => `Dernière erreur : ${error}`,
  },
  de: {
    catalogFailed: ({ reason }) =>
      `Der Katalog von transport.data.gouv.fr konnte nicht gelesen werden (${reason}). Versuch es später noch einmal.`,
    gtfsFailed: ({ name, reason }) =>
      `Der Fahrplan von ${name} konnte nicht gelesen werden (${reason}). Versuch es später noch einmal.`,
    tooBig: ({ name, reason }) =>
      `Der Fahrplan von ${name} ist zu groß für die 256 MB der Integration (${reason}). Für die Île-de-France, Lyon oder Bordeaux nutze ihre eigene Integration.`,
    noNetworkQuery:
      'Gib ein Netz, eine Stadt oder eine Region ein, z. B. „Naolib“, „Rennes“ oder „TER“.',
    noNetwork: 'Noch kein Netz: Starte zuerst „Netz hinzufügen“.',
    unknownNetwork: ({ query, networks }) =>
      `Kein hinzugefügtes Netz heißt „${query}“. Netze: ${networks}.`,
    foundNetworks: ({ count }) => `${count} Netz(e) gefunden:`,
    realtimeShort: 'Echtzeit',
    noRealtime: 'keine (nur Fahrplan)',
    tripUpdates: 'Abfahrten',
    serviceAlerts: 'Meldungen',
    addNetworkHint: 'Um eines hinzuzufügen, starte „Netz hinzufügen“ mit seiner Kennung (tdg…).',
    ambiguousNetwork: ({ query }) =>
      `Mehrere Netze passen zu „${query}“: Füge es über seine Kennung (tdg…) hinzu.`,
    networkAdded: ({ name, areas, routes }) =>
      `${name} hinzugefügt: ${areas} Haltestellen, ${routes} Linien.`,
    networkRealtime: ({ count }) => `Echtzeit: ${count} Feed(s).`,
    networkNoRealtime: 'Echtzeit: keine veröffentlicht, nur Fahrplan.',
    licence: ({ licence }) => `Datenlizenz: ${licence}.`,
    networkKnown: ({ name }) => `${name} ist bereits hinzugefügt.`,
    tooManyNetworks: ({ max }) => `Höchstens ${max} Netze: Entferne zuerst eines.`,
    searchStopHint: 'Suche jetzt deine Haltestellen mit „Haltestelle suchen“.',
    noQuery:
      'Gib einen Namen ein oder trage die Position deines Zuhauses in Gladys ein (Einstellungen → Zuhause), um die nächstgelegenen aufzulisten.',
    noMatch: ({ query }) => `Nichts passt zu „${query}“.`,
    foundStops: ({ count }) => `${count} Haltestelle(n) gefunden:`,
    closestStops: ({ house }) => `Nächstgelegene Haltestellen zu ${house}:`,
    addStopHint:
      'Um eine zu überwachen, starte „Haltestelle hinzufügen“ mit ihrem Namen oder ihrer Kennung (in Klammern).',
    ambiguous: ({ query }) => `Mehrere Treffer für „${query}“: Füge sie über ihre Kennung hinzu.`,
    stopAdded: ({ name, lines }) => `${name} hinzugefügt (${lines}).`,
    stopUpdated: ({ name, lines }) => `${name} aktualisiert (${lines}).`,
    tooManyLines: ({ count, max }) =>
      `Hier halten ${count} Linien und Richtungen: Das Gerät behält die ersten ${max}. Füge die Haltestelle mit deinen Linien erneut hinzu, um sie auszuwählen.`,
    allLines: 'alle Linien',
    unknownLines: ({ lines, available }) =>
      `Diese Linie(n) halten hier nicht: ${lines}. Linien an dieser Haltestelle: ${available}.`,
    toDiscovery: 'Öffne den Tab „Entdecken“, um ihr Gerät anzulegen.',
    removed: ({ name }) =>
      `${name} aus der Liste entfernt. Lösche das Gerät in Gladys, falls nötig.`,
    networkRemoved: ({ name, count }) =>
      `${name} entfernt, mit seinen ${count} Haltestelle(n). Lösche ihre Geräte in Gladys, falls nötig.`,
    notWatched: ({ query }) => `Nichts Überwachtes heißt „${query}“ oder hat diese Kennung.`,
    tooMany: ({ max }) => `Die Liste ist voll (höchstens ${max} Haltestellen).`,
    watchedNetworks: ({ count }) => `Netze: ${count}`,
    watchedStops: ({ count }) => `Überwachte Haltestellen: ${count}`,
    timetable: ({ date, until }) =>
      `Fahrplan: am ${date} heruntergeladen, Abfahrten bis ${until} bekannt.`,
    timetableMissing: 'Fahrplan: noch nicht gelesen.',
    realtime: ({ age, tracked, volume }) =>
      `Echtzeit: vor ${age} s aktualisiert, ${tracked} Fahrt(en) verfolgt, etwa ${volume} MB pro Stunde, solange Abfahrten geplant sind.`,
    realtimeOff: 'Echtzeit: in der Konfiguration ausgeschaltet (nur Fahrplan).',
    realtimeWaiting: 'Echtzeit: noch nicht gelesen.',
    siriShort: 'Abfahrten je Haltestelle (SIRI)',
    networkSiri: ({ format }) => `Echtzeit: ${format}, je Haltestelle abgefragt.`,
    siriKeyHint:
      'Wenn das Netz einen API-Schlüssel verlangt, gib ihn in der Konfiguration der Integration ein („SIRI-API-Schlüssel“).',
    siriRealtime: ({ format, age, tracked, requests }) =>
      `Echtzeit (${format}): vor ${age} s aktualisiert, ${tracked} Abfahrt(en) verfolgt, ${requests} Anfrage(n) pro Aktualisierung, solange Abfahrten anstehen.`,
    siriWaiting: ({ format }) => `Echtzeit (${format}): noch nicht gelesen.`,
    siriKeyRefused:
      'Echtzeit (SIRI): Zugriff vom Server verweigert. Prüfe den API-Schlüssel in der Konfiguration („SIRI-API-Schlüssel“).',
    siriUnknownStops: ({ stops }) =>
      `Dem SIRI-Server unbekannte Haltestellen: ${stops}. Gib ihre SIRI-Kennung mit „Haltestelle hinzufügen“ an.`,
    siriRef: ({ refs }) => `SIRI-Kennung: ${refs}.`,
    siriRefUnused:
      'Dieses Netz wird nicht per SIRI gelesen: Die SIRI-Kennung wird nicht verwendet.',
    siriNoData:
      'Echtzeit (SIRI): Der Server antwortet, aber ohne Haltestellen und ohne Abfahrten. Er verlangt sehr wahrscheinlich einen API-Schlüssel oder lehnt den angegebenen ab.',
    siriNoStopMonitoring:
      'Echtzeit (SIRI): Dieser Server bietet keine nächsten Abfahrten je Haltestelle (StopMonitoring), nur andere Dienste. Nur Fahrplan.',
    lastError: ({ error }) => `Letzter Fehler: ${error}`,
  },
  es: {
    catalogFailed: ({ reason }) =>
      `No se ha podido leer el catálogo de transport.data.gouv.fr (${reason}). Vuelva a intentarlo más tarde.`,
    gtfsFailed: ({ name, reason }) =>
      `No se han podido leer los horarios de ${name} (${reason}). Vuelva a intentarlo más tarde.`,
    tooBig: ({ name, reason }) =>
      `Los horarios de ${name} son demasiado grandes para los 256 MB de la integración (${reason}). Para Île-de-France, Lyon o Burdeos, use su integración específica.`,
    noNetworkQuery:
      'Escriba una red, una ciudad o una región, por ejemplo «Naolib», «Rennes» o «TER».',
    noNetwork: 'Aún no hay ninguna red: ejecute primero «Añadir una red».',
    unknownNetwork: ({ query, networks }) =>
      `Ninguna red añadida se llama «${query}». Redes: ${networks}.`,
    foundNetworks: ({ count }) => `${count} red(es) encontrada(s):`,
    realtimeShort: 'tiempo real',
    noRealtime: 'ninguno (solo horarios teóricos)',
    tripUpdates: 'salidas',
    serviceAlerts: 'avisos',
    addNetworkHint: 'Para añadir una, ejecute «Añadir una red» con su identificador (tdg…).',
    ambiguousNetwork: ({ query }) =>
      `Varias redes coinciden con «${query}»: añádala por su identificador (tdg…).`,
    networkAdded: ({ name, areas, routes }) =>
      `${name} añadida: ${areas} paradas, ${routes} líneas.`,
    networkRealtime: ({ count }) => `Tiempo real: ${count} flujo(s).`,
    networkNoRealtime: 'Tiempo real: no se publica ninguno, solo horarios teóricos.',
    licence: ({ licence }) => `Licencia de los datos: ${licence}.`,
    networkKnown: ({ name }) => `${name} ya está añadida.`,
    tooManyNetworks: ({ max }) => `${max} redes como máximo: elimine una primero.`,
    searchStopHint: 'Busque ahora sus paradas con «Buscar una parada».',
    noQuery:
      'Escriba un nombre, o indique la posición de su casa en Gladys (Configuración → Viviendas) para listar las más cercanas.',
    noMatch: ({ query }) => `Nada coincide con «${query}».`,
    foundStops: ({ count }) => `${count} parada(s) encontrada(s):`,
    closestStops: ({ house }) => `Paradas más cercanas a ${house}:`,
    addStopHint:
      'Para vigilar una, ejecute «Añadir una parada» con su nombre o su identificador (entre corchetes).',
    ambiguous: ({ query }) => `Varios resultados para «${query}»: añádala por su identificador.`,
    stopAdded: ({ name, lines }) => `${name} añadida (${lines}).`,
    stopUpdated: ({ name, lines }) => `${name} actualizada (${lines}).`,
    tooManyLines: ({ count, max }) =>
      `Aquí paran ${count} líneas y direcciones: el dispositivo conserva las ${max} primeras. Vuelva a añadir la parada con sus líneas para elegirlas.`,
    allLines: 'todas las líneas',
    unknownLines: ({ lines, available }) =>
      `Línea(s) que no pasan por esta parada: ${lines}. Líneas de esta parada: ${available}.`,
    toDiscovery: 'Abra la pestaña Descubrir para crear su dispositivo.',
    removed: ({ name }) =>
      `${name} eliminada de la lista. Elimine su dispositivo en Gladys si lo necesita.`,
    networkRemoved: ({ name, count }) =>
      `${name} eliminada, con sus ${count} parada(s). Elimine sus dispositivos en Gladys si lo necesita.`,
    notWatched: ({ query }) =>
      `Nada de lo vigilado se llama «${query}» ni tiene este identificador.`,
    tooMany: ({ max }) => `La lista está llena (${max} paradas como máximo).`,
    watchedNetworks: ({ count }) => `Redes: ${count}`,
    watchedStops: ({ count }) => `Paradas vigiladas: ${count}`,
    timetable: ({ date, until }) =>
      `Horarios: descargados el ${date}, salidas conocidas hasta el ${until}.`,
    timetableMissing: 'Horarios: aún sin leer.',
    realtime: ({ age, tracked, volume }) =>
      `Tiempo real: actualizado hace ${age} s, ${tracked} trayecto(s) seguido(s), unos ${volume} MB por hora mientras haya salidas previstas.`,
    realtimeOff: 'Tiempo real: desactivado en la configuración (solo horarios teóricos).',
    realtimeWaiting: 'Tiempo real: aún sin leer.',
    siriShort: 'salidas parada por parada (SIRI)',
    networkSiri: ({ format }) => `Tiempo real: ${format}, consultado parada por parada.`,
    siriKeyHint:
      'Si la red pide una clave de API, escríbala en la configuración de la integración («Claves de API SIRI»).',
    siriRealtime: ({ format, age, tracked, requests }) =>
      `Tiempo real (${format}): actualizado hace ${age} s, ${tracked} salida(s) seguida(s), ${requests} petición(es) por actualización mientras haya salidas previstas.`,
    siriWaiting: ({ format }) => `Tiempo real (${format}): aún sin leer.`,
    siriKeyRefused:
      'Tiempo real (SIRI): el servidor ha rechazado el acceso. Compruebe la clave de API en la configuración («Claves de API SIRI»).',
    siriUnknownStops: ({ stops }) =>
      `Paradas desconocidas para el servidor SIRI: ${stops}. Indique su identificador SIRI con «Añadir una parada».`,
    siriRef: ({ refs }) => `Identificador SIRI: ${refs}.`,
    siriRefUnused: 'Esta red no se lee por SIRI: el identificador SIRI no se usa.',
    siriNoData:
      'Tiempo real (SIRI): el servidor responde, pero sin ninguna parada ni salida. Lo más probable es que pida una clave de API o rechace la indicada.',
    siriNoStopMonitoring:
      'Tiempo real (SIRI): este servidor no ofrece las próximas salidas por parada (StopMonitoring), solo otros servicios. Solo horarios teóricos.',
    lastError: ({ error }) => `Último error: ${error}`,
  },
};

/** One entry of a table, in one language (function entries rendered). */
export function say(table, language, key, params = {}) {
  const entries = table[language] ?? table.en;
  const entry = entries[key] ?? table.en[key];
  return typeof entry === 'function' ? entry(params) : entry;
}

/** One entry of a table, in every language. */
export function render(table, key, params = {}) {
  return Object.fromEntries(
    Object.keys(table).map((language) => [language, say(table, language, key, params)]),
  );
}

/** Joins rendered messages (or plain strings), language by language, one per line. */
export function lines(...messages) {
  const languages = Object.keys(messages.find((m) => typeof m === 'object') ?? { en: '' });
  return Object.fromEntries(
    languages.map((language) => [
      language,
      messages
        .filter((message) => message !== null && message !== undefined)
        .map((message) => (typeof message === 'string' ? message : message[language]))
        .join('\n'),
    ]),
  );
}
