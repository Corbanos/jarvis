// ═══════════════════════════════════════════════════════════════════════════
// WORLDVIEW — BOOT SEQUENCE & KEYBOARD BINDINGS
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// KEYBOARD SHORTCUTS
// ═══════════════════════════════════════════════════════════════════════════
document.addEventListener('keydown', e => {
  const tag = document.activeElement.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea') return;

  switch(e.key) {
    case '1': setMode('normal');  break;
    case '2': setMode('nvg');     break;
    case '3': setMode('flir');    break;
    case '4': setMode('crt');     break;
    case 'Escape': deselectEntity(); break;
    case '/':
      e.preventDefault();
      const si = document.getElementById('search-input');
      if (si) si.focus();
      break;
    default: {
      const lm = LANDMARKS.find(l => l.key === e.key.toUpperCase());
      if (lm) flyToLandmark(lm);
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════════════════════════════
async function boot() {
  setLoadProgress(5, 'INITIALIZING CESIUM ENGINE...');
  try {
    await initCesium();
  } catch(e) {
    setLoadProgress(0, 'CESIUM INIT FAILED — CHECK TOKEN');
    console.error('Cesium init error:', e);
    return;
  }

  setLoadProgress(25, 'TERRAIN LOADED');
  await new Promise(r => setTimeout(r, 300));

  setLoadProgress(40, 'CONFIGURING POST-PROCESSING SHADERS...');
  await new Promise(r => setTimeout(r, 200));

  setLoadProgress(55, 'BUILDING LANDMARK DATABASE...');
  buildLandmarkList();

  setLoadProgress(65, 'INITIALIZING SEARCH ENGINE...');
  initSearch();

  setLoadProgress(75, 'CONFIGURING INTEL FEED...');
  intelLog('SYS', 'WORLDVIEW intelligence system booting...');
  intelLog('SYS', `Cesium engine initialized — terrain provider active`);
  intelLog('SYS', `${LANDMARKS.length} landmarks loaded`);
  intelLog('SYS', `${CCTV_CAMERAS_STATIC.length} CCTV feeds configured (+ live API expansion)`);
  intelLog('SYS', `${NUCLEAR_PLANTS.length} nuclear facilities in database`);
  intelLog('SYS', `${MILITARY_BASES.length} military installations mapped`);

  setLoadProgress(80, 'INITIALIZING CAMERA DISCOVERY ENGINE...');
  CameraDiscovery.init();
  intelLog('SYS', `Camera discovery: ${CameraDiscovery.sources.length} regional DOT sources configured (US, UK, CA, AU, NL)`);

  setLoadProgress(90, 'SETTING INITIAL VIEW...');
  setInitialCamera();
  await new Promise(r => setTimeout(r, 200));

  setLoadProgress(100, 'SYSTEM ONLINE');
  await new Promise(r => setTimeout(r, 600));

  const ls = document.getElementById('loading-screen');
  ls.classList.add('fade-out');
  setTimeout(() => ls.remove(), 900);

  notify('WORLDVIEW ONLINE — ALL SYSTEMS NOMINAL');
  notify('[1-4] MODE  [A-Z] LANDMARKS  [/] SEARCH  [ESC] DESELECT');
  notify('ZOOM IN + ENABLE CCTV TO DISCOVER LOCAL CAMERAS');
  intelLog('SYS', 'WORLDVIEW online — all subsystems nominal');
  intelLog('SYS', 'Camera discovery armed — zoom into a city and enable CCTV to scan');

  // Auto-enable core layers with staggered loading
  setTimeout(() => toggleLayer('satellites'), 1500);
  setTimeout(() => toggleLayer('flights'),   3500);
  setTimeout(() => toggleLayer('seismic'),   5500);
  setTimeout(() => toggleLayer('iss'),       7000);
  setTimeout(() => toggleLayer('weather'),   8500);
}

boot();
