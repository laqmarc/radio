const API_BASE = "https://de1.api.radio-browser.info";
const PAGE_SIZE = 50;
const FAVORITES_KEY = "radio-atlas-favorites";

const state = {
  stations: [],
  offset: 0,
  loading: false,
  preset: "all",
  favorites: readFavorites(),
  hasMore: true,
};

const els = {
  apiStatus: document.querySelector("#apiStatus"),
  searchInput: document.querySelector("#searchInput"),
  countrySelect: document.querySelector("#countrySelect"),
  languageSelect: document.querySelector("#languageSelect"),
  codecSelect: document.querySelector("#codecSelect"),
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
  els.orderSelect.addEventListener("change", () => loadStations(true));
  els.refreshButton.addEventListener("click", () => loadStations(true));
  els.loadMoreButton.addEventListener("click", () => loadStations(false));

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
    setStatus("API connectada", "ok");
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

  state.loading = true;
  renderLoading(reset);

  try {
    const params = buildSearchParams();
    const items = await getJson(`/json/stations/search?${params.toString()}`);
    state.stations = reset ? items : state.stations.concat(items);
    state.offset += items.length;
    state.hasMore = items.length === PAGE_SIZE;
    renderStations();
    setStatus("API connectada", "ok");
  } catch (error) {
    console.error(error);
    setStatus("Error de connexio", "error");
    renderError();
  } finally {
    state.loading = false;
  }
}

function buildSearchParams() {
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

function renderStationCard(station) {
  const title = escapeHtml(station.name || "Radio sense nom");
  const location = escapeHtml([station.country, station.state].filter(Boolean).join(" · ") || "Ubicacio desconeguda");
  const codec = escapeHtml(station.codec || "n/d");
  const bitrate = station.bitrate ? `${station.bitrate} kbps` : "n/d";
  const tags = (station.tags || "")
    .split(",")
    .map((tag) => tag.trim())
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
        <div class="stat"><span>Vots</span><strong>${station.votes || 0}</strong></div>
      </div>
      <div class="station-actions">
        <button class="station-action play" type="button" data-play="${escapeAttribute(station.stationuuid)}">Escolta</button>
        <button class="station-action favorite ${saved ? "saved" : ""}" type="button" data-favorite="${escapeAttribute(station.stationuuid)}" aria-label="Desa favorit">${saved ? "★" : "☆"}</button>
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
}

function findStation(uuid) {
  return state.stations.find((station) => station.stationuuid === uuid)
    || state.favorites.get(uuid);
}

function playStation(station) {
  const streamUrl = station.url_resolved || station.url;

  if (!streamUrl) {
    setStatus("Stream no disponible", "error");
    return;
  }

  els.audioPlayer.src = streamUrl;
  els.audioPlayer.play().catch(() => {
    setStatus("El navegador ha bloquejat la reproduccio", "error");
  });

  els.playerName.textContent = station.name || "Radio sense nom";
  els.playerMeta.textContent = [station.country, station.codec, station.bitrate ? `${station.bitrate} kbps` : ""]
    .filter(Boolean)
    .join(" · ");
  els.playerArt.textContent = getInitials(station.name);
  setStatus("Reproduint", "ok");

  fetch(`${API_BASE}/json/url/${station.stationuuid}`).catch(() => {});
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
