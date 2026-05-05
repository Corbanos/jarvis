// ═══════════════════════════════════════════════════════════════════════════
// WORLDVIEW — ALL DATA LAYERS
// ═══════════════════════════════════════════════════════════════════════════

const layers = {
  satellites: { on: false, entities: [], data: [] },
  flights:    { on: false, entities: [], data: [] },
  military:   { on: false, entities: [], data: [] },
  traffic:    { on: false, entities: [], intervals: [] },
  cctv:       { on: false, entities: [] },
  seismic:    { on: false, entities: [], data: [] },
  weather:    { on: false, entities: [], data: [] },
  wildfires:  { on: false, entities: [], data: [] },
  ships:      { on: false, entities: [], data: [] },
  nuclear:    { on: false, entities: [] },
  bases:      { on: false, entities: [] },
  aqi:        { on: false, entities: [], data: [] },
  iss:        { on: false, entities: [], data: [] },
};

let selectedEntity = null;
let trackedEntity  = null;
let satelliteSatrecs = [];
let satPropInterval = null;
let satDensityPct   = 30;
let flightDensityPct = 100;
let trafficParticles = [];
let trafficAnimFrame = null;
let issInterval = null;
let shipAnimFrame = null;
let simulatedShips = [];

// ═══════════════════════════════════════════════════════════════════════════
// LAYER TOGGLE
// ═══════════════════════════════════════════════════════════════════════════
function toggleLayer(name) {
  const layer = layers[name];
  layer.on = !layer.on;
  const toggle = document.getElementById('toggle-' + name);
  if (toggle) toggle.classList.toggle('on', layer.on);

  if (layer.on) {
    loadLayer(name);
  } else {
    unloadLayer(name);
  }
}

function loadLayer(name) {
  const loaders = {
    satellites: loadSatellites,
    flights:    loadFlights,
    military:   loadMilitary,
    traffic:    loadTraffic,
    cctv:       loadCCTV,
    seismic:    loadSeismic,
    weather:    loadWeather,
    wildfires:  loadWildfires,
    ships:      loadShips,
    nuclear:    loadNuclear,
    bases:      loadBases,
    aqi:        loadAirQuality,
    iss:        loadISS,
  };
  if (loaders[name]) loaders[name]();
}

function unloadLayer(name) {
  const layer = layers[name];
  layer.entities.forEach(e => { try { viewer.entities.remove(e); } catch(err){} });
  layer.entities = [];
  const countEl = document.getElementById('count-' + name);
  if (countEl) countEl.textContent = '--';
  updateStats();

  if (name === 'satellites' && satPropInterval) { clearInterval(satPropInterval); satPropInterval = null; }
  if (name === 'cctv') document.getElementById('cctv-panel').classList.add('hidden');
  if (name === 'traffic') { if (trafficAnimFrame) cancelAnimationFrame(trafficAnimFrame); trafficAnimFrame = null; }
  if (name === 'iss' && issInterval) { clearInterval(issInterval); issInterval = null; }
  if (name === 'ships' && shipAnimFrame) { cancelAnimationFrame(shipAnimFrame); shipAnimFrame = null; }
}

function setSatDensity(val) {
  satDensityPct = parseInt(val);
  if (layers.satellites.on) refreshSatelliteEntities();
}
function setFlightDensity(val) {
  flightDensityPct = parseInt(val);
  if (layers.flights.on) refreshFlightEntities();
}

// ═══════════════════════════════════════════════════════════════════════════
// SATELLITES — CelesTrak TLE + satellite.js SGP4 propagation
// ═══════════════════════════════════════════════════════════════════════════
async function loadSatellites() {
  notify('LOADING SATELLITE TLE DATA...');
  let tles = [...EMBEDDED_TLES];

  try {
    const res = await fetch(CONFIG.proxy + encodeURIComponent('https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle'), { signal: AbortSignal.timeout(10000) });
    if (res.ok) {
      const text = await res.text();
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
      const live = [];
      for (let i = 0; i < lines.length - 2; i += 3) {
        if (lines[i+1] && lines[i+1].startsWith('1 ') && lines[i+2] && lines[i+2].startsWith('2 ')) {
          live.push({ name: lines[i], l1: lines[i+1], l2: lines[i+2] });
        }
      }
      if (live.length > 50) {
        tles = live;
        notify(`CELESTRAK: ${live.length} SATS LOADED`);
        intelLog('SAT', `CelesTrak sync: ${live.length} active TLEs`);
      }
    }
  } catch (e) {
    notify('CELESTRAK UNAVAILABLE — USING EMBEDDED DATA', 'warn');
    intelLog('SAT', 'CelesTrak offline — embedded TLE fallback');
  }

  satelliteSatrecs = tles.map(t => {
    try { return { name: t.name, satrec: satellite.twoline2satrec(t.l1, t.l2) }; }
    catch(e) { return null; }
  }).filter(Boolean);

  layers.satellites.data = satelliteSatrecs;
  setCount('satellites', satelliteSatrecs.length);
  document.getElementById('stat-sat').textContent = satelliteSatrecs.length;

  refreshSatelliteEntities();
  if (satPropInterval) clearInterval(satPropInterval);
  satPropInterval = setInterval(propagateSatellites, CONFIG.satPropagateInterval);
  notify(`${satelliteSatrecs.length} SATELLITES TRACKED`);
}

function refreshSatelliteEntities() {
  layers.satellites.entities.forEach(e => { try { viewer.entities.remove(e); } catch(e){} });
  layers.satellites.entities = [];
  const count = Math.ceil(layers.satellites.data.length * satDensityPct / 100);
  const subset = layers.satellites.data.slice(0, count);
  const now = new Date();
  subset.forEach(({ name, satrec }) => {
    try {
      const posVel = satellite.propagate(satrec, now);
      if (!posVel.position) return;
      const gmst = satellite.gstime(now);
      const geo = satellite.eciToGeodetic(posVel.position, gmst);
      const lat = satellite.degreesLat(geo.latitude);
      const lon = satellite.degreesLong(geo.longitude);
      const alt = geo.height * 1000;
      if (isNaN(lat) || isNaN(lon) || isNaN(alt)) return;
      const ent = viewer.entities.add({
        name: name,
        position: Cesium.Cartesian3.fromDegrees(lon, lat, alt),
        point: { pixelSize: 3, color: Cesium.Color.fromCssColorString('#00ff41').withAlpha(0.85), outlineColor: Cesium.Color.fromCssColorString('#00aa2a'), outlineWidth: 1, scaleByDistance: new Cesium.NearFarScalar(1e6, 1.5, 2e8, 0.5) },
        label: { text: name, font: '9px Courier New', fillColor: Cesium.Color.fromCssColorString('#00ff41').withAlpha(0.7), outlineColor: Cesium.Color.BLACK, outlineWidth: 1, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(6, 0), show: false, scaleByDistance: new Cesium.NearFarScalar(1e6, 1.0, 1e8, 0.0) },
        properties: { type: 'SATELLITE', id: satrec.satnum, alt_km: Math.round(geo.height), period_min: Math.round(1440 / (satrec.no * 1440 / (2 * Math.PI))) },
      });
      ent._satrec = satrec;
      layers.satellites.entities.push(ent);
    } catch(e) {}
  });
  propagateSatellites();
  document.getElementById('stat-sat').textContent = layers.satellites.entities.length;
}

function propagateSatellites() {
  if (!layers.satellites.on) return;
  const now = new Date();
  const gmst = satellite.gstime(now);
  layers.satellites.entities.forEach(ent => {
    if (!ent._satrec) return;
    try {
      const pv = satellite.propagate(ent._satrec, now);
      if (!pv.position) return;
      const geo = satellite.eciToGeodetic(pv.position, gmst);
      const lat = satellite.degreesLat(geo.latitude);
      const lon = satellite.degreesLong(geo.longitude);
      const alt = geo.height * 1000;
      if (!isNaN(lat) && !isNaN(lon) && !isNaN(alt)) {
        ent.position = Cesium.Cartesian3.fromDegrees(lon, lat, alt);
      }
    } catch(e) {}
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// COMMERCIAL FLIGHTS — OpenSky Network (via CORS proxy)
// ═══════════════════════════════════════════════════════════════════════════
let flightRefreshTimer = null;
async function loadFlights() {
  notify('CONNECTING TO OPENSKY NETWORK...');
  await fetchFlights();
  flightRefreshTimer = setInterval(fetchFlights, CONFIG.flightRefresh);
}

async function fetchFlights() {
  // Use adsb.lol — free community ADS-B aggregator with global coverage.
  // Fetch multiple regions in parallel for worldwide coverage.
  const regions = [
    { name:'N.AMERICA EAST', lat:40.0,  lon:-74.0,  dist:500 },
    { name:'N.AMERICA WEST', lat:37.0,  lon:-122.0, dist:500 },
    { name:'N.AMERICA MID',  lat:41.0,  lon:-95.0,  dist:500 },
    { name:'EUROPE WEST',    lat:48.8,  lon:2.3,    dist:500 },
    { name:'EUROPE EAST',    lat:52.0,  lon:20.0,   dist:500 },
    { name:'UK / NORTH SEA',  lat:51.5,  lon:-0.1,   dist:400 },
    { name:'MIDDLE EAST',    lat:25.0,  lon:55.0,   dist:500 },
    { name:'EAST ASIA',      lat:35.0,  lon:135.0,  dist:500 },
    { name:'SE ASIA',        lat:1.3,   lon:104.0,  dist:500 },
    { name:'S.AMERICA',      lat:-23.0, lon:-46.0,  dist:500 },
    { name:'OCEANIA',        lat:-33.0, lon:151.0,  dist:500 },
    { name:'S.ASIA',         lat:28.0,  lon:77.0,   dist:500 },
  ];

  let allAircraft = [];
  let seenHex = new Set();
  let successCount = 0;

  const results = await Promise.allSettled(regions.map(async (region) => {
    try {
      const url = `https://api.adsb.lol/v2/lat/${region.lat}/lon/${region.lon}/dist/${region.dist}`;
      const res = await fetch(CONFIG.proxy + encodeURIComponent(url), { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(res.status);
      const data = await res.json();
      const ac = (data.ac || []).filter(a => a.lat && a.lon);
      return { region: region.name, aircraft: ac };
    } catch(e) {
      return { region: region.name, aircraft: [] };
    }
  }));

  results.forEach(r => {
    if (r.status === 'fulfilled' && r.value.aircraft.length > 0) {
      r.value.aircraft.forEach(ac => {
        if (!seenHex.has(ac.hex)) {
          seenHex.add(ac.hex);
          allAircraft.push(ac);
        }
      });
      successCount++;
      intelLog('FLT', `${r.value.region}: ${r.value.aircraft.length} aircraft via ADS-B`);
    }
  });

  if (allAircraft.length > 0) {
    // Convert adsb.lol format to our internal format
    layers.flights.data = allAircraft.map(ac => [
      ac.hex,
      ac.flight || ac.hex,
      ac.r || 'UNKNOWN',          // registration country
      null, null,
      ac.lon,
      ac.lat,
      ac.alt_baro === 'ground' ? 0 : (ac.alt_baro || 0) * 0.3048, // ft→m
      ac.alt_baro === 'ground',
      ac.gs ? ac.gs * 0.514444 : null, // knots→m/s
      ac.track || null,
      null, null,
      ac.alt_geom ? ac.alt_geom * 0.3048 : null,
      ac.squawk,
      ac.t || null,               // aircraft type
      ac.flight || null,
    ]);
    refreshFlightEntities();
    notify(`ADS-B: ${allAircraft.length} REAL FLIGHTS FROM ${successCount} REGIONS`);
    intelLog('FLT', `ADS-B sync: ${allAircraft.length} unique aircraft across ${successCount}/${regions.length} regions`);
  } else {
    notify('ADS-B UNAVAILABLE — SIMULATING FLIGHTS', 'warn');
    intelLog('FLT', 'ADS-B offline — synthetic flight generation active');
    simulateFlights();
  }
}

function refreshFlightEntities() {
  layers.flights.entities.forEach(e => { try { viewer.entities.remove(e); } catch(e){} });
  layers.flights.entities = [];
  const count = Math.ceil(layers.flights.data.length * flightDensityPct / 100);
  const states = layers.flights.data.slice(0, count);
  states.forEach(s => {
    const [icao24, callsign, origin, , , lon, lat, altBaro, onGround, , track, , , altGeo, squawk] = s;
    if (!lon || !lat) return;
    const alt = (altGeo || altBaro || 10000);
    if (alt < 100) return;
    const ent = viewer.entities.add({
      name: (callsign || icao24 || 'UNKNOWN').trim(),
      position: Cesium.Cartesian3.fromDegrees(lon, lat, alt),
      point: { pixelSize: 4, color: Cesium.Color.fromCssColorString('#00e5ff').withAlpha(0.9), outlineColor: Cesium.Color.fromCssColorString('#007acc'), outlineWidth: 1, scaleByDistance: new Cesium.NearFarScalar(1e5, 2.0, 2e7, 0.6) },
      label: { text: (callsign || icao24 || '').trim(), font: '8px Courier New', fillColor: Cesium.Color.fromCssColorString('#00e5ff').withAlpha(0.6), outlineColor: Cesium.Color.BLACK, outlineWidth: 1, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(6, 0), show: false, scaleByDistance: new Cesium.NearFarScalar(1e5, 1.0, 5e6, 0.0) },
      properties: { type: 'COMMERCIAL FLIGHT', callsign: (callsign||'N/A').trim(), icao24, origin_country: origin, altitude_m: Math.round(alt), ground_speed_ms: s[9] ? Math.round(s[9]) : 'N/A', heading: track ? Math.round(track) + '°' : 'N/A', squawk },
    });
    layers.flights.entities.push(ent);
  });
  const n = layers.flights.entities.length;
  setCount('flights', n);
  document.getElementById('stat-flt').textContent = n;
}

function simulateFlights() {
  // Generate realistic synthetic flights along major air corridors
  const corridors = [
    { from:[-74,40.6], to:[2.5,49], name:'TRANSATLANTIC' },
    { from:[-122,37.6], to:[139.7,35.5], name:'TRANSPACIFIC' },
    { from:[0,51], to:[55,25], name:'EUROPE-GULF' },
    { from:[103,1.3], to:[151,-33.8], name:'SINGAPORE-SYDNEY' },
    { from:[-73,40.7], to:[-87.6,41.9], name:'NYC-CHICAGO' },
    { from:[2.5,49], to:[37.4,55.9], name:'PARIS-MOSCOW' },
    { from:[55,25], to:[77,28.5], name:'DUBAI-DELHI' },
    { from:[113.9,22.3], to:[139.7,35.5], name:'HK-TOKYO' },
    { from:[-43,-22.9], to:[12.3,-25.7], name:'RIO-JOHANNESBURG' },
    { from:[-99.1,19.4], to:[-3.7,40.4], name:'MEXICO-MADRID' },
  ];
  const data = [];
  corridors.forEach((c, ci) => {
    for (let i = 0; i < 30; i++) {
      const t = Math.random();
      const lon = c.from[0] + (c.to[0] - c.from[0]) * t + (Math.random()-0.5)*5;
      const lat = c.from[1] + (c.to[1] - c.from[1]) * t + (Math.random()-0.5)*3;
      const alt = 9000 + Math.random() * 3000;
      const cs = c.name.substring(0,3) + String(ci*30+i).padStart(3,'0');
      data.push([`SIM${ci}${i}`, cs, c.name, null, null, lon, lat, alt, false, 220+Math.random()*50, Math.random()*360, null, null, alt, null]);
    }
  });
  layers.flights.data = data;
  refreshFlightEntities();
  notify(`SIMULATED ${data.length} SYNTHETIC FLIGHTS ALONG ${corridors.length} CORRIDORS`);
}

// ═══════════════════════════════════════════════════════════════════════════
// MILITARY FLIGHTS — Simulated near real bases (ADS-B Exchange requires paid API)
// ═══════════════════════════════════════════════════════════════════════════
let militaryRefreshTimer = null;
async function loadMilitary() {
  notify('GENERATING MILITARY ADS-B INTELLIGENCE...');
  simulateMilitary();
  militaryRefreshTimer = setInterval(simulateMilitary, CONFIG.militaryRefresh);
}

function simulateMilitary() {
  const types = ['F-35A','F-22','C-17','KC-135','B-52H','MQ-9','E-3','P-8A','F-16C','C-130J','RC-135','U-2S','B-1B','F-15E','EA-18G','V-22'];
  const ac = MILITARY_BASES.flatMap((base, bi) => {
    const count = 2 + Math.floor(Math.random() * 5);
    return Array.from({length: count}, (_, i) => ({
      lon: base.lon + (Math.random()-0.5)*4,
      lat: base.lat + (Math.random()-0.5)*3,
      alt_baro: 5000 + Math.random() * 35000,
      flight: `${base.branch.replace(/\s/g,'')}${bi}${i}`,
      icao: `MIL${String(bi*10+i).padStart(4,'0')}`,
      squawk: ['7700','7600','7777','1200','0100'][Math.floor(Math.random()*5)],
      category: 'MILITARY',
      aircraft_type: types[Math.floor(Math.random()*types.length)],
      base: base.name,
    }));
  });
  layers.military.data = ac;
  refreshMilitaryEntities(ac);
  intelLog('MIL', `${ac.length} military aircraft simulated near ${MILITARY_BASES.length} installations`);
}

function refreshMilitaryEntities(aclist) {
  layers.military.entities.forEach(e => { try { viewer.entities.remove(e); } catch(e){} });
  layers.military.entities = [];
  aclist.forEach(ac => {
    const alt = (ac.alt_baro || 10000) * 0.3048;
    if (!ac.lon || !ac.lat) return;
    const ent = viewer.entities.add({
      name: ac.flight || ac.icao || 'MIL',
      position: Cesium.Cartesian3.fromDegrees(ac.lon, ac.lat, alt),
      point: { pixelSize: 5, color: Cesium.Color.fromCssColorString('#ff6600').withAlpha(0.95), outlineColor: Cesium.Color.fromCssColorString('#cc3300'), outlineWidth: 1, scaleByDistance: new Cesium.NearFarScalar(1e5, 2.5, 2e7, 0.8) },
      label: { text: (ac.flight || 'MIL').trim(), font: '8px Courier New', fillColor: Cesium.Color.fromCssColorString('#ff6600').withAlpha(0.7), outlineColor: Cesium.Color.BLACK, outlineWidth: 1, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(6, 0), show: false },
      properties: { type: 'MILITARY AIRCRAFT', callsign: (ac.flight||'N/A').trim(), aircraft_type: ac.aircraft_type||'UNKNOWN', base_of_origin: ac.base||'UNKNOWN', altitude_ft: Math.round(ac.alt_baro), squawk: ac.squawk, classification: 'UNCLASSIFIED' },
    });
    layers.military.entities.push(ent);
  });
  const n = layers.military.entities.length;
  setCount('military', n);
  document.getElementById('stat-mil').textContent = n;
}

// ═══════════════════════════════════════════════════════════════════════════
// SEISMIC — USGS Earthquake Feed (free, no key, no CORS issues)
// ═══════════════════════════════════════════════════════════════════════════
async function loadSeismic() {
  notify('FETCHING USGS SEISMIC DATA...');
  try {
    const res = await fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson', { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(res.status);
    const json = await res.json();
    const features = json.features || [];
    layers.seismic.entities.forEach(e => { try { viewer.entities.remove(e); } catch(e){} });
    layers.seismic.entities = [];
    features.forEach(f => {
      const [lon, lat, depth] = f.geometry.coordinates;
      const mag = f.properties.mag || 0;
      const name = f.properties.place || 'Unknown';
      const time = new Date(f.properties.time);
      let color;
      if (mag < 2.5) color = '#00ff41';
      else if (mag < 4.0) color = '#ffff00';
      else if (mag < 6.0) color = '#ff9900';
      else color = '#ff0000';
      const size = Math.max(4, mag * 3);
      const ent = viewer.entities.add({
        name: `M${mag.toFixed(1)} — ${name}`,
        position: Cesium.Cartesian3.fromDegrees(lon, lat, 0),
        point: { pixelSize: size, color: Cesium.Color.fromCssColorString(color).withAlpha(0.8), outlineColor: Cesium.Color.fromCssColorString(color).withAlpha(0.3), outlineWidth: 3 },
        label: { text: `M${mag.toFixed(1)}`, font: '9px Courier New', fillColor: Cesium.Color.fromCssColorString(color), outlineColor: Cesium.Color.BLACK, outlineWidth: 1, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(0, -14), show: mag >= 4.0 },
        properties: { type: 'SEISMIC EVENT', magnitude: mag, depth_km: depth, location: name, time: time.toISOString(), felt_reports: f.properties.felt || 0, tsunami_warning: f.properties.tsunami ? 'YES' : 'NO' },
      });
      layers.seismic.entities.push(ent);
    });
    const n = layers.seismic.entities.length;
    setCount('seismic', n);
    document.getElementById('stat-seis').textContent = n;
    notify(`USGS: ${n} SEISMIC EVENTS (24H)`);
    intelLog('SEIS', `${n} earthquakes in past 24h — max M${Math.max(...features.map(f=>f.properties.mag||0)).toFixed(1)}`);
  } catch(e) {
    notify('USGS UNAVAILABLE', 'warn');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// WEATHER — Open-Meteo (free, no key, no CORS)
// ═══════════════════════════════════════════════════════════════════════════
async function loadWeather() {
  notify('FETCHING GLOBAL WEATHER DATA...');
  try {
    // Fetch weather for a grid of major cities worldwide
    const cities = [
      {n:'New York',lon:-74.0,lat:40.7},{n:'London',lon:-0.12,lat:51.5},{n:'Tokyo',lon:139.7,lat:35.7},
      {n:'Sydney',lon:151.2,lat:-33.9},{n:'Moscow',lon:37.6,lat:55.8},{n:'Dubai',lon:55.3,lat:25.2},
      {n:'Delhi',lon:77.2,lat:28.6},{n:'Shanghai',lon:121.5,lat:31.2},{n:'São Paulo',lon:-46.6,lat:-23.5},
      {n:'Cairo',lon:31.2,lat:30.0},{n:'Lagos',lon:3.4,lat:6.5},{n:'Seoul',lon:127.0,lat:37.6},
      {n:'Mexico City',lon:-99.1,lat:19.4},{n:'Paris',lon:2.3,lat:48.9},{n:'Berlin',lon:13.4,lat:52.5},
      {n:'Cape Town',lon:18.4,lat:-34.0},{n:'Buenos Aires',lon:-58.4,lat:-34.6},{n:'Mumbai',lon:72.9,lat:19.1},
      {n:'Bangkok',lon:100.5,lat:13.8},{n:'Singapore',lon:103.8,lat:1.3},{n:'Nairobi',lon:36.8,lat:-1.3},
      {n:'Istanbul',lon:29.0,lat:41.0},{n:'Beijing',lon:116.4,lat:39.9},{n:'Lima',lon:-77.0,lat:-12.0},
      {n:'Rome',lon:12.5,lat:41.9},{n:'Jakarta',lon:106.8,lat:-6.2},{n:'Toronto',lon:-79.4,lat:43.7},
      {n:'LA',lon:-118.2,lat:34.1},{n:'Chicago',lon:-87.6,lat:41.9},{n:'Houston',lon:-95.4,lat:29.8},
      {n:'Riyadh',lon:46.7,lat:24.7},{n:'Karachi',lon:67.0,lat:24.9},{n:'Dhaka',lon:90.4,lat:23.8},
      {n:'Bogotá',lon:-74.1,lat:4.7},{n:'Santiago',lon:-70.7,lat:-33.4},{n:'Kinshasa',lon:15.3,lat:-4.3},
    ];
    const lats = cities.map(c => c.lat).join(',');
    const lons = cities.map(c => c.lon).join(',');
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&current=temperature_2m,wind_speed_10m,weather_code,relative_humidity_2m,pressure_msl&timezone=auto`, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) throw new Error(res.status);
    const json = await res.json();
    // Open-Meteo returns array when multiple coords given
    const results = Array.isArray(json) ? json : [json];

    layers.weather.entities.forEach(e => { try { viewer.entities.remove(e); } catch(e){} });
    layers.weather.entities = [];

    results.forEach((w, i) => {
      if (!w.current || i >= cities.length) return;
      const c = cities[i];
      const cur = w.current;
      const temp = cur.temperature_2m;
      const wind = cur.wind_speed_10m;
      const code = cur.weather_code;
      const humidity = cur.relative_humidity_2m;
      const pressure = cur.pressure_msl;
      const desc = weatherCodeToText(code);

      // Color by temperature
      let color;
      if (temp < 0) color = '#6699ff';
      else if (temp < 10) color = '#00ccff';
      else if (temp < 20) color = '#00ff88';
      else if (temp < 30) color = '#ffcc00';
      else if (temp < 40) color = '#ff6600';
      else color = '#ff0000';

      const ent = viewer.entities.add({
        name: `${c.n}: ${temp}°C ${desc}`,
        position: Cesium.Cartesian3.fromDegrees(c.lon, c.lat, 0),
        point: { pixelSize: 10, color: Cesium.Color.fromCssColorString(color).withAlpha(0.7), outlineColor: Cesium.Color.fromCssColorString(color).withAlpha(0.3), outlineWidth: 4, scaleByDistance: new Cesium.NearFarScalar(1e5, 1.5, 2e7, 0.6) },
        label: { text: `${Math.round(temp)}°`, font: '11px Courier New', fillColor: Cesium.Color.fromCssColorString(color), outlineColor: Cesium.Color.BLACK, outlineWidth: 2, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(0, -16), show: true, scaleByDistance: new Cesium.NearFarScalar(1e5, 1.0, 1e7, 0.0) },
        properties: { type: 'WEATHER STATION', city: c.n, temperature_c: temp, wind_speed_kmh: wind, condition: desc, humidity_pct: humidity, pressure_hpa: pressure },
      });
      layers.weather.entities.push(ent);
    });
    const n = layers.weather.entities.length;
    setCount('weather', n);
    document.getElementById('stat-wx').textContent = n;
    notify(`WEATHER: ${n} STATIONS REPORTING`);
    intelLog('WX', `${n} global weather stations — temps range ${Math.min(...results.map(r=>r.current?.temperature_2m||99))}°C to ${Math.max(...results.map(r=>r.current?.temperature_2m||-99))}°C`);
  } catch(e) {
    notify('OPEN-METEO UNAVAILABLE', 'warn');
  }
}

function weatherCodeToText(code) {
  const codes = {0:'Clear',1:'Mostly Clear',2:'Partly Cloudy',3:'Overcast',45:'Fog',48:'Rime Fog',51:'Light Drizzle',53:'Drizzle',55:'Heavy Drizzle',61:'Light Rain',63:'Rain',65:'Heavy Rain',71:'Light Snow',73:'Snow',75:'Heavy Snow',77:'Snow Grains',80:'Light Showers',81:'Showers',82:'Heavy Showers',85:'Snow Showers',86:'Heavy Snow Showers',95:'Thunderstorm',96:'Thunderstorm + Hail',99:'Heavy Thunderstorm'};
  return codes[code] || 'Unknown';
}

// ═══════════════════════════════════════════════════════════════════════════
// WILDFIRES — NASA FIRMS (free, no key for recent CSV)
// ═══════════════════════════════════════════════════════════════════════════
async function loadWildfires() {
  notify('FETCHING NASA FIRMS FIRE DATA...');
  try {
    // NASA EONET for active natural events including wildfires
    const res = await fetch('https://eonet.gsfc.nasa.gov/api/v3/events?category=wildfires&status=open&limit=200', { signal: AbortSignal.timeout(12000) });
    if (!res.ok) throw new Error(res.status);
    const json = await res.json();
    const events = json.events || [];

    layers.wildfires.entities.forEach(e => { try { viewer.entities.remove(e); } catch(e){} });
    layers.wildfires.entities = [];

    events.forEach(ev => {
      const geom = ev.geometry && ev.geometry[ev.geometry.length - 1]; // latest geometry
      if (!geom || !geom.coordinates) return;
      const [lon, lat] = geom.coordinates;
      const ent = viewer.entities.add({
        name: ev.title,
        position: Cesium.Cartesian3.fromDegrees(lon, lat, 0),
        point: { pixelSize: 8, color: Cesium.Color.fromCssColorString('#ff4400').withAlpha(0.9), outlineColor: Cesium.Color.fromCssColorString('#ff0000').withAlpha(0.4), outlineWidth: 6 },
        label: { text: 'FIRE', font: '8px Courier New', fillColor: Cesium.Color.fromCssColorString('#ff4400'), outlineColor: Cesium.Color.BLACK, outlineWidth: 1, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(0, -14), show: true, scaleByDistance: new Cesium.NearFarScalar(1e5, 1.0, 5e6, 0.0) },
        properties: { type: 'WILDFIRE', event_name: ev.title, source: ev.sources?.[0]?.id || 'NASA', date: geom.date || 'N/A', category: 'WILDFIRE' },
      });
      layers.wildfires.entities.push(ent);
    });
    const n = layers.wildfires.entities.length;
    setCount('wildfires', n);
    document.getElementById('stat-fire').textContent = n;
    notify(`NASA EONET: ${n} ACTIVE WILDFIRES`);
    intelLog('FIRE', `${n} active wildfires tracked via NASA EONET`);
  } catch(e) {
    notify('NASA FIRMS UNAVAILABLE', 'warn');
    intelLog('FIRE', 'NASA EONET offline');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MARITIME — Simulated ship traffic on real shipping lanes
// ═══════════════════════════════════════════════════════════════════════════
function loadShips() {
  notify('GENERATING MARITIME AIS DATA...');
  layers.ships.entities.forEach(e => { try { viewer.entities.remove(e); } catch(e){} });
  layers.ships.entities = [];
  simulatedShips = [];

  const shipTypes = ['CONTAINER','TANKER','BULK CARRIER','LNG','CRUISE','CARGO','RORO','FISHING','NAVAL'];
  const flags = ['PANAMA','LIBERIA','MARSHALL IS.','HONG KONG','SINGAPORE','MALTA','BAHAMAS','GREECE','CHINA','JAPAN'];

  SHIPPING_LANES.forEach((lane, li) => {
    const numShips = 8 + Math.floor(Math.random() * 12);
    for (let i = 0; i < numShips; i++) {
      const t = Math.random();
      const segIdx = Math.floor(t * (lane.pts.length - 1));
      const segT = (t * (lane.pts.length - 1)) - segIdx;
      const p1 = lane.pts[Math.min(segIdx, lane.pts.length-2)];
      const p2 = lane.pts[Math.min(segIdx+1, lane.pts.length-1)];
      const lon = p1.lon + (p2.lon - p1.lon) * segT + (Math.random()-0.5)*1.5;
      const lat = p1.lat + (p2.lat - p1.lat) * segT + (Math.random()-0.5)*0.8;
      const shipType = shipTypes[Math.floor(Math.random()*shipTypes.length)];
      const flag = flags[Math.floor(Math.random()*flags.length)];
      const mmsi = `${200+li}${String(i).padStart(6,'0')}`;
      const name = `${shipType.substring(0,4)}-${mmsi.substring(3)}`;
      const speed = 5 + Math.random() * 20; // knots
      const heading = Math.atan2(p2.lon-p1.lon, p2.lat-p1.lat) * 180/Math.PI + (Math.random()-0.5)*20;

      const ship = {
        lon, lat, speed, heading, lane: li, t, dir: Math.random() > 0.5 ? 1 : -1,
      };
      simulatedShips.push(ship);

      const ent = viewer.entities.add({
        name: name,
        position: Cesium.Cartesian3.fromDegrees(lon, lat, 0),
        point: { pixelSize: 4, color: Cesium.Color.fromCssColorString('#88aaff').withAlpha(0.8), outlineColor: Cesium.Color.fromCssColorString('#4466cc'), outlineWidth: 1, scaleByDistance: new Cesium.NearFarScalar(1e4, 2.0, 1e7, 0.5) },
        label: { text: name, font: '7px Courier New', fillColor: Cesium.Color.fromCssColorString('#88aaff').withAlpha(0.5), outlineColor: Cesium.Color.BLACK, outlineWidth: 1, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(6, 0), show: false, scaleByDistance: new Cesium.NearFarScalar(1e4, 1.0, 1e6, 0.0) },
        properties: { type: 'MARITIME VESSEL', vessel_name: name, mmsi, vessel_type: shipType, flag, speed_knots: speed.toFixed(1), heading: Math.round(heading)+'°', shipping_lane: lane.name },
      });
      ship.entity = ent;
      layers.ships.entities.push(ent);
    }
  });

  const n = layers.ships.entities.length;
  setCount('ships', n);
  document.getElementById('stat-ship').textContent = n;
  notify(`MARITIME: ${n} VESSELS ON ${SHIPPING_LANES.length} SHIPPING LANES`);
  intelLog('AIS', `${n} vessels generated across ${SHIPPING_LANES.length} major shipping lanes`);

  // Animate ships
  function animateShips() {
    if (!layers.ships.on) return;
    simulatedShips.forEach(ship => {
      ship.lon += (Math.random()-0.5) * 0.002;
      ship.lat += (Math.random()-0.5) * 0.001;
      if (ship.entity) {
        ship.entity.position = Cesium.Cartesian3.fromDegrees(ship.lon, ship.lat, 0);
      }
    });
    shipAnimFrame = requestAnimationFrame(animateShips);
  }
  if (shipAnimFrame) cancelAnimationFrame(shipAnimFrame);
  shipAnimFrame = requestAnimationFrame(animateShips);
}

// ═══════════════════════════════════════════════════════════════════════════
// NUCLEAR PLANTS — Embedded data (IAEA PRIS source)
// ═══════════════════════════════════════════════════════════════════════════
function loadNuclear() {
  notify('LOADING NUCLEAR FACILITY DATABASE...');
  layers.nuclear.entities.forEach(e => { try { viewer.entities.remove(e); } catch(e){} });
  layers.nuclear.entities = [];
  NUCLEAR_PLANTS.forEach(plant => {
    const ent = viewer.entities.add({
      name: plant.name,
      position: Cesium.Cartesian3.fromDegrees(plant.lon, plant.lat, 0),
      point: { pixelSize: 7, color: Cesium.Color.fromCssColorString('#ff00ff').withAlpha(0.85), outlineColor: Cesium.Color.fromCssColorString('#cc00cc').withAlpha(0.4), outlineWidth: 5, scaleByDistance: new Cesium.NearFarScalar(1e5, 2.0, 1e7, 0.6) },
      label: { text: '☢ ' + plant.name, font: '8px Courier New', fillColor: Cesium.Color.fromCssColorString('#ff00ff').withAlpha(0.7), outlineColor: Cesium.Color.BLACK, outlineWidth: 1, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(0, -16), show: false, scaleByDistance: new Cesium.NearFarScalar(1e5, 1.0, 5e6, 0.0) },
      properties: { type: 'NUCLEAR FACILITY', plant_name: plant.name, country: plant.country, reactors: plant.reactors, capacity_mw: plant.mw, status: 'OPERATIONAL', source: 'IAEA PRIS' },
    });
    layers.nuclear.entities.push(ent);
  });
  const n = layers.nuclear.entities.length;
  setCount('nuclear', n);
  notify(`NUCLEAR: ${n} FACILITIES MAPPED`);
  intelLog('NUC', `${n} nuclear power plants loaded — total ${NUCLEAR_PLANTS.reduce((s,p)=>s+p.mw,0).toLocaleString()} MW capacity`);
}

// ═══════════════════════════════════════════════════════════════════════════
// MILITARY BASES — Embedded data
// ═══════════════════════════════════════════════════════════════════════════
function loadBases() {
  notify('LOADING MILITARY INSTALLATION DATABASE...');
  layers.bases.entities.forEach(e => { try { viewer.entities.remove(e); } catch(e){} });
  layers.bases.entities = [];
  MILITARY_BASES.forEach(base => {
    const ent = viewer.entities.add({
      name: base.name,
      position: Cesium.Cartesian3.fromDegrees(base.lon, base.lat, 0),
      point: { pixelSize: 6, color: Cesium.Color.fromCssColorString('#ff3333').withAlpha(0.9), outlineColor: Cesium.Color.fromCssColorString('#ff0000').withAlpha(0.3), outlineWidth: 8, scaleByDistance: new Cesium.NearFarScalar(1e5, 2.0, 1e7, 0.7) },
      label: { text: base.name, font: '8px Courier New', fillColor: Cesium.Color.fromCssColorString('#ff3333').withAlpha(0.7), outlineColor: Cesium.Color.BLACK, outlineWidth: 1, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(0, -14), show: false, scaleByDistance: new Cesium.NearFarScalar(1e5, 1.0, 5e6, 0.0) },
      properties: { type: 'MILITARY INSTALLATION', installation: base.name, country: base.country, branch: base.branch, classification: 'UNCLASSIFIED / OSINT' },
    });
    layers.bases.entities.push(ent);
  });
  const n = layers.bases.entities.length;
  setCount('bases', n);
  notify(`MILBASES: ${n} INSTALLATIONS MAPPED`);
  intelLog('BASE', `${n} military installations loaded — ${new Set(MILITARY_BASES.map(b=>b.country)).size} countries`);
}

// ═══════════════════════════════════════════════════════════════════════════
// AIR QUALITY — OpenAQ (free, no key)
// ═══════════════════════════════════════════════════════════════════════════
async function loadAirQuality() {
  notify('FETCHING GLOBAL AIR QUALITY DATA...');
  try {
    // Use Open-Meteo Air Quality API (free, no key)
    const cities = [
      {n:'Beijing',lon:116.4,lat:39.9},{n:'Delhi',lon:77.2,lat:28.6},{n:'LA',lon:-118.2,lat:34.1},
      {n:'Cairo',lon:31.2,lat:30.0},{n:'London',lon:-0.12,lat:51.5},{n:'Tokyo',lon:139.7,lat:35.7},
      {n:'Paris',lon:2.3,lat:48.9},{n:'Moscow',lon:37.6,lat:55.8},{n:'São Paulo',lon:-46.6,lat:-23.5},
      {n:'Jakarta',lon:106.8,lat:-6.2},{n:'Lagos',lon:3.4,lat:6.5},{n:'Mumbai',lon:72.9,lat:19.1},
      {n:'Dhaka',lon:90.4,lat:23.8},{n:'Karachi',lon:67.0,lat:24.9},{n:'Mexico City',lon:-99.1,lat:19.4},
      {n:'Bangkok',lon:100.5,lat:13.8},{n:'Kolkata',lon:88.4,lat:22.6},{n:'Shanghai',lon:121.5,lat:31.2},
      {n:'Lahore',lon:74.3,lat:31.5},{n:'NYC',lon:-74.0,lat:40.7},
    ];
    const lats = cities.map(c=>c.lat).join(',');
    const lons = cities.map(c=>c.lon).join(',');
    const res = await fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lats}&longitude=${lons}&current=pm2_5,pm10,us_aqi,carbon_monoxide,nitrogen_dioxide`, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) throw new Error(res.status);
    const json = await res.json();
    const results = Array.isArray(json) ? json : [json];

    layers.aqi.entities.forEach(e => { try { viewer.entities.remove(e); } catch(e){} });
    layers.aqi.entities = [];

    results.forEach((r, i) => {
      if (!r.current || i >= cities.length) return;
      const c = cities[i];
      const aqi = r.current.us_aqi || 0;
      const pm25 = r.current.pm2_5;
      const pm10 = r.current.pm10;

      let color, level;
      if (aqi <= 50)       { color = '#00ff41'; level = 'GOOD'; }
      else if (aqi <= 100) { color = '#ffff00'; level = 'MODERATE'; }
      else if (aqi <= 150) { color = '#ff9900'; level = 'UNHEALTHY (SENS)'; }
      else if (aqi <= 200) { color = '#ff3333'; level = 'UNHEALTHY'; }
      else if (aqi <= 300) { color = '#cc00cc'; level = 'VERY UNHEALTHY'; }
      else                 { color = '#990033'; level = 'HAZARDOUS'; }

      const ent = viewer.entities.add({
        name: `${c.n}: AQI ${aqi} (${level})`,
        position: Cesium.Cartesian3.fromDegrees(c.lon, c.lat, 500),
        point: { pixelSize: 9, color: Cesium.Color.fromCssColorString(color).withAlpha(0.75), outlineColor: Cesium.Color.fromCssColorString(color).withAlpha(0.2), outlineWidth: 6, scaleByDistance: new Cesium.NearFarScalar(1e5, 1.5, 2e7, 0.5) },
        label: { text: `AQI:${aqi}`, font: '9px Courier New', fillColor: Cesium.Color.fromCssColorString(color), outlineColor: Cesium.Color.BLACK, outlineWidth: 2, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(0, -16), show: true, scaleByDistance: new Cesium.NearFarScalar(1e5, 1.0, 1e7, 0.0) },
        properties: { type: 'AIR QUALITY', city: c.n, us_aqi: aqi, level, pm2_5: pm25, pm10, co: r.current.carbon_monoxide, no2: r.current.nitrogen_dioxide },
      });
      layers.aqi.entities.push(ent);
    });
    const n = layers.aqi.entities.length;
    setCount('aqi', n);
    notify(`AIR QUALITY: ${n} CITIES MONITORED`);
    intelLog('AQI', `${n} cities — worst: AQI ${Math.max(...results.map(r=>r.current?.us_aqi||0))}`);
  } catch(e) {
    notify('AIR QUALITY DATA UNAVAILABLE', 'warn');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ISS TRACKER — wheretheiss.at API (free, no key)
// ═══════════════════════════════════════════════════════════════════════════
let issOrbitPositions = [];
async function loadISS() {
  notify('TRACKING ISS IN REAL-TIME...');
  await fetchISS();
  issInterval = setInterval(fetchISS, CONFIG.issRefresh);
}

async function fetchISS() {
  try {
    const res = await fetch('https://api.wheretheiss.at/v1/satellites/25544', { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();

    // Update or create entity
    layers.iss.entities.forEach(e => { try { viewer.entities.remove(e); } catch(e){} });
    layers.iss.entities = [];

    const ent = viewer.entities.add({
      name: 'ISS (ZARYA)',
      position: Cesium.Cartesian3.fromDegrees(data.longitude, data.latitude, data.altitude * 1000),
      point: { pixelSize: 10, color: Cesium.Color.fromCssColorString('#ffffff'), outlineColor: Cesium.Color.fromCssColorString('#00ff41'), outlineWidth: 3 },
      label: { text: 'ISS', font: '12px Courier New', fillColor: Cesium.Color.WHITE, outlineColor: Cesium.Color.BLACK, outlineWidth: 2, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(12, 0), show: true },
      properties: { type: 'SPACE STATION', altitude_km: Math.round(data.altitude), velocity_kmh: Math.round(data.velocity), latitude: data.latitude.toFixed(4), longitude: data.longitude.toFixed(4), visibility: data.visibility, footprint_km: Math.round(data.footprint) },
    });
    layers.iss.entities.push(ent);

    // Build orbit trail
    issOrbitPositions.push({ lon: data.longitude, lat: data.latitude, alt: data.altitude * 1000 });
    if (issOrbitPositions.length > 200) issOrbitPositions.shift();

    if (issOrbitPositions.length > 2) {
      const positions = issOrbitPositions.flatMap(p => [p.lon, p.lat, p.alt]);
      // Remove old polyline if exists
      viewer.entities.values.filter(e => e._issOrbit).forEach(e => viewer.entities.remove(e));
      const orbitLine = viewer.entities.add({
        polyline: {
          positions: Cesium.Cartesian3.fromDegreesArrayHeights(positions),
          width: 1,
          material: Cesium.Color.fromCssColorString('#00ff41').withAlpha(0.4),
        },
      });
      orbitLine._issOrbit = true;
      layers.iss.entities.push(orbitLine);
    }

    setCount('iss', 1);
    document.getElementById('stat-iss').textContent = `${Math.round(data.altitude)}km`;
  } catch(e) {
    // Silent fail on individual poll
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// STREET TRAFFIC — OSM Overpass API
// ═══════════════════════════════════════════════════════════════════════════
async function loadTraffic() {
  notify('FETCHING OSM ROAD NETWORK...');
  const city = TRAFFIC_CITIES[Math.floor(Math.random() * TRAFFIC_CITIES.length)];
  await spawnTrafficForCity(city);
}

async function spawnTrafficForCity(city) {
  let roads = [];
  try {
    const overpassUrl = `https://overpass-api.de/api/interpreter?data=%5Bout%3Ajson%5D%5Btimeout%3A15%5D%3Bway%5B%22highway%22~%22primary%7Csecondary%7Ctertiary%22%5D(${city.bbox})%3B(._%3B%3E%3B)%3Bout+body%3B`;
    const res = await fetch(overpassUrl, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) throw new Error(res.status);
    const json = await res.json();
    const nodes = {};
    json.elements.filter(e => e.type === 'node').forEach(n => { nodes[n.id] = [n.lon, n.lat]; });
    json.elements.filter(e => e.type === 'way').forEach(way => {
      const pts = (way.nodes || []).map(nid => nodes[nid]).filter(Boolean);
      for (let i = 0; i < pts.length - 1; i++) {
        roads.push({ from: pts[i], to: pts[i+1] });
      }
    });
  } catch(e) {
    notify('OSM UNAVAILABLE — SIMULATING TRAFFIC', 'warn');
    for (let dx = -0.01; dx <= 0.01; dx += 0.002) {
      for (let dy = -0.01; dy <= 0.01; dy += 0.002) {
        roads.push({ from: [city.lon+dx, city.lat+dy], to: [city.lon+dx, city.lat+dy+0.002] });
        roads.push({ from: [city.lon+dx, city.lat+dy], to: [city.lon+dx+0.002, city.lat+dy] });
      }
    }
  }
  if (roads.length === 0) return;
  notify(`${city.name}: ${roads.length} ROAD SEGMENTS`);
  intelLog('TRF', `${city.name}: ${roads.length} road segments loaded from OSM`);

  layers.traffic.entities.forEach(e => { try { viewer.entities.remove(e); } catch(e){} });
  layers.traffic.entities = [];
  trafficParticles = [];

  const selRoads = roads.slice(0, Math.min(roads.length, 150));
  selRoads.forEach(road => {
    for (let n = 0; n < 2; n++) {
      trafficParticles.push({ road, t: Math.random(), speed: 0.004 + Math.random()*0.012, dir: Math.random()>0.5?1:-1 });
    }
  });
  trafficParticles.forEach(p => {
    const [lon, lat] = lerpRoad(p.road, p.t);
    const ent = viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(lon, lat, 5),
      point: { pixelSize: 3, color: Cesium.Color.fromCssColorString('#ffff00').withAlpha(0.7), scaleByDistance: new Cesium.NearFarScalar(1e3, 1.5, 1e5, 0.3), disableDepthTestDistance: 100 },
      properties: { type: 'TRAFFIC' },
    });
    p.entity = ent;
    layers.traffic.entities.push(ent);
  });
  setCount('traffic', trafficParticles.length);
  document.getElementById('stat-traf').textContent = trafficParticles.length;

  function animateTraffic() {
    if (!layers.traffic.on) return;
    trafficParticles.forEach(p => {
      p.t += p.speed * p.dir * 0.016;
      if (p.t > 1.0) { p.t = 1.0; p.dir = -1; }
      if (p.t < 0.0) { p.t = 0.0; p.dir = 1; }
      const [lon, lat] = lerpRoad(p.road, p.t);
      if (p.entity) p.entity.position = Cesium.Cartesian3.fromDegrees(lon, lat, 5);
    });
    trafficAnimFrame = requestAnimationFrame(animateTraffic);
  }
  if (trafficAnimFrame) cancelAnimationFrame(trafficAnimFrame);
  trafficAnimFrame = requestAnimationFrame(animateTraffic);
}

function lerpRoad(road, t) {
  return [road.from[0]+(road.to[0]-road.from[0])*t, road.from[1]+(road.to[1]-road.from[1])*t];
}

// ═══════════════════════════════════════════════════════════════════════════
// CCTV — Global camera feeds with live API expansion + fullscreen + Street View
// ═══════════════════════════════════════════════════════════════════════════
let allCCTVCameras = [];
let currentCCTVPage = 0;
const CCTV_PAGE_SIZE = 20;

async function loadCCTV() {
  notify('LOADING GLOBAL CCTV FEEDS...');
  document.getElementById('cctv-panel').classList.remove('hidden');

  // Start with static cameras
  allCCTVCameras = [...CCTV_CAMERAS_STATIC];

  // ── Phase 1: Fetch all CameraDiscovery sources in parallel ──────────────
  intelLog('CCTV', `Fetching ${CameraDiscovery.sources.length} DOT sources in parallel...`);
  const discoveryResults = await Promise.allSettled(
    CameraDiscovery.sources.map(async src => {
      CameraDiscovery.fetchedSources.add(src.id);
      try {
        const cameras = await src.fetch();
        return { name: src.name, cameras };
      } catch(e) {
        return { name: src.name, cameras: [] };
      }
    })
  );

  discoveryResults.forEach(r => {
    if (r.status !== 'fulfilled' || !r.value.cameras.length) return;
    const { name, cameras } = r.value;
    allCCTVCameras.push(...cameras);
    intelLog('CCTV', `${name}: ${cameras.length} cameras`);
  });

  // ── Phase 2: Fetch legacy live APIs ─────────────────────────────────────
  const liveResults = await Promise.allSettled(CCTV_LIVE_APIS.map(async (api) => {
    try {
      const res = await fetch(CONFIG.proxy + encodeURIComponent(api.url), { signal: AbortSignal.timeout(12000) });
      if (!res.ok) throw new Error(res.status);
      const data = await res.json();
      return api.parser(data);
    } catch(e) {
      return [];
    }
  }));
  liveResults.forEach(r => {
    if (r.status === 'fulfilled' && r.value.length > 0) allCCTVCameras.push(...r.value);
  });

  // ── Deduplicate by lat/lon key ───────────────────────────────────────────
  const seen = new Set();
  allCCTVCameras = allCCTVCameras.filter(cam => {
    if (!cam.lat || !cam.lon) return false;
    const key = `${cam.lat.toFixed(4)}_${cam.lon.toFixed(4)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  setCount('cctv', allCCTVCameras.length);

  // ── Add globe markers ────────────────────────────────────────────────────
  allCCTVCameras.forEach(cam => {
    const ent = viewer.entities.add({
      name: cam.name,
      position: Cesium.Cartesian3.fromDegrees(cam.lon, cam.lat, 5),
      point: { pixelSize: 5, color: Cesium.Color.fromCssColorString('#ff3a3a').withAlpha(0.85), outlineColor: Cesium.Color.fromCssColorString('#ff0000'), outlineWidth: 1, scaleByDistance: new Cesium.NearFarScalar(1e3, 2.0, 1e6, 0.3) },
      label: { text: cam.name, font: '7px Courier New', fillColor: Cesium.Color.fromCssColorString('#ff3a3a').withAlpha(0.5), outlineColor: Cesium.Color.BLACK, outlineWidth: 1, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(0, -10), show: false, scaleByDistance: new Cesium.NearFarScalar(1e3, 1.0, 5e5, 0.0) },
      properties: { type: 'CCTV CAMERA', camera_id: cam.id, location: cam.name, city: cam.city, source: cam.source, feed_type: 'SNAPSHOT' },
    });
    layers.cctv.entities.push(ent);
  });

  currentCCTVPage = 0;
  renderCCTVGrid();
  const cities = new Set(allCCTVCameras.map(c => c.city)).size;
  intelLog('CCTV', `${allCCTVCameras.length} cameras across ${cities} cities — all sources loaded`);
  notify(`CCTV: ${allCCTVCameras.length} CAMERAS WORLDWIDE`);
}

function renderCCTVGrid() {
  const grid = document.getElementById('cctv-grid');
  grid.innerHTML = '';

  const start = currentCCTVPage * CCTV_PAGE_SIZE;
  const page = allCCTVCameras.slice(start, start + CCTV_PAGE_SIZE);

  page.forEach((cam, i) => {
    const div = document.createElement('div');
    div.className = 'cctv-thumb';
    div.id = 'cam-' + cam.id;
    div.onclick = () => selectCamera(cam);
    const proxyUrl = cam.url ? CONFIG.proxy + encodeURIComponent(cam.url) : '';
    div.innerHTML = `
      <img src="${cam.url}" alt="${cam.name}" loading="lazy"
           onerror="if(!this.dataset.tried){this.dataset.tried=1;this.src='${proxyUrl}'}else{this.style.display='none';this.nextElementSibling.style.display='flex'}"
           style="width:100%;height:100%;object-fit:cover;display:block;filter:sepia(0.2) saturate(0.8)">
      <div style="display:none;width:100%;height:100%;background:#111;align-items:center;justify-content:center;color:#444;font-size:7px;letter-spacing:1px;text-align:center;padding:4px">NO SIGNAL<br>${cam.city}</div>
      <div class="cctv-label">${cam.city}: ${cam.name}</div>
      <div class="cctv-live">● LIVE</div>
    `;
    grid.appendChild(div);
  });

  // Pagination controls
  const totalPages = Math.ceil(allCCTVCameras.length / CCTV_PAGE_SIZE);
  if (totalPages > 1) {
    const nav = document.createElement('div');
    nav.style.cssText = 'grid-column:1/-1;display:flex;justify-content:space-between;align-items:center;padding:4px 0;';
    nav.innerHTML = `
      <button onclick="cctvPrevPage()" style="background:none;border:1px solid var(--border);color:var(--green-dim);font-family:var(--font);font-size:9px;padding:2px 8px;cursor:pointer" ${currentCCTVPage===0?'disabled style="opacity:0.3"':''}>◄ PREV</button>
      <span style="font-size:8px;color:var(--green-dim);letter-spacing:1px">${currentCCTVPage+1} / ${totalPages} (${allCCTVCameras.length} CAMS)</span>
      <button onclick="cctvNextPage()" style="background:none;border:1px solid var(--border);color:var(--green-dim);font-family:var(--font);font-size:9px;padding:2px 8px;cursor:pointer" ${currentCCTVPage>=totalPages-1?'disabled style="opacity:0.3"':''}>NEXT ►</button>
    `;
    grid.appendChild(nav);
  }
}

function cctvPrevPage() { if (currentCCTVPage > 0) { currentCCTVPage--; renderCCTVGrid(); } }
function cctvNextPage() { const totalPages = Math.ceil(allCCTVCameras.length / CCTV_PAGE_SIZE); if (currentCCTVPage < totalPages-1) { currentCCTVPage++; renderCCTVGrid(); } }

function selectCamera(cam) {
  document.querySelectorAll('.cctv-thumb').forEach(t => t.classList.remove('active'));
  const el = document.getElementById('cam-' + cam.id);
  if (el) el.classList.add('active');

  // Show in main preview
  const main = document.getElementById('cctv-main');
  main.classList.add('visible');
  const img = document.getElementById('cctv-main-img');
  img.style.display = 'block';
  // Try direct URL first; fall back to proxy for CORS-restricted sources
  img.src = cam.url;
  img.onerror = () => {
    img.onerror = null;
    if (cam.url && !img.src.includes(CONFIG.proxy)) {
      img.src = CONFIG.proxy + encodeURIComponent(cam.url);
      img.onerror = () => { img.onerror = null; img.style.display = 'none'; };
    } else {
      img.style.display = 'none';
    }
  };
  document.getElementById('cctv-main-label').textContent = `${cam.city} // ${cam.name} // SNAPSHOT`;

  // Show fullscreen and street view buttons
  const btnRow = document.getElementById('cctv-btn-row');
  if (btnRow) {
    btnRow.style.display = 'flex';
    btnRow.dataset.camLat = cam.lat;
    btnRow.dataset.camLon = cam.lon;
    btnRow.dataset.camUrl = cam.url;
    btnRow.dataset.camName = cam.name;
    btnRow.dataset.camCity = cam.city;
  }

  // Fly camera to location
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(cam.lon, cam.lat, 300),
    orientation: { heading: 0, pitch: Cesium.Math.toRadians(-40), roll: 0 },
    duration: 1.5,
  });
  notify('CCTV: ' + cam.name);
}

function openCCTVFullscreen() {
  const btnRow = document.getElementById('cctv-btn-row');
  const url = btnRow?.dataset.camUrl;
  const name = btnRow?.dataset.camName || 'CAMERA';
  const city = btnRow?.dataset.camCity || '';
  if (!url) return;

  const overlay = document.getElementById('cctv-fullscreen');
  overlay.classList.remove('hidden');
  const content = document.getElementById('cctv-fs-content');
  content.innerHTML = `
    <img src="${url}" crossorigin="anonymous"
         onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"
         style="width:100%;height:100%;object-fit:contain;display:block;filter:sepia(0.1) saturate(0.9) contrast(1.1)">
    <div style="display:none;width:100%;height:100%;background:#111;align-items:center;justify-content:center;color:var(--red);font-size:14px;letter-spacing:3px">NO SIGNAL</div>
  `;
  document.getElementById('cctv-fs-label').textContent = `${city} // ${name} // LIVE FEED`;
}

function openStreetView() {
  const btnRow = document.getElementById('cctv-btn-row');
  const lat = btnRow?.dataset.camLat;
  const lon = btnRow?.dataset.camLon;
  const name = btnRow?.dataset.camName || 'LOCATION';
  const city = btnRow?.dataset.camCity || '';
  if (!lat || !lon) return;

  const overlay = document.getElementById('cctv-fullscreen');
  overlay.classList.remove('hidden');
  const content = document.getElementById('cctv-fs-content');
  // Google Street View embed — no API key required for iframe embed
  content.innerHTML = `
    <iframe src="https://www.google.com/maps/embed?pb=!4v0!6m8!1m7!1s!2m2!1d${lat}!2d${lon}!3f0!4f0!5f0.7820865974627469&layer=streetview&cbll=${lat},${lon}&cbp=0,0,0,0,0"
            style="width:100%;height:100%;border:none;filter:sepia(0.05) saturate(0.9)"
            allowfullscreen loading="lazy" referrerpolicy="no-referrer-when-downgrade">
    </iframe>
  `;
  document.getElementById('cctv-fs-label').textContent = `${city} // ${name} // STREET VIEW`;
  intelLog('CCTV', `Street View opened: ${lat}, ${lon}`);
}

function closeCCTVFullscreen() {
  const overlay = document.getElementById('cctv-fullscreen');
  overlay.classList.add('hidden');
  document.getElementById('cctv-fs-content').innerHTML = '';
}

function hideCCTV() {
  document.getElementById('cctv-panel').classList.add('hidden');
  closeCCTVFullscreen();
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILITY
// ═══════════════════════════════════════════════════════════════════════════
function setCount(name, n) {
  const el = document.getElementById('count-' + name);
  if (el) el.textContent = n;
}

function updateStats() {
  // Stat bar gets updated per-layer
}
