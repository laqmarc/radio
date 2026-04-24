# Afegir mes fonts de radio

Aquest document recull el pla per ampliar Radio Quexulo amb mes fonts sense embolicar el codi.

## 1. Cataleg propi local

Crear una font propia dins el projecte amb un fitxer JSON:

```text
data/custom-stations.json
```

Aquesta opcio serveix per tenir emissores curades, destacar radios catalanes, corregir streams que fallin en altres directoris i afegir emissores que no apareguin a Radio Browser o IPRD.

Cada emissora ha de tenir aquesta forma:

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

Ja esta implementat com a font `Quexulo` al selector de fonts. Quan tries `Totes`, tambe es barreja amb Radio Browser i IPRD.

## 2. CasterClub

CasterClub pot servir com a font externa addicional si volem augmentar cataleg. Abans d'integrar-la cal revisar si ofereix un endpoint public estable, quins camps retorna i si permet us directe des del navegador.

## 3. Directoris Icecast

Algunes radios Icecast publiquen directoris o llistes de streams. Pot ser util per descobrir emissores independents, pero cal normalitzar millor les dades perque sovint hi ha menys metadades.

## 4. Llistes M3U publiques

Una altra via es acceptar fitxers `.m3u` o `.pls` i convertir-los a emissores internes. Aixo seria util per importar paquets de radios, pero requeriria un parser petit al servidor o al navegador.

## 5. Fonts verificades manualment

Per qualitat de producte, la millor estrategia es combinar APIs grans amb una capa curada propia. Radio Browser i IPRD donen volum; `data/custom-stations.json` dona control.
