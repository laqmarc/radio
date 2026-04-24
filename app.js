const API_BASE = "https://de1.api.radio-browser.info";
const IPRD_CATALOG_URL = "https://iprd-org.github.io/iprd/site_data/metadata/catalog.json";
const CUSTOM_CATALOG_URL = "data/custom-stations.json";
const CASTERCLUB_SOURCE_URL = "/sources/casterclub";
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
  customStations: null,
  currentStation: null,
  currentStreamIndex: 0,
  visualizerOpen: false,
  tvFrame: null,
  tvClockTimer: null,
  visualizerFrame: null,
  visualizerSource: null,
  audioContext: null,
  analyser: null,
  frequencyData: null,
  waveformData: null,
  lastSignalAt: 0,
  initialRouteHandled: false,
  filtersMobileMode: null,
  metadataSource: null,
  nowPlaying: "",
  songLookupCache: new Map(),
};

const els = {
  apiStatus: document.querySelector("#apiStatus"),
  searchInput: document.querySelector("#searchInput"),
  countrySelect: document.querySelector("#countrySelect"),
  languageSelect: document.querySelector("#languageSelect"),
  codecSelect: document.querySelector("#codecSelect"),
  sourceSelect: document.querySelector("#sourceSelect"),
  orderSelect: document.querySelector("#orderSelect"),
  httpsOnlyInput: document.querySelector("#httpsOnlyInput"),
  hideHlsInput: document.querySelector("#hideHlsInput"),
  logoOnlyInput: document.querySelector("#logoOnlyInput"),
  minBitrateInput: document.querySelector("#minBitrateInput"),
  stationGrid: document.querySelector("#stationGrid"),
  resultTitle: document.querySelector("#resultTitle"),
  resultMeta: document.querySelector("#resultMeta"),
  refreshButton: document.querySelector("#refreshButton"),
  randomButton: document.querySelector("#randomButton"),
  loadMoreButton: document.querySelector("#loadMoreButton"),
  audioPlayer: document.querySelector("#audioPlayer"),
  playerName: document.querySelector("#playerName"),
  playerMeta: document.querySelector("#playerMeta"),
  nowPlaying: document.querySelector("#nowPlaying"),
  playerArt: document.querySelector("#playerArt"),
  visualizerToggle: document.querySelector("#visualizerToggle"),
  tvToggle: document.querySelector("#tvToggle"),
  resumePlaybackButton: document.querySelector("#resumePlaybackButton"),
  visualizerPanel: document.querySelector("#visualizerPanel"),
  visualizerCanvas: document.querySelector("#visualizerCanvas"),
  fullscreenVisualizerButton: document.querySelector("#fullscreenVisualizerButton"),
  tvView: document.querySelector("#tvView"),
  tvStationName: document.querySelector("#tvStationName"),
  tvStationMeta: document.querySelector("#tvStationMeta"),
  tvClock: document.querySelector("#tvClock"),
  tvLogo: document.querySelector("#tvLogo"),
  tvCanvas: document.querySelector("#tvCanvas"),
  exitTvButton: document.querySelector("#exitTvButton"),
  songFinderButton: document.querySelector("#songFinderButton"),
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
  syncFilterDisclosure();
  await Promise.all([loadFilterOptions(), loadStations(true)]);
  await handleInitialRoute();
}

function bindEvents() {
  const debouncedSearch = debounce(() => loadStations(true));

  els.searchInput.addEventListener("input", debouncedSearch);
  els.countrySelect.addEventListener("change", () => loadStations(true));
  els.languageSelect.addEventListener("change", () => loadStations(true));
  els.codecSelect.addEventListener("change", () => loadStations(true));
  els.sourceSelect.addEventListener("change", () => loadStations(true));
  els.orderSelect.addEventListener("change", () => loadStations(true));
  els.httpsOnlyInput.addEventListener("change", () => loadStations(true));
  els.hideHlsInput.addEventListener("change", () => loadStations(true));
  els.logoOnlyInput.addEventListener("change", () => loadStations(true));
  els.minBitrateInput.addEventListener("input", debounce(() => loadStations(true), 250));
  els.refreshButton.addEventListener("click", () => loadStations(true));
  els.randomButton.addEventListener("click", playRandomStation);
  els.loadMoreButton.addEventListener("click", () => loadStations(false));
  els.visualizerToggle.addEventListener("click", toggleVisualizer);
  els.tvToggle.addEventListener("click", openCurrentStationInTvMode);
  els.songFinderButton.addEventListener("click", openSongFinder);
  els.resumePlaybackButton.addEventListener("click", resumeBlockedPlayback);
  els.fullscreenVisualizerButton.addEventListener("click", toggleVisualizerFullscreen);
  els.exitTvButton.addEventListener("click", exitTvMode);
  document.addEventListener("fullscreenchange", resizeVisualizerCanvas);
  window.addEventListener("resize", resizeVisualizerCanvas);
  window.addEventListener("resize", syncFilterDisclosure);
  window.addEventListener("hashchange", handleInitialRoute);
  els.audioPlayer.addEventListener("loadstart", () => updatePlayerStatus("Connectant..."));
  els.audioPlayer.addEventListener("waiting", () => updatePlayerStatus("Connectant..."));
  els.audioPlayer.addEventListener("playing", () => {
    setStatus("Reproduint", "ok");
    updatePlayerStatus("Reproduint");
    setPlaybackResumeVisible(false);
  });
  els.audioPlayer.addEventListener("error", handlePlaybackError);

  document.querySelectorAll("[data-preset]").forEach((button) => {
    button.addEventListener("click", () => applyPreset(button.dataset.preset));
  });
}

function syncFilterDisclosure() {
  const disclosure = document.querySelector(".filter-disclosure");
  if (!disclosure) return;

  const mobile = window.matchMedia("(max-width: 640px)").matches;
  if (state.filtersMobileMode === mobile) return;

  state.filtersMobileMode = mobile;
  if (mobile) {
    disclosure.removeAttribute("open");
  } else {
    disclosure.setAttribute("open", "");
  }
}

async function loadFilterOptions() {
  try {
    const [countries, languages, codecs] = await Promise.all([
      getJson("/json/countries?hidebroken=true&order=stationcount&reverse=true"),
      getJson("/json/languages?hidebroken=true&order=stationcount&reverse=true"),
      getJson("/json/codecs?hidebroken=true&order=stationcount&reverse=true"),
    ]);

    fillSelect(els.countrySelect, countries, "name", "iso_3166_1", "Tots");
    fillSelect(els.languageSelect, languages, "name", "name", "Tots");
    fillSelect(els.codecSelect, codecs, "name", "name", "Tots");
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

    const nextStations = reset ? items : state.stations.concat(items);
    state.stations = dedupeStations(nextStations);
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

  if (els.sourceSelect.value === "custom") {
    return loadCustomStations();
  }

  if (els.sourceSelect.value === "casterclub") {
    return loadCasterClubStations();
  }

  return loadAllSourcesStations();
}

async function loadAllSourcesStations() {
  const results = await Promise.allSettled([
    loadCustomStations(),
    loadRadioBrowserStations(),
    loadIprdStations(),
    loadCasterClubStations(),
  ]);
  const [customStations, radioBrowserStations, iprdStations, casterClubStations] = results.map((result) => (
    result.status === "fulfilled" ? result.value : []
  ));

  if (!customStations.length && !radioBrowserStations.length && !iprdStations.length && !casterClubStations.length) {
    throw new Error("Cap font ha retornat emissores");
  }

  return dedupeStations(interleaveStations(customStations, radioBrowserStations, iprdStations, casterClubStations)).slice(0, PAGE_SIZE);
}

async function loadRadioBrowserStations() {
  const params = buildRadioBrowserParams();
  const items = await getJson(`/json/stations/search?${params.toString()}`);
  return items.map(normalizeRadioBrowserStation).filter(matchesQualityFilters);
}

async function loadIprdStations() {
  const catalog = await getIprdCatalog();
  const filtered = catalog
    .filter(matchesIprdFilters)
    .sort(sortIprdStations);

  return filtered
    .slice(state.offset, state.offset + PAGE_SIZE)
    .map(normalizeIprdStation)
    .filter(matchesQualityFilters);
}

async function loadCustomStations() {
  const catalog = await getCustomCatalog();
  const filtered = catalog
    .filter(matchesCustomFilters)
    .sort(sortCustomStations);

  return filtered
    .slice(state.offset, state.offset + PAGE_SIZE)
    .map(normalizeCustomStation)
    .filter(matchesQualityFilters);
}

async function loadCasterClubStations() {
  const firstPage = Math.floor(state.offset / PAGE_SIZE) * 2 + 1;
  const pages = await Promise.all([
    fetchCasterClubPage(firstPage),
    fetchCasterClubPage(firstPage + 1),
  ]);
  return pages
    .flat()
    .map(normalizeCasterClubStation)
    .filter(matchesCasterClubClientFilters)
    .filter(matchesQualityFilters)
    .slice(0, PAGE_SIZE);
}

async function fetchCasterClubPage(page) {
  const params = new URLSearchParams({
    page,
    order: els.orderSelect.value,
    preset: state.preset,
  });
  const search = els.searchInput.value.trim();
  if (search) params.set("search", search);
  if (els.codecSelect.value) params.set("codec", els.codecSelect.value);

  const response = await fetch(`${CASTERCLUB_SOURCE_URL}?${params.toString()}`, {
    headers: {
      "Accept": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`CasterClub ha retornat ${response.status}`);
  }

  const payload = await response.json();
  return Array.isArray(payload.stations) ? payload.stations : [];
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

function matchesQualityFilters(station) {
  const streamUrl = station.streamUrl || station.url_resolved || station.url || "";
  const minBitrate = Number(els.minBitrateInput.value) || 0;

  if (els.httpsOnlyInput.checked && !streamUrl.toLowerCase().startsWith("https://")) {
    return false;
  }

  if (els.hideHlsInput.checked && Number(station.hls) === 1) {
    return false;
  }

  if (els.logoOnlyInput.checked && !station.favicon) {
    return false;
  }

  if (minBitrate > 0 && (Number(station.bitrate) || 0) < minBitrate) {
    return false;
  }

  return true;
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
  if (els.httpsOnlyInput.checked) params.set("is_https", "true");

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

async function getCustomCatalog() {
  if (state.customStations) {
    return state.customStations;
  }

  const response = await fetch(CUSTOM_CATALOG_URL, {
    cache: "no-store",
    headers: {
      "Accept": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Cataleg Quexulo ha retornat ${response.status}`);
  }

  const catalog = await response.json();
  state.customStations = Array.isArray(catalog.stations) ? catalog.stations : [];
  return state.customStations;
}

function fillSelect(select, items, labelKey, valueKey, defaultLabel) {
  const currentValue = select.value;
  select.replaceChildren(new Option(defaultLabel, ""));

  items
    .filter((item) => item[labelKey] && item[valueKey])
    .sort((a, b) => String(a[labelKey]).localeCompare(String(b[labelKey]), "ca", { sensitivity: "base" }))
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

function matchesCustomFilters(station) {
  const search = els.searchInput.value.trim().toLowerCase();
  const tags = Array.isArray(station.tags) ? station.tags : [];
  const streams = Array.isArray(station.streams) ? station.streams : [];
  const searchableText = [
    station.name,
    station.country,
    station.city,
    station.language,
    station.website,
    ...tags,
  ].filter(Boolean).join(" ").toLowerCase();

  if (search && !searchableText.includes(search)) return false;
  if (els.countrySelect.value && getCountryCode(station.country) !== els.countrySelect.value) return false;
  if (els.languageSelect.value && !hasCustomLanguage(station, els.languageSelect.value.toLowerCase())) return false;
  if (els.codecSelect.value && !streams.some((stream) => String(stream.codec || "").toLowerCase() === els.codecSelect.value.toLowerCase())) return false;
  if (state.preset === "music" && !hasCustomTerm(station, "music") && !hasCustomTerm(station, "musica")) return false;
  if (state.preset === "news" && !hasCustomTerm(station, "news") && !hasCustomTerm(station, "noticies")) return false;
  if (state.preset === "ca" && !hasCustomLanguage(station, "catalan") && !hasCustomLanguage(station, "catala") && !hasCustomTerm(station, "catala")) return false;

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

function hasCustomTerm(station, term) {
  return (station.tags || [])
    .map((value) => String(value).toLowerCase())
    .some((value) => value.includes(term));
}

function hasCustomLanguage(station, language) {
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

function sortCustomStations(a, b) {
  const order = els.orderSelect.value;

  if (order === "name") {
    return String(a.name || "").localeCompare(String(b.name || ""), "ca", { sensitivity: "base" });
  }

  return (Number(b.priority) || 0) - (Number(a.priority) || 0)
    || String(a.name || "").localeCompare(String(b.name || ""), "ca", { sensitivity: "base" });
}

function getBestReliability(station) {
  const streams = Array.isArray(station.streams) ? station.streams : [];
  return streams.reduce((best, stream) => Math.max(best, Number(stream.reliability) || 0), 0);
}

function normalizeRadioBrowserStation(station) {
  return {
    ...station,
    shareSource: "radio-browser",
    shareId: station.stationuuid,
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
    shareSource: "iprd",
    shareId: station.id || station.name,
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
    hls: String(stream.url || "").toLowerCase().includes(".m3u8") ? 1 : 0,
    tagsList: [...new Set(tagsList)],
    statLabel: "Fiabilitat",
    statValue: stream.reliability ? `${Math.round(Number(stream.reliability) * 100)}%` : "n/d",
  };
}

function normalizeCustomStation(station) {
  const streams = getSortedCustomStreams(station);
  const stream = streams[0] || {};
  const tagsList = Array.isArray(station.tags) ? station.tags.filter(Boolean) : [];

  return {
    stationuuid: `custom:${station.id || station.name}`,
    shareSource: "custom",
    shareId: station.id || station.name,
    name: station.name,
    country: station.country,
    state: station.city || "",
    language: Array.isArray(station.language) ? station.language.join(", ") : station.language,
    codec: stream.codec || "",
    bitrate: stream.bitrate || 0,
    favicon: station.logo || "",
    homepage: station.website || "",
    source: "Quexulo",
    streamUrl: stream.url,
    streamUrls: streams.map((item) => item.url).filter(Boolean),
    url: stream.url,
    url_resolved: stream.url,
    hls: String(stream.url || "").toLowerCase().includes(".m3u8") ? 1 : 0,
    tagsList: [...new Set(tagsList)],
    statLabel: "Prioritat",
    statValue: station.priority || "n/d",
  };
}

function normalizeCasterClubStation(station) {
  const genreTags = String(station.genre || "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);

  return {
    stationuuid: `casterclub:${station.id || station.name}`,
    shareSource: "casterclub",
    shareId: station.id || station.name,
    name: station.name,
    country: station.country || "",
    state: "",
    language: "",
    codec: station.codec || "",
    bitrate: station.bitrate || 0,
    favicon: "",
    homepage: station.homepage || "",
    source: "CasterClub",
    streamUrl: station.streamUrl,
    streamUrls: [station.streamUrl].filter(Boolean),
    url: station.streamUrl,
    url_resolved: station.streamUrl,
    hls: String(station.streamUrl || "").toLowerCase().includes(".m3u8") ? 1 : 0,
    tagsList: [...new Set(genreTags.length ? genreTags : ["radio"])],
    statLabel: "Oients",
    statValue: station.listeners || 0,
    nowPlayingTitle: station.nowPlaying || "",
  };
}

function matchesCasterClubClientFilters(station) {
  if (els.countrySelect.value && getCountryCode(station.country) !== els.countrySelect.value) return false;
  if (els.languageSelect.value) return false;

  if (state.preset === "ca") {
    const searchable = [station.name, station.country, station.tagsList?.join(" ")]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return searchable.includes("catal") || searchable.includes("andorra");
  }

  return true;
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

function getSortedCustomStreams(station) {
  const streams = Array.isArray(station.streams) ? station.streams : [];
  return streams
    .filter((stream) => stream.url)
    .sort((a, b) => (
      (Number(b.priority) || 0) - (Number(a.priority) || 0)
      || (Number(b.bitrate) || 0) - (Number(a.bitrate) || 0)
    ));
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

function playRandomStation() {
  const playableStations = state.stations.filter((station) => (
    station.streamUrl || station.url_resolved || station.url
  ));

  if (!playableStations.length) {
    setStatus("Carrega emissores abans", "error");
    return;
  }

  const randomIndex = Math.floor(Math.random() * playableStations.length);
  playStation(playableStations[randomIndex]);
}

function toggleVisualizer() {
  state.visualizerOpen = !state.visualizerOpen;
  els.visualizerPanel.hidden = !state.visualizerOpen;
  els.visualizerToggle.classList.toggle("active", state.visualizerOpen);
  els.visualizerToggle.setAttribute("aria-label", state.visualizerOpen ? "Amaga visualitzador" : "Mostra visualitzador");

  if (state.visualizerOpen) {
    startVisualizer();
  } else {
    stopVisualizer();
  }
}

function startVisualizer() {
  stopVisualizer();
  setupVisualizerProbe();
  resizeVisualizerCanvas();
  drawVisualizer();
}

function toggleVisualizerFullscreen() {
  if (!document.fullscreenElement) {
    els.visualizerPanel.requestFullscreen?.();
  } else {
    document.exitFullscreen?.();
  }
}

function resizeVisualizerCanvas() {
  const canvas = els.visualizerCanvas;
  const rect = canvas.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  const nextWidth = Math.max(640, Math.floor(rect.width * scale));
  const nextHeight = Math.max(220, Math.floor(rect.height * scale));

  if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
    canvas.width = nextWidth;
    canvas.height = nextHeight;
  }

  const fullscreen = document.fullscreenElement === els.visualizerPanel;
  els.fullscreenVisualizerButton.textContent = fullscreen ? "Surt de pantalla completa" : "Pantalla completa";
}

function stopVisualizer() {
  if (state.visualizerFrame) {
    cancelAnimationFrame(state.visualizerFrame);
    state.visualizerFrame = null;
  }
}

function setupVisualizerProbe() {
  const streamUrl = els.audioPlayer.currentSrc || els.audioPlayer.src;
  if (!streamUrl || !canUseLocalProxy() || !window.AudioContext && !window.webkitAudioContext) {
    return;
  }

  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    state.audioContext = state.audioContext || new AudioContextClass();

    if (!state.visualizerSource) {
      state.visualizerSource = state.audioContext.createMediaElementSource(els.audioPlayer);
    }

    if (!state.analyser) {
      state.analyser = state.audioContext.createAnalyser();
      state.analyser.fftSize = 1024;
      state.analyser.smoothingTimeConstant = 0.74;
      state.frequencyData = new Uint8Array(state.analyser.frequencyBinCount);
      state.waveformData = new Uint8Array(state.analyser.fftSize);
      state.visualizerSource.connect(state.analyser);
      state.analyser.connect(state.audioContext.destination);
    }

    state.audioContext.resume().catch(() => {});
  } catch (error) {
    console.warn("Visualitzador real no disponible; usant mode animat", error);
    state.analyser = null;
    state.frequencyData = null;
    state.waveformData = null;
  }
}

function drawVisualizer() {
  const canvas = els.visualizerCanvas;
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const data = getVisualizerData();

  ctx.clearRect(0, 0, width, height);
  drawVisualizerBackdrop(ctx, width, height, data.real);

  drawWave(ctx, data.waveform, data.frequency, width, height, data.real);

  drawSignalBadge(ctx, width, height, data.real);

  state.visualizerFrame = requestAnimationFrame(drawVisualizer);
}

function getVisualizerData() {
  if (state.analyser && state.frequencyData && state.waveformData) {
    state.analyser.getByteFrequencyData(state.frequencyData);
    state.analyser.getByteTimeDomainData(state.waveformData);

    const signal = state.frequencyData.reduce((total, value) => total + value, 0) / state.frequencyData.length;
    if (signal > 1.5) {
      state.lastSignalAt = performance.now();
      return {
        frequency: state.frequencyData,
        waveform: state.waveformData,
        real: true,
      };
    }
  }

  return getFallbackVisualizerData();
}

function getFallbackVisualizerData() {
  const frequency = new Uint8Array(128);
  const waveform = new Uint8Array(256);
  const time = performance.now() / 1000;
  const playing = !els.audioPlayer.paused && !els.audioPlayer.ended;
  const beat = Math.pow((Math.sin(time * 3.2) + 1) / 2, 3);
  const energy = playing ? 0.82 + beat * 0.5 : 0.18;

  frequency.forEach((_, index) => {
    const bass = Math.sin(time * 6.1 + index * 0.07) * Math.max(0, 1 - index / 58);
    const wave = Math.sin(time * 3.4 + index * 0.22);
    const shimmer = Math.sin(time * 12 + index * 0.47);
    frequency[index] = Math.max(8, Math.min(255, Math.round((58 + bass * 96 + wave * 46 + shimmer * 16) * energy)));
  });

  waveform.forEach((_, index) => {
    waveform[index] = Math.round(128 + Math.sin(time * 3 + index * 0.08) * 44 * energy + Math.sin(time * 7 + index * 0.018) * 22 * energy);
  });

  return { frequency, waveform, real: false };
}

function drawVisualizerBackdrop(ctx, width, height, real) {
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#071a22");
  gradient.addColorStop(0.42, "#111827");
  gradient.addColorStop(1, real ? "#062f2c" : "#1f2937");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  const time = performance.now() / 1000;
  for (let index = 0; index < 36; index += 1) {
    const x = (Math.sin(time * 0.3 + index * 1.7) * 0.5 + 0.5) * width;
    const y = (Math.cos(time * 0.25 + index * 1.2) * 0.5 + 0.5) * height;
    ctx.fillStyle = index % 2 === 0 ? "rgba(45, 212, 191, 0.12)" : "rgba(245, 158, 11, 0.10)";
    ctx.beginPath();
    ctx.arc(x, y, 2 + (index % 5), 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawWave(ctx, waveform, frequency, width, height, real) {
  const bass = getBandAverage(frequency, 0, 36);
  const mid = getBandAverage(frequency, 36, 190);
  const treble = getBandAverage(frequency, 190, frequency.length);
  const time = performance.now() / 1000;
  const centerY = height / 2;
  const amplitude = height * (0.16 + bass * 0.24 + mid * 0.16);
  const drift = Math.sin(time * 0.9) * height * 0.025;
  const points = buildWavePoints(waveform, width, centerY + drift, amplitude);

  drawWaveAura(ctx, points, width, height, bass, mid, treble);

  const fill = ctx.createLinearGradient(0, height * 0.18, 0, height * 0.88);
  fill.addColorStop(0, "rgba(94, 234, 212, 0.26)");
  fill.addColorStop(0.52, real ? "rgba(20, 184, 166, 0.12)" : "rgba(148, 163, 184, 0.10)");
  fill.addColorStop(1, "rgba(251, 191, 36, 0.18)");
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(points[0].x, centerY);
  points.forEach((point, index) => {
    if (index === 0) ctx.lineTo(point.x, point.y);
    else {
      const previous = points[index - 1];
      const controlX = (previous.x + point.x) / 2;
      ctx.quadraticCurveTo(previous.x, previous.y, controlX, (previous.y + point.y) / 2);
    }
  });
  ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
  ctx.lineTo(width, height * 0.82);
  ctx.lineTo(0, height * 0.82);
  ctx.closePath();
  ctx.fill();

  drawWaveLine(ctx, points, {
    colorA: "#67e8f9",
    colorB: "#5eead4",
    width: 5 + bass * 7,
    glow: 24 + bass * 44,
    alpha: 0.96,
  });

  const mirror = points.map((point) => ({
    x: point.x,
    y: centerY - (point.y - centerY) * (0.52 + treble * 0.25),
  }));
  drawWaveLine(ctx, mirror, {
    colorA: "#fbbf24",
    colorB: "#f8fafc",
    width: 2.2 + treble * 3,
    glow: 12 + treble * 28,
    alpha: 0.68,
  });

  drawWaveSparkles(ctx, points, bass, treble, time);

  ctx.save();
  ctx.strokeStyle = "rgba(248, 250, 252, 0.18)";
  ctx.lineWidth = 1;
  ctx.setLineDash([8, 12]);
  ctx.beginPath();
  ctx.moveTo(width * 0.04, centerY);
  ctx.lineTo(width * 0.96, centerY);
  ctx.stroke();
  ctx.restore();
}

function buildWavePoints(waveform, width, centerY, amplitude) {
  const pointCount = Math.min(180, Math.max(72, Math.floor(width / 8)));
  const points = [];

  for (let index = 0; index < pointCount; index += 1) {
    const ratio = index / (pointCount - 1);
    const cursor = Math.floor(ratio * (waveform.length - 1));
    const previous = waveform[Math.max(0, cursor - 1)] || 128;
    const current = waveform[cursor] || 128;
    const next = waveform[Math.min(waveform.length - 1, cursor + 1)] || 128;
    const normalized = ((previous + current * 2 + next) / 4 - 128) / 128;
    const edgeFade = Math.sin(ratio * Math.PI);
    points.push({
      x: ratio * width,
      y: centerY + normalized * amplitude * (0.35 + edgeFade * 0.85),
    });
  }

  return points;
}

function drawWaveAura(ctx, points, width, height, bass, mid, treble) {
  const pulse = 0.35 + bass * 0.65;
  const radial = ctx.createRadialGradient(width * 0.52, height * 0.5, height * 0.08, width * 0.52, height * 0.5, width * 0.72);
  radial.addColorStop(0, `rgba(45, 212, 191, ${0.16 + pulse * 0.18})`);
  radial.addColorStop(0.52, `rgba(14, 165, 233, ${0.06 + mid * 0.12})`);
  radial.addColorStop(1, "rgba(15, 23, 42, 0)");
  ctx.fillStyle = radial;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.globalAlpha = 0.34 + treble * 0.22;
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(248, 250, 252, 0.08)";
  for (let index = 0; index < 5; index += 1) {
    const y = height * (0.24 + index * 0.13);
    ctx.beginPath();
    ctx.moveTo(width * 0.04, y);
    ctx.lineTo(width * 0.96, y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawWaveLine(ctx, points, options) {
  const gradient = ctx.createLinearGradient(0, 0, points[points.length - 1].x, 0);
  gradient.addColorStop(0, options.colorA);
  gradient.addColorStop(0.5, options.colorB);
  gradient.addColorStop(1, options.colorA);

  ctx.save();
  ctx.globalAlpha = options.alpha;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = options.width;
  ctx.strokeStyle = gradient;
  ctx.shadowColor = options.colorB;
  ctx.shadowBlur = options.glow;
  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else {
      const previous = points[index - 1];
      const controlX = (previous.x + point.x) / 2;
      ctx.quadraticCurveTo(previous.x, previous.y, controlX, (previous.y + point.y) / 2);
    }
  });
  ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
  ctx.stroke();
  ctx.restore();
}

function drawWaveSparkles(ctx, points, bass, treble, time) {
  ctx.save();
  for (let index = 0; index < 10; index += 1) {
    const cursor = Math.floor(((index * 0.097 + time * 0.035) % 1) * (points.length - 1));
    const point = points[cursor];
    const radius = 1.5 + ((index % 4) + bass * 4 + treble * 3);
    ctx.globalAlpha = 0.18 + ((Math.sin(time * 2.2 + index) + 1) / 2) * 0.34;
    ctx.fillStyle = index % 2 ? "#fbbf24" : "#67e8f9";
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur = 12 + radius * 3;
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawSignalBadge(ctx, width, height, real) {
  const text = real ? "audio real" : (canUseLocalProxy() ? "esperant senyal" : "proxy no disponible");
  const paddingX = 12;
  const badgeHeight = 28;
  ctx.font = "700 13px system-ui, sans-serif";
  const badgeWidth = ctx.measureText(text).width + paddingX * 2;
  const x = width - badgeWidth - 14;
  const y = 14;

  ctx.shadowBlur = 0;
  ctx.fillStyle = real ? "rgba(6, 95, 70, 0.84)" : "rgba(127, 29, 29, 0.74)";
  ctx.beginPath();
  ctx.roundRect(x, y, badgeWidth, badgeHeight, 7);
  ctx.fill();
  ctx.fillStyle = "#f8fafc";
  ctx.fillText(text, x + paddingX, y + 18);
}

function getBandAverage(data, start, end) {
  const from = Math.max(0, start);
  const to = Math.min(data.length, end);
  let total = 0;

  for (let index = from; index < to; index += 1) {
    total += data[index];
  }

  return total / Math.max(1, to - from) / 255;
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
        ${tags.length ? tags.map((tag) => `<button class="tag tag-button" type="button" data-tag-search="${escapeAttribute(tag)}">${escapeHtml(tag)}</button>`).join("") : `<button class="tag tag-button" type="button" data-tag-search="radio">radio</button>`}
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

  els.stationGrid.querySelectorAll("[data-tag-search]").forEach((button) => {
    button.addEventListener("click", () => searchByTag(button.dataset.tagSearch));
  });
}

function searchByTag(tag) {
  const disclosure = document.querySelector(".filter-disclosure");
  if (disclosure && window.matchMedia("(max-width: 640px)").matches) {
    disclosure.setAttribute("open", "");
  }

  state.preset = "all";
  document.querySelectorAll("[data-preset]").forEach((button) => {
    button.classList.toggle("active", button.dataset.preset === "all");
  });
  els.searchInput.value = tag;
  loadStations(true);
}

function findStation(uuid) {
  return state.stations.find((station) => station.stationuuid === uuid)
    || state.favorites.get(uuid)
    || state.recents.get(uuid);
}

async function handleInitialRoute() {
  const route = getStationRoute();
  if (!route) return;

  const existing = findStationByRoute(route.source, route.id);
  if (existing) {
    if (isTvRoute()) enterTvMode(existing);
    playStation(existing, 0, { updateRoute: false });
    return;
  }

  try {
    setStatus("Carregant emissora", "ok");
    const station = await fetchStationByRoute(route.source, route.id);
    if (!station) {
      setStatus("Emissora no trobada", "error");
      return;
    }

    state.stations = dedupeStations([station, ...state.stations]);
    renderStations();
    if (isTvRoute()) enterTvMode(station);
    playStation(station, 0, { updateRoute: false });
  } catch (error) {
    console.error(error);
    setStatus("No s'ha pogut carregar l'enllac", "error");
  }
}

function isTvRoute() {
  return new URLSearchParams(location.search).get("view") === "tv";
}

function getStationRoute() {
  const match = location.hash.match(/^#\/station\/([^/]+)\/(.+)$/);
  if (!match) return null;

  return {
    source: decodeURIComponent(match[1]),
    id: decodeURIComponent(match[2]),
  };
}

function findStationByRoute(source, id) {
  return [...state.stations, ...state.favorites.values(), ...state.recents.values()]
    .find((station) => station.shareSource === source && station.shareId === id);
}

async function fetchStationByRoute(source, id) {
  if (source === "radio-browser") {
    const items = await getJson(`/json/stations/byuuid?uuids=${encodeURIComponent(id)}`);
    return items[0] ? normalizeRadioBrowserStation(items[0]) : null;
  }

  if (source === "iprd") {
    const catalog = await getIprdCatalog();
    const station = catalog.find((item) => String(item.id || item.name) === id);
    return station ? normalizeIprdStation(station) : null;
  }

  if (source === "custom") {
    const catalog = await getCustomCatalog();
    const station = catalog.find((item) => String(item.id || item.name) === id);
    return station ? normalizeCustomStation(station) : null;
  }

  if (source === "casterclub") {
    const response = await fetch(`/sources/casterclub/station?id=${encodeURIComponent(id)}`, {
      headers: {
        "Accept": "application/json",
      },
    });

    if (!response.ok) return null;
    const payload = await response.json();
    return payload.station ? normalizeCasterClubStation(payload.station) : null;
  }

  return null;
}

function getShareUrl(station) {
  const source = station.shareSource || (station.source === "IPRD" ? "iprd" : "radio-browser");
  const id = station.shareId || station.stationuuid;
  return `${location.origin}${location.pathname}#/station/${encodeURIComponent(source)}/${encodeURIComponent(id)}`;
}

function getTvUrl(station) {
  const source = station.shareSource || (station.source === "IPRD" ? "iprd" : "radio-browser");
  const id = station.shareId || station.stationuuid;
  return `${location.origin}${location.pathname}?view=tv#/station/${encodeURIComponent(source)}/${encodeURIComponent(id)}`;
}

function updateTvRoute(station) {
  history.replaceState(null, "", getTvUrl(station));
}

function updateStationRoute(station) {
  history.replaceState(null, "", getShareUrl(station));
}

async function copyStationLink(station, button) {
  const url = getShareUrl(station);

  try {
    await navigator.clipboard.writeText(url);
    button.textContent = "Copiat";
  } catch {
    window.prompt("Copia aquest enllac", url);
  }

  window.setTimeout(() => {
    button.textContent = "Comparteix";
  }, 1400);
}

function enterTvMode(station) {
  els.tvView.hidden = false;
  document.body.classList.add("tv-active");
  updateTvStation(station);
  startVisualizer();
  startTvClock();
  stopTvVisualizer();
  drawTvVisualizer();
}

function openStationInTvMode(station) {
  closeStationDetails();
  updateTvRoute(station);

  if (state.currentStation?.stationuuid !== station.stationuuid || els.audioPlayer.paused) {
    playStation(station, 0, { updateRoute: false });
  }

  enterTvMode(station);
}

function openCurrentStationInTvMode() {
  if (!state.currentStation) {
    setStatus("Tria una emissora abans", "error");
    return;
  }

  openStationInTvMode(state.currentStation);
}

function exitTvMode() {
  els.tvView.hidden = true;
  document.body.classList.remove("tv-active");
  stopTvVisualizer();
  window.clearInterval(state.tvClockTimer);

  if (state.currentStation) {
    window.history.replaceState(null, "", getShareUrl(state.currentStation));
  }
}

function updateTvStation(station) {
  els.tvStationName.textContent = station.name || "Radio";
  els.tvStationMeta.textContent = [station.country, station.source, station.codec].filter(Boolean).join(" - ");
  els.tvLogo.textContent = getInitials(station.name);
  els.tvLogo.style.backgroundImage = station.favicon ? `url("${station.favicon.replaceAll('"', "%22")}")` : "";
  els.tvLogo.classList.toggle("has-logo", Boolean(station.favicon));
}

function startTvClock() {
  updateTvClock();
  window.clearInterval(state.tvClockTimer);
  state.tvClockTimer = window.setInterval(updateTvClock, 1000);
}

function updateTvClock() {
  els.tvClock.textContent = new Intl.DateTimeFormat("ca", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());
}

function stopTvVisualizer() {
  if (state.tvFrame) {
    cancelAnimationFrame(state.tvFrame);
    state.tvFrame = null;
  }
}

function drawTvVisualizer() {
  const canvas = els.tvCanvas;
  const rect = canvas.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  const nextWidth = Math.max(900, Math.floor(rect.width * scale));
  const nextHeight = Math.max(420, Math.floor(rect.height * scale));

  if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
    canvas.width = nextWidth;
    canvas.height = nextHeight;
  }

  const ctx = canvas.getContext("2d");
  const data = getVisualizerData();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawVisualizerBackdrop(ctx, canvas.width, canvas.height, data.real);

  drawWave(ctx, data.waveform, data.frequency, canvas.width, canvas.height, data.real);

  drawSignalBadge(ctx, canvas.width, canvas.height, data.real);
  state.tvFrame = requestAnimationFrame(drawTvVisualizer);
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
        <button class="link-button" type="button" data-share-station="${escapeAttribute(station.stationuuid)}">Comparteix</button>
        <button class="link-button" type="button" data-tv-station="${escapeAttribute(station.stationuuid)}">Mode TV</button>
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
      return;
    }

    const shareButton = event.target.closest("[data-share-station]");
    if (shareButton) {
      const stationToShare = findStation(shareButton.dataset.shareStation);
      if (stationToShare) copyStationLink(stationToShare, shareButton);
      return;
    }

    const tvButton = event.target.closest("[data-tv-station]");
    if (tvButton) {
      const stationForTv = findStation(tvButton.dataset.tvStation);
      if (stationForTv) openStationInTvMode(stationForTv);
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

async function openSongFinder() {
  closeSongFinder();

  const source = getCurrentSongText();
  const parsed = parseSongText(source.text);
  const dialog = document.createElement("div");
  dialog.className = "modal-backdrop song-modal-backdrop";
  dialog.innerHTML = renderSongFinderShell(source, parsed);
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog || event.target.closest("[data-close-song-modal]")) {
      closeSongFinder();
    }
  });

  document.addEventListener("keydown", handleSongFinderKeydown);
  document.body.append(dialog);
  dialog.querySelector("[data-close-song-modal]").focus();

  if (!source.text) {
    renderSongFinderMessage("No tinc cap pista encara. Espera uns segons amb la radio sonant o prova una altra emissora.");
    return;
  }

  await enrichCurrentSong(source.text, parsed);
}

function renderSongFinderShell(source, parsed) {
  const title = parsed.title && parsed.artist
    ? `${parsed.artist} - ${parsed.title}`
    : source.text || "Sense metadades";

  return `
    <section class="station-modal song-modal" role="dialog" aria-modal="true" aria-label="Que sona">
      <button class="modal-close" type="button" data-close-song-modal aria-label="Tanca">x</button>
      <div class="modal-header">
        <div class="song-modal-icon">
          <svg class="song-finder-icon" aria-hidden="true" viewBox="0 0 24 24">
            <path d="M9 18V5l12-2v13"></path>
            <circle cx="6" cy="18" r="3"></circle>
            <circle cx="18" cy="16" r="3"></circle>
          </svg>
        </div>
        <div>
          <p class="modal-source">${escapeHtml(source.label)}</p>
          <h2>Que sona?</h2>
          <p>${escapeHtml(title)}</p>
        </div>
      </div>
      <div class="song-finder-status" id="songFinderStatus">Buscant dades gratuites...</div>
      <div class="song-results" id="songResults"></div>
    </section>
  `;
}

async function enrichCurrentSong(rawText, parsed) {
  const query = parsed.artist && parsed.title ? `${parsed.artist} ${parsed.title}` : rawText;
  const cacheKey = normalizeDedupeText(query);

  if (state.songLookupCache.has(cacheKey)) {
    renderSongFinderResults(state.songLookupCache.get(cacheKey), parsed);
    return;
  }

  try {
    const params = new URLSearchParams({ q: query });
    if (parsed.artist) params.set("artist", parsed.artist);
    if (parsed.title) params.set("title", parsed.title);

    const response = await fetch(`/song/search?${params.toString()}`, {
      headers: {
        "Accept": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Song search ha retornat ${response.status}`);
    }

    const payload = await response.json();
    state.songLookupCache.set(cacheKey, payload);
    renderSongFinderResults(payload, parsed);
  } catch (error) {
    console.error(error);
    renderSongFinderMessage("He trobat el text de l'emissora, pero no he pogut enriquir-lo ara mateix.");
  }
}

function renderSongFinderResults(payload, parsed) {
  const resultsContainer = document.querySelector("#songResults");
  const status = document.querySelector("#songFinderStatus");
  if (!resultsContainer || !status) return;

  const itunes = Array.isArray(payload.itunes) ? payload.itunes : [];
  const musicbrainz = Array.isArray(payload.musicbrainz) ? payload.musicbrainz : [];
  const primary = pickBestSongResult(itunes, parsed) || itunes[0];

  if (!primary && !musicbrainz.length) {
    renderSongFinderMessage("Tinc una pista, pero no he trobat cap coincidencia clara a iTunes ni MusicBrainz.");
    return;
  }

  status.textContent = primary ? "Coincidencia gratuita trobada" : "Coincidencies de MusicBrainz";
  resultsContainer.innerHTML = `
    ${primary ? renderPrimarySongResult(primary) : ""}
    ${musicbrainz.length ? `
      <div class="song-secondary">
        <h3>Altres coincidencies</h3>
        ${musicbrainz.slice(0, 4).map(renderSecondarySongResult).join("")}
      </div>
    ` : ""}
  `;
}

function pickBestSongResult(results, parsed) {
  if (!parsed.artist || !parsed.title) return results[0] || null;

  const artist = parsed.artist.toLowerCase();
  const title = parsed.title.toLowerCase();
  return results.find((item) => (
    String(item.artist || "").toLowerCase().includes(artist)
    && String(item.title || "").toLowerCase().includes(title)
  )) || results[0] || null;
}

function renderPrimarySongResult(result) {
  return `
    <article class="song-primary">
      <div class="song-artwork">${result.artwork ? `<img src="${escapeAttribute(result.artwork)}" alt="" loading="lazy">` : `<svg class="song-finder-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>`}</div>
      <div>
        <p class="modal-source">${escapeHtml(result.source || "iTunes")}</p>
        <h3>${escapeHtml(result.title || "Titol desconegut")}</h3>
        <p>${escapeHtml([result.artist, result.album].filter(Boolean).join(" - ") || "Artista desconegut")}</p>
        ${result.releaseDate ? `<span>${escapeHtml(String(result.releaseDate).slice(0, 10))}</span>` : ""}
        <div class="detail-links song-links">
          ${result.url ? `<a href="${escapeAttribute(result.url)}" target="_blank" rel="noreferrer">Obre fitxa</a>` : ""}
          ${result.previewUrl ? `<a href="${escapeAttribute(result.previewUrl)}" target="_blank" rel="noreferrer">Preview</a>` : ""}
        </div>
      </div>
    </article>
  `;
}

function renderSecondarySongResult(result) {
  return `
    <a class="song-secondary-row" href="${escapeAttribute(result.url || "#")}" target="_blank" rel="noreferrer">
      <strong>${escapeHtml(result.title || "Titol desconegut")}</strong>
      <span>${escapeHtml([result.artist, result.album, result.releaseDate].filter(Boolean).join(" - "))}</span>
    </a>
  `;
}

function renderSongFinderMessage(message) {
  const status = document.querySelector("#songFinderStatus");
  const resultsContainer = document.querySelector("#songResults");
  if (status) status.textContent = "Sense coincidencia clara";
  if (resultsContainer) {
    resultsContainer.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
  }
}

function getCurrentSongText() {
  if (state.nowPlaying) {
    return { text: state.nowPlaying, label: "Metadades de la radio" };
  }

  if (state.currentStation?.nowPlayingTitle) {
    return { text: state.currentStation.nowPlayingTitle, label: "Dades de la font" };
  }

  return { text: "", label: "Sense metadades" };
}

function parseSongText(value) {
  let text = String(value || "")
    .replace(/\s+/g, " ")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\b(on air|now playing|playing now|ara sona)\b:?/gi, "")
    .replace(/\[[^\]]*]/g, "")
    .replace(/\([^)]*(radio|live|official|remaster|advert|publi)[^)]*\)/gi, "")
    .trim();

  text = text.replace(/^[-:|]+|[-:|]+$/g, "").trim();
  const byMatch = text.match(/^(.+?)\s+by\s+(.+)$/i);
  if (byMatch) {
    return cleanParsedSong(byMatch[2], byMatch[1], text);
  }

  const separators = [" - ", " – ", " — ", " :: ", " | "];
  for (const separator of separators) {
    if (text.includes(separator)) {
      const [artist, ...titleParts] = text.split(separator);
      return cleanParsedSong(artist, titleParts.join(separator), text);
    }
  }

  return { artist: "", title: text, query: text };
}

function cleanParsedSong(artist, title, fallback) {
  return {
    artist: String(artist || "").replace(/^artist:/i, "").trim(),
    title: String(title || "").replace(/^title:/i, "").trim(),
    query: fallback,
  };
}

function closeSongFinder() {
  document.querySelector(".song-modal-backdrop")?.remove();
  document.removeEventListener("keydown", handleSongFinderKeydown);
}

function handleSongFinderKeydown(event) {
  if (event.key === "Escape") {
    closeSongFinder();
  }
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

function playStation(station, streamIndex = 0, options = {}) {
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
  clearNowPlaying();
  setPlaybackResumeVisible(false);
  if (station.nowPlayingTitle) {
    setNowPlaying(station.nowPlayingTitle);
  }
  startMetadataStream(streamUrl);
  if (options.updateRoute !== false) {
    updateStationRoute(station);
  }
  els.audioPlayer.crossOrigin = "anonymous";
  els.audioPlayer.src = getAudioPlaybackUrl(streamUrl);
  if (state.visualizerOpen) {
    startVisualizer();
  }
  els.audioPlayer.play().catch(() => {
    setStatus("El navegador ha bloquejat la reproduccio", "error");
    updatePlayerStatus("Reproduccio bloquejada");
    setPlaybackResumeVisible(true);
    if (!els.tvView.hidden) {
      els.tvStationMeta.textContent = "Prem Reprendre per iniciar la reproduccio";
    }
  });

  els.playerName.textContent = station.name || "Radio sense nom";
  updatePlayerStatus("Connectant...");
  els.playerArt.textContent = getInitials(station.name);
  setStatus("Connectant", "ok");

  if (station.source === "Radio Browser") {
    fetch(`${API_BASE}/json/url/${station.stationuuid}`).catch(() => {});
  }
}

function getAudioPlaybackUrl(streamUrl) {
  if (!canUseLocalProxy()) {
    return streamUrl;
  }

  return `/stream?url=${encodeURIComponent(streamUrl)}`;
}

function startMetadataStream(streamUrl) {
  stopMetadataStream();

  if (!canUseLocalProxy() || typeof EventSource === "undefined") {
    return;
  }

  const metadataUrl = `/metadata?url=${encodeURIComponent(streamUrl)}`;
  const source = new EventSource(metadataUrl);
  state.metadataSource = source;

  source.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.title) {
        setNowPlaying(payload.title);
      }
    } catch {
      // Ignore malformed metadata packets.
    }
  };

  source.onerror = () => {
    stopMetadataStream();
  };
}

function stopMetadataStream() {
  if (state.metadataSource) {
    state.metadataSource.close();
    state.metadataSource = null;
  }
}

function setNowPlaying(title) {
  state.nowPlaying = title;
  els.nowPlaying.textContent = `Ara sona: ${title}`;
  els.nowPlaying.hidden = false;

  if (!els.tvView.hidden) {
    els.tvStationMeta.textContent = title;
  }
}

function clearNowPlaying() {
  state.nowPlaying = "";
  els.nowPlaying.textContent = "";
  els.nowPlaying.hidden = true;
}

function setPlaybackResumeVisible(visible) {
  els.resumePlaybackButton.hidden = !visible;
}

function resumeBlockedPlayback() {
  if (!state.currentStation) {
    setStatus("Tria una emissora abans", "error");
    return;
  }

  els.audioPlayer.play().then(() => {
    setPlaybackResumeVisible(false);
    setStatus("Reproduint", "ok");
    updatePlayerStatus("Reproduint");
  }).catch(() => {
    setStatus("No s'ha pogut reprendre", "error");
    updatePlayerStatus("Encara bloquejada");
  });
}

function canUseLocalProxy() {
  return location.protocol === "http:" || location.protocol === "https:";
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
    setPlaybackResumeVisible(false);
    playStation(station, nextIndex);
    return;
  }

  setStatus("Error de reproduccio", "error");
  setPlaybackResumeVisible(false);
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
  els.apiStatus.title = text;
  els.apiStatus.setAttribute("aria-label", text);
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
