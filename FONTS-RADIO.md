# Fonts de radio

Aquest document resumeix com s'alimenten les emissores de Radio Quexulo i quines vies hi ha per afegir-ne mes sense complicar massa el codi.

## Fonts actuals

Ara mateix el projecte ja integra aquestes fonts:

- Radio Browser
- IPRD
- CasterClub
- Cataleg propi local

La UI treballa amb una capa normalitzada comuna, de manera que totes acaben convertides al mateix format intern abans de renderitzar-les.

## 1. Cataleg propi local

El cataleg propi viu a:

```text
data/custom-stations.json
```

Es la font amb mes control. Serveix per:

- destacar emissores importants
- afegir radios que no apareixen a altres directoris
- corregir streams que fallen en altres fonts
- controlar millor logos, tags i prioritats

Forma base d'una emissora:

```json
{
  "id": "flaix-938",
  "name": "Flaix 93.8",
  "country": "Andorra",
  "city": "Andorra la Vella",
  "language": ["catalan"],
  "website": "https://www.flaixandorra.com/",
  "logo": "",
  "priority": 100,
  "tags": ["catala", "music", "pop", "hits"],
  "streams": [
    {
      "url": "https://example.com/stream.mp3",
      "codec": "MP3",
      "bitrate": 128,
      "priority": 100
    }
  ]
}
```

Notes d'implementacio:

- surt a la UI com a font `Quexulo`
- entra a `Totes`
- es comparteix igual que la resta amb `#/station/custom/{id}`

## 2. Radio Browser

Es la font principal per volum.

Base:

```text
https://de1.api.radio-browser.info
```

Endpoints principals:

- `/json/stations/search`
- `/json/countries`
- `/json/languages`
- `/json/codecs`
- `/json/url/{stationuuid}`

Avantatges:

- directori molt gran
- bon suport per pais, idioma i codec
- molt util per cerca general

Limitacions:

- qualitat irregular segons emissora
- metadades i logos no sempre fiables

## 3. IPRD

IPRD entra a partir del seu cataleg JSON:

```text
https://iprd-org.github.io/iprd/site_data/metadata/catalog.json
```

Avantatges:

- diverses emissores ben documentades
- pot aportar streams alternatius i fiabilitat

Limitacions:

- no es una API de cerca tan flexible com Radio Browser
- primer es descarrega el cataleg i despres es filtra al navegador

## 4. CasterClub

CasterClub ja esta integrat com a font externa.

No s'usa directament des del frontend. El servidor propi fa de traductor:

```text
/sources/casterclub
```

Aquest endpoint consulta:

```text
https://yp.casterclub.com/directory.php
```

I transforma les files HTML i atributs `data-stn-*` a JSON normalitzat per la UI.

Tambe hi ha endpoint de detall:

```text
/sources/casterclub/station?id=6161
```

Que consulta:

```text
https://yp.casterclub.com/station-detail.php?id=6161
```

Avantatges:

- afegeix emissores diferents de Radio Browser
- aporta `now playing` en alguns casos

Limitacions:

- depen d'una pagina HTML externa, no d'una API publica estable
- si CasterClub canvia el markup, cal ajustar el parser de `server.js`

## 5. Enriquiment de `Que sona?`

No es una font de radios, pero si una font de dades musicals complementaries.

El servidor ofereix:

```text
/song/search
```

Aquest endpoint consulta:

- iTunes Search API
- MusicBrainz

Serveix per enriquir el text de `StreamTitle` o `now playing` amb:

- artista
- titol
- album
- portada
- links externs

No fa reconeixement d'audio per fingerprint. Depen del text que publiqui la radio.

## Estrategia actual

La millor combinacio del projecte ara mateix es:

- Radio Browser per volum
- IPRD per complementar
- CasterClub per afegir cataleg extern extra
- `data/custom-stations.json` per control manual

Dit d'una altra manera:

- APIs grans per cobertura
- cataleg propi per qualitat

## Vies futures

### Directoris Icecast

Algunes radios Icecast publiquen directoris o pagines de llistat propies. Pot ser una bona via per descobrir emissores independents, pero caldria normalitzar camps i fiabilitat.

### Llistes M3U o PLS

Una altra opcio es acceptar fitxers `.m3u` o `.pls` i importar-los al format intern. Aixo encaixa be amb el cataleg propi o amb eines petites d'importacio al servidor.

### Fonts verificades manualment

La via mes robusta continua sent una capa curada propia. Si una emissora es important pel producte, val mes tenir-la a `data/custom-stations.json` que confiar sempre en directoris externs.

### Reconeixement d'audio real

Si algun dia cal anar mes enllac de `Que sona?`, es podria afegir una capa de pagament tipus AudD o ACRCloud. Ara mateix no esta integrada, i la decisio actual del projecte es exhaurir primer tot el que es gratuit i basat en metadades.
