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
- Visualitzador de so amb boto d'ull, pantalla completa i modes `Barres` i `Ona`, optimitzats per seguir l'audio real quan s'executa amb `npm start`.
  - Les barres representen bandes de frequencia: greus a l'esquerra, mitjos al centre i aguts a la dreta.
- Modal de detall amb font, web oficial, tags, metadades i URL del stream.
- Favorits persistents amb `localStorage`.
- Historial de les ultimes emissores escoltades amb el preset `Recents`.
- Filtres de qualitat: nomes HTTPS, amagar HLS, emissores amb logo i bitrate minim.
- Boto `Aleatoria` per reproduir una emissora dels resultats carregats.
- Enllacos compartibles d'emissora amb format `#/station/{font}/{id}` i boto `Comparteix` al modal.
- Mode pantalla gran amb format `?view=tv#/station/{font}/{id}`, logo, hora i visualitzador gran.
- Metadades ICY opcionals per mostrar `Ara sona` quan l'emissora publica titol de canco o programa.
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

Per tenir reproduccio i visualitzador real sincronitzat amb la musica, executa el servidor local:

```bash
npm start
```

O directament:

```bash
node server.js
```

I obre:

```text
http://localhost:8000
```

El servidor inclou un proxy de streams a `/stream`, necessari perque el navegador permeti analitzar l'audio amb Web Audio. En produccio tambe s'usa el proxy del mateix domini, per exemple `https://radio.quexulo.cat/stream?...`.
També inclou `/metadata`, que llegeix metadades ICY (`StreamTitle`) quan el stream les publica.

També pots obrir `index.html` directament al navegador, pero molts streams no permetran visualitzacio real per CORS.

Un servidor simple com `python -m http.server` pot servir la web, pero no inclou el proxy de streams i per tant no garanteix visualitzacio real amb la musica.

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
