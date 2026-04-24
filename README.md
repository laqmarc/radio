# Radio Atlas

Web estatica per explorar emissores de radio de [Radio Browser](https://www.radio-browser.info/) i [IPRD](https://iprd-org.github.io/iprd/api/) i escoltar-les directament des del navegador.

## Funcionalitats

- Cerca d'emissores per nom.
- Filtres per pais, idioma i codec.
- Selector de font: totes, Radio Browser o IPRD.
- Ordenacio per popularitat, vots, nom o actualitzacio.
- Presets rapids: totes, favorites, catala, musica i noticies.
- Reproductor d'audio fix a la part inferior.
- Estat de reproduccio: connectant, reproduint i error.
- Reintent automatic amb un altre stream quan IPRD en te mes d'un.
- Modal de detall amb font, web oficial, tags, metadades i URL del stream.
- Favorits persistents amb `localStorage`.
- Historial de les ultimes emissores escoltades amb el preset `Recents`.
- Paginacio amb boto `Carrega mes`.
- Filtre `hidebroken=true` per evitar emissores marcades com trencades.

## Fitxers

```text
index.html   Estructura de la pagina
styles.css   Estils responsive
app.js       Connexio amb l'API, filtres, favorits i reproductor
```

## Com executar-ho

No cal instal-lar dependecies ni fer build.

Obre `index.html` directament al navegador.

Si algun navegador bloqueja peticions o audio obrint el fitxer localment, pots servir la carpeta amb un servidor simple:

```bash
python -m http.server 8000
```

I obrir:

```text
http://localhost:8000
```

## APIs

L'app consulta aquest servidor de Radio Browser:

```text
https://de1.api.radio-browser.info
```

Endpoints principals:

- `/json/stations/search`
- `/json/countries`
- `/json/languages`
- `/json/codecs`
- `/json/url/{stationuuid}` per comptar clics quan es reprodueix una emissora.

També pot consultar el cataleg JSON d'IPRD:

```text
https://iprd-org.github.io/iprd/site_data/metadata/catalog.json
```

Radio Browser es carrega per pagines amb `limit` i `offset`. IPRD es descarrega com a cataleg JSON i despres es filtra i pagina al navegador. Quan la font es `Totes`, l'app barreja resultats de les dues APIs i elimina duplicats simples per URL del stream i per nom+pais.

## Notes

Algunes emissores poden no reproduir-se per limitacions del stream, CORS, formats HLS no compatibles o bloqueig de contingut mixt si el stream usa HTTP.
