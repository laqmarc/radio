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
