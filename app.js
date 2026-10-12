/**
 * AERIS-DELPHI: High-Performance Frontend Scientific Dashboard Engine
 * Implements:
 * 1. Reactive state management and REST API synchronization
 * 2. High-resolution Canvas 2D renderers:
 *    - 72-Hour Coupled vs Uncoupled Forecast Timeline
 *    - Vertical Thermodynamic Inversion Sounding (0 - 2,000m)
 *    - Regional Vector & Lagrangian Plume Particle Dispersion Map
 *    - What-If Scenario Delta Comparator
 * 3. Station search and drill-down inspection
 * 4. AeroChem-AI Copilot conversational interface
 */

// Global Application State
const state = {
  activeTab: 'tab-overview',
  isCoupled: true,
  forecastVar: 'aqi',
  forecastData: null,
  stationsData: [],
  inversionData: null,
  plumesData: null,
  satelliteData: null,
  weatherData: null,
  scrubberHour: 0,
  isPlayingScrubber: false,
  scrubberTimer: null,
  mapSettings: {
    showParticles: true,
    showDensity: true,
    showStations: true,
  },
  scenario: {
    stubbleReduction: 0,
    windDelta: 0.0,
    feedbackEnabled: true,
    scenarioSeries: null
  },
  spatialData: null,
  hoveredMapEntity: null,
  uiMode: localStorage.getItem('aero_ui_mode') || 'simple',
  telemetryStreamActive: true,
  vastNetworkFilter: 'all',
  vastLayout: 'row',
  vastStationsData: []
};

// API Base URL (relative path)
const API_BASE = window.location.origin;

// Initialize on DOM Ready
document.addEventListener('DOMContentLoaded', () => {
  initClock();
  initNavigation();
  initCanvasListeners();
  initInterfaceMode();
  fetchAllData();
  refreshLiveApiData();
  startTelemetryStream();

  // Auto-refresh telemetry every 60 seconds
  setInterval(() => {
    fetchStationTelemetry();
    fetchInversionSounding(state.scrubberHour);
    fetchSpatialSeverity();
    refreshLiveApiData();
  }, 60000);
});

/* ==========================================================================
   Dual-Mode Engine: Simple Citizen Mode vs Science Mode
   ========================================================================== */
function initInterfaceMode() {
  setInterfaceMode(state.uiMode);
}

function setInterfaceMode(mode) {
  state.uiMode = mode;
  localStorage.setItem('aero_ui_mode', mode);

  if (mode === 'simple') {
    document.body.classList.add('mode-simple');
    document.body.classList.remove('mode-science');
  } else {
    document.body.classList.add('mode-science');
    document.body.classList.remove('mode-simple');
  }

  const btnSimple = document.getElementById('btn-mode-simple');
  const btnScience = document.getElementById('btn-mode-science');
  if (btnSimple) btnSimple.classList.toggle('active', mode === 'simple');
  if (btnScience) {
    btnScience.classList.toggle('active', mode === 'science');
    btnScience.classList.toggle('science', mode === 'science');
  }

  const titleEl = document.getElementById('brand-main-title');
  const badgeEl = document.getElementById('brand-badge-mode');
  const subEl = document.getElementById('brand-subtitle');

  if (titleEl) titleEl.innerText = 'AERIS-DELHI';
  if (badgeEl) badgeEl.innerText = mode === 'simple' ? 'DEVELOPED BY QUANTUMX // CITIZEN WATCH' : 'DEVELOPED BY QUANTUMX // WRF-CHEM COUPLED HPC';
  if (subEl) subEl.innerText = mode === 'simple' 
    ? 'Clear Air & Health Guide for Delhi NCR • Know what you breathe' 
    : 'Atmospheric Inversion Dynamics & 72h Coupled Forecast • Delhi NCR Airshed';

  // Update Navigation Tab Titles
  document.querySelectorAll('.nav-tab .tab-title').forEach(el => {
    const txt = el.getAttribute(mode === 'simple' ? 'data-simple' : 'data-science');
    if (txt) el.innerText = txt;
  });

  // Update Section Headers with dual titles
  document.querySelectorAll('[data-simple]').forEach(el => {
    if (!el.classList.contains('tab-title')) {
      const txt = el.getAttribute(mode === 'simple' ? 'data-simple' : 'data-science');
      if (txt) el.innerText = txt;
    }
  });

  // Re-render station table if data is present
  if (state.stationsData && state.stationsData.length > 0) {
    renderStationsTable(state.stationsData);
    if (typeof updateStationMap === 'function') updateStationMap(state.stationsData);
  }
}

/* ==========================================================================
   Clock & Navigation
   ========================================================================== */
function initClock() {
  const clockEl = document.getElementById('live-clock');
  const update = () => {
    const now = new Date();
    const ist = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
    const h = String(ist.getUTCHours()).padStart(2, '0');
    const m = String(ist.getUTCMinutes()).padStart(2, '0');
    const s = String(ist.getUTCSeconds()).padStart(2, '0');
    if (clockEl) clockEl.textContent = `${h}:${m}:${s} IST`;
  };
  update();
  setInterval(update, 1000);
}

function initNavigation() {
  const tabs = document.querySelectorAll('.nav-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.getAttribute('data-tab');
      switchTab(target);
    });
  });

  const aiBtn = document.getElementById('btn-open-ai');
  if (aiBtn) aiBtn.addEventListener('click', () => switchTab('tab-ai'));

  const resyncBtn = document.getElementById('btn-sync-simulation');
  if (resyncBtn) resyncBtn.addEventListener('click', () => {
    resyncBtn.classList.add('spinning');
    fetchAllData().then(() => resyncBtn.classList.remove('spinning'));
  });

  // Station Filter
  const filterInput = document.getElementById('station-filter-input');
  if (filterInput) {
    filterInput.addEventListener('input', (e) => {
      filterStationsTable(e.target.value.toLowerCase().trim());
    });
  }

  // Forecast Variable Pill Selectors
  const varPills = document.querySelectorAll('#forecast-variable-selectors .pill-btn');
  varPills.forEach(pill => {
    pill.addEventListener('click', () => {
      varPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      state.forecastVar = pill.getAttribute('data-var');
      renderForecastChart();
    });
  });

  // Sounding Hour Select
  const soundingSelect = document.getElementById('sounding-hour-select');
  if (soundingSelect) {
    soundingSelect.addEventListener('change', (e) => {
      fetchInversionSounding(parseFloat(e.target.value));
    });
  }
}

function switchTab(tabId) {
  state.activeTab = tabId;

  // Update nav buttons
  document.querySelectorAll('.nav-tab').forEach(t => {
    if (t.getAttribute('data-tab') === tabId) t.classList.add('active');
    else t.classList.remove('active');
  });

  // Update content sections
  document.querySelectorAll('.tab-content').forEach(c => {
    if (c.id === tabId) c.classList.add('active');
    else c.classList.remove('active');
  });

  // Redraw canvases on tab switch to ensure correct dimensions
  setTimeout(() => {
    if (tabId === 'tab-forecast') renderForecastChart();
    if (tabId === 'tab-severity') renderZonalMatrixChart();
    if (tabId === 'tab-inversion') renderSoundingChart();
    if (tabId === 'tab-plumes') renderPlumeMap();
    if (tabId === 'tab-scenario') renderScenarioChart();
  }, 50);
}

/* ==========================================================================
   Data Fetching Pipeline
   ========================================================================== */
async function fetchAllData() {
  try {
    await Promise.all([
      fetchForecastData(),
      fetchStationTelemetry(),
      fetchInversionSounding(20),
      fetchPlumeDispersion(state.scrubberHour),
      fetchSatelliteIntel(),
      fetchSpatialSeverity()
    ]);
  } catch (err) {
    console.error('[AeroSys] Error fetching atmospheric telemetry:', err);
  }
}

async function fetchForecastData() {
  try {
    const res = await fetch(`${API_BASE}/api/forecast/72h?enable_feedback=true`);
    const data = await res.json();
    state.forecastData = data;
    updateOverviewKpis(data);
    renderForecastChart();
    renderForecastDayCards(data);
  } catch (err) {
    console.error('Forecast fetch failed:', err);
  }
}

async function fetchStationTelemetry() {
  try {
    const res = await fetch(`${API_BASE}/api/stations/live`);
    const data = await res.json();
    state.stationsData = data.stations || [];
    renderStationsTable(state.stationsData);
    if (typeof updateStationMap === 'function') updateStationMap(state.stationsData);
    const countEl = document.getElementById('hud-stations-count');
    if (countEl) countEl.textContent = `${state.stationsData.length} STATIONS LIVE`;
  } catch (err) {
    console.error('Stations fetch failed:', err);
  }
}

async function fetchInversionSounding(hour = 20) {
  try {
    const res = await fetch(`${API_BASE}/api/inversion/sounding?hour=${hour}`);
    const data = await res.json();
    state.inversionData = data.inversion_metrics;
    updateInversionDiagnostics(data.inversion_metrics);
    renderSoundingChart();
  } catch (err) {
    console.error('Inversion sounding fetch failed:', err);
  }
}

async function fetchPlumeDispersion(hour = 0) {
  try {
    const res = await fetch(`${API_BASE}/api/plumes/dispersion?hour=${hour}`);
    const data = await res.json();
    state.plumesData = data;
    renderPlumeHotspotsList(data.fire_hotspots || []);
    renderPlumeMap();
  } catch (err) {
    console.error('Plume dispersion fetch failed:', err);
  }
}

async function fetchSatelliteIntel() {
  try {
    const res = await fetch(`${API_BASE}/api/satellite/fires`);
    const data = await res.json();
    state.satelliteData = data;
    renderSatelliteIntel(data);
  } catch (err) {
    console.error('Satellite intel fetch failed:', err);
  }
}

/* ==========================================================================
   DOM Renderers & Updaters
   ========================================================================== */
function updateOverviewKpis(forecast) {
  if (!forecast || !forecast.series || forecast.series.length === 0) return;
  const current = forecast.series[0];

  const aqiVal = document.getElementById('kpi-aqi-val');
  const aqiCat = document.getElementById('kpi-aqi-category');
  const aqiBar = document.getElementById('kpi-aqi-bar');
  const pm25Val = document.getElementById('kpi-pm25-val');
  const pm25Uncoupled = document.getElementById('kpi-pm25-uncoupled');
  const invVal = document.getElementById('kpi-inversion-strength');
  const capBase = document.getElementById('kpi-capping-base');
  const capTop = document.getElementById('kpi-capping-top');
  const pblVal = document.getElementById('kpi-pbl-val');
  const pblSupp = document.getElementById('kpi-pbl-suppression');
  const ventVal = document.getElementById('kpi-ventilation-val');
  const stubbleShare = document.getElementById('kpi-stubble-share');

  if (aqiVal) aqiVal.textContent = current.aqi_coupled;
  if (aqiCat) {
    aqiCat.textContent = current.category.toUpperCase();
    aqiCat.style.background = current.color + '33';
    aqiCat.style.borderColor = current.color;
  }
  if (aqiBar) {
    const pct = Math.min(100, (current.aqi_coupled / 500) * 100);
    aqiBar.style.width = `${pct}%`;
  }
  if (pm25Val) pm25Val.textContent = current.pm25_coupled;
  if (pm25Uncoupled) pm25Uncoupled.textContent = current.pm25_uncoupled;
  if (invVal) invVal.textContent = `+${current.inversion_strength_c}`;
  if (capBase) capBase.textContent = `0 m (SFC)`;
  if (capTop) capTop.textContent = `${current.capping_height_m} m`;
  if (pblVal) pblVal.textContent = current.pbl_height_coupled_m;
  if (pblSupp) pblSupp.textContent = `-${current.pbl_suppression_m} m`;
  if (ventVal) ventVal.textContent = Number(current.ventilation_index_m2s).toLocaleString();
  if (stubbleShare) stubbleShare.textContent = current.stubble_share_percent;

  // Dynamically update descriptions based on actual numbers
  const descPbl = document.getElementById('desc-pbl');
  if (descPbl) {
    descPbl.innerHTML = `<b>💡 What this means:</b> The breathing volume has squeezed down from 1,000 meters to just ${current.pbl_height_coupled_m} meters. All the city's smoke is crammed into a tiny space.`;
  }
  const descVent = document.getElementById('desc-ventilation');
  if (descVent) {
    descVent.innerHTML = `<b>💡 What this means:</b> Winds are weak and calm. With a ventilation index of ${Number(current.ventilation_index_m2s).toLocaleString()} m²/s, there is no strong breeze to flush out the thick smoke over Delhi.`;
  }
  const descStubble = document.getElementById('desc-stubble');
  if (descStubble) {
    descStubble.innerHTML = `<b>💡 What this means:</b> Around ${current.stubble_share_percent}% of today's pollution blew into Delhi from crop stubble burning in neighboring agricultural fields upwind.`;
  }
  const descInv = document.getElementById('desc-inversion');
  if (descInv) {
    descInv.innerHTML = `<b>💡 What this means:</b> Warm air sitting above cold night air creates a +${current.inversion_strength_c}°C lid. Smoke cannot rise into the sky and stays trapped.`;
  }
}

function renderStationsTable(stations) {
  const tbody = document.getElementById('stations-table-body');
  if (!tbody) return;

  tbody.innerHTML = '';
  stations.forEach(st => {
    const tr = document.createElement('tr');
    const aqiClass = st.aqi >= 401 ? 'severe' : (st.aqi >= 301 ? 'verypoor' : (st.aqi >= 201 ? 'poor' : 'moderate'));
    
    // Simple, easy-to-understand health safety badge
    let safetyBadge = '';
    if (st.aqi >= 401) {
      safetyBadge = '<span class="safety-tag stay-indoors">⛔ Stay Indoors (N95)</span>';
    } else if (st.aqi >= 301) {
      safetyBadge = '<span class="safety-tag stay-indoors">⚠️ High Hazard (N95)</span>';
    } else if (st.aqi >= 201) {
      safetyBadge = '<span class="safety-tag mask-required">😷 Mask Recommended</span>';
    } else {
      safetyBadge = '<span class="safety-tag safe-air">✅ Moderate Caution</span>';
    }

    const deltaSecTag = st.score_delta_sec ? `<span class="stream-delta-tag ${st.score_delta_sec_val >= 0 ? 'up' : 'down'}" style="margin-left:5px; font-size:0.68rem;">${st.score_delta_sec}</span>` : '';
    const scoreVal = st.score_exact !== undefined ? st.score_exact : st.aqi;
    const changingPill = `<span class="stream-type-pill ${st.changing_type_class || 'drift'} mini">${st.changing_type_badge || st.changing_type || 'DRIFTING'}</span>`;
    const minTrendVal = st.score_delta_min ? `<span style="color:${st.score_delta_min_val >= 0 ? '#f87171' : '#34d399'}; font-weight:700; font-family:var(--font-mono); font-size:0.75rem;">${st.score_delta_min}</span>` : '<span style="color:#94a3b8;">--</span>';
    const tempVal = st.temp_c !== undefined ? st.temp_c : (st.temp !== undefined ? st.temp : 24.5);
    const feelsLikeVal = st.feels_like_c !== undefined ? st.feels_like_c : tempVal;
    const weatherIcon = st.weather_icon || '🌫️';
    const rhVal = st.relative_humidity !== undefined ? st.relative_humidity : 75;
    const windVal = st.wind_speed_ms !== undefined ? st.wind_speed_ms : 2.1;
    const windCard = st.wind_cardinal || '';

    tr.innerHTML = `
      <td>
        <div class="station-name-cell">
          <span class="status-dot green"></span>
          <span><b>${st.name}</b> <br><small style="color:#94a3b8; font-size:0.72rem;">Zone: ${st.region}</small></span>
        </div>
      </td>
      <td>
        <span class="aqi-pill ${aqiClass}" style="font-weight:900; font-size:0.85rem;">${scoreVal}</span>
        ${deltaSecTag}
      </td>
      <td>${changingPill}</td>
      <td>${minTrendVal}</td>
      <td>
        <div class="table-weather-cell">
          <div class="table-temp-row">
            <span>${weatherIcon}</span>
            <span class="table-temp-val">${tempVal}°C</span>
            <span style="font-size: 0.68rem; color: #94a3b8;">(Feels ${feelsLikeVal}°C)</span>
          </div>
          <div class="table-weather-meta">
            <span>💧 ${rhVal}% RH • 💨 ${windVal} m/s ${windCard}</span>
          </div>
        </div>
      </td>
      <td>${safetyBadge}</td>
      <td style="color: var(--cyan-neon); font-weight: 700;">${st.pm25} &mu;g/m&sup3;</td>
      <td>
        <button class="hud-btn mini secondary" onclick="inspectStation('${st.id}')">DETAILS</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function filterStationsTable(query) {
  if (!state.stationsData) return;
  const filtered = state.stationsData.filter(st => 
    st.name.toLowerCase().includes(query) || st.region.toLowerCase().includes(query)
  );
  renderStationsTable(filtered);
}

function inspectStation(stationId) {
  const st = (state.stationsData || []).find(s => s.id === stationId) || 
             (state.vastStationsData || []).find(s => s.id === stationId);
  if (!st) return;

  const modal = document.getElementById('station-modal');
  const modalName = document.getElementById('modal-station-name');
  const modalBody = document.getElementById('modal-station-body');

  const tempVal = st.temp_c !== undefined ? st.temp_c : (st.temp !== undefined ? st.temp : 24.5);
  const tempF = st.temp_f !== undefined ? st.temp_f : Math.round((tempVal * 9/5 + 32) * 10)/10;
  const feelsLike = st.feels_like_c !== undefined ? st.feels_like_c : tempVal;
  const rh = st.relative_humidity !== undefined ? st.relative_humidity : 75;
  const dewPoint = st.dew_point_c !== undefined ? st.dew_point_c : 18.2;
  const windSpd = st.wind_speed_ms !== undefined ? st.wind_speed_ms : 2.1;
  const windKmh = st.wind_speed_kmh !== undefined ? st.wind_speed_kmh : Math.round(windSpd * 3.6 * 10)/10;
  const windGust = st.wind_gust_ms !== undefined ? st.wind_gust_ms : Math.round(windSpd * 1.4 * 10)/10;
  const windCard = st.wind_cardinal || '';
  const pressure = st.surface_pressure_hpa || 1010.5;
  const wIcon = st.weather_icon || '🌫️';
  const wCond = st.weather_condition || 'Heavy Smog';
  const cigs = st.health_cigarettes_day !== undefined ? st.health_cigarettes_day : Math.round((st.pm25 || 200) / 22 * 10)/10;
  const scoreVal = st.score_exact !== undefined ? st.score_exact : st.aqi;

  if (modalName) modalName.textContent = `${st.name} (${st.id}) • Live Ground Telemetry`;
  if (modalBody) {
    modalBody.innerHTML = `
      <!-- Real-Time Station Weather & Temperature Cockpit -->
      <div class="modal-weather-cockpit">
        <div class="modal-weather-header">
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="font-size:1.6rem;">${wIcon}</span>
            <div>
              <div style="font-weight:800; font-size:1.05rem; color:#fff;">${tempVal}°C / ${tempF}°F</div>
              <div style="font-size:0.7rem; color:#94a3b8;">${wCond} • Feels like <b style="color:var(--cyan-neon);">${feelsLike}°C</b></div>
            </div>
          </div>
          <span class="stream-type-pill ${st.changing_type_class || 'drift'} mini">${st.changing_type_badge || st.changing_type || 'LIVE PULSE'}</span>
        </div>
        <div class="modal-weather-grid">
          <div class="weather-kpi-item">
            <span class="weather-kpi-lbl">HUMIDITY</span>
            <span class="weather-kpi-val text-cyan">${rh}% RH</span>
            <span class="weather-kpi-sub">Dew Point: ${dewPoint}°C</span>
          </div>
          <div class="weather-kpi-item">
            <span class="weather-kpi-lbl">SURFACE WIND</span>
            <span class="weather-kpi-val text-emerald">${windSpd} m/s</span>
            <span class="weather-kpi-sub">${windKmh} km/h ${windCard} (Gusts ${windGust})</span>
          </div>
          <div class="weather-kpi-item">
            <span class="weather-kpi-lbl">PRESSURE</span>
            <span class="weather-kpi-val text-purple">${pressure} hPa</span>
            <span class="weather-kpi-sub">Elevation: ${st.elevation_m || 215}m AGL</span>
          </div>
          <div class="weather-kpi-item">
            <span class="weather-kpi-lbl">SMOKE EQUIVALENT</span>
            <span class="weather-kpi-val text-amber">🚬 ~${cigs} /day</span>
            <span class="weather-kpi-sub">Berkeley Earth formula</span>
          </div>
        </div>
      </div>

      <!-- Air Quality Diagnostics -->
      <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 14px;">
        <div class="diag-metric-box">
          <span class="diag-label">COMPOSITE NAQI SCORE</span>
          <span class="diag-val" style="color: ${st.color || 'var(--cyan-neon)'};">${scoreVal} <small style="font-size:0.75rem; color:#94a3b8;">(${st.category})</small></span>
          <span class="diag-sub">Rate: ${st.score_delta_sec || '0.0 pts/s'} | ${st.score_delta_min || '0.0 pts/min'}</span>
        </div>
        <div class="diag-metric-box">
          <span class="diag-label">FINE PARTICULATES (PM2.5 / PM10)</span>
          <span class="diag-val text-cyan">${st.pm25} / ${st.pm10}</span>
          <span class="diag-sub">&mu;g/m&sup3; (Dominant: ${st.dominant_pollutant})</span>
        </div>
        <div class="diag-metric-box">
          <span class="diag-label">TRACE TOXIC GASES</span>
          <span class="diag-val text-amber">NO2: ${st.no2} | O3: ${st.o3}</span>
          <span class="diag-sub">CO: ${st.co || 1.8} mg/m&sup3; | SO2: ${st.so2 || 14.5} &mu;g/m&sup3;</span>
        </div>
        <div class="diag-metric-box">
          <span class="diag-label">DYNAMIC CHANGING BEHAVIOR</span>
          <span class="diag-val text-purple" style="font-size:0.85rem;">${st.changing_type || 'EQUILIBRIUM'}</span>
          <span class="diag-sub">${st.changing_type_desc || 'Atmospheric telemetry active.'}</span>
        </div>
      </div>

      <!-- Station Characteristics & Safety Advisory -->
      <div style="background: rgba(5, 8, 17, 0.75); padding: 12px 14px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.06);">
        <div style="font-size: 0.72rem; color: #94a3b8; margin-bottom: 4px;">STATION METADATA & HEALTH ADVISORY</div>
        <div style="font-size: 0.82rem; color: #e2e8f0; margin-bottom: 6px;">
          <b>Station Type:</b> ${st.station_type} | <b>Vulnerability Index:</b> ${Math.round((st.vulnerability_score || 0.8) * 100)}%
        </div>
        <div style="font-size: 0.8rem; color: #f87171; line-height: 1.4;">
          <b>Health Action:</b> ${st.health_advisory}
        </div>
      </div>
    `;
  }
  if (modal) modal.classList.add('active');
}

function closeStationModal(e) {
  const modal = document.getElementById('station-modal');
  if (modal) modal.classList.remove('active');
}

function updateInversionDiagnostics(metrics) {
  if (!metrics) return;
  const capTop = document.getElementById('diag-capping-top');
  const invStr = document.getElementById('diag-inversion-strength');
  const ri = document.getElementById('diag-richardson');
  const vent = document.getElementById('diag-ventilation');
  const stab = document.getElementById('diag-stability');
  const needle = document.getElementById('ventilation-needle');

  if (capTop) capTop.textContent = `${metrics.capping_height_m} m`;
  if (invStr) invStr.textContent = `+${metrics.inversion_strength_c} °C`;
  if (ri) ri.textContent = metrics.bulk_richardson_sfc;
  if (vent) vent.textContent = `${Number(metrics.ventilation_index_m2s).toLocaleString()} m²/s`;
  if (stab) stab.textContent = metrics.stability_class;

  if (needle) {
    needle.textContent = `▼ CURRENT: ${Number(metrics.ventilation_index_m2s).toLocaleString()} m²/s (${metrics.ventilation_status.toUpperCase()})`;
    if (metrics.ventilation_index_m2s < 2000) needle.style.color = '#ef4444';
    else if (metrics.ventilation_index_m2s < 4000) needle.style.color = '#f59e0b';
    else needle.style.color = '#10b981';
  }
}

function renderPlumeHotspotsList(hotspots) {
  const container = document.getElementById('hotspot-cards-list');
  const countBadge = document.getElementById('fire-count-badge');
  if (countBadge) countBadge.textContent = `${hotspots.length} ACTIVE CLUSTERS`;
  if (!container) return;

  container.innerHTML = '';
  hotspots.forEach(h => {
    const card = document.createElement('div');
    card.className = 'hotspot-card';
    let conf = 'HIGH'; let confColor = '#10b981'; let confBg = 'rgba(16, 185, 129, 0.15)';
    if (h.frp_mw < 130) { conf = 'MEDIUM'; confColor = '#f59e0b'; confBg = 'rgba(245, 158, 11, 0.15)'; }
    if (h.frp_mw < 100) { conf = 'LOW'; confColor = '#ef4444'; confBg = 'rgba(239, 68, 68, 0.15)'; }
    
    card.style.background = 'rgba(0,0,0,0.2)';
    card.style.borderBottom = '1px solid rgba(255,255,255,0.05)';
    card.style.padding = '12px 10px';
    card.style.marginBottom = '5px';
    card.style.display = 'flex';
    card.style.justifyContent = 'space-between';
    card.style.alignItems = 'flex-start';

    card.innerHTML = `
      <div>
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
          <span style="color: #f59e0b; font-size: 1.1rem;">🔥</span>
          <span style="color: #fff; font-weight: 700; font-size: 0.85rem;">${h.name} Cluster</span>
        </div>
        <div style="color: #94a3b8; font-size: 0.75rem; margin-bottom: 4px;">${h.state}</div>
        <div style="color: #64748b; font-size: 0.7rem; font-family: var(--font-mono);">
          Advection: ${h.transport_time_hours}h to Delhi &nbsp;|&nbsp; Wind: NW &rarr; SE
        </div>
      </div>
      <div style="display: flex; align-items: center; gap: 10px;">
        <span style="color: #f59e0b; font-weight: 700; font-size: 0.85rem;">${h.frp_mw} MW</span>
        <span style="background: ${confBg}; border: 1px solid ${confColor}; color: ${confColor}; font-size: 0.6rem; padding: 2px 6px; border-radius: 4px; font-weight: 700;">${conf}</span>
      </div>
    `;
    container.appendChild(card);
  });
}

function renderSatelliteIntel(intel) {
  if (!intel) return;

  const frpTotal = document.getElementById('intel-frp-total');
  const pm25Flux = document.getElementById('intel-pm25-flux');
  const ratio = document.getElementById('intel-ratio');

  if (frpTotal) frpTotal.textContent = `${intel.total_frp_megawatts} MW`;
  if (pm25Flux) pm25Flux.textContent = `${intel.total_pm25_emission_flux_tonnes_per_day} tonnes/day`;
  if (ratio) ratio.textContent = `${intel.punjab_share_percent}% / ${intel.haryana_share_percent}%`;
}

function renderForecastDayCards(forecast) {
  const container = document.getElementById('forecast-day-cards');
  if (!container || !forecast || !forecast.series) return;

  container.innerHTML = '';
  const days = [
    { title: 'DAY 1: NOCTURNAL PEAK & INVERSION', slice: forecast.series.slice(0, 24) },
    { title: 'DAY 2: PERSISTENT SMOG & STUBBLE INFLUX', slice: forecast.series.slice(24, 48) },
    { title: 'DAY 3: SLOW DILUTION WINDOW', slice: forecast.series.slice(48, 72) }
  ];

  days.forEach((day, idx) => {
    const maxAqi = Math.max(...day.slice.map(s => s.aqi_coupled));
    const maxInv = Math.max(...day.slice.map(s => s.inversion_strength_c));
    const minPbl = Math.min(...day.slice.map(s => s.pbl_height_coupled_m));
    const avgDim = Math.round(day.slice.reduce((acc, s) => acc + s.dimming_flux_wm2, 0) / 24);

    let aqiClass = 'text-green';
    let aqiLabel = 'SAFE';
    if (maxAqi > 50) { aqiClass = 'text-amber'; aqiLabel = 'MODERATE'; }
    if (maxAqi > 100) { aqiClass = 'text-amber'; aqiLabel = 'UNHEALTHY FOR SENSITIVE'; }
    if (maxAqi > 150) { aqiClass = 'text-red'; aqiLabel = 'UNHEALTHY'; }
    if (maxAqi > 200) { aqiClass = 'text-purple'; aqiLabel = 'VERY UNHEALTHY'; }
    if (maxAqi > 300) { aqiClass = 'text-severe'; aqiLabel = 'HAZARDOUS'; }

    const card = document.createElement('div');
    card.className = 'glass-panel day-card';
    card.innerHTML = `
      <div class="day-card-header">
        <span class="day-title">${day.title}</span>
        <span class="day-aqi-stat ${aqiClass}">PEAK AQI ${maxAqi} [${aqiLabel}]</span>
      </div>
      <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; font-family: var(--font-mono); font-size: 0.72rem;">
        <div><b>Max Inversion:</b> <span class="text-amber">+${maxInv}&deg;C</span></div>
        <div><b>Min PBL Height:</b> <span class="text-purple">${minPbl}m</span></div>
        <div><b>Avg Solar Dimming:</b> -${avgDim} W/m&sup2;</div>
        <div><b>Transport Flow:</b> NW ~ 14 km/h</div>
      </div>
    `;
    container.appendChild(card);
  });
}

/* ==========================================================================
   Forecast Controls & Mode Toggle
   ========================================================================== */
function setCoupledMode(isCoupled) {
  state.isCoupled = isCoupled;
  const btnCoupled = document.getElementById('btn-model-coupled');
  const btnUncoupled = document.getElementById('btn-model-uncoupled');
  const hudStatus = document.getElementById('hud-coupling-status');

  if (isCoupled) {
    btnCoupled.classList.add('active');
    btnUncoupled.classList.remove('active');
    if (hudStatus) hudStatus.textContent = '2-WAY FEEDBACK';
  } else {
    btnCoupled.classList.remove('active');
    btnUncoupled.classList.add('active');
    if (hudStatus) hudStatus.textContent = 'UNCOUPLED NAIVE';
  }
  renderForecastChart();
}

/* ==========================================================================
   Canvas Chart 1: 72-Hour Outlook Timeline
   ========================================================================== */
function renderForecastChart() {
  const canvas = document.getElementById('forecastChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  
  canvas.width = (rect.width || 1160) * dpr;
  canvas.height = 420 * dpr;
  ctx.scale(dpr, dpr);

  const W = rect.width || 1160;
  const H = 420;
  ctx.clearRect(0, 0, W, H);

  if (!state.forecastData || !state.forecastData.series) {
    ctx.fillStyle = '#94a3b8';
    ctx.font = '14px JetBrains Mono';
    ctx.fillText('Loading coupled 72-hour forecast data...', 50, H / 2);
    return;
  }

  const series = state.forecastData.series;
  const N = series.length;
  const padLeft = 60;
  const padRight = 70;
  const padTop = 30;
  const padBottom = 50;
  const chartW = W - padLeft - padRight;
  const chartH = H - padTop - padBottom;

  // Day/Night Atmospheric Shading Bands
  series.forEach((pt, i) => {
    const hour = pt.hour_of_day;
    const isNight = (hour < 6.5 || hour > 18.0);
    const x = padLeft + (i / (N - 1)) * chartW;
    const nextX = padLeft + ((i + 1) / (N - 1)) * chartW;
    const bandW = nextX - x + 1;

    if (isNight) {
      ctx.fillStyle = 'rgba(10, 17, 40, 0.45)';
      ctx.fillRect(x, padTop, bandW, chartH);
    }
  });

  // Grid Lines & Y Axis
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.lineWidth = 1;
  for (let step = 0; step <= 5; step++) {
    const y = padTop + (step / 5) * chartH;
    ctx.beginPath();
    ctx.moveTo(padLeft, y);
    ctx.lineTo(W - padRight, y);
    ctx.stroke();

    // Primary Y-Axis Labels (AQI or PM2.5)
    ctx.fillStyle = '#64748b';
    ctx.font = '10px JetBrains Mono';
    const val = Math.round(500 - (step / 5) * 500);
    ctx.fillText(val, padLeft - 35, y + 4);
  }

  // Draw Time Axis (X) Labels
  for (let i = 0; i < N; i += 6) {
    const x = padLeft + (i / (N - 1)) * chartW;
    ctx.fillStyle = '#64748b';
    ctx.font = '10px JetBrains Mono';
    ctx.fillText(series[i].time_label.split(' ')[0], x - 15, H - 20);
    ctx.fillText(`${series[i].hour_of_day}:00`, x - 12, H - 8);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.beginPath();
    ctx.moveTo(x, H - padBottom);
    ctx.lineTo(x, H - padBottom + 6);
    ctx.stroke();
  }

  // Draw Uncoupled Baseline (Naive) Line
  ctx.strokeStyle = '#64748b';
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  series.forEach((pt, i) => {
    const x = padLeft + (i / (N - 1)) * chartW;
    const val = (state.forecastVar === 'pbl') ? pt.pbl_height_uncoupled_m : pt.pm25_uncoupled;
    const maxScale = (state.forecastVar === 'pbl') ? 1600 : 450;
    const y = padTop + chartH - (val / maxScale) * chartH;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.setLineDash([]);

  // Draw Coupled Line (Realistic Physics Feedback)
  ctx.strokeStyle = state.isCoupled ? '#00f2fe' : 'rgba(0, 242, 254, 0.3)';
  ctx.lineWidth = state.isCoupled ? 3 : 1.5;
  ctx.shadowColor = 'rgba(0, 242, 254, 0.5)';
  ctx.shadowBlur = state.isCoupled ? 10 : 0;
  ctx.beginPath();
  series.forEach((pt, i) => {
    const x = padLeft + (i / (N - 1)) * chartW;
    const val = (state.forecastVar === 'pbl') ? pt.pbl_height_coupled_m : pt.pm25_coupled;
    const maxScale = (state.forecastVar === 'pbl') ? 1600 : 450;
    const y = padTop + chartH - (val / maxScale) * chartH;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Secondary Line: Inversion Strength (°C)
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 2;
  ctx.beginPath();
  series.forEach((pt, i) => {
    const x = padLeft + (i / (N - 1)) * chartW;
    const y = padTop + chartH - (pt.inversion_strength_c / 12.0) * chartH;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Draw Secondary Y-Axis Labels (Inversion °C)
  ctx.fillStyle = '#f59e0b';
  ctx.font = '10px JetBrains Mono';
  ctx.fillText('INV °C', W - padRight + 12, padTop - 10);
  for (let step = 0; step <= 4; step++) {
    const y = padTop + (step / 4) * chartH;
    const deg = Math.round(12 - (step / 4) * 12);
    ctx.fillText(`+${deg}°`, W - padRight + 12, y + 4);
  }

  // Update Summary Metrics below chart
  const sumEl = document.getElementById('forecast-summary-bar');
  if (sumEl && state.forecastData.summary) {
    const s = state.forecastData.summary;
    sumEl.innerHTML = `
      <div><b>PEAK COUPLED PM2.5:</b> <span class="text-cyan">${s.peak_pm25_coupled} &mu;g/m&sup3;</span></div>
      <div><b>PEAK UNCOUPLED PM2.5:</b> <span style="color:#94a3b8;">${s.peak_pm25_uncoupled} &mu;g/m&sup3;</span></div>
      <div><b>FEEDBACK GAP:</b> <span class="text-severe">+${s.peak_gap_delta} &mu;g/m&sup3;</span></div>
      <div><b>AVG PBL SUPPRESSION:</b> <span class="text-purple">-${s.avg_pbl_suppression_m}m</span></div>
      <div><b>MAX INVERSION:</b> <span class="text-amber">+${s.max_inversion_strength_c}&deg;C</span></div>
    `;
  }
}

/* ==========================================================================
   Canvas Chart 2: Vertical Thermodynamic Inversion Sounding (0 - 2000m)
   ========================================================================== */
function renderSoundingChart() {
  const canvas = document.getElementById('soundingChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();

  canvas.width = (rect.width || 600) * dpr;
  canvas.height = 460 * dpr;
  ctx.scale(dpr, dpr);

  const W = rect.width || 600;
  const H = 460;
  ctx.clearRect(0, 0, W, H);

  if (!state.inversionData || !state.inversionData.sounding_levels) return;

  const levels = state.inversionData.sounding_levels;
  const padLeft = 70;
  const padRight = 40;
  const padTop = 30;
  const padBottom = 50;
  const chartW = W - padLeft - padRight;
  const chartH = H - padTop - padBottom;

  const capH = state.inversionData.capping_height_m;
  const maxAlt = 2000;
  const minTemp = 5;
  const maxTemp = 30;

  // Inversion Capping Layer Shaded Region
  const capY = padTop + chartH - (capH / maxAlt) * chartH;
  ctx.fillStyle = 'rgba(239, 68, 68, 0.12)';
  ctx.fillRect(padLeft, capY, chartW, (padTop + chartH) - capY);

  // Capping Ceiling Line
  ctx.strokeStyle = '#ef4444';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(padLeft, capY);
  ctx.lineTo(W - padRight, capY);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = '#f87171';
  ctx.font = '11px JetBrains Mono';
  ctx.fillText(`▲ INVERSION CAPPING CEILING (${capH}m AGL)`, padLeft + 15, capY - 6);

  // Altitude (Y) Grid & Labels
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.lineWidth = 1;
  for (let alt = 0; alt <= 2000; alt += 400) {
    const y = padTop + chartH - (alt / maxAlt) * chartH;
    ctx.beginPath();
    ctx.moveTo(padLeft, y);
    ctx.lineTo(W - padRight, y);
    ctx.stroke();

    ctx.fillStyle = '#64748b';
    ctx.font = '10px JetBrains Mono';
    ctx.fillText(`${alt}m`, padLeft - 45, y + 4);
  }

  // Temperature (X) Grid & Labels
  for (let t = minTemp; t <= maxTemp; t += 5) {
    const x = padLeft + ((t - minTemp) / (maxTemp - minTemp)) * chartW;
    ctx.beginPath();
    ctx.moveTo(x, padTop);
    ctx.lineTo(x, H - padBottom);
    ctx.stroke();

    ctx.fillStyle = '#64748b';
    ctx.font = '10px JetBrains Mono';
    ctx.fillText(`${t}°C`, x - 10, H - padBottom + 18);
  }

  // Plot Temperature Profile T(z) (Glowing Red/Amber in inversion, Blue above)
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 3;
  ctx.shadowColor = 'rgba(245, 158, 11, 0.5)';
  ctx.shadowBlur = 8;
  ctx.beginPath();

  levels.forEach((lvl, i) => {
    const x = padLeft + ((lvl.temp_c - minTemp) / (maxTemp - minTemp)) * chartW;
    const y = padTop + chartH - (lvl.altitude_m / maxAlt) * chartH;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Plot Points
  levels.forEach(lvl => {
    const x = padLeft + ((lvl.temp_c - minTemp) / (maxTemp - minTemp)) * chartW;
    const y = padTop + chartH - (lvl.altitude_m / maxAlt) * chartH;
    ctx.fillStyle = (lvl.altitude_m <= capH) ? '#ef4444' : '#38bdf8';
    ctx.beginPath();
    ctx.arc(x, y, 3.5, 0, Math.PI * 2);
    ctx.fill();
  });

  // Chart Title / Subtitle
  ctx.fillStyle = '#94a3b8';
  ctx.font = '11px Chakra Petch';
  ctx.fillText('ALTITUDE AGL (METERS) vs AMBIENT TEMPERATURE T(z)', padLeft, padTop - 12);
}

/* ==========================================================================
   Canvas Chart 3: Regional Vector & Lagrangian Plume Particle Map
   ========================================================================== */
function renderPlumeMap() {
  const canvas = document.getElementById('plumeMapCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();

  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const W = rect.width;
  const H = rect.height;
  ctx.clearRect(0, 0, W, H);

  // Map Bounds: 28.0 N to 31.8 N, 74.2 E to 77.8 E
  const minLat = 28.0, maxLat = 31.8;
  const minLon = 74.2, maxLon = 77.8;

  const latToY = (lat) => H - ((lat - minLat) / (maxLat - minLat)) * (H - 60) - 30;
  const lonToX = (lon) => ((lon - minLon) / (maxLon - minLon)) * (W - 80) + 40;

  // Draw State / Airshed Boundaries (Punjab, Haryana, Delhi NCR)
  ctx.strokeStyle = 'rgba(0, 242, 254, 0.18)';
  ctx.lineWidth = 1;

  // Representative Regional Boundary lines
  ctx.beginPath();
  // Punjab / Haryana border approx
  ctx.moveTo(lonToX(74.5), latToY(30.0));
  ctx.lineTo(lonToX(76.2), latToY(30.4));
  ctx.lineTo(lonToX(76.8), latToY(30.9));
  ctx.stroke();

  // Haryana / Delhi border
  ctx.beginPath();
  ctx.arc(lonToX(77.2), latToY(28.61), 45, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(239, 68, 68, 0.35)';
  ctx.stroke();

  // Delhi NCR Hub Core
  const delhiX = lonToX(77.209);
  const delhiY = latToY(28.614);
  ctx.fillStyle = 'rgba(239, 68, 68, 0.2)';
  ctx.beginPath();
  ctx.arc(delhiX, delhiY, 22, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.font = '12px Chakra Petch';
  ctx.fillText('DELHI NCR AIRSHED', delhiX - 55, delhiY + 36);

  // Regional Geography Labels
  ctx.fillStyle = '#475569';
  ctx.font = '13px Chakra Petch';
  ctx.fillText('PUNJAB AGRICULTURAL BASIN', lonToX(74.8), latToY(31.2));
  ctx.fillText('HARYANA CORRIDOR', lonToX(75.8), latToY(29.5));

  // Draw Synoptic Wind Vectors (North-Westerly flow blowing SE)
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.18)';
  ctx.lineWidth = 1.5;
  for (let gy = 80; gy < H - 80; gy += 90) {
    for (let gx = 80; gx < W - 80; gx += 110) {
      drawArrow(ctx, gx, gy, gx + 28, gy + 22);
    }
  }

  // Draw Lagrangian Smoke Puff Particles
  if (state.mapSettings.showParticles && state.plumesData && state.plumesData.lagrangian_particles) {
    state.plumesData.lagrangian_particles.forEach(p => {
      const px = lonToX(p.lon);
      const py = latToY(p.lat);
      const radius = Math.max(3, Math.min(16, p.size || 6));

      // Gradient smoke puff
      const grad = ctx.createRadialGradient(px, py, 0, px, py, radius);
      if (p.is_trapped_by_inversion) {
        grad.addColorStop(0, 'rgba(245, 158, 11, 0.75)');
        grad.addColorStop(1, 'rgba(239, 68, 68, 0.0)');
      } else {
        grad.addColorStop(0, 'rgba(148, 163, 184, 0.6)');
        grad.addColorStop(1, 'rgba(148, 163, 184, 0.0)');
      }
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(px, py, radius, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  // Draw Satellite Fire Hotspots
  if (state.plumesData && state.plumesData.fire_hotspots) {
    state.plumesData.fire_hotspots.forEach(h => {
      const hx = lonToX(h.lon);
      const hy = latToY(h.lat);

      // Pulsing thermal ring
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.6)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(hx, hy, 14, 0, Math.PI * 2);
      ctx.stroke();

      // Fire Core
      ctx.fillStyle = '#f59e0b';
      ctx.beginPath();
      ctx.arc(hx, hy, 5, 0, Math.PI * 2);
      ctx.fill();

      // Label
      ctx.fillStyle = '#fef08a';
      ctx.font = '10px JetBrains Mono';
      ctx.fillText(`🔥 ${h.name.split(' ')[0]} (${h.frp_mw}MW)`, hx + 10, hy + 4);
    });
  }

  // Draw CAAQMS Ground Stations in Delhi NCR
  if (state.mapSettings.showStations && state.stationsData) {
    state.stationsData.forEach(st => {
      const sx = lonToX(st.lon);
      const sy = latToY(st.lat);

      ctx.fillStyle = st.color || '#ef4444';
      ctx.beginPath();
      ctx.arc(sx, sy, 4.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.stroke();
    });
  }
}

function drawArrow(ctx, fromx, fromy, tox, toy) {
  const headlen = 6;
  const dx = tox - fromx;
  const dy = toy - fromy;
  const angle = Math.atan2(dy, dx);
  ctx.beginPath();
  ctx.moveTo(fromx, fromy);
  ctx.lineTo(tox, toy);
  ctx.lineTo(tox - headlen * Math.cos(angle - Math.PI / 6), toy - headlen * Math.sin(angle - Math.PI / 6));
  ctx.moveTo(tox, toy);
  ctx.lineTo(tox - headlen * Math.cos(angle + Math.PI / 6), toy - headlen * Math.sin(angle + Math.PI / 6));
  ctx.stroke();
}

function togglePlumeParticles() {
  state.mapSettings.showParticles = !state.mapSettings.showParticles;
  renderPlumeMap();
}

function toggleDensityHeatmap() {
  state.mapSettings.showDensity = !state.mapSettings.showDensity;
  renderPlumeMap();
}

function toggleMapStations() {
  state.mapSettings.showStations = !state.mapSettings.showStations;
  renderPlumeMap();
}

/* ==========================================================================
   Interactive 72h Plume Scrubber Controls
   ========================================================================== */
function onScrubberInput(hourVal) {
  state.scrubberHour = parseInt(hourVal);
  const badge = document.getElementById('scrubber-display-time');
  if (badge) badge.textContent = `T+${String(state.scrubberHour).padStart(2, '0')}h`;
  fetchPlumeDispersion(state.scrubberHour);
}

function stepScrubber(delta) {
  let next = state.scrubberHour + delta;
  if (next < 0) next = 71;
  if (next > 71) next = 0;
  const slider = document.getElementById('plume-time-slider');
  if (slider) slider.value = next;
  onScrubberInput(next);
}

function toggleScrubberPlay() {
  state.isPlayingScrubber = !state.isPlayingScrubber;
  const btn = document.getElementById('btn-play-scrubber');
  if (state.isPlayingScrubber) {
    if (btn) btn.textContent = '⏸ PAUSE';
    state.scrubberTimer = setInterval(() => {
      stepScrubber(1);
    }, 750);
  } else {
    if (btn) btn.textContent = '▶ PLAY';
    clearInterval(state.scrubberTimer);
  }
}

/* ==========================================================================
   Tab 05: What-If Policy Intervention Simulator
   ========================================================================== */
function updateScenarioSliderLabels() {
  const sRed = document.getElementById('slider-stubble-reduction').value;
  const wDel = document.getElementById('slider-wind-delta').value;

  const lRed = document.getElementById('val-stubble-reduction');
  const lDel = document.getElementById('val-wind-delta');

  if (lRed) lRed.textContent = `-${sRed}% (Target Suppression)`;
  if (lDel) lDel.textContent = `${parseFloat(wDel) >= 0 ? '+' : ''}${wDel} m/s (Ventilation Shift)`;
}

function setScenarioFeedback(enabled) {
  state.scenario.feedbackEnabled = enabled;
  const bOn = document.getElementById('btn-scen-feedback-on');
  const bOff = document.getElementById('btn-scen-feedback-off');
  const lStat = document.getElementById('val-feedback-status');

  if (enabled) {
    bOn.classList.add('active');
    bOff.classList.remove('active');
    if (lStat) lStat.textContent = 'ACTIVE (WRF-Chem)';
  } else {
    bOn.classList.remove('active');
    bOff.classList.add('active');
    if (lStat) lStat.textContent = 'DISABLED (Naive Decoupled)';
  }
}

function resetScenarioDefaults() {
  document.getElementById('slider-stubble-reduction').value = 0;
  document.getElementById('slider-wind-delta').value = 0.0;
  updateScenarioSliderLabels();
  setScenarioFeedback(true);
  runScenarioSimulation();
}

async function runScenarioSimulation() {
  const sRed = parseFloat(document.getElementById('slider-stubble-reduction').value);
  const wDel = parseFloat(document.getElementById('slider-wind-delta').value);
  const btn = document.getElementById('btn-run-scenario');

  if (btn) {
    btn.textContent = '⚡ COMPUTING COUPLED PHYSICS...';
    btn.disabled = true;
  }

  try {
    const res = await fetch(`${API_BASE}/api/simulation/what-if`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stubble_reduction_percent: sRed,
        wind_speed_delta_ms: wDel,
        feedback_enabled: state.scenario.feedbackEnabled
      })
    });
    const result = await res.json();
    state.scenario.scenarioSeries = result.scenario_series;

    // Update KPIs
    const imp = result.impact_summary;
    const dVal = document.getElementById('scen-delta-aqi');
    const pVal = document.getElementById('scen-percent-improvement');
    const nVal = document.getElementById('scen-new-peak-aqi');
    const vBox = document.getElementById('scen-verdict-box');

    if (dVal) dVal.textContent = `-${imp.peak_aqi_drop}`;
    if (pVal) pVal.textContent = `${imp.percent_improvement}%`;
    if (nVal) nVal.textContent = imp.scenario_peak_aqi;
    if (vBox) vBox.innerHTML = `<b>POLICY VERDICT:</b> ${imp.policy_verdict}`;

    renderScenarioChart();
  } catch (err) {
    console.error('Scenario simulation failed:', err);
  } finally {
    if (btn) {
      btn.textContent = '⚡ RUN COUPLED RE-SIMULATION';
      btn.disabled = false;
    }
  }
}

function renderScenarioChart() {
  const canvas = document.getElementById('scenarioChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();

  canvas.width = (rect.width || 800) * dpr;
  canvas.height = 320 * dpr;
  ctx.scale(dpr, dpr);

  const W = rect.width || 800;
  const H = 320;
  ctx.clearRect(0, 0, W, H);

  if (!state.forecastData || !state.forecastData.series) return;

  const baseSeries = state.forecastData.series;
  const scenSeries = state.scenario.scenarioSeries || baseSeries;
  const N = baseSeries.length;

  const padLeft = 50, padRight = 30, padTop = 20, padBottom = 40;
  const chartW = W - padLeft - padRight;
  const chartH = H - padTop - padBottom;

  // Grid
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
  for (let s = 0; s <= 4; s++) {
    const y = padTop + (s / 4) * chartH;
    ctx.beginPath();
    ctx.moveTo(padLeft, y);
    ctx.lineTo(W - padRight, y);
    ctx.stroke();

    ctx.fillStyle = '#64748b';
    ctx.font = '10px JetBrains Mono';
    ctx.fillText(Math.round(500 - (s / 4) * 500), padLeft - 30, y + 4);
  }

  // Baseline Line (Red)
  ctx.strokeStyle = '#ef4444';
  ctx.lineWidth = 2;
  ctx.beginPath();
  baseSeries.forEach((pt, i) => {
    const x = padLeft + (i / (N - 1)) * chartW;
    const y = padTop + chartH - (pt.aqi_coupled / 500) * chartH;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Scenario Line (Green)
  ctx.strokeStyle = '#10b981';
  ctx.lineWidth = 2.5;
  ctx.shadowColor = 'rgba(16, 185, 129, 0.4)';
  ctx.shadowBlur = 8;
  ctx.beginPath();
  scenSeries.forEach((pt, i) => {
    const x = padLeft + (i / (N - 1)) * chartW;
    const y = padTop + chartH - (pt.aqi_coupled / 500) * chartH;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Legend
  ctx.fillStyle = '#ef4444';
  ctx.font = '11px JetBrains Mono';
  ctx.fillText('— Current Baseline Peak AQI', padLeft + 20, padTop + 20);
  ctx.fillStyle = '#10b981';
  ctx.fillText('— Post-Intervention Policy Curve', padLeft + 250, padTop + 20);
}

/* ==========================================================================
   Tab 06: AeroChem-AI Copilot
   ========================================================================== */
async function submitAiMessage() {
  const input = document.getElementById('ai-user-input');
  if (!input) return;
  const msg = input.value.trim();
  if (!msg) return;

  appendAiMessage('user', msg);
  input.value = '';

  // Show live reasoning indicator
  const tempId = 'ai-typing-' + Date.now();
  const box = document.getElementById('ai-messages-box');
  if (box) {
    const typingDiv = document.createElement('div');
    typingDiv.id = tempId;
    typingDiv.className = 'ai-message bot';
    typingDiv.innerHTML = `
      <div class="msg-avatar">⚡</div>
      <div class="msg-bubble"><i style="color:#94a3b8">Searching for the AQI & analyzing data...</i></div>
    `;
    box.appendChild(typingDiv);
    box.scrollTop = box.scrollHeight;
  }

  try {
    const res = await fetch(`${API_BASE}/api/ai/assistant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg })
    });
    const data = await res.json();
    const typingEl = document.getElementById(tempId);
    if (typingEl) typingEl.remove();
    appendAiMessage('bot', data.text, data.action, data.suggested_questions);
  } catch (err) {
    const typingEl = document.getElementById(tempId);
    if (typingEl) typingEl.remove();
    appendAiMessage('bot', 'Communication fault with atmospheric reasoning server.');
  }
}

function sendAiPrompt(promptText) {
  const input = document.getElementById('ai-user-input');
  if (input) input.value = promptText;
  submitAiMessage();
}

function appendAiMessage(sender, text, action = null, suggested = []) {
  const box = document.getElementById('ai-messages-box');
  if (!box) return;

  const msgDiv = document.createElement('div');
  msgDiv.className = `ai-message ${sender}`;

  let actionHtml = '';
  if (action && action.tab) {
    actionHtml = `<button class="hud-btn mini glow-cyan" onclick="switchTab('tab-${action.tab}')">⚡ ${action.label || 'View in Platform'}</button>`;
  }

  msgDiv.innerHTML = `
    <div class="msg-avatar">${sender === 'bot' ? '⚡' : '👤'}</div>
    <div class="msg-bubble">
      <div>${formatMarkdown(text)}</div>
      ${actionHtml ? `<div class="msg-actions">${actionHtml}</div>` : ''}
    </div>
  `;

  box.appendChild(msgDiv);
  box.scrollTop = box.scrollHeight;
}

function formatMarkdown(text) {
  if (!text) return '';
  // Markdown renderer for headers, bold, math, lists, linebreaks
  return text
    .replace(/^#### (.*$)/gim, '<h5 style="color:#38bdf8; margin: 8px 0 3px; font-size: 0.95rem; font-weight:700;">$1</h5>')
    .replace(/^### (.*$)/gim, '<h4 style="color:#ffffff; margin: 10px 0 4px; font-size: 1.05rem; font-weight:700;">$1</h4>')
    .replace(/^## (.*$)/gim, '<h3 style="color:#00f2fe; margin: 12px 0 6px; font-size: 1.15rem; font-weight:700;">$1</h3>')
    .replace(/\*\*(.*?)\*\*/gim, '<b>$1</b>')
    .replace(/\*(.*?)\*/gim, '<i>$1</i>')
    .replace(/\$(.*?)\$/gim, '<code style="color:var(--cyan-neon); background:rgba(0,242,254,0.1); padding:1px 4px; border-radius:3px;">$1</code>')
    .replace(/^\- (.*$)/gim, '• $1<br>')
    .replace(/\n\n/gim, '<br><br>')
    .replace(/\n/gim, '<br>');
}

async function fetchSpatialSeverity() {
  try {
    const res = await fetch(`${API_BASE}/api/forecast/spatial-severity?enable_feedback=true`);
    const data = await res.json();
    state.spatialData = data;
    renderSpatialSeverity(data);
    renderZonalMatrixChart();
  } catch (err) {
    console.error('Spatial severity fetch failed:', err);
  }
}

function renderSpatialSeverity(data) {
  if (!data || !data.timeline || data.timeline.length === 0) return;
  const current = data.timeline[0];
  const trip = current.tripartite_interaction;

  // Tripartite Status Banner
  const badge = document.getElementById('tripartite-regime-badge');
  const headline = document.getElementById('tripartite-headline');
  if (badge) {
    badge.textContent = `COUPLING INDEX: ${trip.index} • ${trip.regime.toUpperCase()}`;
    badge.style.background = trip.regime_color + '33';
    badge.style.color = '#ffffff';
  }
  if (headline) {
    headline.innerHTML = `
      <b>TRIPARTITE COUPLING DYNAMICS ACTIVE:</b>
      <b>Weather:</b> ${trip.weather_trapping_driver} &nbsp;|&nbsp;
      <b>Pollution Feedback:</b> ${trip.pollution_dimming_driver} &nbsp;|&nbsp;
      <b>External Influx:</b> ${trip.stubble_influx_driver}.
    `;
  }

  // Populate Pillars
  if (state.forecastData && state.forecastData.series && state.forecastData.series.length > 0) {
    const fc = state.forecastData.series[0];
    const tripInv = document.getElementById('trip-inversion');
    const tripPbl = document.getElementById('trip-pbl');
    const tripVent = document.getElementById('trip-vent');
    const tripWind = document.getElementById('trip-wind');

    if (tripInv) tripInv.textContent = `+${fc.inversion_strength_c} °C`;
    if (tripPbl) tripPbl.textContent = `${fc.pbl_height_coupled_m} m`;
    if (tripVent) tripVent.textContent = `${Number(fc.ventilation_index_m2s).toLocaleString()} m²/s (${fc.ventilation_status})`;
    if (tripWind) tripWind.textContent = `${fc.wind_dir_deg}° ${fc.wind_cardinal} @ ${fc.wind_speed_ms} m/s`;

    const tripAod = document.getElementById('trip-aod');
    const tripDim = document.getElementById('trip-dimming');
    const tripCool = document.getElementById('trip-cooling');
    const tripSupp = document.getElementById('trip-suppression');

    if (tripAod) tripAod.textContent = `${fc.aod} (Heavy Smog)`;
    if (tripDim) tripDim.textContent = `-${fc.dimming_flux_wm2} W/m²`;
    if (tripCool) tripCool.textContent = `${fc.temp_cooling_delta} °C`;
    if (tripSupp) tripSupp.textContent = `-${fc.pbl_suppression_m} m`;

    const tripShare = document.getElementById('trip-share');
    if (tripShare) tripShare.textContent = `${fc.stubble_share_percent}%`;
  }

  // Populate Ranked Sub-Region Hotspot Cards
  const container = document.getElementById('ranked-hotspots-container');
  if (!container || !data.ranked_hotspots) return;

  container.innerHTML = '';
  data.ranked_hotspots.forEach(z => {
    const card = document.createElement('div');
    const rankClass = z.peak_aqi >= 470 ? 'extreme' : (z.peak_aqi >= 430 ? 'veryhigh' : 'high');
    card.className = `sub-region-card ${rankClass}`;

    card.innerHTML = `
      <div>
        <div class="sub-card-header">
          <span class="sub-zone-name">${z.name}</span>
          <span class="badge-pill ${rankClass === 'extreme' ? 'alert' : 'warning'}">${z.risk_rank}</span>
        </div>
        <div class="sub-zone-hubs">${z.hubs}</div>
        <div class="sub-aqi-row">
          <span class="sub-aqi-val text-severe">${z.peak_aqi}</span>
          <span style="font-family: var(--font-mono); font-size: 0.72rem; color: #fca5a5;">PROJECTED PEAK</span>
        </div>
        <div class="sub-meta-stats">
          <div><b>Peak Arrival:</b> <span class="text-amber">${z.peak_hour}</span></div>
          <div><b>Peak PM2.5:</b> <span class="text-cyan">${z.peak_pm25} &mu;g/m&sup3;</span></div>
          <div><b>Severe Duration:</b> <span class="text-purple">${z.severe_hours_count}h &gt;400</span></div>
          <div><b>Trapping:</b> Active Capping</div>
        </div>
      </div>
      <div>
        <div class="sub-driver-bars">
          <div class="driver-bar-label">
            <span>Stubble vs Local Ratio</span>
            <span class="text-amber">Plume Influx</span>
          </div>
          <div class="driver-track">
            <div class="driver-fill" style="width: 44%; background: linear-gradient(90deg, #0ea5e9, #f59e0b);"></div>
          </div>
        </div>
        <div class="sub-vulnerability-desc">${z.primary_vulnerability}</div>
      </div>
    `;
    container.appendChild(card);
  });
}

function renderZonalMatrixChart() {
  const canvas = document.getElementById('zonalMatrixCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();

  canvas.width = (rect.width || 1160) * dpr;
  canvas.height = 360 * dpr;
  ctx.scale(dpr, dpr);

  const W = rect.width || 1160;
  const H = 360;
  ctx.clearRect(0, 0, W, H);

  if (!state.spatialData || !state.spatialData.timeline) {
    ctx.fillStyle = '#94a3b8';
    ctx.font = '13px JetBrains Mono';
    ctx.fillText('Loading 72-hour spatial severity matrix...', 50, H / 2);
    return;
  }

  const timeline = state.spatialData.timeline;
  const zones = timeline[0].zones;
  const numZones = zones.length;
  const numHours = timeline.length;

  const padLeft = 190;
  const padRight = 30;
  const padTop = 30;
  const padBottom = 45;

  const gridW = W - padLeft - padRight;
  const gridH = H - padTop - padBottom;
  const cellW = gridW / numHours;
  const cellH = gridH / numZones;

  // Draw Y-Axis Zone Labels
  zones.forEach((z, zi) => {
    const y = padTop + zi * cellH + cellH / 2;
    ctx.fillStyle = '#f1f5f9';
    ctx.font = '11px Chakra Petch';
    ctx.fillText(z.zone_name, 15, y + 4);

    ctx.fillStyle = '#64748b';
    ctx.font = '9px JetBrains Mono';
    ctx.fillText(z.hubs.split(',')[0], 15, y + 15);
  });

  // Draw Heatmap Cells
  timeline.forEach((pt, hi) => {
    pt.zones.forEach((z, zi) => {
      const x = padLeft + hi * cellW;
      const y = padTop + zi * cellH;

      ctx.fillStyle = z.severity_color;
      ctx.fillRect(x, y, cellW - 0.5, cellH - 0.5);
    });
  });

  // Draw Time Axis (X)
  for (let hi = 0; hi < numHours; hi += 6) {
    const x = padLeft + hi * cellW;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.beginPath();
    ctx.moveTo(x, padTop);
    ctx.lineTo(x, H - padBottom);
    ctx.stroke();

    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px JetBrains Mono';
    ctx.fillText(`T+${hi}h`, x - 12, H - 22);
    ctx.fillText(`${timeline[hi].hour_of_day}:00`, x - 10, H - 10);
  }

  // Draw Current Timeline Marker
  const curX = padLeft + (state.scrubberHour / numHours) * gridW;
  ctx.strokeStyle = '#00f2fe';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(curX, padTop - 10);
  ctx.lineTo(curX, H - padBottom + 10);
  ctx.stroke();
}

/* ==========================================================================
   Canvas Event Listeners (Resize & Tooltips)
   ========================================================================== */
function initCanvasListeners() {
  window.addEventListener('resize', () => {
    renderForecastChart();
    renderSoundingChart();
    renderPlumeMap();
    renderScenarioChart();
    renderZonalMatrixChart();
  });

  const matrixCanvas = document.getElementById('zonalMatrixCanvas');
  if (matrixCanvas) {
    matrixCanvas.addEventListener('mousemove', (e) => {
      if (!state.spatialData || !state.spatialData.timeline) return;
      const rect = matrixCanvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const padLeft = 190;
      const padRight = 30;
      const padTop = 30;
      const padBottom = 45;
      const gridW = rect.width - padLeft - padRight;
      const gridH = 360 - padTop - padBottom;

      if (x >= padLeft && x <= rect.width - padRight && y >= padTop && y <= 360 - padBottom) {
        const timeline = state.spatialData.timeline;
        const numHours = timeline.length;
        const numZones = timeline[0].zones.length;

        const hi = Math.min(numHours - 1, Math.max(0, Math.floor(((x - padLeft) / gridW) * numHours)));
        const zi = Math.min(numZones - 1, Math.max(0, Math.floor(((y - padTop) / gridH) * numZones)));

        const pt = timeline[hi];
        const zone = pt.zones[zi];
        const footer = document.getElementById('zonal-hover-details');
        if (footer) {
          footer.innerHTML = `
            <b>[${pt.time_label}] ${zone.zone_name} (${zone.hubs}):</b> 
            <span style="color:${zone.severity_color}; font-weight:800;">AQI ${zone.aqi} (${zone.severity})</span> | 
            PM2.5: <span class="text-cyan">${zone.pm25}&mu;g/m&sup3;</span> | 
            Stubble Influx Share: <span class="text-amber">${zone.stubble_share_pct}%</span> | 
            Local Share: ${zone.local_share_pct}% | 
            Tripartite Index: ${pt.tripartite_interaction.index}
          `;
        }
      }
    });
  }
}

// ================================================================
// 12. FLOATING AI COPILOT (SEARCH FOR THE AQI)
// ================================================================
function toggleFloatingChat() {
  const drawer = document.getElementById('floating-chat-drawer');
  if (!drawer) return;
  drawer.classList.toggle('active');
  if (drawer.classList.contains('active')) {
    const input = document.getElementById('floating-ai-input');
    if (input) input.focus();
  }
}

function sendFloatingAiPrompt(promptText) {
  const drawer = document.getElementById('floating-chat-drawer');
  if (drawer && !drawer.classList.contains('active')) {
    drawer.classList.add('active');
  }
  const input = document.getElementById('floating-ai-input');
  if (input) input.value = promptText;
  submitFloatingAiMessage();
}

async function submitFloatingAiMessage() {
  const input = document.getElementById('floating-ai-input');
  if (!input) return;
  const msg = input.value.trim();
  if (!msg) return;

  appendFloatingAiMessage('user', msg);
  input.value = '';

  // Temporary thinking indicator
  const tempId = 'floating-typing-' + Date.now();
  const box = document.getElementById('floating-ai-messages');
  if (box) {
    const typingDiv = document.createElement('div');
    typingDiv.id = tempId;
    typingDiv.className = 'ai-message bot';
    typingDiv.innerHTML = `
      <div class="msg-avatar">⚡</div>
      <div class="msg-bubble"><i style="color:#94a3b8">Searching for the AQI & analyzing data...</i></div>
    `;
    box.appendChild(typingDiv);
    box.scrollTop = box.scrollHeight;
  }

  try {
    const res = await fetch(`${API_BASE}/api/ai/assistant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg })
    });
    const data = await res.json();
    
    const typingEl = document.getElementById(tempId);
    if (typingEl) typingEl.remove();

    appendFloatingAiMessage('bot', data.text, data.action, data.suggested_questions);
  } catch (err) {
    const typingEl = document.getElementById(tempId);
    if (typingEl) typingEl.remove();
    appendFloatingAiMessage('bot', 'Sorry, communication with the air quality system timed out. Please check if the local server is running.');
  }
}

function appendFloatingAiMessage(sender, text, action = null, suggested = []) {
  const box = document.getElementById('floating-ai-messages');
  if (!box) return;

  const msgDiv = document.createElement('div');
  msgDiv.className = `ai-message ${sender}`;

  let actionHtml = '';
  if (action && action.tab) {
    actionHtml = `<button class="hud-btn mini glow-cyan" onclick="switchTab('tab-${action.tab}'); toggleFloatingChat();">⚡ ${action.label || 'View in Platform'}</button>`;
  }

  msgDiv.innerHTML = `
    <div class="msg-avatar">${sender === 'bot' ? '⚡' : '👤'}</div>
    <div class="msg-bubble">
      <div>${formatMarkdown(text)}</div>
      ${actionHtml ? `<div class="msg-actions">${actionHtml}</div>` : ''}
    </div>
  `;

  box.appendChild(msgDiv);
  box.scrollTop = box.scrollHeight;
}

/* ==========================================================================
   13. Real-Time Live API Telemetry Ingest & Synchronization
   ========================================================================== */
async function refreshLiveApiData() {
  const btn = document.getElementById('btn-refresh-live-api');
  if (btn) btn.innerText = 'FETCHING...';

  try {
    const res = await fetch(`${API_BASE}/api/realtime/live-api?refresh=true`);
    const data = await res.json();
    if (btn) btn.innerText = '🔄 REFRESH LIVE API';
    updateLiveApiUI(data);
  } catch (err) {
    if (btn) btn.innerText = '🔄 REFRESH LIVE API';
    console.error('Failed to refresh live API data:', err);
  }
}

function updateLiveApiUI(data) {
  if (!data) return;
  const wx = data.meteorology || {};
  const pol = data.pollutants || {};
  const idx = data.air_quality_indices || {};

  const timeEl = document.getElementById('live-api-time');
  if (timeEl && data.observation_time_ist) {
    timeEl.innerText = `${data.observation_time_ist} // ${data.api_provider || 'LIVE CAMS'}`;
  }
  const mapTimeEl = document.getElementById('map-current-date-time');
  if (mapTimeEl && data.observation_time_ist) {
    mapTimeEl.innerText = data.observation_time_ist.split(',')[0].toUpperCase();
  }

  const tempEl = document.getElementById('live-api-temp');
  if (tempEl && wx.temperature_c !== undefined) tempEl.innerText = `${wx.temperature_c}°C`;

  const rhEl = document.getElementById('live-api-rh');
  if (rhEl && wx.relative_humidity_percent !== undefined) rhEl.innerText = `${wx.relative_humidity_percent}%`;

  const windEl = document.getElementById('live-api-wind');
  if (windEl && wx.wind_speed_ms !== undefined) windEl.innerText = `${wx.wind_speed_ms} m/s ${wx.wind_cardinal || ''}`;

  const rainEl = document.getElementById('live-api-rain');
  if (rainEl && wx.precipitation_mm !== undefined) rainEl.innerText = `${wx.precipitation_mm} mm`;

  const pm25El = document.getElementById('live-api-pm25');
  if (pm25El && pol.pm2_5_ugm3 !== undefined) pm25El.innerHTML = `${pol.pm2_5_ugm3} &mu;g/m&sup3;`;

  const pm10El = document.getElementById('live-api-pm10');
  if (pm10El && pol.pm10_ugm3 !== undefined) pm10El.innerHTML = `${pol.pm10_ugm3} &mu;g/m&sup3;`;

  const no2El = document.getElementById('live-api-no2');
  if (no2El && pol.no2_ugm3 !== undefined) no2El.innerHTML = `${pol.no2_ugm3} &mu;g/m&sup3;`;

  // Update Advanced Science Telemetry
  const sciPbl = document.getElementById('sci-telemetry-pbl');
  if (sciPbl && wx.pbl_height_m) sciPbl.innerText = `${Math.round(wx.pbl_height_m)} m`;
  
  const sciVent = document.getElementById('sci-telemetry-vent');
  if (sciVent && wx.pbl_height_m && wx.wind_speed_ms) sciVent.innerText = `${Math.round(wx.pbl_height_m * wx.wind_speed_ms)} m²/s`;
  
  const sciWind = document.getElementById('sci-telemetry-wind');
  if (sciWind && wx.wind_speed_ms) sciWind.innerText = `${Math.round(wx.wind_direction_deg || 0)}° ${wx.wind_cardinal || ''} @ ${wx.wind_speed_ms} m/s`;
  
  const sciInv = document.getElementById('sci-telemetry-inv');
  if (sciInv && wx.inversion_strength_c !== undefined) {
    const invStr = (wx.inversion_strength_c).toFixed(1);
    sciInv.innerText = invStr > 0 ? `+${invStr} °C` : `${invStr} °C`;
    sciInv.style.color = invStr > 0 ? '#ef4444' : '#84cc16';
  }
  
  const sciMass = document.getElementById('sci-telemetry-mass');
  if (sciMass && pol.pm2_5_ugm3) {
      if (pol.pm2_5_ugm3 > 250) { sciMass.innerText = "CRITICAL"; sciMass.style.color = "#ef4444"; }
      else if (pol.pm2_5_ugm3 > 100) { sciMass.innerText = "HIGH LOAD"; sciMass.style.color = "#f59e0b"; }
      else { sciMass.innerText = "NOMINAL"; sciMass.style.color = "#84cc16"; }
  }

  const naqiEl = document.getElementById('live-api-naqi');
  if (naqiEl && idx.india_cpcb_naqi !== undefined) {
    naqiEl.innerText = `${idx.india_cpcb_naqi} (${(idx.india_category || '').toUpperCase()})`;
    if (idx.india_color) naqiEl.style.color = idx.india_color;
  }

  // Update Citizen Health Shield
  const cigEl = document.getElementById('shield-cigarettes-val');
  if (cigEl && data.health_equivalence && data.health_equivalence.cigarettes_per_day) {
    cigEl.innerHTML = `🚬 ~${data.health_equivalence.cigarettes_per_day} Cigarettes / Day Inhaled`;
  }

  const shieldStat = document.getElementById('shield-health-status');
  if (shieldStat && idx.india_category) {
    const category = idx.india_category.toLowerCase();
    
    const outStatus = document.getElementById('shield-outdoor-status');
    const outDesc = document.getElementById('shield-outdoor-desc');
    const childStatus = document.getElementById('shield-children-status');
    const childDesc = document.getElementById('shield-children-desc');
    const walkStatus = document.getElementById('shield-walkers-status');
    const walkDesc = document.getElementById('shield-walkers-desc');
    const homeStatus = document.getElementById('shield-home-status');
    const homeDesc = document.getElementById('shield-home-desc');
    
    let shieldEmoji = "🔴";
    let shieldText = "HEALTH HAZARD";
    
    let outStatusText = "N95 Mask Needed"; let outStatusClass = "urgent";
    let outDescText = "Wear a certified N95 / FFP2 mask outside. Normal cloth or surgical masks cannot filter microscopic PM2.5 smoke.";
    
    let childStatusText = "Stay Indoors"; let childStatusClass = "urgent";
    let childDescText = "Kids and elderly people are vulnerable to asthma and lung irritation. Postpone outdoor sports, playground, and heavy exertion.";
    
    let walkStatusText = "Postpone to Noon"; let walkStatusClass = "caution";
    let walkDescText = "Avoid jogging between 5:00 AM & 9:00 AM. Cold morning air traps the heaviest blanket of toxic smoke at breathing level.";
    
    let homeStatusText = "Windows Closed"; let homeStatusClass = "safe";
    let homeDescText = "Keep external doors & windows shut. Run indoor air purifiers if available. Avoid lighting incense sticks (agarbatti) or candles.";

    if (category === "good") {
      shieldEmoji = "🟢"; shieldText = "AIR QUALITY GOOD";
      outStatusText = "Normal Activities"; outStatusClass = "safe";
      outDescText = "Enjoy outdoor activities. Air is fresh and safe.";
      childStatusText = "Safe to Play"; childStatusClass = "safe";
      childDescText = "Kids can safely play outdoors without any restrictions.";
      walkStatusText = "Great for Walking"; walkStatusClass = "safe";
      walkDescText = "Perfect time for morning walk and outdoor exercises.";
      homeStatusText = "Ventilate Home"; homeStatusClass = "safe";
      homeDescText = "Open windows to let fresh air circulate inside your home.";
    } else if (category === "satisfactory") {
      shieldEmoji = "🟡"; shieldText = "AIR QUALITY ACCEPTABLE";
      outStatusText = "Normal Activities"; outStatusClass = "safe";
      outDescText = "Safe for most people. Sensitive individuals should monitor how they feel.";
      childStatusText = "Monitor Play"; childStatusClass = "safe";
      childDescText = "Safe for kids to play, but monitor asthmatic children for any slight symptoms.";
      walkStatusText = "Good for Walking"; walkStatusClass = "safe";
      walkDescText = "Morning walks are generally fine for healthy individuals.";
      homeStatusText = "Keep Ventilated"; homeStatusClass = "safe";
      homeDescText = "Keep windows open. Indoor air is safe.";
    } else if (category === "moderate") {
      shieldEmoji = "🟠"; shieldText = "MODERATE HEALTH RISK";
      outStatusText = "Limit Heavy Exertion"; outStatusClass = "caution";
      outDescText = "Consider reducing prolonged or heavy exertion outdoors if you experience symptoms like coughing.";
      childStatusText = "Limit Outdoor Play"; childStatusClass = "caution";
      childDescText = "Children and seniors should reduce prolonged outdoor physical exertion.";
      walkStatusText = "Delay Walk if Sensitive"; walkStatusClass = "caution";
      walkDescText = "Asthmatics and elderly should consider walking later in the day when air clears.";
      homeStatusText = "Mostly Closed"; homeStatusClass = "caution";
      homeDescText = "Keep windows closed during peak traffic hours to prevent dust and smoke entry.";
    } else if (category === "poor") {
      shieldEmoji = "🔴"; shieldText = "POOR AIR QUALITY";
      outStatusText = "Mask Recommended"; outStatusClass = "urgent";
      outDescText = "Wear an N95 mask outside. Reduce prolonged outdoor activities.";
      childStatusText = "Restrict Activities"; childStatusClass = "urgent";
      childDescText = "Children, elderly, and people with respiratory diseases should avoid outdoor exertion.";
      walkStatusText = "Avoid Morning Walks"; walkStatusClass = "urgent";
      walkDescText = "Do not walk early morning. Wait until afternoon when air quality slightly improves.";
      homeStatusText = "Keep Windows Closed"; homeStatusClass = "urgent";
      homeDescText = "Shut doors and windows. Use an air purifier if available.";
    } else if (category === "very poor") {
      shieldEmoji = "🟣"; shieldText = "SEVERE HEALTH HAZARD";
      outStatusText = "N95 Mask Needed"; outStatusClass = "urgent";
      outDescText = "Avoid all outdoor physical exertion. N95 mask is strictly necessary when stepping out.";
      childStatusText = "Stay Indoors"; childStatusClass = "urgent";
      childDescText = "High risk to children and elderly. Keep them indoors at all times.";
      walkStatusText = "Stop Morning Walks"; walkStatusClass = "urgent";
      walkDescText = "Walking or jogging in the morning is highly dangerous. Stay indoors.";
      homeStatusText = "Run Air Purifiers"; homeStatusClass = "urgent";
      homeDescText = "Keep all windows sealed. Keep indoor air purifiers running on high mode.";
    } else if (category === "severe") {
      shieldEmoji = "🟤"; shieldText = "CRITICAL HEALTH EMERGENCY";
      outStatusText = "Strictly Avoid Outdoors"; outStatusClass = "urgent";
      outDescText = "Remain indoors. Wear an N95 mask even for short trips outside. Healthy people will experience respiratory illness.";
      childStatusText = "Absolute Indoor Restriction"; childStatusClass = "urgent";
      childDescText = "Extreme danger for children and elderly. Halt all outdoor activities immediately.";
      walkStatusText = "Dangerous Exposure"; walkStatusClass = "urgent";
      walkDescText = "Morning air is extremely toxic. Do not walk, run, or cycle outside.";
      homeStatusText = "Seal Home & Purify"; homeStatusClass = "urgent";
      homeDescText = "Seal all gaps. Run air purifiers 24/7. Avoid any indoor smoke.";
    }

    shieldStat.innerHTML = `${shieldEmoji} ${category.toUpperCase()} - ${shieldText}`;
    if (idx.india_color) {
      shieldStat.style.borderColor = idx.india_color;
      shieldStat.style.color = idx.india_color;
    }
    
    if (outStatus) { outStatus.className = `action-card-status ${outStatusClass}`; outStatus.innerText = outStatusText; }
    if (outDesc) { outDesc.innerText = outDescText; }
    if (childStatus) { childStatus.className = `action-card-status ${childStatusClass}`; childStatus.innerText = childStatusText; }
    if (childDesc) { childDesc.innerText = childDescText; }
    if (walkStatus) { walkStatus.className = `action-card-status ${walkStatusClass}`; walkStatus.innerText = walkStatusText; }
    if (walkDesc) { walkDesc.innerText = walkDescText; }
    if (homeStatus) { homeStatus.className = `action-card-status ${homeStatusClass}`; homeStatus.innerText = homeStatusText; }
    if (homeDesc) { homeDesc.innerText = homeDescText; }
    
    const inversionAlert = document.getElementById('overview-inversion-alert');
    if (inversionAlert) {
      if (category === "very poor" || category === "severe") {
        inversionAlert.style.display = "flex";
      } else {
        inversionAlert.style.display = "none";
      }
    }
  }

  // Sync Live Data to KPI Matrix (Overriding mock 72h forecast)
  const aqiVal = document.getElementById('kpi-aqi-val');
  const aqiCat = document.getElementById('kpi-aqi-category');
  const aqiBar = document.getElementById('kpi-aqi-bar');
  const pm25Val = document.getElementById('kpi-pm25-val');

  if (aqiVal && idx.india_cpcb_naqi !== undefined) {
    aqiVal.textContent = idx.india_cpcb_naqi;
    aqiVal.style.color = idx.india_color || "";
  }
  
  if (aqiCat && idx.india_category) {
    aqiCat.textContent = idx.india_category.toUpperCase();
    if (idx.india_color) {
      aqiCat.style.background = idx.india_color + '33';
      aqiCat.style.borderColor = idx.india_color;
      aqiCat.style.color = idx.india_color;
    }
  }
  
  if (aqiBar && idx.india_cpcb_naqi !== undefined) {
    const pct = Math.min(100, (idx.india_cpcb_naqi / 500) * 100);
    aqiBar.style.width = `${pct}%`;
    if (idx.india_color) aqiBar.style.background = idx.india_color;
  }
  
  if (pm25Val && pol.pm2_5_ugm3 !== undefined) {
    pm25Val.textContent = pol.pm2_5_ugm3;
    if (idx.india_color) pm25Val.style.color = idx.india_color; 
  }

  const descAqi = document.getElementById('desc-aqi');
  if (descAqi && idx.india_category) {
    const cat = idx.india_category.toLowerCase();
    let txt = "The air is heavily polluted. Wear an N95 mask outside.";
    if (cat === "good") txt = "The air is fresh and healthy. Enjoy outdoor activities.";
    else if (cat === "satisfactory") txt = "Air quality is acceptable. Safe for most people to be outside.";
    else if (cat === "moderate") txt = "Acceptable air quality, but sensitive groups should limit heavy exertion.";
    else if (cat === "poor") txt = "Air is polluted. Breathing causes discomfort to most people.";
    else if (cat === "very poor") txt = "Prolonged exposure to this air causes respiratory illness. Wear a mask.";
    else if (cat === "severe") txt = "The air is highly toxic. Breathing causes severe health impacts. Strictly stay indoors.";
    descAqi.innerHTML = `<b>💡 What this means:</b> ${txt}`;
  }

  // Update Inversion, PBL, Vc, Stubble from live meteorology
  const invVal = document.getElementById('kpi-inversion-strength');
  const pblVal = document.getElementById('kpi-pbl-val');
  const ventVal = document.getElementById('kpi-ventilation-val');
  const stubbleShare = document.getElementById('kpi-stubble-share');
  
  const descInv = document.getElementById('desc-inversion');
  const descPbl = document.getElementById('desc-pbl');
  const descVent = document.getElementById('desc-ventilation');
  const descStubble = document.getElementById('desc-stubble');

  if (wx.inversion_strength_c !== undefined) {
    if (invVal) invVal.textContent = `+${wx.inversion_strength_c}`;
    if (descInv) descInv.innerHTML = `<b>💡 What this means:</b> Warm air sitting above cold night air creates a +${wx.inversion_strength_c}°C lid. Smoke cannot rise into the sky and stays trapped.`;
    const badge = invVal ? invVal.closest('.kpi-card').querySelector('.kpi-badge') : null;
    if (badge) {
      if (wx.inversion_strength_c < 2.0) { badge.className = 'kpi-badge safe'; badge.textContent = 'WEAK INVERSION'; }
      else if (wx.inversion_strength_c < 5.0) { badge.className = 'kpi-badge amber'; badge.textContent = 'MODERATE LID'; }
      else { badge.className = 'kpi-badge red'; badge.textContent = 'WARM LID ACTIVE'; }
    }
  }
  if (wx.pbl_height_m !== undefined) {
    if (pblVal) pblVal.textContent = wx.pbl_height_m;
    if (descPbl) descPbl.innerHTML = `<b>💡 What this means:</b> The breathing volume is at ${wx.pbl_height_m} meters.`;
    const badge = pblVal ? pblVal.closest('.kpi-card').querySelector('.kpi-badge') : null;
    if (badge) {
      if (wx.pbl_height_m > 800) { badge.className = 'kpi-badge safe'; badge.textContent = 'GOOD CEILING'; }
      else if (wx.pbl_height_m > 400) { badge.className = 'kpi-badge amber'; badge.textContent = 'MODERATE CEILING'; }
      else { badge.className = 'kpi-badge dark'; badge.textContent = 'SHALLOW CEILING'; }
    }
  }
  if (wx.ventilation_index_m2s !== undefined) {
    if (ventVal) ventVal.textContent = Number(wx.ventilation_index_m2s).toLocaleString();
    if (descVent) descVent.innerHTML = `<b>💡 What this means:</b> Winds combined with boundary layer give a ventilation index of ${Number(wx.ventilation_index_m2s).toLocaleString()} m²/s.`;
    const badge = ventVal ? ventVal.closest('.kpi-card').querySelector('.kpi-badge') : null;
    if (badge) {
      if (wx.ventilation_index_m2s > 4000) { badge.className = 'kpi-badge safe'; badge.textContent = 'GOOD CLEARING'; }
      else if (wx.ventilation_index_m2s > 2000) { badge.className = 'kpi-badge amber'; badge.textContent = 'POOR CLEARING'; }
      else { badge.className = 'kpi-badge red'; badge.textContent = 'CRITICAL TRAP'; }
    }
  }
  if (wx.stubble_share_percent !== undefined) {
    if (stubbleShare) stubbleShare.textContent = wx.stubble_share_percent;
    if (descStubble) descStubble.innerHTML = `<b>💡 What this means:</b> Around ${wx.stubble_share_percent}% of today's pollution blew into Delhi from crop stubble burning in neighboring agricultural fields upwind.`;
    const badge = stubbleShare ? stubbleShare.closest('.kpi-card').querySelector('.kpi-badge') : null;
    if (badge) {
      if (wx.stubble_share_percent < 15.0) { badge.className = 'kpi-badge safe'; badge.textContent = 'LOW SHARE'; }
      else { badge.className = 'kpi-badge amber'; badge.textContent = 'PUNJAB & HARYANA'; }
    }
  }

  // Update plume bottom bar weather stats
  const plumeWind = document.getElementById('plume-bar-wind');
  const plumeDir = document.getElementById('plume-bar-dir');
  const plumeTemp = document.getElementById('plume-bar-temp');
  const plumeStab = document.getElementById('plume-bar-stab');

  if (wx.wind_speed_kmh !== undefined && plumeWind) plumeWind.textContent = `${wx.wind_speed_kmh} km/h`;
  if (wx.wind_cardinal !== undefined && plumeDir) plumeDir.innerHTML = `${wx.wind_cardinal} &rarr; SE`;
  if (wx.temperature_c !== undefined && plumeTemp) plumeTemp.textContent = `${wx.temperature_c}°C`;
  if (wx.inversion_strength_c !== undefined && plumeStab) {
    if (wx.inversion_strength_c < 2.0) { plumeStab.textContent = 'MODERATE'; plumeStab.style.color = '#f59e0b'; }
    else if (wx.inversion_strength_c < 5.0) { plumeStab.textContent = 'POOR (TRAPPED)'; plumeStab.style.color = '#ef4444'; }
    else { plumeStab.textContent = 'CRITICAL (SEALED)'; plumeStab.style.color = '#7f1d1d'; }
  }
}

/* ==========================================================================
   14. High-Frequency Real-Time Telemetry Stream (Second & Minute Drift)
   ========================================================================== */
let streamIntervalId = null;
let streamFetchInProgress = false;

function toggleTelemetryStream() {
  state.telemetryStreamActive = !state.telemetryStreamActive;
  const btnIcon = document.getElementById('stream-btn-icon');
  const btnText = document.getElementById('stream-btn-text');
  const beacon = document.querySelector('.stream-radar-beacon');

  if (state.telemetryStreamActive) {
    if (btnIcon) btnIcon.textContent = '⏸️';
    if (btnText) btnText.textContent = 'PAUSE STREAM';
    if (beacon) beacon.classList.remove('paused');
    startTelemetryStream();
  } else {
    if (btnIcon) btnIcon.textContent = '▶️';
    if (btnText) btnText.textContent = 'RESUME STREAM';
    if (beacon) beacon.classList.add('paused');
    if (streamIntervalId) {
      clearInterval(streamIntervalId);
      streamIntervalId = null;
    }
  }
}

function startTelemetryStream() {
  if (streamIntervalId) clearInterval(streamIntervalId);
  state.telemetryStreamActive = true;

  // Initial immediate fetch
  fetchTelemetryStream();

  // Poll live telemetry stream every 2 seconds
  streamIntervalId = setInterval(() => {
    if (state.telemetryStreamActive) {
      fetchTelemetryStream();
    }
  }, 2000);
}

async function fetchTelemetryStream() {
  if (streamFetchInProgress) return;
  streamFetchInProgress = true;

  try {
    const res = await fetch(`${API_BASE}/api/realtime/live-stream`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    updateLiveStreamHUD(data);
    updateLiveApiUI(data);
  } catch (err) {
    console.warn('Telemetry stream pulse deferred:', err);
  } finally {
    streamFetchInProgress = false;
  }
}

function updateLiveStreamHUD(data) {
  if (!data) return;
  const stream = data.realtime_stream || {};
  const pol = data.pollutants || {};
  const wx = data.meteorology || {};
  const idx = data.air_quality_indices || {};
  const scoreChange = stream.score_change || {};

  // Clock badge with live second
  const clockEl = document.getElementById('stream-clock-badge');
  if (clockEl) {
    const timeStr = stream.current_second_ist || data.observation_time_ist || new Date().toLocaleTimeString();
    clockEl.innerHTML = `STREAMING: <b style="color:var(--cyan-neon);">${timeStr}</b> • HIGH-FREQUENCY SENSOR FEED`;
  }

  // Live Continuous Score (exact decimal)
  const scoreValEl = document.getElementById('stream-score-val');
  if (scoreValEl) {
    const exactScore = scoreChange.score_now !== undefined ? scoreChange.score_now : (stream.instantaneous_score_exact || idx.india_cpcb_naqi || 232);
    scoreValEl.textContent = exactScore;
  }

  // Score Delta per second tag
  const scoreDeltaEl = document.getElementById('stream-score-delta');
  if (scoreDeltaEl && scoreChange.delta_per_second) {
    const isUp = (scoreChange.delta_per_second_val !== undefined) ? (scoreChange.delta_per_second_val >= 0) : true;
    scoreDeltaEl.className = `stream-delta-tag ${isUp ? 'up' : 'down'}`;
    scoreDeltaEl.textContent = `${isUp ? '▲' : '▼'} ${scoreChange.delta_per_second}`;
  }

  // Changing Type Dynamic Badge
  const typeBadgeEl = document.getElementById('stream-changing-type-badge');
  if (typeBadgeEl && scoreChange.changing_type_badge) {
    typeBadgeEl.textContent = scoreChange.changing_type_badge;
    typeBadgeEl.className = `stream-type-pill ${scoreChange.changing_type_class || 'climb'}`;
  }

  // Score 1-Min Trend Rate
  const scoreRateEl = document.getElementById('stream-score-min-rate');
  if (scoreRateEl && scoreChange.delta_per_minute) {
    const isUp = (scoreChange.delta_per_minute_val !== undefined) ? (scoreChange.delta_per_minute_val >= 0) : true;
    scoreRateEl.textContent = scoreChange.delta_per_minute;
    scoreRateEl.style.color = isUp ? '#f87171' : '#34d399';
  }

  // Plain English Live Explanation Bar
  const typeDescEl = document.getElementById('stream-changing-type-desc');
  if (typeDescEl && scoreChange.changing_type_desc) {
    typeDescEl.innerHTML = `💡 <b style="color:var(--cyan-neon);">Live Dynamic Status:</b> ${scoreChange.changing_type_desc}`;
  }

  // PM2.5 with second delta tag
  const pm25ValEl = document.getElementById('stream-pm25-val');
  if (pm25ValEl && pol.pm2_5_ugm3 !== undefined) {
    pm25ValEl.innerHTML = `${pol.pm2_5_ugm3} &mu;g/m&sup3;`;
  }

  const deltaEl = document.getElementById('stream-pm25-delta');
  if (deltaEl && stream.second_drift_pm25) {
    const drift = stream.turbulent_eddy_fluctuation !== undefined ? stream.turbulent_eddy_fluctuation : 0;
    const isUp = drift >= 0;
    deltaEl.className = `stream-delta-tag ${isUp ? 'up' : 'down'}`;
    deltaEl.textContent = `${isUp ? '▲' : '▼'} ${stream.second_drift_pm25}/s`;
  }

  // 1-min trend
  const trendEl = document.getElementById('stream-min-trend');
  if (trendEl && stream.minute_trend_pm25) {
    const isRising = stream.trend_direction === 'RISING';
    trendEl.innerHTML = `<span style="color:${isRising ? '#f87171' : '#34d399'}; font-weight:700;">${isRising ? '▲' : '▼'} ${stream.minute_trend_pm25}</span>`;
  }

  // Wind
  const windEl = document.getElementById('stream-wind-val');
  if (windEl && wx.wind_speed_ms !== undefined) {
    windEl.textContent = `${wx.wind_speed_ms} m/s ${wx.wind_cardinal || ''}`;
  }

  // Temp
  const tempEl = document.getElementById('stream-temp-val');
  if (tempEl && wx.temperature_c !== undefined) {
    tempEl.textContent = `${wx.temperature_c}°C`;
  }

  // Live NAQI Category
  const naqiEl = document.getElementById('stream-naqi-val');
  if (naqiEl && idx.india_cpcb_naqi !== undefined) {
    naqiEl.textContent = `${idx.india_cpcb_naqi} ${(idx.india_category || '').toUpperCase()}`;
    if (idx.india_color) {
      naqiEl.style.color = idx.india_color;
    }
  }

  // Vast Stations Network Live Update
  if (stream.vast_stations_network && stream.vast_stations_network.length > 0) {
    state.vastStationsData = stream.vast_stations_network;
    state.stationsData = stream.vast_stations_network;
    renderVastNetworkGrid(state.vastStationsData);
    renderStationsTable(state.vastStationsData);
  }
}

/* ==========================================================================
   15. Vast Real-Time Telemetry & Score Network Grid / Row Controls
   ========================================================================== */
function setVastLayout(layout) {
  state.vastLayout = layout || 'row';
  const btnRow = document.getElementById('vast-view-row');
  const btnGrid = document.getElementById('vast-view-grid');
  const header = document.getElementById('vast-series-header');
  const grid = document.getElementById('vast-network-grid');

  if (btnRow) {
    if (state.vastLayout === 'row') btnRow.classList.add('active');
    else btnRow.classList.remove('active');
  }
  if (btnGrid) {
    if (state.vastLayout === 'grid') btnGrid.classList.add('active');
    else btnGrid.classList.remove('active');
  }
  if (header) {
    header.style.display = state.vastLayout === 'row' ? 'grid' : 'none';
  }
  if (grid) {
    if (state.vastLayout === 'row') {
      grid.classList.add('row-layout');
    } else {
      grid.classList.remove('row-layout');
    }
  }

  if (state.vastStationsData && state.vastStationsData.length > 0) {
    renderVastNetworkGrid(state.vastStationsData);
  }
}

function filterVastNetwork(filterType) {
  state.vastNetworkFilter = filterType || 'all';
  const buttons = document.querySelectorAll('#vast-filter-buttons .vast-chip');
  buttons.forEach(btn => {
    if (btn.getAttribute('data-filter') === state.vastNetworkFilter) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  if (state.vastStationsData && state.vastStationsData.length > 0) {
    renderVastNetworkGrid(state.vastStationsData);
  }
}

function renderVastNetworkGrid(stations) {
  const grid = document.getElementById('vast-network-grid');
  if (!grid || !stations || stations.length === 0) return;

  const layout = state.vastLayout || 'row';
  const filter = state.vastNetworkFilter || 'all';
  const filtered = filter === 'all' 
    ? stations 
    : stations.filter(s => (s.changing_type_class || '').toLowerCase() === filter.toLowerCase());

  // Keep series header in sync
  const header = document.getElementById('vast-series-header');
  if (header) {
    header.style.display = layout === 'row' ? 'grid' : 'none';
  }
  if (layout === 'row') {
    grid.classList.add('row-layout');
  } else {
    grid.classList.remove('row-layout');
  }

  grid.innerHTML = '';
  filtered.forEach(st => {
    const typeClass = st.changing_type_class || 'climb';
    const scoreVal = st.score_exact !== undefined ? st.score_exact : st.aqi;
    const deltaSecTag = st.score_delta_sec ? `<span class="stream-delta-tag ${st.score_delta_sec_val >= 0 ? 'up' : 'down'}" style="font-size:0.68rem;">${st.score_delta_sec}</span>` : '';
    const deltaMinTag = st.score_delta_min ? `<span class="stream-delta-tag ${st.score_delta_min_val >= 0 ? 'up' : 'down'}" style="font-size:0.68rem;">${st.score_delta_min}</span>` : '';
    const tempVal = st.temp_c !== undefined ? st.temp_c : 24.5;
    const feelsLikeVal = st.feels_like_c !== undefined ? st.feels_like_c : tempVal;
    const rhVal = st.relative_humidity !== undefined ? st.relative_humidity : 75;
    const windVal = st.wind_speed_ms !== undefined ? st.wind_speed_ms : 2.1;
    const windCard = st.wind_cardinal || '';
    const wIcon = st.weather_icon || '🌫️';
    const cigs = st.health_cigarettes_day || 12;

    if (layout === 'row') {
      // Clear Row Series Layout - all details collected in a single line in a series
      const row = document.createElement('div');
      row.className = `vast-station-row ${typeClass}`;
      row.innerHTML = `
        <!-- 1. Station & Zone Series Item -->
        <div class="row-cell-station">
          <div class="row-station-name">${st.name}</div>
          <div class="row-station-meta">
            <span>${st.region}</span>
            <span class="station-id-tag">${st.id}</span>
          </div>
        </div>

        <!-- 2. Live Weather & Temperature Series Item -->
        <div class="row-cell-weather">
          <span class="row-weather-icon">${wIcon}</span>
          <div class="row-weather-info">
            <div class="row-weather-temp">${tempVal}°C <small>(Feels ${feelsLikeVal}°C)</small></div>
            <div class="row-weather-sub">💧 <b>${rhVal}%</b> RH • 💨 <b>${windVal}</b> m/s ${windCard}</div>
          </div>
        </div>

        <!-- 3. Real-Time AQI Score & Rates Series Item -->
        <div class="row-cell-score">
          <div class="row-score-main">
            <span class="row-score-val" style="color: ${st.color || 'var(--cyan-neon)'};">${scoreVal}</span>
            <span class="row-score-lbl">AQI</span>
          </div>
          <div class="row-score-rates">
            ${deltaSecTag}
            ${deltaMinTag}
          </div>
        </div>

        <!-- 4. Changing Type & Dynamic Movement Series Item -->
        <div class="row-cell-type">
          <div><span class="stream-type-pill ${typeClass} mini">${st.changing_type_badge || st.changing_type}</span></div>
          <div class="row-desc-text" title="${st.changing_type_desc || ''}">${st.changing_type_desc || 'Atmospheric telemetry stream active.'}</div>
        </div>

        <!-- 5. Smoke & Cigarettes Series Item -->
        <div class="row-cell-smoke">
          <div class="row-smoke-val">PM2.5: <b>${st.pm25} &mu;g/m&sup3;</b></div>
          <div class="row-cigs-val">🚬 ~${cigs} cigs/day</div>
        </div>

        <!-- 6. Action Series Item -->
        <div class="row-cell-action">
          <button class="hud-btn mini secondary" style="padding: 4px 10px; font-size: 0.7rem;" onclick="inspectStation('${st.id}')">DETAILS</button>
        </div>
      `;
      grid.appendChild(row);
    } else {
      // Compact Box Grid Layout
      const card = document.createElement('div');
      card.className = `vast-station-card ${typeClass}`;
      card.innerHTML = `
        <div>
          <div class="vast-card-top">
            <div>
              <div class="vast-station-name">${st.name}</div>
              <div class="vast-station-region">${st.region}</div>
            </div>
            <span class="stream-type-pill ${typeClass} mini">${st.changing_type_badge || st.changing_type}</span>
          </div>

          <div class="vast-score-row">
            <div>
              <span class="vast-score-val" style="color: ${st.color || 'var(--cyan-neon)'};">${scoreVal}</span>
              <span style="font-family: var(--font-mono); font-size: 0.72rem; color: #94a3b8; margin-left: 4px;">AQI</span>
            </div>
            <div class="vast-score-rate-group">
              ${deltaSecTag}
              ${deltaMinTag}
            </div>
          </div>

          <div class="vast-weather-box">
            <div class="vast-weather-main">
              <span class="vast-weather-icon">${wIcon}</span>
              <div>
                <div class="vast-weather-temp">${tempVal}°C</div>
                <div class="vast-weather-feels">Feels ${feelsLikeVal}°C • ${st.weather_condition || 'Smog'}</div>
              </div>
            </div>
            <div class="vast-weather-sub">
              <span>💧 <b>${rhVal}%</b> RH</span>
              <span>💨 <b>${windVal}</b> m/s ${windCard}</span>
            </div>
          </div>

          <div class="vast-desc-text">
            ${st.changing_type_desc || 'Atmospheric telemetry stream active.'}
          </div>
        </div>

        <div class="vast-card-bottom">
          <span>PM2.5: <b style="color:var(--cyan-neon);">${st.pm25} &mu;g/m&sup3;</b></span>
          <span style="font-size:0.7rem; color:#94a3b8;">🚬 ~${cigs} cigs/day</span>
          <button class="hud-btn mini secondary" style="padding: 2px 8px; font-size: 0.68rem;" onclick="inspectStation('${st.id}')">DETAILS</button>
        </div>
      `;
      grid.appendChild(card);
    }
  });
}



// ==========================================
// Map Controls (3D & Fullscreen)
// ==========================================
let isMap3D = false;

window.toggleMap3D = function() {
  const iframe = document.getElementById('science-map-iframe');
  const icon = document.getElementById('map-3d-icon');
  const text = document.getElementById('map-3d-text');
  const label = document.getElementById('science-map-label');
  
  if (!iframe) return;
  
  isMap3D = !isMap3D;
  if (isMap3D) {
    // Switch to 3D Earth Nullschool map (PM2.5) centered on Delhi
    iframe.src = "https://earth.nullschool.net/#current/particulates/surface/level/overlay=pm2.5/orthographic=-282.79,28.61,1500";
    icon.innerText = "🗺️";
    text.innerText = "2D MAP";
    if(label) label.innerText = "🛰️ LIVE SATELLITE (3D): PM2.5 CAMS GLOBE";
    iframe.style.filter = "none";
  } else {
    // Switch back to 2D Windy map (PM2.5) centered on Delhi
    iframe.src = "https://embed.windy.com/embed.html?type=map&location=coordinates&metricRain=mm&metricTemp=%C2%B0C&metricWind=km%2Fh&zoom=7&overlay=pm2p5&product=ecmwf&level=surface&lat=28.6139&lon=77.209";
    icon.innerText = "🌐";
    text.innerText = "3D GLOBE";
    if(label) label.innerText = "🛰️ LIVE SATELLITE (2D): PM2.5 ECMWF";
    iframe.style.filter = "contrast(1.1) saturate(1.2)";
  }
};

window.toggleMapFullscreen = function() {
  const container = document.getElementById('science-map-container');
  if (!container) return;
  
  if (!document.fullscreenElement) {
    if (container.requestFullscreen) {
      container.requestFullscreen();
    } else if (container.mozRequestFullScreen) { // Firefox
      container.mozRequestFullScreen();
    } else if (container.webkitRequestFullscreen) { // Chrome, Safari, Opera
      container.webkitRequestFullscreen();
    } else if (container.msRequestFullscreen) { // IE/Edge
      container.msRequestFullscreen();
    }
  } else {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    } else if (document.mozCancelFullScreen) {
      document.mozCancelFullScreen();
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    }
  }
};

// ==========================================
// Farm Smoke Plume Map Controls (3D & Fullscreen)
// ==========================================
let isPlumeMap3D = false;

window.togglePlumeMap3D = function() {
  const iframe = document.getElementById('plume-map-iframe');
  const icon = document.getElementById('plume-map-3d-icon');
  const text = document.getElementById('plume-map-3d-text');
  
  if (!iframe) return;
  
  isPlumeMap3D = !isPlumeMap3D;
  if (isPlumeMap3D) {
    // 3D Earth Nullschool map (PM2.5) centered on Punjab/Haryana
    iframe.src = "https://earth.nullschool.net/#current/particulates/surface/level/overlay=pm2.5/orthographic=-282.79,28.61,4000";
    if (icon) icon.innerText = "🗺️";
    if (text) text.innerText = "2D MAP";
    iframe.style.filter = "none";
  } else {
    // 2D Windy map (PM2.5) centered on Punjab/Haryana
    iframe.src = "https://embed.windy.com/embed.html?type=map&location=coordinates&metricRain=mm&metricTemp=%C2%B0C&metricWind=km%2Fh&zoom=9&overlay=pm2p5&product=ecmwf&level=surface&lat=28.6139&lon=77.209";
    if (icon) icon.innerText = "🌐";
    if (text) text.innerText = "3D GLOBE";
    iframe.style.filter = "contrast(1.1) saturate(1.2)";
  }
};

window.togglePlumeMapFullscreen = function() {
  const container = document.querySelector('.canvas-map-wrapper');
  if (!container) return;
  
  if (!document.fullscreenElement) {
    if (container.requestFullscreen) {
      container.requestFullscreen();
    } else if (container.mozRequestFullScreen) { // Firefox
      container.mozRequestFullScreen();
    } else if (container.webkitRequestFullscreen) { // Chrome, Safari, Opera
      container.webkitRequestFullscreen();
    } else if (container.msRequestFullscreen) { // IE/Edge
      container.msRequestFullscreen();
    }
  } else {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    } else if (document.mozCancelFullScreen) {
      document.mozCancelFullScreen();
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    }
  }
};


// ==========================================
// Farm Smoke Leaflet Station Map
// ==========================================
let stationMap = null;
let stationMarkers = [];
let satelliteLayer = null;
let darkLayer = null;
let isSatellite = false;

function initStationMap() {
  const mapEl = document.getElementById('station-leaflet-map');
  if (!mapEl || stationMap) return;
  
  // Initialize map centered on Delhi
  stationMap = L.map('station-leaflet-map', {zoomControl: false}).setView([28.6139, 77.2090], 10);
  
  L.control.zoom({
      position: 'bottomright'
  }).addTo(stationMap);

  // Define Carto Dark Layer
  darkLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 20
  });

  // Define ESRI Satellite Layer
  satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
  });

  darkLayer.addTo(stationMap);
}

// Hook into the main polling logic to init the map once Leaflet is ready
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    initStationMap();
  }, 1000);
});

// Update Map with 15 Stations
function updateStationMap(stationsData) {
  if (!stationMap || !stationsData || !Array.isArray(stationsData)) return;

  // Clear existing markers
  stationMarkers.forEach(m => stationMap.removeLayer(m));
  stationMarkers = [];

  stationsData.forEach(st => {
    if (!st.lat || !st.lon) return;

    // Define marker color based on AQI severity
    let color = "#10b981"; // Good
    if (st.aqi > 300) color = "#7f1d1d"; // Severe
    else if (st.aqi > 200) color = "#ef4444"; // Poor
    else if (st.aqi > 100) color = "#f59e0b"; // Moderate

    // Create custom circle marker
    const marker = L.circleMarker([st.lat, st.lon], {
      radius: 8,
      fillColor: color,
      color: "#ffffff",
      weight: 1,
      opacity: 1,
      fillOpacity: 0.8
    });

    // Create professional popup
    const popupContent = `
      <div style="font-family: 'JetBrains Mono', monospace; font-size: 12px; color: #333; min-width: 150px;">
        <strong style="color: #000; font-size: 14px;">${st.name || st.station || "Unknown Station"}</strong><br>
        <div style="margin-top: 5px; border-top: 1px solid #ccc; padding-top: 5px;">
          AQI: <strong style="color: ${color}; font-size: 16px;">${st.aqi || '--'}</strong><br>
          PM2.5: ${Math.round(st.pm2_5_ugm3) || '--'} µg/m³<br>
          Temp: ${Math.round(st.temp_c) || '--'}°C | RH: ${Math.round(st.rh_pct) || '--'}%
        </div>
      </div>
    `;
    marker.bindPopup(popupContent);
    marker.addTo(stationMap);
    stationMarkers.push(marker);
  });
}



window.toggleLeafletSatellite = function() {
  const icon = document.getElementById('leaflet-map-sat-icon');
  const text = document.getElementById('leaflet-map-sat-text');
  if (!stationMap) return;

  isSatellite = !isSatellite;
  if (isSatellite) {
    stationMap.removeLayer(darkLayer);
    satelliteLayer.addTo(stationMap);
    if (icon) icon.innerText = "🗺️";
    if (text) text.innerText = "DARK MAP";
  } else {
    stationMap.removeLayer(satelliteLayer);
    darkLayer.addTo(stationMap);
    if (icon) icon.innerText = "🛰️";
    if (text) text.innerText = "SATELLITE VIEW";
  }
};

window.toggleLeafletFullscreen = function() {
  const container = document.querySelector('.canvas-map-wrapper');
  if (!container) return;
  
  if (!document.fullscreenElement) {
    if (container.requestFullscreen) {
      container.requestFullscreen();
    } else if (container.webkitRequestFullscreen) {
      container.webkitRequestFullscreen();
    }
  } else {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    }
  }
};

// ==========================================
// Farm Smoke: Projected Station Overlay
// ==========================================
function projectWebMercator(lat, lon, centerLat, centerLon, zoom, width, height) {
    const tileSize = 256;
    const scale = Math.pow(2, zoom);
    
    // Project Center
    const cx = (centerLon + 180) / 360 * tileSize * scale;
    const cy = (1 - Math.log(Math.tan(centerLat * Math.PI / 180) + 1 / Math.cos(centerLat * Math.PI / 180)) / Math.PI) / 2 * tileSize * scale;
    
    // Project Target
    const px = (lon + 180) / 360 * tileSize * scale;
    const py = (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * tileSize * scale;
    
    // Calculate pixel coordinates
    return {
        x: (px - cx) + width / 2,
        y: (py - cy) + height / 2
    };
}

function renderPlumeStationsOverlay(stationsData) {
    const canvas = document.getElementById('plume-stations-overlay');
    if (!canvas || !stationsData) return;
    
    // Setup canvas resolution to match display size exactly
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return; // Not visible
    
    // Handle high-DPI displays
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, rect.width, rect.height);
    
    // Center of our Windy map iframe
    const centerLat = 28.6139;
    const centerLon = 77.2090;
    const zoom = 9;
    
    stationsData.forEach(st => {
        if (!st.lat || !st.lon) return;
        
        const pos = projectWebMercator(st.lat, st.lon, centerLat, centerLon, zoom, rect.width, rect.height);
        
        // Define color by AQI
        let color = "#10b981"; // Good
        if (st.aqi > 300) color = "#7f1d1d"; // Severe
        else if (st.aqi > 200) color = "#ef4444"; // Poor
        else if (st.aqi > 100) color = "#f59e0b"; // Moderate
        
        // Draw glow
        ctx.shadowColor = color;
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 6, 0, 2 * Math.PI);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.shadowBlur = 0; // Reset
        
        // Draw white center dot
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 2, 0, 2 * Math.PI);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
        
        // Draw Station Name / AQI Box
        const text = `${st.name || st.station || 'Station'} : AQI ${Math.round(st.aqi)}`;
        ctx.font = "bold 10px 'JetBrains Mono', monospace";
        const tWidth = ctx.measureText(text).width;
        
        // Background box
        ctx.fillStyle = "rgba(0, 0, 0, 0.85)";
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(pos.x + 10, pos.y - 8, tWidth + 12, 16, 4);
        ctx.fill();
        ctx.stroke();
        
        // Text
        ctx.fillStyle = "#ffffff";
        ctx.fillText(text, pos.x + 16, pos.y + 3);
    });
}

// Hook it into the animation loop so it resizes/redraws automatically
let lastStationsData = null;
function updateStationMap(stationsData) {
    if (stationsData) lastStationsData = stationsData;
    // (If Leaflet map is still around, it updates that too, but we mainly care about our overlay now)
    renderPlumeStationsOverlay(stationsData || lastStationsData);
}

// Ensure the overlay redraws if the window resizes
window.addEventListener('resize', () => {
    if (lastStationsData) renderPlumeStationsOverlay(lastStationsData);
});
