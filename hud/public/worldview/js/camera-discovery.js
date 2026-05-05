// ═══════════════════════════════════════════════════════════════════════════
// WORLDVIEW — DYNAMIC CAMERA DISCOVERY ENGINE
// Scans the user's current viewport and fetches cameras from open APIs
// for the region they're looking at. Cameras load dynamically as you pan/zoom.
// ═══════════════════════════════════════════════════════════════════════════

const CameraDiscovery = {
  // All discovered cameras across all sources
  discoveredCameras: [],
  // Track which API sources have been fetched to avoid re-fetching
  fetchedSources: new Set(),
  // Debounce timer for viewport changes
  _scanTimer: null,
  // Whether discovery is active
  active: false,
  // Minimum zoom level (camera height) to trigger discovery
  MAX_HEIGHT_FOR_SCAN: 500000, // 500km — don't scan when zoomed way out

  // ─── CAMERA SOURCE DEFINITIONS ──────────────────────────────────────────
  sources: [
    // ── CALIFORNIA (Caltrans) — 2,600+ cameras, no CORS issues ────────────
    ...['3','4','5','6','7','8','11'].map(d => ({
      id: `caltrans_d${d}`,
      name: `Caltrans D${d}`,
      region: 'California',
      // Approximate bounding boxes per district
      bounds: {
        '3':  { s:38.0, n:42.0, w:-123.0, e:-119.5 },  // Sacramento / N.Cal
        '4':  { s:36.5, n:38.5, w:-123.0, e:-121.0 },  // SF Bay Area
        '5':  { s:34.5, n:37.0, w:-122.0, e:-119.0 },  // Central Coast
        '6':  { s:34.5, n:37.5, w:-121.0, e:-118.5 },  // Fresno / Central Valley
        '7':  { s:33.5, n:34.5, w:-119.0, e:-117.5 },  // Los Angeles
        '8':  { s:33.5, n:35.5, w:-118.0, e:-115.0 },  // San Bernardino / Riverside
        '11': { s:32.5, n:33.5, w:-117.5, e:-116.0 },  // San Diego
      }[d],
      fetch: async () => {
        const res = await fetch(`https://cwwp2.dot.ca.gov/data/d${d}/cctv/cctvStatusD${d.padStart(2,'0')}.json`, { signal: AbortSignal.timeout(10000) });
        if (!res.ok) return [];
        const data = await res.json();
        const cameras = [];
        const walk = (obj) => {
          if (Array.isArray(obj)) return obj.forEach(walk);
          if (obj && obj.cctv) {
            const arr = Array.isArray(obj.cctv) ? obj.cctv : [obj.cctv];
            arr.forEach(c => {
              if (c.location?.longitude && c.location?.latitude) {
                cameras.push({
                  id: `ctd${d}_${cameras.length}`,
                  name: (c.location.locationName || 'CAM').toUpperCase().substring(0, 35),
                  city: c.location.nearbyPlace || `Caltrans D${d}`,
                  lat: parseFloat(c.location.latitude),
                  lon: parseFloat(c.location.longitude),
                  url: c.imageData?.static?.currentImageURL || `https://cwwp2.dot.ca.gov/data/d${d}/cctv/image/placeholder.jpg`,
                  source: `Caltrans D${d}`,
                });
              }
            });
          }
        };
        walk(Array.isArray(data) ? data : Object.values(data));
        return cameras;
      },
    })),

    // ── NEW YORK CITY (NYC DOT) — 957 cameras ─────────────────────────────
    {
      id: 'nycdot',
      name: 'NYC DOT',
      region: 'New York City',
      bounds: { s: 40.49, n: 40.92, w: -74.26, e: -73.68 },
      fetch: async () => {
        const res = await fetch(CONFIG.proxy + encodeURIComponent('https://webcams.nyctmc.org/api/cameras/'), { signal: AbortSignal.timeout(12000) });
        if (!res.ok) return [];
        const data = await res.json();
        if (!Array.isArray(data)) return [];
        return data.filter(c => c.latitude && c.longitude).map((c, i) => ({
          id: `nyc_${c.id || i}`,
          name: (c.name || 'NYC CAM').toUpperCase().substring(0, 35),
          city: c.area || 'NYC',
          lat: c.latitude,
          lon: c.longitude,
          url: c.imageUrl || `https://webcams.nyctmc.org/api/cameras/${c.id}/image`,
          source: 'NYC DOT',
        }));
      },
    },

    // ── LONDON (TfL JamCams) — 883 cameras ────────────────────────────────
    {
      id: 'tfl',
      name: 'TfL JamCams',
      region: 'London',
      bounds: { s: 51.28, n: 51.70, w: -0.51, e: 0.33 },
      fetch: async () => {
        const res = await fetch(CONFIG.proxy + encodeURIComponent('https://api.tfl.gov.uk/Place/Type/JamCam'), { signal: AbortSignal.timeout(12000) });
        if (!res.ok) return [];
        const data = await res.json();
        if (!Array.isArray(data)) return [];
        return data.filter(c => c.lat && c.lon).map((c, i) => {
          const imgProp = (c.additionalProperties || []).find(p => p.key === 'imageUrl');
          return {
            id: `tfl_${c.id || i}`,
            name: (c.commonName || 'LONDON CAM').toUpperCase().substring(0, 35),
            city: 'London',
            lat: c.lat,
            lon: c.lon,
            url: imgProp?.value || `https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/${c.id}.jpg`,
            source: 'TfL JamCams',
          };
        });
      },
    },

    // ── WASHINGTON STATE (WSDOT) — 900+ cameras ───────────────────────────
    {
      id: 'wsdot',
      name: 'WSDOT Cameras',
      region: 'Washington State',
      bounds: { s: 45.5, n: 49.1, w: -124.8, e: -116.9 },
      fetch: async () => {
        const url = 'https://www.wsdot.wa.gov/traffic/api/HighwayCameras/HighwayCamerasREST.svc/GetCamerasAsJson?AccessCode=wsdot-data-api-key';
        const res = await fetch(CONFIG.proxy + encodeURIComponent(url), { signal: AbortSignal.timeout(12000) });
        if (!res.ok) return [];
        const data = await res.json();
        const list = Array.isArray(data) ? data : [];
        return list.filter(c => c.ImageLocation?.Latitude && c.ImageLocation?.Longitude).map((c, i) => ({
          id: `wa_${c.CameraID || i}`,
          name: (c.Title || c.Description || 'WA CAM').toUpperCase().substring(0, 35),
          city: c.City || 'Washington',
          lat: c.ImageLocation.Latitude,
          lon: c.ImageLocation.Longitude,
          url: c.ImageURL || '',
          source: 'WSDOT',
        }));
      },
    },

    // ── OREGON (TripCheck ODOT) — 600+ cameras ────────────────────────────
    {
      id: 'odot',
      name: 'Oregon TripCheck',
      region: 'Oregon',
      bounds: { s: 41.9, n: 46.3, w: -124.6, e: -116.5 },
      fetch: async () => {
        const url = 'https://tripcheck.com/Scripts/rss/data/MTRoadsCamera.json';
        const res = await fetch(CONFIG.proxy + encodeURIComponent(url), { signal: AbortSignal.timeout(12000) });
        if (!res.ok) return [];
        const data = await res.json();
        const list = Array.isArray(data) ? data : (data.cameras || data.CameraList || []);
        return list.filter(c => (c.Latitude || c.latitude) && (c.Longitude || c.longitude)).map((c, i) => ({
          id: `or_${c.CameraId || c.id || i}`,
          name: (c.Description || c.Name || c.name || 'OR CAM').toUpperCase().substring(0, 35),
          city: c.City || c.city || 'Oregon',
          lat: parseFloat(c.Latitude || c.latitude),
          lon: parseFloat(c.Longitude || c.longitude),
          url: c.ImageUrl || c.imageUrl || c.url || '',
          source: 'Oregon TripCheck',
        }));
      },
    },

    // ── UTAH (UDOT Traffic) — 500+ cameras ───────────────────────────────
    {
      id: 'udot',
      name: 'UDOT Traffic',
      region: 'Utah',
      bounds: { s: 36.9, n: 42.1, w: -114.1, e: -109.0 },
      fetch: async () => {
        const url = 'https://udottraffic.utah.gov/api/v1/cameras';
        const res = await fetch(CONFIG.proxy + encodeURIComponent(url), { signal: AbortSignal.timeout(12000) });
        if (!res.ok) return [];
        const data = await res.json();
        const list = Array.isArray(data) ? data : (data.items || data.cameras || []);
        return list.filter(c => (c.latitude || c.lat) && (c.longitude || c.lon)).map((c, i) => ({
          id: `ut_${c.id || i}`,
          name: (c.name || c.description || 'UDOT CAM').toUpperCase().substring(0, 35),
          city: c.city || 'Utah',
          lat: parseFloat(c.latitude || c.lat),
          lon: parseFloat(c.longitude || c.lon),
          url: c.imageUrl || c.image_url || c.url || '',
          source: 'UDOT Traffic',
        }));
      },
    },

    // ── COLORADO (COTRIP) — 400+ cameras ─────────────────────────────────
    {
      id: 'cotrip',
      name: 'Colorado COTRIP',
      region: 'Colorado',
      bounds: { s: 36.9, n: 41.1, w: -109.1, e: -102.0 },
      fetch: async () => {
        const url = 'https://cotrip.org/speed/getCameras.do';
        const res = await fetch(CONFIG.proxy + encodeURIComponent(url), { signal: AbortSignal.timeout(12000) });
        if (!res.ok) return [];
        const data = await res.json();
        const list = Array.isArray(data) ? data : (data.cameras || data.features || []);
        return list.filter(c => c.latitude && c.longitude).map((c, i) => ({
          id: `co_${c.id || i}`,
          name: (c.description || c.name || 'CO CAM').toUpperCase().substring(0, 35),
          city: c.city || 'Colorado',
          lat: parseFloat(c.latitude),
          lon: parseFloat(c.longitude),
          url: c.imageUrl || '',
          source: 'Colorado COTRIP',
        }));
      },
    },

    // ── GEORGIA (NaviGAtor DOT) — 600+ cameras ────────────────────────────
    {
      id: 'gdot_nav',
      name: 'Georgia NaviGAtor',
      region: 'Georgia',
      bounds: { s: 30.35, n: 35.0, w: -85.6, e: -80.8 },
      fetch: async () => {
        const url = 'https://www.navigator.dot.ga.gov/navigator-api-public/api/v1/cameras';
        const res = await fetch(CONFIG.proxy + encodeURIComponent(url), { signal: AbortSignal.timeout(12000) });
        if (!res.ok) return [];
        const data = await res.json();
        const list = Array.isArray(data) ? data : (data.cameras || data.features || []);
        return list.filter(c => c.latitude && c.longitude).map((c, i) => ({
          id: `ga_${c.deviceId || c.id || i}`,
          name: (c.description || c.name || 'GA CAM').toUpperCase().substring(0, 35),
          city: c.city || 'Georgia',
          lat: parseFloat(c.latitude),
          lon: parseFloat(c.longitude),
          url: c.imageUrl || c.url || '',
          source: 'Georgia NaviGAtor',
        }));
      },
    },

    // ── FLORIDA (FL511) — 1,000+ cameras ─────────────────────────────────
    {
      id: 'fl511',
      name: 'Florida FL511',
      region: 'Florida',
      bounds: { s: 24.4, n: 31.1, w: -87.7, e: -80.0 },
      fetch: async () => {
        const url = 'https://fl511.com/map/api/objects?type=cameras';
        const res = await fetch(CONFIG.proxy + encodeURIComponent(url), { signal: AbortSignal.timeout(12000) });
        if (!res.ok) return [];
        const data = await res.json();
        const list = Array.isArray(data) ? data : (data.cameras || data.features || []);
        return list.filter(c => (c.Latitude || c.latitude) && (c.Longitude || c.longitude)).map((c, i) => ({
          id: `fl_${c.Id || c.id || i}`,
          name: (c.Description || c.Name || c.name || 'FL CAM').toUpperCase().substring(0, 35),
          city: c.Area || c.City || c.city || 'Florida',
          lat: parseFloat(c.Latitude || c.latitude),
          lon: parseFloat(c.Longitude || c.longitude),
          url: c.CameraUrl || c.ImageUrl || c.imageUrl || '',
          source: 'Florida FL511',
        }));
      },
    },

    // ── TEXAS (DriveTexas) — 1,500+ cameras ───────────────────────────────
    {
      id: 'txdot',
      name: 'Texas DriveTexas',
      region: 'Texas',
      bounds: { s: 25.8, n: 36.6, w: -106.7, e: -93.5 },
      fetch: async () => {
        const url = 'https://www.drivetexas.org/api/4/cameras';
        const res = await fetch(CONFIG.proxy + encodeURIComponent(url), { signal: AbortSignal.timeout(15000) });
        if (!res.ok) return [];
        const data = await res.json();
        const list = Array.isArray(data) ? data : (data.cameras || []);
        return list.filter(c => c.latitude && c.longitude).map((c, i) => ({
          id: `tx_${c.id || i}`,
          name: (c.description || c.name || 'TX CAM').toUpperCase().substring(0, 35),
          city: c.city || c.location || 'Texas',
          lat: parseFloat(c.latitude),
          lon: parseFloat(c.longitude),
          url: c.imageUrl || c.url || `https://www.drivetexas.org/images/cameras/${c.id}.jpg`,
          source: 'Texas DriveTexas',
        }));
      },
    },

    // ── OHIO (OHGO) — 700+ cameras ────────────────────────────────────────
    {
      id: 'ohgo',
      name: 'Ohio OHGO',
      region: 'Ohio',
      bounds: { s: 38.4, n: 42.0, w: -84.8, e: -80.5 },
      fetch: async () => {
        const url = 'https://ohgo.com/api/Cameras';
        const res = await fetch(CONFIG.proxy + encodeURIComponent(url), { signal: AbortSignal.timeout(12000) });
        if (!res.ok) return [];
        const data = await res.json();
        const list = Array.isArray(data) ? data : (data.Cameras || data.cameras || []);
        return list.filter(c => (c.Latitude || c.latitude) && (c.Longitude || c.longitude)).map((c, i) => ({
          id: `oh_${c.Id || c.id || i}`,
          name: (c.Description || c.Name || c.name || 'OH CAM').toUpperCase().substring(0, 35),
          city: c.City || c.Location || c.city || 'Ohio',
          lat: parseFloat(c.Latitude || c.latitude),
          lon: parseFloat(c.Longitude || c.longitude),
          url: (c.Image && c.Image.Url) || c.ImageUrl || c.imageUrl || '',
          source: 'Ohio OHGO',
        }));
      },
    },

    // ── MICHIGAN (MiDrive MDOT) — 700+ cameras ────────────────────────────
    {
      id: 'midrive',
      name: 'Michigan MiDrive',
      region: 'Michigan',
      bounds: { s: 41.7, n: 48.3, w: -90.5, e: -82.4 },
      fetch: async () => {
        const url = 'https://mdotjboss.state.mi.us/MiDrive/cameras';
        const res = await fetch(CONFIG.proxy + encodeURIComponent(url), { signal: AbortSignal.timeout(12000) });
        if (!res.ok) return [];
        const data = await res.json();
        const list = Array.isArray(data) ? data : (data.cameras || []);
        return list.filter(c => c.latitude && c.longitude).map((c, i) => ({
          id: `mi_${c.id || i}`,
          name: (c.description || c.name || 'MI CAM').toUpperCase().substring(0, 35),
          city: c.city || 'Michigan',
          lat: parseFloat(c.latitude),
          lon: parseFloat(c.longitude),
          url: c.imageUrl || '',
          source: 'Michigan MiDrive',
        }));
      },
    },

    // ── MINNESOTA (MnDOT 511) — 500+ cameras ─────────────────────────────
    {
      id: 'mndot',
      name: 'MnDOT 511',
      region: 'Minnesota',
      bounds: { s: 43.5, n: 49.4, w: -97.3, e: -89.5 },
      fetch: async () => {
        const url = 'https://511mn.org/api/cameras';
        const res = await fetch(CONFIG.proxy + encodeURIComponent(url), { signal: AbortSignal.timeout(12000) });
        if (!res.ok) return [];
        const data = await res.json();
        const list = Array.isArray(data) ? data : (data.cameras || data.features || []);
        return list.filter(c => (c.latitude || c.lat) && (c.longitude || c.lon)).map((c, i) => ({
          id: `mn_${c.id || i}`,
          name: (c.name || c.description || 'MN CAM').toUpperCase().substring(0, 35),
          city: c.city || 'Minnesota',
          lat: parseFloat(c.latitude || c.lat),
          lon: parseFloat(c.longitude || c.lon),
          url: c.imageUrl || c.url || '',
          source: 'MnDOT 511',
        }));
      },
    },

    // ── VIRGINIA (VDOT Smart Traffic) — 700+ cameras ──────────────────────
    {
      id: 'vdot',
      name: 'VDOT Smart Traffic',
      region: 'Virginia',
      bounds: { s: 36.5, n: 39.5, w: -83.7, e: -75.2 },
      fetch: async () => {
        const url = 'https://www.511virginia.org/api/getcameras';
        const res = await fetch(CONFIG.proxy + encodeURIComponent(url), { signal: AbortSignal.timeout(12000) });
        if (!res.ok) return [];
        const data = await res.json();
        const list = Array.isArray(data) ? data : (data.cameras || []);
        return list.filter(c => (c.Latitude || c.latitude) && (c.Longitude || c.longitude)).map((c, i) => ({
          id: `va_${c.Id || c.id || i}`,
          name: (c.Name || c.Description || c.name || 'VA CAM').toUpperCase().substring(0, 35),
          city: c.Location || c.City || c.city || 'Virginia',
          lat: parseFloat(c.Latitude || c.latitude),
          lon: parseFloat(c.Longitude || c.longitude),
          url: c.VideoUrl || c.ImageUrl || c.imageUrl || '',
          source: 'VDOT Smart Traffic',
        }));
      },
    },

    // ── MARYLAND (SHA CHART) — 400+ cameras ───────────────────────────────
    {
      id: 'mdsha',
      name: 'Maryland SHA',
      region: 'Maryland',
      bounds: { s: 37.9, n: 39.7, w: -79.5, e: -75.0 },
      fetch: async () => {
        const url = 'https://chart.maryland.gov/content/incident/getCameras.php';
        const res = await fetch(CONFIG.proxy + encodeURIComponent(url), { signal: AbortSignal.timeout(12000) });
        if (!res.ok) return [];
        const data = await res.json();
        const list = Array.isArray(data) ? data : (data.cameras || []);
        return list.filter(c => (c.latitude || c.Latitude) && (c.longitude || c.Longitude)).map((c, i) => ({
          id: `md_${c.id || c.Id || i}`,
          name: (c.description || c.Description || c.name || 'MD CAM').toUpperCase().substring(0, 35),
          city: c.location || c.Location || 'Maryland',
          lat: parseFloat(c.latitude || c.Latitude),
          lon: parseFloat(c.longitude || c.Longitude),
          url: c.imageUrl || c.ImageUrl || c.url || '',
          source: 'Maryland SHA',
        }));
      },
    },

    // ── ARIZONA (AZ511 ADOT) — 400+ cameras ──────────────────────────────
    {
      id: 'adot',
      name: 'Arizona ADOT',
      region: 'Arizona',
      bounds: { s: 31.3, n: 37.0, w: -114.8, e: -109.0 },
      fetch: async () => {
        const url = 'https://az511.com/api/cameras';
        const res = await fetch(CONFIG.proxy + encodeURIComponent(url), { signal: AbortSignal.timeout(12000) });
        if (!res.ok) return [];
        const data = await res.json();
        const list = Array.isArray(data) ? data : (data.cameras || data.features || []);
        return list.filter(c => (c.latitude || c.lat) && (c.longitude || c.lon)).map((c, i) => ({
          id: `az_${c.id || i}`,
          name: (c.description || c.name || 'AZ CAM').toUpperCase().substring(0, 35),
          city: c.city || 'Arizona',
          lat: parseFloat(c.latitude || c.lat),
          lon: parseFloat(c.longitude || c.lon),
          url: c.imageUrl || c.url || '',
          source: 'Arizona ADOT',
        }));
      },
    },

    // ── NEVADA (NV Roads) — 300+ cameras ────────────────────────────────
    {
      id: 'nvroads',
      name: 'Nevada NV Roads',
      region: 'Nevada',
      bounds: { s: 35.0, n: 42.0, w: -120.0, e: -114.0 },
      fetch: async () => {
        const url = 'https://www.nvroads.com/api/cameras';
        const res = await fetch(CONFIG.proxy + encodeURIComponent(url), { signal: AbortSignal.timeout(12000) });
        if (!res.ok) return [];
        const data = await res.json();
        const list = Array.isArray(data) ? data : (data.cameras || []);
        return list.filter(c => (c.Latitude || c.latitude) && (c.Longitude || c.longitude)).map((c, i) => ({
          id: `nv_${c.Id || c.id || i}`,
          name: (c.Description || c.Name || c.name || 'NV CAM').toUpperCase().substring(0, 35),
          city: 'Nevada',
          lat: parseFloat(c.Latitude || c.latitude),
          lon: parseFloat(c.Longitude || c.longitude),
          url: c.ImageUrl || c.imageUrl || c.url || '',
          source: 'Nevada NV Roads',
        }));
      },
    },

    // ── PENNSYLVANIA (511PA) — 800+ cameras ──────────────────────────────
    {
      id: 'pa511',
      name: 'Pennsylvania 511PA',
      region: 'Pennsylvania',
      bounds: { s: 39.7, n: 42.3, w: -80.5, e: -74.7 },
      fetch: async () => {
        const url = 'https://www.511pa.com/api/cameras';
        const res = await fetch(CONFIG.proxy + encodeURIComponent(url), { signal: AbortSignal.timeout(12000) });
        if (!res.ok) return [];
        const data = await res.json();
        const list = Array.isArray(data) ? data : (data.cameras || data.features || []);
        return list.filter(c => (c.latitude || c.lat) && (c.longitude || c.lon)).map((c, i) => ({
          id: `pa_${c.id || i}`,
          name: (c.name || c.description || 'PA CAM').toUpperCase().substring(0, 35),
          city: c.city || 'Pennsylvania',
          lat: parseFloat(c.latitude || c.lat),
          lon: parseFloat(c.longitude || c.lon),
          url: c.imageUrl || c.url || '',
          source: 'Pennsylvania 511PA',
        }));
      },
    },

    // ── NEW JERSEY (NJ511) — 400+ cameras ────────────────────────────────
    {
      id: 'nj511',
      name: 'New Jersey 511NJ',
      region: 'New Jersey',
      bounds: { s: 38.9, n: 41.4, w: -75.6, e: -73.9 },
      fetch: async () => {
        const url = 'https://511nj.org/api/cameras';
        const res = await fetch(CONFIG.proxy + encodeURIComponent(url), { signal: AbortSignal.timeout(12000) });
        if (!res.ok) return [];
        const data = await res.json();
        const list = Array.isArray(data) ? data : (data.cameras || []);
        return list.filter(c => (c.latitude || c.lat) && (c.longitude || c.lon)).map((c, i) => ({
          id: `nj_${c.id || i}`,
          name: (c.name || c.description || 'NJ CAM').toUpperCase().substring(0, 35),
          city: c.city || 'New Jersey',
          lat: parseFloat(c.latitude || c.lat),
          lon: parseFloat(c.longitude || c.lon),
          url: c.imageUrl || c.url || '',
          source: 'New Jersey 511NJ',
        }));
      },
    },

    // ── ILLINOIS (Illinois DOT) — 500+ cameras ────────────────────────────
    {
      id: 'idot',
      name: 'Illinois IDOT',
      region: 'Illinois',
      bounds: { s: 36.9, n: 42.5, w: -91.5, e: -87.5 },
      fetch: async () => {
        const url = 'https://www.gettingaroundillinois.com/api/cameras';
        const res = await fetch(CONFIG.proxy + encodeURIComponent(url), { signal: AbortSignal.timeout(12000) });
        if (!res.ok) return [];
        const data = await res.json();
        const list = Array.isArray(data) ? data : (data.cameras || data.features || []);
        return list.filter(c => (c.latitude || c.lat) && (c.longitude || c.lon)).map((c, i) => ({
          id: `il_${c.id || i}`,
          name: (c.name || c.description || 'IL CAM').toUpperCase().substring(0, 35),
          city: c.city || 'Illinois',
          lat: parseFloat(c.latitude || c.lat),
          lon: parseFloat(c.longitude || c.lon),
          url: c.imageUrl || c.url || '',
          source: 'Illinois IDOT',
        }));
      },
    },

    // ── NORTH CAROLINA (NC Quick Travel) — 600+ cameras ──────────────────
    {
      id: 'ncdot',
      name: 'NC Quick Travel',
      region: 'North Carolina',
      bounds: { s: 33.8, n: 36.6, w: -84.3, e: -75.5 },
      fetch: async () => {
        const url = 'https://www.ncdot.gov/travel-maps/nc511/api/cameras';
        const res = await fetch(CONFIG.proxy + encodeURIComponent(url), { signal: AbortSignal.timeout(12000) });
        if (!res.ok) return [];
        const data = await res.json();
        const list = Array.isArray(data) ? data : (data.cameras || data.features || []);
        return list.filter(c => (c.latitude || c.lat) && (c.longitude || c.lon)).map((c, i) => ({
          id: `nc_${c.id || i}`,
          name: (c.name || c.description || 'NC CAM').toUpperCase().substring(0, 35),
          city: c.city || 'North Carolina',
          lat: parseFloat(c.latitude || c.lat),
          lon: parseFloat(c.longitude || c.lon),
          url: c.imageUrl || c.url || '',
          source: 'NC Quick Travel',
        }));
      },
    },

    // ── TENNESSEE (SmartWay) — 400+ cameras ──────────────────────────────
    {
      id: 'tdot',
      name: 'Tennessee SmartWay',
      region: 'Tennessee',
      bounds: { s: 34.9, n: 36.7, w: -90.3, e: -81.6 },
      fetch: async () => {
        const url = 'https://smartway.tn.gov/api/cameras';
        const res = await fetch(CONFIG.proxy + encodeURIComponent(url), { signal: AbortSignal.timeout(12000) });
        if (!res.ok) return [];
        const data = await res.json();
        const list = Array.isArray(data) ? data : (data.cameras || []);
        return list.filter(c => (c.latitude || c.lat) && (c.longitude || c.lon)).map((c, i) => ({
          id: `tn_${c.id || i}`,
          name: (c.name || c.description || 'TN CAM').toUpperCase().substring(0, 35),
          city: c.city || 'Tennessee',
          lat: parseFloat(c.latitude || c.lat),
          lon: parseFloat(c.longitude || c.lon),
          url: c.imageUrl || c.url || '',
          source: 'Tennessee SmartWay',
        }));
      },
    },

    // ── TORONTO (City of Toronto) — 100+ cameras ─────────────────────────
    {
      id: 'toronto',
      name: 'Toronto Traffic',
      region: 'Toronto',
      bounds: { s: 43.58, n: 43.85, w: -79.64, e: -79.12 },
      fetch: async () => {
        const url = 'https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/datastore_search?resource_id=e4f20e44-a812-4b96-b91e-5e12ce1ea27c&limit=500';
        const res = await fetch(CONFIG.proxy + encodeURIComponent(url), { signal: AbortSignal.timeout(12000) });
        if (!res.ok) return [];
        const data = await res.json();
        const records = data?.result?.records || [];
        return records.filter(c => c.Latitude && c.Longitude).map((c, i) => ({
          id: `tor_${c._id || i}`,
          name: (c.Main || c.Midpoint || 'TORONTO CAM').toUpperCase().substring(0, 35),
          city: 'Toronto',
          lat: parseFloat(c.Latitude),
          lon: parseFloat(c.Longitude),
          url: `https://www.toronto.ca/ext/uvis/cameraViewer.jsp?siteId=${c._id}`,
          source: 'Toronto Traffic',
        }));
      },
    },

    // ── MONTREAL (MTQ Québec) — 300+ cameras ─────────────────────────────
    {
      id: 'mtq',
      name: 'Québec MTQ',
      region: 'Québec',
      bounds: { s: 45.0, n: 48.5, w: -75.0, e: -71.0 },
      fetch: async () => {
        const url = 'https://www.quebec511.info/fr/Carte/Segments/GetCamera?boundNorth=49&boundSouth=44&boundWest=-76&boundEast=-70&lang=fr';
        const res = await fetch(CONFIG.proxy + encodeURIComponent(url), { signal: AbortSignal.timeout(12000) });
        if (!res.ok) return [];
        const data = await res.json();
        const list = Array.isArray(data) ? data : (data.cameras || []);
        return list.filter(c => c.Latitude && c.Longitude).map((c, i) => ({
          id: `qc_${c.Id || i}`,
          name: (c.Description || c.Name || 'QC CAM').toUpperCase().substring(0, 35),
          city: c.City || 'Québec',
          lat: parseFloat(c.Latitude),
          lon: parseFloat(c.Longitude),
          url: c.ImageUrl || c.Url || '',
          source: 'Québec MTQ',
        }));
      },
    },

    // ── AUSTRALIA (VicRoads Victoria) — 200+ cameras ──────────────────────
    {
      id: 'vicroads',
      name: 'VicRoads Australia',
      region: 'Victoria Australia',
      bounds: { s: -39.2, n: -34.0, w: 140.9, e: 150.0 },
      fetch: async () => {
        const url = 'https://traffic.vicroads.vic.gov.au/api/trafficcameras';
        const res = await fetch(CONFIG.proxy + encodeURIComponent(url), { signal: AbortSignal.timeout(12000) });
        if (!res.ok) return [];
        const data = await res.json();
        const list = Array.isArray(data) ? data : (data.cameras || data.features || []);
        return list.filter(c => (c.latitude || c.lat) && (c.longitude || c.lon)).map((c, i) => ({
          id: `au_vic_${c.id || i}`,
          name: (c.name || c.description || 'VIC CAM').toUpperCase().substring(0, 35),
          city: c.suburb || 'Victoria',
          lat: parseFloat(c.latitude || c.lat),
          lon: parseFloat(c.longitude || c.lon),
          url: c.imageUrl || c.url || '',
          source: 'VicRoads Australia',
        }));
      },
    },

    // ── NETHERLANDS (NDW) — 1,000+ cameras ───────────────────────────────
    {
      id: 'ndw',
      name: 'Netherlands NDW',
      region: 'Netherlands',
      bounds: { s: 50.75, n: 53.55, w: 3.35, e: 7.22 },
      fetch: async () => {
        const url = 'https://data.ndw.nu/api/rest/static-road-data/traffic-signs/v4';
        // Fallback to NDW camera endpoint
        const camUrl = 'https://opendata.ndw.nu/cameras.json.gz';
        const res = await fetch(CONFIG.proxy + encodeURIComponent('https://api.ndw.nu/cameras'), { signal: AbortSignal.timeout(12000) });
        if (!res.ok) return [];
        const data = await res.json();
        const list = Array.isArray(data) ? data : [];
        return list.filter(c => c.latitude && c.longitude).map((c, i) => ({
          id: `nl_${c.id || i}`,
          name: (c.description || c.name || 'NL CAM').toUpperCase().substring(0, 35),
          city: c.city || 'Netherlands',
          lat: parseFloat(c.latitude),
          lon: parseFloat(c.longitude),
          url: c.imageUrl || c.url || '',
          source: 'Netherlands NDW',
        }));
      },
    },

    // ── CALTRANS D1 (Eureka/Redding — North California) ──────────────────
    {
      id: 'caltrans_d1',
      name: 'Caltrans D1',
      region: 'California',
      bounds: { s: 40.0, n: 42.1, w: -124.5, e: -122.0 },
      fetch: async () => {
        const res = await fetch(`https://cwwp2.dot.ca.gov/data/d1/cctv/cctvStatusD01.json`, { signal: AbortSignal.timeout(10000) });
        if (!res.ok) return [];
        const data = await res.json();
        const cameras = [];
        const walk = (obj) => {
          if (Array.isArray(obj)) return obj.forEach(walk);
          if (obj && obj.cctv) {
            const arr = Array.isArray(obj.cctv) ? obj.cctv : [obj.cctv];
            arr.forEach(c => {
              if (c.location?.longitude && c.location?.latitude) {
                cameras.push({
                  id: `ctd1_${cameras.length}`,
                  name: (c.location.locationName || 'CAM').toUpperCase().substring(0, 35),
                  city: c.location.nearbyPlace || 'Caltrans D1',
                  lat: parseFloat(c.location.latitude),
                  lon: parseFloat(c.location.longitude),
                  url: c.imageData?.static?.currentImageURL || '',
                  source: 'Caltrans D1',
                });
              }
            });
          }
        };
        walk(Array.isArray(data) ? data : Object.values(data));
        return cameras;
      },
    },

    // ── CALTRANS D2 (Redding region) ──────────────────────────────────────
    {
      id: 'caltrans_d2',
      name: 'Caltrans D2',
      region: 'California',
      bounds: { s: 39.5, n: 41.5, w: -123.0, e: -120.5 },
      fetch: async () => {
        const res = await fetch(`https://cwwp2.dot.ca.gov/data/d2/cctv/cctvStatusD02.json`, { signal: AbortSignal.timeout(10000) });
        if (!res.ok) return [];
        const data = await res.json();
        const cameras = [];
        const walk = (obj) => {
          if (Array.isArray(obj)) return obj.forEach(walk);
          if (obj && obj.cctv) {
            const arr = Array.isArray(obj.cctv) ? obj.cctv : [obj.cctv];
            arr.forEach(c => {
              if (c.location?.longitude && c.location?.latitude) {
                cameras.push({
                  id: `ctd2_${cameras.length}`,
                  name: (c.location.locationName || 'CAM').toUpperCase().substring(0, 35),
                  city: c.location.nearbyPlace || 'Caltrans D2',
                  lat: parseFloat(c.location.latitude),
                  lon: parseFloat(c.location.longitude),
                  url: c.imageData?.static?.currentImageURL || '',
                  source: 'Caltrans D2',
                });
              }
            });
          }
        };
        walk(Array.isArray(data) ? data : Object.values(data));
        return cameras;
      },
    },

    // ── CALTRANS D9/D10 (Fresno/Stockton) ────────────────────────────────
    ...['9','10','12'].map(d => ({
      id: `caltrans_d${d}`,
      name: `Caltrans D${d}`,
      region: 'California',
      bounds: {
        '9':  { s: 35.5, n: 37.5, w: -121.0, e: -117.5 },
        '10': { s: 37.0, n: 38.5, w: -121.5, e: -119.0 },
        '12': { s: 37.5, n: 38.5, w: -122.5, e: -121.0 },
      }[d],
      fetch: async () => {
        const res = await fetch(`https://cwwp2.dot.ca.gov/data/d${d}/cctv/cctvStatusD${d.padStart(2,'0')}.json`, { signal: AbortSignal.timeout(10000) });
        if (!res.ok) return [];
        const data = await res.json();
        const cameras = [];
        const walk = (obj) => {
          if (Array.isArray(obj)) return obj.forEach(walk);
          if (obj && obj.cctv) {
            const arr = Array.isArray(obj.cctv) ? obj.cctv : [obj.cctv];
            arr.forEach(c => {
              if (c.location?.longitude && c.location?.latitude) {
                cameras.push({
                  id: `ctd${d}_${cameras.length}`,
                  name: (c.location.locationName || 'CAM').toUpperCase().substring(0, 35),
                  city: c.location.nearbyPlace || `Caltrans D${d}`,
                  lat: parseFloat(c.location.latitude),
                  lon: parseFloat(c.location.longitude),
                  url: c.imageData?.static?.currentImageURL || '',
                  source: `Caltrans D${d}`,
                });
              }
            });
          }
        };
        walk(Array.isArray(data) ? data : Object.values(data));
        return cameras;
      },
    })),
  ],

  // ─── INIT: Hook into Cesium camera events ───────────────────────────────
  init() {
    if (!viewer) return;
    // Listen for camera movement end
    viewer.camera.moveEnd.addEventListener(() => {
      if (!this.active) return;
      clearTimeout(this._scanTimer);
      this._scanTimer = setTimeout(() => this.scanViewport(), 1500);
    });
    this.active = true;
    intelLog('CCTV', 'Camera discovery engine initialized — pan/zoom to discover cameras');
  },

  // ─── SCAN: Check which sources overlap current viewport ─────────────────
  async scanViewport() {
    if (!viewer) return;
    const cam = viewer.camera;
    const height = cam.positionCartographic.height;

    // Don't scan when zoomed way out
    if (height > this.MAX_HEIGHT_FOR_SCAN) return;

    // Get viewport bounds
    const rect = viewer.canvas.getBoundingClientRect();
    const corners = [
      { x: rect.left, y: rect.top },
      { x: rect.right, y: rect.top },
      { x: rect.left, y: rect.bottom },
      { x: rect.right, y: rect.bottom },
      { x: rect.left + rect.width/2, y: rect.top + rect.height/2 },
    ];

    let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
    let validCount = 0;
    corners.forEach(c => {
      const ray = viewer.camera.getPickRay(new Cesium.Cartesian2(c.x, c.y));
      if (!ray) return;
      const pos = viewer.scene.globe.pick(ray, viewer.scene);
      if (!pos) return;
      const carto = Cesium.Cartographic.fromCartesian(pos);
      const lat = Cesium.Math.toDegrees(carto.latitude);
      const lon = Cesium.Math.toDegrees(carto.longitude);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
      minLon = Math.min(minLon, lon);
      maxLon = Math.max(maxLon, lon);
      validCount++;
    });

    if (validCount < 2) return;

    // Check which sources overlap this viewport
    const viewport = { s: minLat, n: maxLat, w: minLon, e: maxLon };
    const matchingSources = this.sources.filter(src => {
      if (this.fetchedSources.has(src.id)) return false;
      if (!src.bounds) return false;
      return this.boundsOverlap(viewport, src.bounds);
    });

    if (matchingSources.length === 0) return;

    notify(`SCANNING ${matchingSources.length} CAMERA SOURCE${matchingSources.length>1?'S':''}...`);
    intelLog('CCTV', `Viewport scan: ${matchingSources.map(s=>s.name).join(', ')}`);

    // Fetch in parallel
    const results = await Promise.allSettled(matchingSources.map(async src => {
      this.fetchedSources.add(src.id); // Mark as fetched immediately to prevent double-fetch
      try {
        const cameras = await src.fetch();
        return { source: src, cameras };
      } catch(e) {
        return { source: src, cameras: [] };
      }
    }));

    let newCount = 0;
    results.forEach(r => {
      if (r.status !== 'fulfilled' || r.value.cameras.length === 0) return;
      const { source, cameras } = r.value;

      // Deduplicate against existing
      const existingKeys = new Set(allCCTVCameras.map(c => `${c.lat.toFixed(4)}_${c.lon.toFixed(4)}`));
      const newCams = cameras.filter(c => {
        const key = `${c.lat.toFixed(4)}_${c.lon.toFixed(4)}`;
        if (existingKeys.has(key)) return false;
        existingKeys.add(key);
        return true;
      });

      if (newCams.length === 0) return;

      // Add to global camera list
      allCCTVCameras.push(...newCams);
      newCount += newCams.length;

      // Add globe markers
      newCams.forEach(cam => {
        const ent = viewer.entities.add({
          name: cam.name,
          position: Cesium.Cartesian3.fromDegrees(cam.lon, cam.lat, 5),
          point: { pixelSize: 5, color: Cesium.Color.fromCssColorString('#ff3a3a').withAlpha(0.85), outlineColor: Cesium.Color.fromCssColorString('#ff0000'), outlineWidth: 1, scaleByDistance: new Cesium.NearFarScalar(1e3, 2.0, 1e6, 0.3) },
          label: { text: cam.name, font: '7px Courier New', fillColor: Cesium.Color.fromCssColorString('#ff3a3a').withAlpha(0.5), outlineColor: Cesium.Color.BLACK, outlineWidth: 1, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(0, -10), show: false, scaleByDistance: new Cesium.NearFarScalar(1e3, 1.0, 5e5, 0.0) },
          properties: { type: 'CCTV CAMERA', camera_id: cam.id, location: cam.name, city: cam.city, source: cam.source, feed_type: 'SNAPSHOT' },
        });
        layers.cctv.entities.push(ent);
      });

      intelLog('CCTV', `${source.name}: ${newCams.length} cameras discovered`);
      notify(`DISCOVERED ${newCams.length} CAMERAS — ${source.name}`);
    });

    if (newCount > 0) {
      setCount('cctv', allCCTVCameras.length);
      // Re-render the grid to include new cameras
      currentCCTVPage = 0;
      renderCCTVGrid();
      intelLog('CCTV', `Total cameras now: ${allCCTVCameras.length}`);
    }
  },

  // ─── UTILITY: Check if two bounding boxes overlap ───────────────────────
  boundsOverlap(a, b) {
    return !(a.e < b.w || a.w > b.e || a.n < b.s || a.s > b.n);
  },

  // ─── MANUAL SCAN: Force a scan of the current viewport ─────────────────
  forceScan() {
    this.scanViewport();
  },

  // ─── RESET: Clear all discovered cameras (keeps static ones) ───────────
  reset() {
    this.fetchedSources.clear();
    this.discoveredCameras = [];
  },
};
