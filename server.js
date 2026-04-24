const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT) || 8000;
const ROOT = __dirname;
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);

  if (requestUrl.pathname === "/stream") {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Range, Accept",
      });
      res.end();
      return;
    }

    proxyStream(requestUrl, req, res);
    return;
  }

  if (requestUrl.pathname === "/metadata") {
    streamMetadata(requestUrl, req, res);
    return;
  }

  if (requestUrl.pathname === "/sources/casterclub") {
    getCasterClubStations(requestUrl, res);
    return;
  }

  if (requestUrl.pathname === "/sources/casterclub/station") {
    getCasterClubStation(requestUrl, res);
    return;
  }

  if (requestUrl.pathname === "/song/search") {
    searchSong(requestUrl, res);
    return;
  }

  serveStatic(requestUrl, res);
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${PORT} ocupat. Defineix PORT amb un port lliure o atura el proces que ja l'esta usant.`);
    console.error("Exemple Linux/Plesk SSH: PORT=8010 npm start");
    process.exit(1);
  }

  throw error;
});

server.listen(PORT, () => {
  console.log(`Radio Quexulo: http://localhost:${PORT}`);
});

function serveStatic(requestUrl, res) {
  const requestedPath = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
  const filePath = path.resolve(ROOT, `.${decodeURIComponent(requestedPath)}`);

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const contentType = MIME_TYPES[path.extname(filePath)] || "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      "Pragma": "no-cache",
      "Expires": "0",
      "Surrogate-Control": "no-store",
    });
    res.end(content);
  });
}

function proxyStream(requestUrl, clientReq, clientRes) {
  const target = requestUrl.searchParams.get("url");

  if (!target || !/^https?:\/\//i.test(target)) {
    clientRes.writeHead(400);
    clientRes.end("Missing stream url");
    return;
  }

  requestUpstream(target, clientReq, clientRes, 0);
}

function requestUpstream(target, clientReq, clientRes, redirectCount) {
  const upstreamUrl = new URL(target);
  const transport = upstreamUrl.protocol === "https:" ? https : http;
  const headers = {
    "User-Agent": "RadioQuexulo/1.0",
    "Accept": clientReq.headers.accept || "*/*",
  };

  if (clientReq.headers.range) {
    headers.Range = clientReq.headers.range;
  }

  const upstreamReq = transport.get(upstreamUrl, { headers }, (upstreamRes) => {
    if ([301, 302, 303, 307, 308].includes(upstreamRes.statusCode) && upstreamRes.headers.location && redirectCount < 5) {
      upstreamRes.resume();
      const nextUrl = new URL(upstreamRes.headers.location, upstreamUrl).toString();
      requestUpstream(nextUrl, clientReq, clientRes, redirectCount + 1);
      return;
    }

    const responseHeaders = {
      "Content-Type": upstreamRes.headers["content-type"] || "audio/mpeg",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges",
      "Cache-Control": "no-cache",
    };

    if (upstreamRes.headers["content-length"]) {
      responseHeaders["Content-Length"] = upstreamRes.headers["content-length"];
    }

    if (upstreamRes.headers["accept-ranges"]) {
      responseHeaders["Accept-Ranges"] = upstreamRes.headers["accept-ranges"];
    }

    if (upstreamRes.headers["content-range"]) {
      responseHeaders["Content-Range"] = upstreamRes.headers["content-range"];
    }

    clientRes.writeHead(upstreamRes.statusCode || 200, responseHeaders);
    upstreamRes.pipe(clientRes);
  });

  upstreamReq.on("error", () => {
    if (!clientRes.headersSent) {
      clientRes.writeHead(502);
    }
    clientRes.end("Stream proxy error");
  });

  clientReq.on("close", () => upstreamReq.destroy());
}

function streamMetadata(requestUrl, clientReq, clientRes) {
  const target = requestUrl.searchParams.get("url");

  if (!target || !/^https?:\/\//i.test(target)) {
    clientRes.writeHead(400);
    clientRes.end("Missing stream url");
    return;
  }

  clientRes.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });
  clientRes.write("retry: 5000\n\n");

  requestMetadataUpstream(target, clientReq, clientRes, 0);
}

function requestMetadataUpstream(target, clientReq, clientRes, redirectCount) {
  const upstreamUrl = new URL(target);
  const transport = upstreamUrl.protocol === "https:" ? https : http;
  const upstreamReq = transport.get(upstreamUrl, {
    headers: {
      "User-Agent": "RadioQuexulo/1.0",
      "Icy-MetaData": "1",
      "Accept": "*/*",
    },
  }, (upstreamRes) => {
    if ([301, 302, 303, 307, 308].includes(upstreamRes.statusCode) && upstreamRes.headers.location && redirectCount < 5) {
      upstreamRes.resume();
      const nextUrl = new URL(upstreamRes.headers.location, upstreamUrl).toString();
      requestMetadataUpstream(nextUrl, clientReq, clientRes, redirectCount + 1);
      return;
    }

    const metaint = Number(upstreamRes.headers["icy-metaint"]);
    if (!metaint) {
      sendMetadataEvent(clientRes, { title: "", supported: false });
      upstreamRes.destroy();
      clientRes.end();
      return;
    }

    parseIcyMetadata(upstreamRes, metaint, (title) => {
      sendMetadataEvent(clientRes, { title, supported: true });
    });
  });

  upstreamReq.on("error", () => {
    sendMetadataEvent(clientRes, { title: "", supported: false });
    clientRes.end();
  });

  clientReq.on("close", () => upstreamReq.destroy());
}

function parseIcyMetadata(stream, metaint, onTitle) {
  let audioBytesUntilMeta = metaint;
  let metadataLength = null;
  let metadataBuffer = Buffer.alloc(0);
  let lastTitle = "";

  stream.on("data", (chunk) => {
    let offset = 0;

    while (offset < chunk.length) {
      if (audioBytesUntilMeta > 0) {
        const audioBytes = Math.min(audioBytesUntilMeta, chunk.length - offset);
        audioBytesUntilMeta -= audioBytes;
        offset += audioBytes;
        continue;
      }

      if (metadataLength === null) {
        metadataLength = chunk[offset] * 16;
        metadataBuffer = Buffer.alloc(0);
        offset += 1;

        if (metadataLength === 0) {
          metadataLength = null;
          audioBytesUntilMeta = metaint;
        }
        continue;
      }

      const metadataBytes = Math.min(metadataLength - metadataBuffer.length, chunk.length - offset);
      metadataBuffer = Buffer.concat([metadataBuffer, chunk.slice(offset, offset + metadataBytes)]);
      offset += metadataBytes;

      if (metadataBuffer.length === metadataLength) {
        const title = extractStreamTitle(metadataBuffer.toString("utf8"));
        if (title && title !== lastTitle) {
          lastTitle = title;
          onTitle(title);
        }

        metadataLength = null;
        audioBytesUntilMeta = metaint;
      }
    }
  });
}

function extractStreamTitle(metadata) {
  const match = metadata.match(/StreamTitle='([^']*)'/);
  return match ? match[1].trim() : "";
}

function sendMetadataEvent(res, payload) {
  if (!res.destroyed) {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  }
}

function getCasterClubStations(requestUrl, res) {
  const page = Math.max(1, Number(requestUrl.searchParams.get("page")) || 1);
  const target = new URL("https://yp.casterclub.com/directory.php");

  target.searchParams.set("page", String(page));
  target.searchParams.set("sort", mapCasterClubSort(requestUrl.searchParams.get("order")));
  target.searchParams.set("dir", requestUrl.searchParams.get("order") === "name" ? "asc" : "desc");

  const search = requestUrl.searchParams.get("search");
  if (search) target.searchParams.set("search", search.slice(0, 120));

  const codec = mapCasterClubCodec(requestUrl.searchParams.get("codec"));
  if (codec) target.searchParams.set("format", codec);

  const genre = mapCasterClubGenre(requestUrl.searchParams.get("preset"));
  if (genre) target.searchParams.set("genre", genre);

  requestText(target, (error, html) => {
    if (error) {
      sendJson(res, 502, { error: "No s'ha pogut llegir CasterClub" });
      return;
    }

    sendJson(res, 200, {
      source: "CasterClub",
      page,
      stations: parseCasterClubDirectory(html),
    });
  });
}

function searchSong(requestUrl, res) {
  const rawQuery = String(requestUrl.searchParams.get("q") || "").trim().slice(0, 160);
  const artist = String(requestUrl.searchParams.get("artist") || "").trim().slice(0, 120);
  const title = String(requestUrl.searchParams.get("title") || "").trim().slice(0, 120);
  const query = rawQuery || [artist, title].filter(Boolean).join(" ");

  if (!query) {
    sendJson(res, 400, { error: "Missing query" });
    return;
  }

  Promise.allSettled([
    searchItunes(query),
    searchMusicBrainz(query, artist, title),
  ]).then((results) => {
    const [itunesResult, musicBrainzResult] = results;
    sendJson(res, 200, {
      query,
      itunes: itunesResult.status === "fulfilled" ? itunesResult.value : [],
      musicbrainz: musicBrainzResult.status === "fulfilled" ? musicBrainzResult.value : [],
    });
  });
}

function searchItunes(query) {
  const target = new URL("https://itunes.apple.com/search");
  target.searchParams.set("term", query);
  target.searchParams.set("media", "music");
  target.searchParams.set("entity", "song");
  target.searchParams.set("limit", "5");
  target.searchParams.set("country", "ES");

  return requestJson(target).then((payload) => (
    Array.isArray(payload.results) ? payload.results.map((item) => ({
      source: "iTunes",
      artist: item.artistName || "",
      title: item.trackName || "",
      album: item.collectionName || "",
      artwork: String(item.artworkUrl100 || "").replace("100x100", "600x600"),
      url: item.trackViewUrl || item.collectionViewUrl || "",
      previewUrl: item.previewUrl || "",
      releaseDate: item.releaseDate || "",
    })) : []
  ));
}

function searchMusicBrainz(query, artist, title) {
  const target = new URL("https://musicbrainz.org/ws/2/recording/");
  const mbQuery = artist && title
    ? `artist:"${artist}" AND recording:"${title}"`
    : query;

  target.searchParams.set("query", mbQuery);
  target.searchParams.set("fmt", "json");
  target.searchParams.set("limit", "5");

  return requestJson(target).then((payload) => (
    Array.isArray(payload.recordings) ? payload.recordings.map((item) => {
      const release = Array.isArray(item.releases) ? item.releases[0] : null;
      const artistCredit = Array.isArray(item["artist-credit"]) ? item["artist-credit"] : [];
      return {
        source: "MusicBrainz",
        artist: artistCredit.map((credit) => credit.name).filter(Boolean).join(", "),
        title: item.title || "",
        album: release?.title || "",
        url: item.id ? `https://musicbrainz.org/recording/${item.id}` : "",
        releaseDate: item["first-release-date"] || release?.date || "",
        score: item.score || 0,
      };
    }) : []
  ));
}

function requestJson(target) {
  return new Promise((resolve, reject) => {
    requestText(target, (error, text) => {
      if (error) {
        reject(error);
        return;
      }

      try {
        resolve(JSON.parse(text));
      } catch (parseError) {
        reject(parseError);
      }
    });
  });
}

function getCasterClubStation(requestUrl, res) {
  const id = requestUrl.searchParams.get("id");
  if (!id || !/^\d+$/.test(id)) {
    sendJson(res, 400, { error: "Missing station id" });
    return;
  }

  const target = new URL("https://yp.casterclub.com/station-detail.php");
  target.searchParams.set("id", id);

  requestText(target, (error, html) => {
    if (error) {
      sendJson(res, 502, { error: "No s'ha pogut llegir CasterClub" });
      return;
    }

    const station = parseCasterClubDetail(html, id);
    if (!station) {
      sendJson(res, 404, { error: "Emissora no trobada" });
      return;
    }

    sendJson(res, 200, { source: "CasterClub", station });
  });
}

function requestText(target, callback, redirectCount = 0) {
  const targetUrl = target instanceof URL ? target : new URL(target);
  const transport = targetUrl.protocol === "https:" ? https : http;
  const req = transport.get(targetUrl, {
    headers: {
      "User-Agent": "RadioQuexulo/1.0 (+https://radio.quexulo.cat)",
      "Accept": "text/html,application/xhtml+xml",
    },
  }, (upstreamRes) => {
    if ([301, 302, 303, 307, 308].includes(upstreamRes.statusCode) && upstreamRes.headers.location && redirectCount < 5) {
      upstreamRes.resume();
      requestText(new URL(upstreamRes.headers.location, targetUrl), callback, redirectCount + 1);
      return;
    }

    if ((upstreamRes.statusCode || 500) >= 400) {
      upstreamRes.resume();
      callback(new Error(`HTTP ${upstreamRes.statusCode}`));
      return;
    }

    const chunks = [];
    upstreamRes.setEncoding("utf8");
    upstreamRes.on("data", (chunk) => chunks.push(chunk));
    upstreamRes.on("end", () => callback(null, chunks.join("")));
  });

  req.setTimeout(12000, () => req.destroy(new Error("Timeout")));
  req.on("error", callback);
}

function parseCasterClubDirectory(html) {
  const stations = [];
  const rowPattern = /<tr\b[^>]*class="[^"]*\bstn-row\b[^"]*"[^>]*>/gi;
  let match;

  while ((match = rowPattern.exec(html))) {
    const attrs = extractDataAttributes(match[0]);
    if (!attrs.id || !attrs.name || !attrs.listenUrl) continue;

    stations.push({
      id: attrs.id,
      name: attrs.name,
      country: attrs.country || "",
      genre: attrs.genres || "",
      bitrate: Number(attrs.bitrate) || 0,
      codec: codecFromContentType(attrs.serverType),
      serverType: attrs.serverType || "",
      streamUrl: attrs.listenUrl,
      listeners: Number(attrs.listeners) || 0,
      peak: Number(attrs.peak) || 0,
      nowPlaying: attrs.nowPlaying || "",
      description: attrs.description || "",
      homepage: `https://yp.casterclub.com/station-detail.php?id=${encodeURIComponent(attrs.id)}`,
      status: attrs.status || "",
    });
  }

  return stations;
}

function parseCasterClubDetail(html, id) {
  const listenUrl = decodeHtml((html.match(/Listen URL[\s\S]{0,260}<a[^>]+href="(https?:\/\/[^"]+)"/i) || [])[1] || "");
  const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/i) || html.match(/<h2[^>]*>([^<]+)<\/h2>/i);
  const name = pickCasterClubDetail(html, "Station Name") || decodeHtml((titleMatch || [])[1] || "");

  if (!listenUrl || !name) return null;

  const genre = pickCasterClubDetail(html, "Primary Genre");
  const serverType = pickCasterClubDetail(html, "Server Type");

  return {
    id,
    name,
    country: pickCasterClubDetail(html, "Server Location"),
    genre,
    bitrate: Number((pickCasterClubDetail(html, "Bitrate").match(/\d+/) || [])[0]) || 0,
    codec: codecFromContentType(serverType),
    serverType,
    streamUrl: listenUrl,
    listeners: Number((pickCasterClubDetail(html, "Listeners Now").match(/\d+/) || [])[0]) || 0,
    peak: Number((pickCasterClubDetail(html, "Listeners Peak").match(/\d+/) || [])[0]) || 0,
    nowPlaying: pickCasterClubDetail(html, "Current Song"),
    description: "",
    homepage: `https://yp.casterclub.com/station-detail.php?id=${encodeURIComponent(id)}`,
    status: pickCasterClubDetail(html, "Stream Status"),
  };
}

function pickCasterClubDetail(html, label) {
  const labelMatch = new RegExp(escapeRegExp(label), "i").exec(html);
  if (!labelMatch) return "";

  const slice = html.slice(labelMatch.index, labelMatch.index + 600);
  const valueMatch = slice.match(/<span[^>]*class="[^"]*\bkv-val\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
  if (!valueMatch) return "";

  return decodeHtml(stripTags(valueMatch[1]).replace(/\s+/g, " "));
}

function extractDataAttributes(tag) {
  const attrs = {};
  const attrPattern = /data-stn-([a-z-]+)="([^"]*)"/gi;
  let match;

  while ((match = attrPattern.exec(tag))) {
    attrs[toCamelCase(match[1])] = decodeHtml(match[2]);
  }

  return attrs;
}

function mapCasterClubSort(order) {
  if (order === "name") return "name";
  if (order === "changetimestamp") return "reliability";
  if (order === "votes") return "reliability";
  return "listeners";
}

function mapCasterClubCodec(codec) {
  const normalized = String(codec || "").toUpperCase();
  if (normalized === "MP3") return "MP3";
  if (normalized === "AAC" || normalized === "AAC+") return "AAC";
  if (normalized === "OGG" || normalized === "OGG VORBIS") return "OGG";
  if (normalized === "OPUS") return "OPUS";
  return "";
}

function mapCasterClubGenre(preset) {
  if (preset === "news") return "Talk";
  return "";
}

function codecFromContentType(contentType) {
  const value = String(contentType || "").toLowerCase();
  if (value.includes("mpeg") || value.includes("mp3")) return "MP3";
  if (value.includes("aac")) return "AAC";
  if (value.includes("ogg")) return "OGG";
  if (value.includes("opus")) return "OPUS";
  return contentType || "";
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, no-cache, must-revalidate",
  });
  res.end(JSON.stringify(payload));
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#039;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function stripTags(value) {
  return String(value || "").replace(/<[^>]*>/g, " ");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
