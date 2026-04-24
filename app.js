const API_BASE = "https://de1.api.radio-browser.info";
const IPRD_CATALOG_URL = "https://iprd-org.github.io/iprd/site_data/metadata/catalog.json";
const PAGE_SIZE = 50;
const FAVORITES_KEY = "radio-atlas-favorites";
const RECENTS_KEY = "radio-atlas-recents";
const countryCodeCache = new Map();

const state = {
  stations: [],
  offset: 0,
  loading: false,
  preset: "all",
  favorites: readFavorites(),
  recents: readRecents(),
  hasMore: true,
  iprdStations: null,
  currentStation: null,
  currentStreamIndex: 0,
};

const els = {
  apiStatus: document.querySelector("#apiStatus"),
  searchInput: document.querySelector("#searchInput"),
  countrySelect: document.querySelector("#countrySelect"),
  languageSelect: document.querySelector("#languageSelect"),
  codecSelect: document.querySelector("#codecSelect"),
  sourceSelect: document.querySelector("#sourceSelect"),
  orderSelect: document.querySelector("#orderSelect"),
  stationGrid: document.querySelector("#stationGrid"),
  resultTitle: document.querySelector("#resultTitle"),
  resultMeta: document.querySelector("#resultMeta"),
  refreshButton: document.querySelector("#refreshButton"),
  loadMoreButton: document.querySelector("#loadMoreButton"),
  audioPlayer: document.querySelector("#audioPlayer"),
  playerName: document.querySelector("#playerName"),
  playerMeta: document.querySelector("#playerMeta"),
  playerArt: document.querySelector("#playerArt"),
};

const debounce = (fn, wait = 350) => {
  let timeoutId;
  return (...args) => {
    window.clearTimeout(timeoutId);
    timeoutId = window.setTimeout(() => fn(...args), wait);
  };
};

init();

async function init() {
  bindEvents();
  await Promise.all([loadFilterOptions(), loadStations(true)]);
}

function bindEvents() {
  const debouncedSearch = debounce(() => loadStations(true));

  els.searchInput.addEventListener("input", debouncedSearch);
  els.countrySelect.addEventListener("change", () => loadStations(true));
  els.languageSelect.addEventListener("change", () => loadStations(true));
  els.codecSelect.addEventListener("change", () => loadStations(true));
  els.sourceSelect.addEventListener("change", () => loadStations(true));
  els.orderSelect.addEventListener("change", () => loadStations(true));
  els.refreshButton.addEventListener("click", () => loadStations(true));
  els.loadMoreButton.addEventListener("click", () => loadStations(false));
  els.audioPlayer.addEventListener("loadstart", () => updatePlayerStatus("Connectant..."));
  els.audioPlayer.addEventListener("waiting", () => updatePlayerStatus("Connectant..."));
  els.audioPlayer.addEventListener("playing", () => {
    setStatus("Reproduint", "ok");
    updatePlayerStatus("Reproduint");
  });
  els.audioPlayer.addEventListener("error", handlePlaybackError);

  document.querySelectorAll("[data-preset]").forEach((button) => {
    button.addEventListener("click", () => applyPreset(button.dataset.preset));
  });
}

async function loadFilterOptions() {
  try {
    const [countries, languages, codecs] = await Promise.all([
      getJson("/json/countries?hidebroken=true&order=stationcount&reverse=true"),
      getJson("/json/languages?hidebroken=true&order=stationcount&reverse=true"),
      getJson("/json/codecs?hidebroken=true&order=stationcount&reverse=true"),
    ]);

    fillSelect(els.countrySelect, countries.slice(0, 180), "name", "iso_3166_1", "Tots");
    fillSelect(els.languageSelect, languages.slice(0, 120), "name", "name", "Tots");
    fillSelect(els.codecSelect, codecs.slice(0, 50), "name", "name", "Tots");
    setStatus("APIs connectades", "ok");
  } catch (error) {
    console.error(error);
    setStatus("Filtres no disponibles", "error");
  }
}

async function loadStations(reset) {
  if (state.loading) return;

  if (reset) {
    state.offset = 0;
    state.stations = [];
    state.hasMore = true;
  }

  if (state.preset === "favorites") {
    renderFavorites();
    return;
  }

  if (state.preset === "recent") {
    renderRecents();
    return;
  }

  state.loading = true;
  renderLoading(reset);

  try {
    const items = await loadStationsForSelectedSource();

    state.stations = reset ? items : state.stations.concat(items);
    state.offset += items.length;
    state.hasMore = items.length === PAGE_SIZE;
    renderStations();
    setStatus("APIs connectades", "ok");
  } catch (error) {
    console.error(error);
    setStatus("Error de connexio", "error");
    renderError();
  } finally {
    state.loading = false;
  }
}

async function loadStationsForSelectedSource() {
  if (els.sourceSelect.value === "radio-browser") {
    return loadRadioBrowserStations();
  }

  if (els.sourceSelect.value === "iprd") {
    return loadIprdStations();
  }

  return loadAllSourcesStations();
}

async function loadAllSourcesStations() {
  const results = await Promise.allSettled([
    loadRadioBrowserStations(),
    loadIprdStations(),
  ]);
  const [radioBrowserStations, iprdStations] = results.map((result) => (
    result.status === "fulfilled" ? result.value : []
  ));

  if (!radioBrowserStations.length && !iprdStations.length) {
    throw new Error("Cap font ha retornat emissores");
  }

  return dedupeStations(interleaveStations(radioBrowserStations, iprdStations)).slice(0, PAGE_SIZE);
}

async function loadRadioBrowserStations() {
  const params = buildRadioBrowserParams();
  const items = await getJson(`/json/stations/search?${params.toString()}`);
  return items.map(normalizeRadioBrowserStation);
}

async function loadIprdStations() {
  const catalog = await getIprdCatalog();
  const filtered = catalog
    .filter(matchesIprdFilters)
    .sort(sortIprdStations);

  return filtered
    .slice(state.offset, state.offset + PAGE_SIZE)
    .map(normalizeIprdStation);
}

function interleaveStations(...groups) {
  const results = [];
  const longest = Math.max(...groups.map((group) => group.length));

  for (let index = 0; index < longest; index += 1) {
    groups.forEach((group) => {
      if (group[index]) {
        results.push(group[index]);
      }
    });
  }

  return results;
}

function dedupeStations(stations) {
  const seen = new Set();

  return stations.filter((station) => {
    const streamKey = normalizeDedupeText(station.streamUrl || station.url_resolved || station.url);
    const nameCountryKey = normalizeDedupeText(`${station.name || ""}|${station.country || ""}`);
    const keys = [streamKey, nameCountryKey].filter(Boolean);

    if (keys.some((key) => seen.has(key))) {
      return false;
    }

    keys.forEach((key) => seen.add(key));
    return true;
  });
}

function normalizeDedupeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildRadioBrowserParams() {
  const params = new URLSearchParams({
    limit: PAGE_SIZE,
    offset: state.offset,
    hidebroken: "true",
    order: els.orderSelect.value,
    reverse: els.orderSelect.value === "name" ? "false" : "true",
  });

  const search = els.searchInput.value.trim();
  if (search) params.set("name", search);
  if (els.countrySelect.value) params.set("countrycode", els.countrySelect.value);
  if (els.languageSelect.value) params.set("language", els.languageSelect.value);
  if (els.codecSelect.value) params.set("codec", els.codecSelect.value);

  if (state.preset === "music") params.set("tag", "music");
  if (state.preset === "news") params.set("tag", "news");
  if (state.preset === "ca") params.set("language", "catalan");

  return params;
}

async function getJson(path) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Accept": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Radio Browser ha retornat ${response.status}`);
  }

  return response.json();
}

async function getIprdCatalog() {
  if (state.iprdStations) {
    return state.iprdStations;
  }

  const response = await fetch(IPRD_CATALOG_URL, {
    headers: {
      "Accept": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`IPRD ha retornat ${response.status}`);
  }

  const catalog = await response.json();
  state.iprdStations = Array.isArray(catalog.stations) ? catalog.stations : [];
  return state.iprdStations;
}

function fillSelect(select, items, labelKey, valueKey, defaultLabel) {
  const currentValue = select.value;
  select.replaceChildren(new Option(defaultLabel, ""));

  items
    .filter((item) => item[labelKey] && item[valueKey])
    .forEach((item) => {
      const count = item.stationcount ? ` (${item.stationcount})` : "";
      select.append(new Option(`${item[labelKey]}${count}`, item[valueKey]));
    });

  select.value = currentValue;
}

function matchesIprdFilters(station) {
  const search = els.searchInput.value.trim().toLowerCase();
  const tags = Array.isArray(station.tags) ? station.tags : [];
  const genres = Array.isArray(station.genres) ? station.genres : [];
  const streams = Array.isArray(station.streams) ? station.streams : [];
  const searchableText = [
    station.name,
    station.country,
    station.language,
    station.website,
    ...tags,
    ...genres,
  ].filter(Boolean).join(" ").toLowerCase();

  if (search && !searchableText.includes(search)) return false;
  if (els.countrySelect.value && getCountryCode(station.country) !== els.countrySelect.value) return false;
  if (els.languageSelect.value && !hasIprdLanguage(station, els.languageSelect.value.toLowerCase())) return false;
  if (els.codecSelect.value && !streams.some((stream) => String(stream.format || "").toLowerCase() === els.codecSelect.value.toLowerCase())) return false;
  if (state.preset === "music" && !hasIprdTerm(station, "music")) return false;
  if (state.preset === "news" && !hasIprdTerm(station, "news")) return false;
  if (state.preset === "ca" && !hasIprdLanguage(station, "catalan") && !hasIprdTerm(station, "catalan")) return false;

  return streams.some((stream) => stream.url);
}

function hasIprdTerm(station, term) {
  const values = []
    .concat(station.tags || [])
    .concat(station.genres || [])
    .map((value) => String(value).toLowerCase());
  return values.some((value) => value.includes(term));
}

function hasIprdLanguage(station, language) {
  const languages = Array.isArray(station.language) ? station.language : [station.language];
  return languages.some((value) => String(value).toLowerCase() === language);
}

function sortIprdStations(a, b) {
  const order = els.orderSelect.value;

  if (order === "name") {
    return String(a.name || "").localeCompare(String(b.name || ""));
  }

  if (order === "changetimestamp") {
    return Date.parse(b.lastChecked || 0) - Date.parse(a.lastChecked || 0);
  }

  return getBestReliability(b) - getBestReliability(a);
}

function getBestReliability(station) {
  const streams = Array.isArray(station.streams) ? station.streams : [];
  return streams.reduce((best, stream) => Math.max(best, Number(stream.reliability) || 0), 0);
}

function normalizeRadioBrowserStation(station) {
  return {
    ...station,
    source: "Radio Browser",
    streamUrl: station.url_resolved || station.url,
    streamUrls: [station.url_resolved || station.url].filter(Boolean),
    tagsList: String(station.tags || "").split(",").map((tag) => tag.trim()).filter(Boolean),
    statLabel: "Vots",
    statValue: station.votes || 0,
  };
}

function normalizeIprdStation(station) {
  const stream = getBestIprdStream(station);
  const streams = getSortedIprdStreams(station);
  const tagsList = []
    .concat(station.genres || [])
    .concat(station.tags || [])
    .filter(Boolean);

  return {
    stationuuid: `iprd:${station.id || station.name}`,
    name: station.name,
    country: station.country,
    state: "",
    language: Array.isArray(station.language) ? station.language.join(", ") : station.language,
    codec: stream.format || "",
    bitrate: stream.bitrate || 0,
    favicon: station.logo || "",
    homepage: station.website || "",
    source: "IPRD",
    streamUrl: stream.url,
    streamUrls: streams.map((item) => item.url).filter(Boolean),
    url: stream.url,
    url_resolved: stream.url,
    tagsList: [...new Set(tagsList)],
    statLabel: "Fiabilitat",
    statValue: stream.reliability ? `${Math.round(Number(stream.reliability) * 100)}%` : "n/d",
  };
}

function getBestIprdStream(station) {
  return getSortedIprdStreams(station)[0] || {};
}

function getSortedIprdStreams(station) {
  const streams = Array.isArray(station.streams) ? station.streams : [];
  return streams
    .filter((stream) => stream.url)
    .sort((a, b) => {
      const reliabilityDiff = (Number(b.reliability) || 0) - (Number(a.reliability) || 0);
      return reliabilityDiff || ((Number(b.bitrate) || 0) - (Number(a.bitrate) || 0));
    });
}

function getCountryCode(countryName) {
  if (!countryName || typeof Intl === "undefined" || !Intl.DisplayNames) {
    return "";
  }

  const cacheKey = String(countryName).toLowerCase();
  if (countryCodeCache.has(cacheKey)) {
    return countryCodeCache.get(cacheKey);
  }

  const displayNames = new Intl.DisplayNames(["en"], { type: "region" });

  for (let first = 65; first <= 90; first += 1) {
    for (let second = 65; second <= 90; second += 1) {
      const countryCode = String.fromCharCode(first, second);
      if (displayNames.of(countryCode)?.toLowerCase() === String(countryName).toLowerCase()) {
        countryCodeCache.set(cacheKey, countryCode);
        return countryCode;
      }
    }
  }

  countryCodeCache.set(cacheKey, "");
  return "";
}

function applyPreset(preset) {
  state.preset = preset;
  document.querySelectorAll("[data-preset]").forEach((button) => {
    button.classList.toggle("active", button.dataset.preset === preset);
  });

  if (preset === "es") {
    els.countrySelect.value = "ES";
  }

  if (preset === "ca") {
    els.languageSelect.value = "";
  }

  loadStations(true);
}

function renderLoading(reset) {
  els.loadMoreButton.disabled = true;
  els.loadMoreButton.textContent = "Carregant...";
  els.resultMeta.textContent = reset ? "Buscant emissores..." : "Afegint mes emissores...";

  if (reset) {
    els.stationGrid.innerHTML = `<div class="empty-state">Carregant radios...</div>`;
  }
}

function renderStations() {
  els.resultTitle.textContent = "Emissores disponibles";
  els.resultMeta.textContent = `${state.stations.length} emissores carregades`;
  els.loadMoreButton.disabled = false;
  els.loadMoreButton.textContent = "Carrega mes";
  els.loadMoreButton.hidden = !state.hasMore;

  if (!state.stations.length) {
    els.stationGrid.innerHTML = `<div class="empty-state">No hi ha resultats amb aquests filtres.</div>`;
    return;
  }

  els.stationGrid.innerHTML = state.stations.map(renderStationCard).join("");
  bindStationButtons();
}

function renderFavorites() {
  const favorites = [...state.favorites.values()];
  els.resultTitle.textContent = "Favorites";
  els.resultMeta.textContent = favorites.length
    ? `${favorites.length} emissores desades`
    : "Encara no has desat cap emissora";
  els.loadMoreButton.hidden = true;

  els.stationGrid.innerHTML = favorites.length
    ? favorites.map(renderStationCard).join("")
    : `<div class="empty-state">Marca emissores amb l'estrella per trobar-les aqui.</div>`;

  bindStationButtons();
}

function renderRecents() {
  const recents = [...state.recents.values()];
  els.resultTitle.textContent = "Recents";
  els.resultMeta.textContent = recents.length
    ? `${recents.length} emissores escoltades recentment`
    : "Encara no has escoltat cap emissora";
  els.loadMoreButton.hidden = true;

  els.stationGrid.innerHTML = recents.length
    ? recents.map(renderStationCard).join("")
    : `<div class="empty-state">Les emissores que escoltis apareixeran aqui.</div>`;

  bindStationButtons();
}

function renderStationCard(station) {
  const title = escapeHtml(station.name || "Radio sense nom");
  const location = escapeHtml([station.country, station.state, station.source].filter(Boolean).join(" - ") || "Ubicacio desconeguda");
  const codec = escapeHtml(station.codec || "n/d");
  const bitrate = station.bitrate ? `${station.bitrate} kbps` : "n/d";
  const tags = (station.tagsList || String(station.tags || "").split(","))
    .map((tag) => String(tag).trim())
    .filter(Boolean)
    .slice(0, 3);
  const initials = getInitials(station.name);
  const saved = state.favorites.has(station.stationuuid);
  const logo = station.favicon
    ? `<img src="${escapeAttribute(station.favicon)}" alt="" loading="lazy" onerror="this.remove()">`
    : initials;

  return `
    <article class="station-card">
      <div class="station-top">
        <div class="logo">${logo}</div>
        <div>
          <h3 class="station-name">${title}</h3>
          <p class="station-location">${location}</p>
        </div>
      </div>
      <div class="tags">
        ${tags.length ? tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("") : `<span class="tag">radio</span>`}
      </div>
      <div class="station-stats">
        <div class="stat"><span>Codec</span><strong>${codec}</strong></div>
        <div class="stat"><span>Bitrate</span><strong>${bitrate}</strong></div>
        <div class="stat"><span>${escapeHtml(station.statLabel || "Vots")}</span><strong>${escapeHtml(station.statValue ?? station.votes ?? 0)}</strong></div>
      </div>
      <div class="station-actions">
        <button class="station-action play" type="button" data-play="${escapeAttribute(station.stationuuid)}">Escolta</button>
        <button class="station-action info" type="button" data-info="${escapeAttribute(station.stationuuid)}">Info</button>
        <button class="station-action favorite ${saved ? "saved" : ""}" type="button" data-favorite="${escapeAttribute(station.stationuuid)}" aria-label="Desa favorit">${saved ? "*" : "+"}</button>
      </div>
    </article>
  `;
}

function bindStationButtons() {
  els.stationGrid.querySelectorAll("[data-play]").forEach((button) => {
    button.addEventListener("click", () => {
      const station = findStation(button.dataset.play);
      if (station) playStation(station);
    });
  });

  els.stationGrid.querySelectorAll("[data-favorite]").forEach((button) => {
    button.addEventListener("click", () => {
      const station = findStation(button.dataset.favorite);
      if (station) toggleFavorite(station);
    });
  });

  els.stationGrid.querySelectorAll("[data-info]").forEach((button) => {
    button.addEventListener("click", () => {
      const station = findStation(button.dataset.info);
      if (station) showStationDetails(station);
    });
  });
}

function findStation(uuid) {
  return state.stations.find((station) => station.stationuuid === uuid)
    || state.favorites.get(uuid)
    || state.recents.get(uuid);
}

function showStationDetails(station) {
  closeStationDetails();

  const streamUrls = station.streamUrls?.length
    ? station.streamUrls
    : [station.streamUrl || station.url_resolved || station.url].filter(Boolean);
  const tags = (station.tagsList || String(station.tags || "").split(","))
    .map((tag) => String(tag).trim())
    .filter(Boolean);

  const dialog = document.createElement("div");
  dialog.className = "modal-backdrop";
  dialog.innerHTML = `
    <section class="station-modal" role="dialog" aria-modal="true" aria-label="Detall de l'emissora">
      <button class="modal-close" type="button" data-close-modal aria-label="Tanca">x</button>
      <div class="modal-header">
        <div class="modal-logo">${station.favicon ? `<img src="${escapeAttribute(station.favicon)}" alt="" onerror="this.remove()">` : escapeHtml(getInitials(station.name))}</div>
        <div>
          <p class="modal-source">${escapeHtml(station.source || "Font desconeguda")}</p>
          <h2>${escapeHtml(station.name || "Radio sense nom")}</h2>
          <p>${escapeHtml([station.country, station.state, station.language].filter(Boolean).join(" - ") || "Sense ubicacio")}</p>
        </div>
      </div>
      <div class="detail-grid">
        ${renderDetailItem("Codec", station.codec || "n/d")}
        ${renderDetailItem("Bitrate", station.bitrate ? `${station.bitrate} kbps` : "n/d")}
        ${renderDetailItem(station.statLabel || "Vots", station.statValue ?? station.votes ?? "n/d")}
        ${renderDetailItem("Streams", streamUrls.length || "n/d")}
      </div>
      <div class="modal-tags">
        ${tags.length ? tags.slice(0, 12).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("") : `<span class="tag">radio</span>`}
      </div>
      <div class="detail-links">
        ${station.homepage ? `<a href="${escapeAttribute(station.homepage)}" target="_blank" rel="noreferrer">Web oficial</a>` : ""}
        ${streamUrls[0] ? `<a href="${escapeAttribute(streamUrls[0])}" target="_blank" rel="noreferrer">Obre stream</a>` : ""}
      </div>
      <label class="stream-field">
        <span>URL stream</span>
        <input value="${escapeAttribute(streamUrls[0] || "")}" readonly>
      </label>
    </section>
  `;

  dialog.addEventListener("click", (event) => {
    if (event.target === dialog || event.target.closest("[data-close-modal]")) {
      closeStationDetails();
    }
  });

  document.addEventListener("keydown", handleModalKeydown);
  document.body.append(dialog);
  dialog.querySelector("[data-close-modal]").focus();
}

function renderDetailItem(label, value) {
  return `
    <div class="detail-item">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

function closeStationDetails() {
  document.querySelector(".modal-backdrop")?.remove();
  document.removeEventListener("keydown", handleModalKeydown);
}

function handleModalKeydown(event) {
  if (event.key === "Escape") {
    closeStationDetails();
  }
}

function playStation(station, streamIndex = 0) {
  const streamUrls = station.streamUrls?.length
    ? station.streamUrls
    : [station.streamUrl || station.url_resolved || station.url].filter(Boolean);
  const streamUrl = streamUrls[streamIndex];

  if (!streamUrl) {
    setStatus("Stream no disponible", "error");
    updatePlayerStatus("Stream no disponible");
    return;
  }

  state.currentStation = station;
  state.currentStreamIndex = streamIndex;
  saveRecentStation(station);
  els.audioPlayer.src = streamUrl;
  els.audioPlayer.play().catch(() => {
    setStatus("El navegador ha bloquejat la reproduccio", "error");
    updatePlayerStatus("Reproduccio bloquejada");
  });

  els.playerName.textContent = station.name || "Radio sense nom";
  updatePlayerStatus("Connectant...");
  els.playerArt.textContent = getInitials(station.name);
  setStatus("Connectant", "ok");

  if (station.source === "Radio Browser") {
    fetch(`${API_BASE}/json/url/${station.stationuuid}`).catch(() => {});
  }
}

function saveRecentStation(station) {
  state.recents.delete(station.stationuuid);
  state.recents = new Map([[station.stationuuid, station], ...state.recents].slice(0, 20));
  writeRecents();
}

function handlePlaybackError() {
  const station = state.currentStation;
  const streamUrls = station?.streamUrls || [];
  const nextIndex = state.currentStreamIndex + 1;

  if (station && nextIndex < streamUrls.length) {
    setStatus("Provant un altre stream", "ok");
    playStation(station, nextIndex);
    return;
  }

  setStatus("Error de reproduccio", "error");
  updatePlayerStatus("No s'ha pogut reproduir");
}

function updatePlayerStatus(statusText) {
  const station = state.currentStation;
  const details = station
    ? [station.country, station.codec, station.bitrate ? `${station.bitrate} kbps` : ""]
      .filter(Boolean)
      .join(" - ")
    : "Tria una radio per escoltar-la";

  els.playerMeta.textContent = station ? `${statusText} - ${details}` : details;
}

function toggleFavorite(station) {
  if (state.favorites.has(station.stationuuid)) {
    state.favorites.delete(station.stationuuid);
  } else {
    state.favorites.set(station.stationuuid, station);
  }

  writeFavorites();
  if (state.preset === "favorites") {
    renderFavorites();
  } else {
    renderStations();
  }
}

function renderError() {
  els.loadMoreButton.disabled = false;
  els.loadMoreButton.textContent = "Torna-ho a provar";
  els.stationGrid.innerHTML = `<div class="empty-state">No s'han pogut carregar les emissores. Prova d'actualitzar.</div>`;
}

function setStatus(text, type) {
  els.apiStatus.textContent = text;
  els.apiStatus.className = `status-pill ${type || ""}`.trim();
}

function readFavorites() {
  try {
    const items = JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]");
    return new Map(items.map((station) => [station.stationuuid, station]));
  } catch {
    return new Map();
  }
}

function writeFavorites() {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify([...state.favorites.values()]));
}

function readRecents() {
  try {
    const items = JSON.parse(localStorage.getItem(RECENTS_KEY) || "[]");
    return new Map(items.map((station) => [station.stationuuid, station]));
  } catch {
    return new Map();
  }
}

function writeRecents() {
  localStorage.setItem(RECENTS_KEY, JSON.stringify([...state.recents.values()]));
}

function getInitials(name = "") {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] || "R").concat(parts[1]?.[0] || "A").toUpperCase();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}
