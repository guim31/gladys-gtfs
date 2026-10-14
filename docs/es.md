# Transporte público (GTFS)

Las **próximas salidas en sus paradas** y las **incidencias** de sus líneas,
para **cualquier red de transporte francesa** que publique sus horarios en
GTFS en [transport.data.gouv.fr](https://transport.data.gouv.fr): TER y TGV
(SNCF), Naolib (Nantes), STAR (Rennes), TaM (Montpellier), M (Grenoble),
Ilévia (Lille), Stan (Nancy) y cientos más. El tiempo real (GTFS-RT) se usa
cuando la red lo publica, unos 220 conjuntos de datos. Todo procede de datos
abiertos: **sin cuenta ni clave de API**.

Para **Toulouse, Lyon, Île-de-France o Burdeos**, es preferible usar las
integraciones específicas (Tisséo, TCL, IDFM, TBM): llegan más lejos
(bicicletas, metro en tiempo real…). De todos modos, Île-de-France es
demasiado grande para esta integración.

Esta integración es un proyecto comunitario, sin relación con
transport.data.gouv.fr, la SNCF ni ninguna red de transporte.

## Lo que obtiene

- **Un dispositivo por parada vigilada**: para cada línea y dirección, los
  minutos hasta la **próxima salida** y hasta la **siguiente**; las tres
  salidas más próximas en texto; la **info de tráfico** de sus líneas.
- **Widget «Próximas salidas»**: el panel de una parada, las salidas seguidas
  en tiempo real en verde, los horarios teóricos marcados con «≈».
- **Disparador de escena «Incidencia en una línea seguida»**: un nuevo aviso
  de tráfico en una línea de sus paradas, o en toda la red.
- **Acción de escena «Leer las próximas salidas»**, con una frase lista para
  enviar («Tranvía 1 hacia François Mitterrand en Commerce: dentro de 3 y
  7 min»).
- Hasta **3 redes** y **20 paradas** (por ejemplo, la red urbana de su ciudad
  y la SNCF para la estación).

**¿Tiempo real o teórico?** Cuando la red publica un flujo GTFS-RT
«TripUpdates», las salidas se corrigen (retrasos, supresiones, paradas no
servidas) y se muestran sin «≈». Si no, o para los vehículos no seguidos, son
los horarios previstos, marcados con «≈» o «horario teórico». La búsqueda de
red indica lo que publica cada una.

## Requisitos

- Gladys 5.1 o posterior, con acceso a Internet.
- Para listar las paradas **alrededor de su casa**: la posición de su casa en
  Gladys (**Configuración → Viviendas**). La integración la solicita al
  instalarse (`location`): lee las coordenadas de sus viviendas, nada más, y
  solo para ordenar las paradas por distancia. Sin ella, busque por nombre.
- De **1 a 80 MB** de disco en `/data` por red (el archivo de horarios,
  actualizado una vez al día): 6 MB para la SNCF, 26 MB para Naolib.

## Instalación

1. En Gladys, vaya a **Integraciones → Instalar desde GitHub** e introduzca
   `https://github.com/guim31/gladys-gtfs`.
2. Abra la pestaña **Configuración** de la integración y elija el idioma de
   los textos (francés por defecto).
3. Añada su red y luego sus paradas con las acciones de la misma pantalla
   (abajo), y cree sus dispositivos en la pestaña **Descubrir**.

## Configuración

### Ajustes

- **Idioma de los textos**: nombres de las funciones, nombres de las líneas,
  frases de las escenas. Los nombres se fijan al crear el dispositivo: cambie
  primero el idioma y cree después los dispositivos.
- **Frecuencia de actualización**: 30 segundos, 1 minuto (por defecto), 2 o
  5 minutos.
- **Tiempo real**: activado por defecto. Desactivado, la integración solo usa
  los horarios teóricos y deja de descargar los flujos en tiempo real.

### Añadir una red

1. **Buscar una red**: un nombre de red, una ciudad o una región («Naolib»,
   «Rennes», «TER»…). Cada resultado da su nombre, su identificador y el
   tiempo real publicado, por ejemplo
   `• Naolib [tdg84101] — … — tiempo real : salidas`. Algunas redes publican
   dos archivos (horarios en vigor y futuros): elija el que está en vigor.
2. **Añadir una red**: su identificador (`tdg…`), o su nombre si es único. La
   integración descarga sus horarios y los lee: hasta un minuto para una red
   grande.

**Una red fuera del catálogo**: indique la dirección de su archivo GTFS
(`https://….zip`) en **Identificador, nombre o URL GTFS** y, si las conoce,
las direcciones de sus flujos GTFS-RT en **URL GTFS-RT**. **Nombre mostrado**
sustituye el nombre que se pone delante del de las paradas.

### Añadir una parada

1. **Buscar una parada**: escriba un nombre («hotel dieu» encuentra «Hôtel
   Dieu», los acentos y las mayúsculas no importan), o déjelo vacío para
   listar las 10 paradas más cercanas a su casa. Cada resultado da sus líneas,
   su distancia y su identificador entre corchetes, por ejemplo
   `• Commerce [20] — 1, 2, 3, C2, C3 — 90 m`. Con varias redes, el campo
   **Red** restringe la búsqueda.
2. **Añadir una parada**: su nombre, o su identificador si varias paradas
   tienen el mismo nombre. **Líneas** es opcional: «1, C2» conserva solo esas
   dos líneas; vacío, todas las líneas. Una gran estación tiene decenas de líneas: elija las suyas (un dispositivo conserva como máximo 12 líneas y direcciones).
3. Abra la pestaña **Descubrir** y cree el dispositivo.

Añadir una parada ya vigilada cambia sus líneas: Gladys propone entonces
**actualizar** el dispositivo en la pestaña Descubrir.

### Eliminar, comprobar los flujos

- **Eliminar una parada o una red**: su nombre o su identificador. Eliminar
  una red elimina también sus paradas y borra sus horarios. Los dispositivos
  permanecen en Gladys hasta que los elimine.
- **Mostrar lo vigilado**: para cada red, la fecha de los horarios, la antigüedad de los
  datos en tiempo real, el número de trayectos seguidos, el **volumen
  descargado por hora**, las paradas vigiladas y el último error, si lo hay.

## Dispositivos

### Parada

Para cada línea y dirección servida (o las líneas elegidas):

| Función                                     | Tipo           | Valor                           |
| ------------------------------------------- | -------------- | ------------------------------- |
| Tranvía 1 → François Mitterrand             | duración (min) | minutos hasta la próxima salida |
| Tranvía 1 → François Mitterrand (siguiente) | duración (min) | minutos hasta la siguiente      |

Y dos textos para toda la parada:

- **Próximas salidas**: las tres más próximas, p. ej.
  `1 → Jamet 2 min · C2 → Gare Sud ≈4 min` («≈» = teórico).
- **Info de tráfico**: los títulos de las incidencias en curso en sus líneas,
  o «Sin incidencias».

`0` significa que el vehículo está en la parada o llegando (menos de un
minuto); **1440** significa ninguna salida en las próximas 24 horas (noche,
línea que no circula ese día). Estos valores no guardan historial: una cuenta
atrás releída cada minuto llenaría la base de datos para nada.

El nombre del dispositivo empieza por el nombre de la red («Naolib ·
Commerce»). La dirección de un tren es su estación terminal: la SNCF pone ahí
el número del tren, la integración lo sustituye.

## Widget del panel

**Próximas salidas**: elija una parada. Una fila por línea y dirección (diez
como máximo, primero las que tienen una salida): «3 · 7 min» en verde cuando
es tiempo real, «≈ 3 · 7 min» en azul para el horario teórico. La leyenda
enumera las incidencias de sus líneas (⚠), o recuerda el significado de «≈».

## Disparador de escena

**Incidencia en una línea seguida**: aparece un nuevo aviso de tráfico en una
línea de sus paradas vigiladas (el filtro de líneas de una parada lo
restringe), o en toda la red (huelga, cierres). Filtros: **alcance** (una
línea seguida, toda la red, o vacío para ambos) y **línea** (tal como la
escribe la red: A, C1, 15). Variables: alcance, red, línea, título, detalles
(texto plano), enlace. Un aviso se anuncia una vez; los que ya existen cuando
añade una parada no se anuncian. Requiere una red que publique sus avisos en
GTFS-RT («avisos» en la búsqueda de red).

Para «el próximo autobús llega en menos de 5 minutos», use el disparador
«Cambio de estado del dispositivo» de Gladys sobre la cuenta atrás de la
parada: ya sabe comparar valores.

## Acción de escena

**Leer las próximas salidas**: una parada vigilada y, opcionalmente, una
línea. Salidas: **frase** (hasta cuatro líneas y direcciones, primero las más
próximas), parada, línea y dirección de la próxima salida, minutos de espera,
minutos hasta la siguiente, tiempo real (1) o teórico (0), número de líneas
con una salida. Las frases siguen el idioma de la configuración.

## Ejemplos de escenas

- **Es la hora**: a las 7:45 los días laborables, «Leer las próximas
  salidas» en su parada para la línea C2, y luego envíe `{{sentence}}` por
  Telegram o anúnciela en un altavoz.
- **Mi TER tiene una incidencia**: disparador «Incidencia en una línea
  seguida», alcance «una línea seguida», en la estación añadida con su línea
  TER: envíe el título y los detalles a su teléfono.
- **Salir cuando llega el autobús**: disparador «Cambio de estado del
  dispositivo», cuenta atrás de su autobús inferior a 4, condición «alguien en
  casa» y antes de las 8:30: haga parpadear la luz de la entrada.

## Datos, actualización y ancho de banda

| Datos                 | Fuente                                     | Cuándo                                                 |
| --------------------- | ------------------------------------------ | ------------------------------------------------------ |
| Catálogo de redes     | transport.data.gouv.fr (API pública)       | al buscar o añadir una red, guardado un día            |
| Horarios (GTFS)       | la red, a través de transport.data.gouv.fr | una vez al día como máximo, guardados en `/data`       |
| Tiempo real (GTFS-RT) | la red, o el proxy del catálogo            | en cada actualización, cada 15 min cuando nada circula |

El tiempo real es lo más pesado: de unos kB a 2 MB por flujo y por lectura. A
una lectura por minuto, Tisséo supone unos 100 MB por hora y la SNCF unos
90 MB por hora, durante las horas de servicio; la acción **Mostrar lo vigilado** muestra
el volumen de sus redes. De noche, sin salidas en los próximos 90 minutos en
sus paradas, los flujos solo se leen cada 15 minutos, y una red sin parada
vigilada nunca se lee. Elija 2 o 5 minutos, o desactive el tiempo real, con
una conexión limitada. El catálogo y los flujos abiertos no imponen cuota; el proxy de transport.data.gouv.fr solo acepta una lectura por flujo cada 30 segundos, y la integración lo respeta.

**Licencias**: los horarios se publican bajo la Licence Ouverte (Etalab) o la
ODbL según la red; al añadir una red se muestra la suya, y
transport.data.gouv.fr la indica en la página de cada conjunto de datos.

## Solución de problemas

- **«… son demasiado grandes para los 256 MB de la integración»**: la red
  supera lo que el contenedor de Gladys puede leer (Île-de-France, más de
  400 000 trayectos por semana, archivo de más de 80 MB). Use la integración
  específica, o un conjunto de datos más pequeño de la misma red.
- **«Varios resultados»**: añada la parada por su identificador, que da
  «Buscar una parada», o indique la **Red**.
- **Todos los horarios de una parada aparecen con ≈**: la red no publica
  tiempo real, o no para esos vehículos, o el flujo está caído (la acción
  «Mostrar lo vigilado» da el último error). Los horarios teóricos siguen funcionando.
- **Una línea muestra 1440**: ninguna salida en las próximas 24 horas
  (servicio nocturno, línea que no circula ese día, desvío).
- **Ningún dispositivo en la pestaña Descubrir**: añada primero una red y
  luego una parada.
- **La red ha cambiado de dirección** (error HTTP 404 en «Mostrar lo vigilado»): elimine
  la red y vuelva a añadirla desde la búsqueda.
- **Registros**: en Gladys, los registros de la integración indican qué flujo
  ha fallado y por qué (nunca la dirección completa, que puede contener una
  clave).

## Limitaciones

- Redes que publican un GTFS: la mayoría de las redes francesas, pero no
  todas; tres redes y veinte paradas como máximo.
- **Demasiado grandes**: Île-de-France (IDFM); los agregados regionales más
  pesados también pueden rechazarse.
- El tiempo real depende de la red: algunas solo publican avisos, o solo
  siguen una parte de sus vehículos.
- Los nombres de líneas y direcciones son los del archivo de la red (códigos
  de línea SNCF como «P2» o «C30», por ejemplo).
- Una cuenta atrás es tan precisa como la frecuencia de actualización.
- Desarrollada y probada con los datos reales (SNCF, Naolib, Tisséo,
  Aix-Marseille) y el Gladys simulado del SDK, sin una instancia real de
  Gladys: sus comentarios son bienvenidos en el foro.

## Créditos

- Datos: las redes de transporte, a través de
  [transport.data.gouv.fr](https://transport.data.gouv.fr) (Licence Ouverte u
  ODbL según el conjunto de datos).
- Retoma el código de la integración **Tisséo** del mismo autor; inspirada en
  la integración **TCL** de prohand y en las integraciones GTFS de Home
  Assistant.
- Código bajo licencia Apache 2.0.
