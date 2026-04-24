# Radio Quexulo

Directori web de radios en directe construit amb HTML, CSS i JavaScript vanilla.

L'app barreja diverses fonts de radios, permet escoltar-les des del navegador, guardar favorits, compartir emissores, obrir un mode TV i mostrar metadades del que esta sonant quan el stream les publica.

## Quines fonts fa servir

- Radio Browser: `https://de1.api.radio-browser.info`
- IPRD: `https://iprd-org.github.io/iprd/site_data/metadata/catalog.json`
- CasterClub: integrat a traves del servidor local amb `/sources/casterclub`
- Cataleg propi: `data/custom-stations.json`

Quan la font seleccionada es `Totes`, l'app barreja resultats de totes les fonts i elimina duplicats simples per URL del stream i per nom + pais.

## Funcionalitats

- Cerca per nom, ciutat, estil o text relacionat.
- Filtres per pais, idioma, codec, font i ordre.
- Filtres de qualitat: nomes HTTPS, amagar HLS, amb logo i bitrate minim.
- Presets rapids: `Totes`, `Favorites`, `Recents`, `Catala`, `Musica`, `Noticies` i `Aleatoria`.
- Cards d'emissora amb logo, nom, ubicacio, tags clicables i accions.
- Favorits persistents amb `localStorage`.
- Historial de recents amb `localStorage`.
- Reproductor fix a la part inferior.
- Reintent automatic amb un altre stream quan una emissora en te mes d'un.
- Visualitzador amb boto d'ull, pantalla completa i una ona reactiva.
- Mode TV compartible amb logo, rellotge, visualitzador gran i URL propia.
- Modal de detall amb dades de l'emissora, web oficial, stream i boto de compartir.
- Enllacos compartibles amb format `#/station/{font}/{id}`.
- Metadades ICY opcionals per mostrar `Ara sona`.
- Boto flotant `Que sona?` que intenta enriquir el tema actual amb serveis gratuits.
- Favicon local servit des del projecte.

## Estructura del projecte

```text
index.html
styles.css
app.js
server.js
favicon.svg
data/custom-stations.json
FONTS-RADIO.md
package.json
```

Que fa cada fitxer principal:

- `index.html`: estructura de la pagina.
- `styles.css`: estils responsive de la UI.
- `app.js`: logica de fonts, filtres, reproductor, favorits, compartir, mode TV i visualitzador.
- `server.js`: servidor HTTP local amb proxy de streams, metadades ICY i integracions auxiliars.
- `data/custom-stations.json`: cataleg propi editable.

## Com executar-ho

No cal `build` ni dependencies externes.

Script disponible:

```bash
npm start
```

Aixo arrenca:

```bash
node server.js
```

Per defecte escolta a:

```text
http://localhost:8000
```

Tambe pots definir un port manualment:

```bash
PORT=8010 npm start
```

## Per que cal `server.js`

L'app funciona molt millor servida des de `server.js` que obrint nomes l'HTML.

Aquest servidor fa aquestes feines importants:

- `/stream`
  Fa de proxy del stream per evitar problemes de CORS i permetre analitzar l'audio amb Web Audio.

- `/metadata`
  Llegeix metadades ICY (`StreamTitle`) quan l'emissora les publica.

- `/sources/casterclub`
  Converteix el directori HTML de CasterClub a JSON usable per la UI.

- `/sources/casterclub/station`
  Recupera el detall d'una emissora de CasterClub per compartir-la o obrir-la directament.

- `/song/search`
  Fa cerques gratuites a iTunes Search i MusicBrainz per enriquir el text de `Ara sona`.

- `/favicon.ico`
  Serveix el `favicon.svg` com a fallback per navegadors que demanen l'ICO classic.

## Obrir nomes `index.html`

Es pot obrir directament al navegador, pero hi ha limitacions:

- alguns streams no es reproduiran be per CORS
- el visualitzador no seguira l'audio real en molts casos
- no tindras proxy del stream
- no tindras `/metadata`, `/sources/casterclub` ni `/song/search`

Per tant, la manera recomanada es sempre `npm start`.

## Fonts i normalitzacio

### Radio Browser

S'utilitzen principalment aquests endpoints:

- `/json/stations/search`
- `/json/countries`
- `/json/languages`
- `/json/codecs`
- `/json/url/{stationuuid}`

Radio Browser es carrega per pagines amb `limit` i `offset`.

### IPRD

IPRD es descarrega com a cataleg JSON i despres es filtra i pagina al navegador.

### CasterClub

CasterClub no s'usa directament des del frontend. El servidor consulta:

- `https://yp.casterclub.com/directory.php`
- `https://yp.casterclub.com/station-detail.php?id=...`

Despres transforma aquestes dades a un format intern compatible amb la resta de fonts.

### Cataleg propi

Les emissores propies viuen a:

```text
data/custom-stations.json
```

Serveix per:

- destacar emissores concretes
- afegir radios que no surten a altres directoris
- controlar millor logos, tags i streams

## Compartir emissores

Cada emissora pot tenir una URL compartible:

```text
#/station/{font}/{id}
```

Exemples de fonts:

- `radio-browser`
- `iprd`
- `custom`
- `casterclub`

Tambe existeix el mode TV:

```text
?view=tv#/station/{font}/{id}
```

## `Que sona?`

La funcio `Que sona?` no fa fingerprint d'audio.

El que fa ara es:

1. Llegir `StreamTitle` o text de `now playing` si existeix.
2. Intentar separar artista i canco.
3. Consultar serveis gratuits sense clau.

Fonts d'enriquiment actuals:

- iTunes Search API
- MusicBrainz

Serveix per mostrar:

- artista
- titol
- album
- portada si existeix
- enllacos externs

## Desplegament a Plesk

Punts importants:

- la web ha d'executar `server.js`
- el proxy `/stream` depen del servidor
- el mode `Que sona?` i CasterClub tambe depenen del servidor

## Limitacions conegudes

- Alguns streams fallen per origen, format o restriccions del mateix proveidor.
- Si una emissora usa HTTP i la web esta en HTTPS, pot haver-hi bloqueig de contingut mixt.
- No totes les radios publiquen metadades ICY.
- `Que sona?` depen del text publicat per la radio; si la radio no publica res util, no pot deduir la canco.
- Alguns navegadors poden bloquejar l'inici automatic de reproduccio fins que l'usuari interactua.

## Fitxers relacionats

- `FONTS-RADIO.md`: notes sobre com ampliar fonts de radio.

## Cosese a afegir

- Equalitzador per poder filtrar bé 