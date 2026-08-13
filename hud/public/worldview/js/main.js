// ═══════════════════════════════════════════════════════════════════════════
// WORLDVIEW — BOOT SEQUENCE & KEYBOARD BINDINGS
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// KEYBOARD SHORTCUTS
// ═══════════════════════════════════════════════════════════════════════════
// Keyboard shortcuts disabled — controlled by parent HUD via postMessage.

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

  // Camera is now parked at the default view. Only from here is it safe for
  // the bridge to replay queued parent commands — anything it flew to earlier
  // would be overwritten by setInitialCamera() above.
  window.WORLDVIEW_BOOTED = true;

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

  // No auto layers — the parent HUD enables them via postMessage.
}

boot();
