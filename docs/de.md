# Öffentlicher Nahverkehr (GTFS)

Die **nächsten Abfahrten an deinen Haltestellen** und die **Störungen** ihrer
Linien, für **jedes französische Nahverkehrsnetz**, das seinen Fahrplan als
GTFS auf [transport.data.gouv.fr](https://transport.data.gouv.fr)
veröffentlicht: TER und TGV (SNCF), Naolib (Nantes), STAR (Rennes), TaM
(Montpellier), M (Grenoble), Ilévia (Lille), Stan (Nancy) und Hunderte
weitere. Echtzeit (GTFS-RT) wird genutzt, wenn das Netz sie veröffentlicht,
bei etwa 220 Datensätzen. Alles stammt aus offenen Daten: **kein Konto, kein
API-Schlüssel**.

Für **Toulouse, Lyon, die Île-de-France oder Bordeaux** nimm lieber die
eigenen Integrationen (Tisséo, TCL, IDFM, TBM), die mehr bieten (Leihräder,
Metro in Echtzeit…). Die Île-de-France ist für diese Integration ohnehin zu
groß.

Diese Integration ist ein Community-Projekt, ohne Verbindung zu
transport.data.gouv.fr, zur SNCF oder zu einem Verkehrsnetz.

## Was du bekommst

- **Ein Gerät pro überwachter Haltestelle**: für jede Linie und Richtung die
  Minuten bis zur **nächsten Abfahrt** und bis zur **danach**; die drei
  nächsten Abfahrten als Text; die **Verkehrsinfo** ihrer Linien.
- **Widget „Nächste Abfahrten“**: die Abfahrtstafel einer Haltestelle,
  Echtzeit-Abfahrten in Grün, Fahrplanzeiten mit „≈“ markiert.
- **Szenen-Auslöser „Störung auf einer verfolgten Linie“**: eine neue
  Verkehrsmeldung auf einer Linie deiner Haltestellen oder im ganzen Netz.
- **Szenen-Aktion „Nächste Abfahrten lesen“** mit einem fertigen Satz („Tram 1
  Richtung François Mitterrand ab Commerce: in 3 und 7 Min.“).
- Bis zu **3 Netze** und **20 Haltestellen** (zum Beispiel das Stadtnetz und
  die SNCF für den Bahnhof).

**Echtzeit oder Fahrplan?** Wenn das Netz einen GTFS-RT-Feed „TripUpdates“
veröffentlicht, werden die Abfahrten korrigiert (Verspätungen, Ausfälle,
ausgelassene Halte) und ohne „≈“ angezeigt. Sonst, oder für nicht verfolgte
Fahrzeuge, sind es die geplanten Zeiten, markiert mit „≈“ oder „laut
Fahrplan“. Die Netzsuche zeigt, was jedes Netz veröffentlicht.

## Voraussetzungen

- Gladys 5.1 oder neuer, mit Internetzugang.
- Um die Haltestellen **rund um dein Zuhause** aufzulisten: die Position
  deines Zuhauses in Gladys (**Einstellungen → Zuhause**). Die Integration
  fragt bei der Installation danach (`location`) und liest dabei die Koordinaten
  deiner Häuser, sonst nichts, und nur, um die Haltestellen nach Entfernung zu
  sortieren. Ohne sie suchst du nach Namen.
- **1 bis 80 MB** Speicher unter `/data` pro Netz (das Fahrplanarchiv,
  einmal täglich aktualisiert): 6 MB für die SNCF, 26 MB für Naolib.

## Installation

1. Gehe in Gladys zu **Integrationen → Von GitHub installieren** und gib
   `https://github.com/guim31/gladys-gtfs` ein.
2. Öffne den Tab **Konfiguration** der Integration und wähle die Sprache der
   Texte (standardmäßig Französisch).
3. Füge mit den Aktionen desselben Bildschirms (siehe unten) dein Netz und
   dann deine Haltestellen hinzu, und lege ihre Geräte im Tab **Entdecken**
   an.

## Konfiguration

### Einstellungen

- **Sprache der Texte**: Funktionsnamen, Liniennamen, Sätze der Szenen. Die
  Namen werden beim Anlegen des Geräts festgelegt: Ändere zuerst die Sprache,
  lege danach die Geräte an.
- **Aktualisierungsintervall**: 30 Sekunden, 1 Minute (Standard), 2 oder
  5 Minuten.
- **Echtzeit**: standardmäßig an. Aus nutzt die Integration nur den Fahrplan
  und lädt keine Echtzeit-Feeds mehr herunter.

### Netz hinzufügen

1. **Netz suchen**: ein Netzname, eine Stadt oder eine Region („Naolib“,
   „Rennes“, „TER“…). Jedes Ergebnis zeigt Namen, Kennung und die
   veröffentlichte Echtzeit, zum Beispiel
   `• Naolib [tdg84101] — … — Echtzeit : Abfahrten`. Manche Netze
   veröffentlichen zwei Dateien (aktueller und kommender Fahrplan): Nimm die
   aktuelle.
2. **Netz hinzufügen**: seine Kennung (`tdg…`) oder seinen Namen, wenn er
   eindeutig ist. Die Integration lädt den Fahrplan herunter und liest ihn:
   bis zu einer Minute bei einem großen Netz.

**Ein Netz außerhalb des Katalogs**: Gib die Adresse seiner GTFS-Datei
(`https://….zip`) in **Kennung, Name oder GTFS-URL** an und, wenn du sie
kennst, die Adressen seiner GTFS-RT-Feeds in **GTFS-RT-URLs**. **Angezeigter
Name** ersetzt den Namen vor den Haltestellennamen.

### Haltestelle hinzufügen

1. **Haltestelle suchen**: Gib einen Namen ein („hotel dieu“ findet „Hôtel
   Dieu“, Akzente und Groß-/Kleinschreibung spielen keine Rolle) oder lass das
   Feld leer, um die 10 Haltestellen nahe deinem Zuhause aufzulisten. Jedes
   Ergebnis zeigt Linien, Entfernung und Kennung in Klammern, zum Beispiel
   `• Commerce [20] — 1, 2, 3, C2, C3 — 90 m`. Bei mehreren Netzen schränkt
   das Feld **Netz** die Suche ein.
2. **Haltestelle hinzufügen**: ihren Namen oder ihre Kennung, wenn mehrere
   Haltestellen gleich heißen. **Linien** ist optional: „1, C2“ behält nur
   diese beiden Linien; leer alle Linien. Ein großer Bahnhof hat Dutzende Linien: Wähle deine aus (ein Gerät behält höchstens 12 Linien und Richtungen).
3. Öffne den Tab **Entdecken** und lege das Gerät an.

Eine bereits überwachte Haltestelle erneut hinzuzufügen ändert ihre Linien:
Gladys bietet dann im Tab „Entdecken“ an, das Gerät zu **aktualisieren**.

### Entfernen, Feeds prüfen

- **Haltestelle oder Netz entfernen**: Name oder Kennung. Ein Netz zu
  entfernen entfernt auch seine Haltestellen und löscht seinen Fahrplan. Die
  Geräte bleiben in Gladys, bis du sie löschst.
- **Überwachung anzeigen**: für jedes Netz das Datum des Fahrplans, das Alter der
  Echtzeitdaten, die Zahl der verfolgten Fahrten, das **pro Stunde
  heruntergeladene Volumen**, die überwachten Haltestellen und der letzte
  Fehler, falls vorhanden.

## Geräte

### Haltestelle

Für jede bediente Linie und Richtung (oder die gewählten Linien):

| Funktion                              | Typ          | Wert                             |
| ------------------------------------- | ------------ | -------------------------------- |
| Tram 1 → François Mitterrand          | Dauer (Min.) | Minuten bis zur nächsten Abfahrt |
| Tram 1 → François Mitterrand (danach) | Dauer (Min.) | Minuten bis zur Abfahrt danach   |

Und zwei Texte für die ganze Haltestelle:

- **Nächste Abfahrten**: die drei nächsten, z. B.
  `1 → Jamet 2 min · C2 → Gare Sud ≈4 min` („≈“ = laut Fahrplan).
- **Verkehrsinfo**: die Titel der aktuellen Störungen auf ihren Linien, oder
  „Keine Störung“.

`0` bedeutet, dass das Fahrzeug an der Haltestelle ist oder gleich kommt
(weniger als eine Minute); **1440** bedeutet keine Abfahrt in den nächsten
24 Stunden (Nacht, eine Linie, die an diesem Tag nicht fährt). Diese Werte
haben keinen Verlauf: Ein jede Minute neu gelesener Countdown würde die
Datenbank umsonst füllen.

Der Gerätename beginnt mit dem Netznamen („Naolib · Commerce“). Die Richtung
eines Zuges ist sein Endbahnhof: Die SNCF trägt dort die Zugnummer ein, die
Integration ersetzt sie.

## Dashboard-Widget

**Nächste Abfahrten**: Wähle eine Haltestelle. Eine Zeile pro Linie und
Richtung (höchstens zehn, die mit Abfahrt zuerst): „3 · 7 min“ in Grün bei
Echtzeit, „≈ 3 · 7 min“ in Blau für den Fahrplan. Die Bildunterschrift listet
die Störungen ihrer Linien (⚠) oder erklärt, was „≈“ bedeutet.

## Szenen-Auslöser

**Störung auf einer verfolgten Linie**: Eine neue Verkehrsmeldung erscheint
auf einer Linie deiner überwachten Haltestellen (der Linienfilter einer
Haltestelle schränkt sie ein) oder im ganzen Netz (Streik, Schließungen).
Filter: **Umfang** (eine verfolgte Linie, das ganze Netz oder leer für
beides) und **Linie** (wie vom Netz geschrieben: A, C1, 15). Variablen:
Umfang, Netz, Linie, Titel, Details (reiner Text), Link. Eine Meldung wird
einmal angekündigt; die, die beim Hinzufügen einer Haltestelle schon da sind,
nicht. Dein Netz muss seine Meldungen als GTFS-RT veröffentlichen
(„Meldungen“ in der Netzsuche).

Für „der nächste Bus kommt in weniger als 5 Minuten“ nutze den
Gladys-Auslöser „Gerätezustand ändert sich“ auf dem Countdown der
Haltestelle: Er vergleicht Werte schon.

## Szenen-Aktion

**Nächste Abfahrten lesen**: eine überwachte Haltestelle und optional eine
Linie. Ausgaben: **Satz** (bis zu vier Linien und Richtungen, die nächsten
zuerst), Haltestelle, Linie und Richtung der nächsten Abfahrt, Minuten
Wartezeit, Minuten bis zur nächsten, Echtzeit (1) oder Fahrplan (0), Zahl der
Linien mit Abfahrt. Die Sätze folgen der Sprache der Konfiguration.

## Szenenbeispiele

- **Zeit zu gehen**: werktags um 7:45 „Nächste Abfahrten lesen“ an deiner
  Haltestelle für die Linie C2, dann `{{sentence}}` per Telegram senden oder
  auf einem Lautsprecher ansagen.
- **Mein TER hat eine Störung**: Auslöser „Störung auf einer verfolgten
  Linie“, Umfang „eine verfolgte Linie“, am Bahnhof mit deiner TER-Linie:
  Titel und Details aufs Handy schicken.
- **Losgehen, wenn der Bus kommt**: Auslöser „Gerätezustand ändert sich“,
  Countdown deines Busses unter 4, Bedingung „jemand zu Hause“ und vor 8:30:
  das Licht im Flur blinken lassen.

## Daten, Aktualisierung und Bandbreite

| Daten              | Quelle                                   | Wann                                                         |
| ------------------ | ---------------------------------------- | ------------------------------------------------------------ |
| Katalog der Netze  | transport.data.gouv.fr (öffentliche API) | beim Suchen oder Hinzufügen eines Netzes, einen Tag behalten |
| Fahrplan (GTFS)    | das Netz, über transport.data.gouv.fr    | höchstens einmal täglich, in `/data` gespeichert             |
| Echtzeit (GTFS-RT) | das Netz oder der Proxy des Katalogs     | bei jeder Aktualisierung, alle 15 Min., wenn nichts fährt    |

Echtzeit ist am schwersten: von wenigen kB bis 2 MB pro Feed und Abruf. Bei
einem Abruf pro Minute sind es für Tisséo etwa 100 MB pro Stunde und für die
SNCF etwa 90 MB pro Stunde während der Betriebszeiten; die Aktion **Überwachung anzeigen**
zeigt das Volumen deiner Netze. Nachts, ohne Abfahrt innerhalb von
90 Minuten an deinen Haltestellen, werden die Feeds nur alle 15 Minuten
gelesen, und ein Netz ohne überwachte Haltestelle wird nie gelesen. Wähle bei
einer begrenzten Verbindung 2 oder 5 Minuten oder schalte Echtzeit aus. Der
Katalog und die offenen Feeds haben kein Kontingent; der Proxy von transport.data.gouv.fr erlaubt einen Abruf pro Feed alle 30 Sekunden, und die Integration hält sich daran.

**Lizenzen**: Die Fahrpläne stehen je nach Netz unter der Licence Ouverte
(Etalab) oder der ODbL; beim Hinzufügen eines Netzes wird seine Lizenz
angezeigt, und transport.data.gouv.fr nennt sie auf der Seite jedes
Datensatzes.

## Fehlerbehebung

- **„… ist zu groß für die 256 MB der Integration“**: Das Netz übersteigt,
  was der Gladys-Container lesen kann (Île-de-France, mehr als
  400.000 Fahrten pro Woche, Archiv über 80 MB). Nutze die eigene
  Integration oder einen kleineren Datensatz desselben Netzes.
- **„Mehrere Treffer“**: Füge die Haltestelle über ihre Kennung hinzu, die
  „Haltestelle suchen“ anzeigt, oder gib das **Netz** an.
- **Alle Zeiten einer Haltestelle sind mit ≈ markiert**: Das Netz
  veröffentlicht keine Echtzeit, oder nicht für diese Fahrzeuge, oder der Feed
  ist ausgefallen (die Aktion „Überwachung anzeigen“ zeigt den letzten Fehler). Der
  Fahrplan funktioniert weiter.
- **Eine Linie zeigt 1440**: keine Abfahrt in den nächsten 24 Stunden
  (Nachtverkehr, eine Linie, die an diesem Tag nicht fährt, eine Umleitung).
- **Kein Gerät im Tab „Entdecken“**: Füge zuerst ein Netz hinzu, dann eine
  Haltestelle.
- **Das Netz hat seine Adresse geändert** (HTTP-Fehler 404 in „Überwachung anzeigen“):
  Entferne das Netz und füge es über die Suche erneut hinzu.
- **Protokolle**: In Gladys sagen die Protokolle der Integration, welcher Feed
  ausgefallen ist und warum (nie die vollständige Adresse, die einen
  Schlüssel enthalten kann).

## Einschränkungen

- Netze, die ein GTFS veröffentlichen: die meisten französischen Netze, aber
  nicht alle; höchstens drei Netze und zwanzig Haltestellen.
- **Zu groß**: die Île-de-France (IDFM); die schwersten regionalen
  Zusammenfassungen können ebenfalls abgelehnt werden.
- Die Echtzeit hängt vom Netz ab: Manche veröffentlichen nur Meldungen oder
  verfolgen nur einen Teil ihrer Fahrzeuge.
- Linien- und Richtungsnamen sind die aus der Datei des Netzes (zum Beispiel
  SNCF-Liniencodes wie „P2“ oder „C30“).
- Ein Countdown ist so genau wie das Aktualisierungsintervall.
- Entwickelt und getestet mit den echten Daten (SNCF, Naolib, Tisséo,
  Aix-Marseille) und dem simulierten Gladys des SDK, ohne echte
  Gladys-Instanz: Rückmeldungen im Forum sind willkommen.

## Danksagung

- Daten: die Verkehrsnetze, über
  [transport.data.gouv.fr](https://transport.data.gouv.fr) (Licence Ouverte
  oder ODbL je nach Datensatz).
- Übernimmt den Code der **Tisséo**-Integration desselben Autors; inspiriert
  von der **TCL**-Integration von prohand und den GTFS-Integrationen von Home
  Assistant.
- Code unter der Apache-2.0-Lizenz.
