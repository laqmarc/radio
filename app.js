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
  visualizerOpen: false,
  visualizerMode: "bars",
  tvMode: "bars",
  tvFrame: null,
  tvClockTimer: null,
  visualizerFrame: null,
  visualizerSource: null,
  audioContext: null,
  analyser: null,
  frequencyData: null,
  waveformData: null,
  lastSignalAt: 0,
  visualizerLevels: [],
  initialRouteHandled: false,
  filtersMobileMode: null,
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
  playerArt: document.querySelector("#playerArt"),
  visualizerToggle: document.querySelector("#visualizerToggle"),
  tvToggle: document.querySelector("#tvToggle"),
  visualizerPanel: document.querySelector("#visualizerPanel"),
  visualizerCanvas: document.querySelector("#visualizerCanvas"),
  fullscreenVisualizerButton: document.querySelector("#fullscreenVisualizerButton"),
  tvView: document.querySelector("#tvView"),
  tvStationName: document.querySelector("#tvStationName"),
  tvStationMeta: document.querySelector("#tvStationMeta"),
  tvClock: document.querySelector("#tvClock"),
  tvLogo: document.querySelector("#tvLogo"),
  tvCanvas: document.querySelector("#tvCanvas"),
  tvModeButton: document.querySelector("#tvModeButton"),
  exitTvButton: document.querySelector("#exitTvButton"),
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
  els.fullscreenVisualizerButton.addEventListener("click", toggleVisualizerFullscreen);
  els.tvModeButton.addEventListener("click", toggleTvVisualizerMode);
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
  });
  els.audioPlayer.addEventListener("error", handlePlaybackError);

  document.querySelectorAll("[data-visualizer-mode]").forEach((button) => {
    button.addEventListener("click", () => setVisualizerMode(button.dataset.visualizerMode));
  });

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

function setVisualizerMode(mode) {
  state.visualizerMode = mode === "wave" ? "wave" : "bars";
  document.querySelectorAll("[data-visualizer-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.visualizerMode === state.visualizerMode);
  });
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

  if (state.visualizerMode === "wave") {
    drawWave(ctx, data.waveform, data.frequency, width, height);
  } else {
    drawBars(ctx, data.frequency, width, height, data.real);
  }

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

function drawBars(ctx, frequency, width, height, real) {
  const bars = Math.min(84, Math.max(36, Math.floor(width / 14)));
  const gap = Math.max(2, Math.floor(width / 420));
  const barWidth = (width - gap * (bars - 1)) / bars;
  const glow = real ? 16 : 8;
  const levels = getSmoothedBarLevels(frequency, bars);
  drawFrequencyGuides(ctx, width, height);

  for (let index = 0; index < bars; index += 1) {
    const value = levels[index];
    const barHeight = Math.max(6, Math.pow(value, 0.72) * (height - 48));
    const x = index * (barWidth + gap);
    const y = height - barHeight - 30;
    const gradient = ctx.createLinearGradient(0, y, 0, height);
    gradient.addColorStop(0, index % 3 === 0 ? "#5eead4" : index % 3 === 1 ? "#fbbf24" : "#f8fafc");
    gradient.addColorStop(1, "#0f766e");
    ctx.shadowColor = index % 3 === 1 ? "rgba(251, 191, 36, 0.7)" : "rgba(45, 212, 191, 0.7)";
    ctx.shadowBlur = glow * value;
    ctx.fillStyle = gradient;
    ctx.fillRect(x, y, barWidth, barHeight);
  }

  ctx.shadowBlur = 0;
}

function getSmoothedBarLevels(frequency, bars) {
  if (state.visualizerLevels.length !== bars) {
    state.visualizerLevels = Array.from({ length: bars }, () => 0);
  }

  return state.visualizerLevels.map((previous, index) => {
    const startRatio = index / bars;
    const endRatio = (index + 1) / bars;
    const start = Math.floor(logFrequencyPosition(startRatio) * frequency.length);
    const end = Math.max(start + 1, Math.floor(logFrequencyPosition(endRatio) * frequency.length));
    let total = 0;

    for (let cursor = start; cursor < end; cursor += 1) {
      total += frequency[cursor] || 0;
    }

    const raw = total / (end - start) / 255;
    const compensation = 1 + Math.pow(startRatio, 1.35) * 2.1;
    const floor = startRatio > 0.72 ? 0.035 : 0.015;
    const normalized = Math.min(1, Math.max(floor, raw * compensation));
    const next = previous * 0.68 + normalized * 0.32;
    state.visualizerLevels[index] = next;
    return next;
  });
}

function logFrequencyPosition(ratio) {
  return (Math.exp(ratio * 4.2) - 1) / (Math.exp(4.2) - 1);
}

function drawFrequencyGuides(ctx, width, height) {
  const labels = [
    { text: "greus", x: width * 0.08 },
    { text: "mitjos", x: width * 0.42 },
    { text: "aguts", x: width * 0.78 },
  ];

  ctx.save();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(248, 250, 252, 0.12)";
  ctx.fillStyle = "rgba(248, 250, 252, 0.58)";
  ctx.font = "700 12px system-ui, sans-serif";

  labels.forEach((label) => {
    ctx.beginPath();
    ctx.moveTo(label.x, 14);
    ctx.lineTo(label.x, height - 24);
    ctx.stroke();
    ctx.fillText(label.text, label.x + 8, height - 10);
  });

  ctx.restore();
}

function drawWave(ctx, waveform, frequency, width, height) {
  const bass = getBandAverage(frequency, 0, 32);
  const mid = getBandAverage(frequency, 32, 180);
  const centerY = height / 2;
  const amplitude = height * (0.22 + bass * 0.2 + mid * 0.12);

  ctx.lineWidth = 3 + bass * 5;
  ctx.shadowColor = "rgba(45, 212, 191, 0.82)";
  ctx.shadowBlur = 14 + bass * 28;
  ctx.strokeStyle = "#5eead4";
  ctx.beginPath();

  waveform.forEach((value, index) => {
    const x = index / (waveform.length - 1) * width;
    const normalized = (value - 128) / 128;
    const y = centerY + normalized * amplitude;
    if (index === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });

  ctx.stroke();
  ctx.shadowBlur = 0;

  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(251, 191, 36, 0.86)";
  ctx.beginPath();
  waveform.forEach((value, index) => {
    const x = index / (waveform.length - 1) * width;
    const normalized = (value - 128) / 128;
    const y = centerY - normalized * amplitude * 0.62;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(248, 250, 252, 0.28)";
  ctx.beginPath();
  ctx.moveTo(0, height / 2);
  ctx.lineTo(width, height / 2);
  ctx.stroke();
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

function toggleTvVisualizerMode() {
  state.tvMode = state.tvMode === "bars" ? "wave" : "bars";
  els.tvModeButton.textContent = state.tvMode === "bars" ? "Veure ona" : "Veure barres";
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

  if (state.tvMode === "wave") {
    drawWave(ctx, data.waveform, data.frequency, canvas.width, canvas.height);
  } else {
    drawBars(ctx, data.frequency, canvas.width, canvas.height, data.real);
  }

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
    if (!els.tvView.hidden) {
      els.tvStationMeta.textContent = "Prem Sortir i torna a entrar, o inicia la reproduccio manualment";
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
