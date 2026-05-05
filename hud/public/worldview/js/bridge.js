// ═══════════════════════════════════════════════════════════════════════════
// JARVIS BRIDGE — postMessage protocol so the parent HUD can drive Worldview.
// Commands accepted:
//   { type: 'worldview:focus', lat, lon, name?, alt?, pitch? }
//   { type: 'worldview:layer', name, enable }    // name in layers object
//   { type: 'worldview:layers', layers: { name: bool, ... } }   // bulk
//   { type: 'worldview:mode', mode: 'normal'|'nvg'|'flir'|'crt' }
//   { type: 'worldview:state' }                  // request current state
//
// Emits:
//   { type: 'worldview:ready' }                  on boot
//   { type: 'worldview:state', layers, mode, ... } on demand or change
// ═══════════════════════════════════════════════════════════════════════════

(function () {
  function post(msg) {
    try { window.parent.postMessage(msg, '*'); } catch (e) {}
  }

  function snapshotState() {
    const out = { type: 'worldview:state', layers: {}, mode: (typeof currentMode !== 'undefined' ? currentMode : 'normal') };
    if (typeof layers === 'object' && layers) {
      for (const k of Object.keys(layers)) out.layers[k] = !!layers[k].on;
    }
    return out;
  }

  function flyTo(lat, lon, name, alt, pitch) {
    if (typeof viewer === 'undefined' || !viewer) return;
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(lon, lat, alt || 1500000),
      orientation: { heading: 0, pitch: Cesium.Math.toRadians(pitch ?? -55), roll: 0 },
      duration: 1.8,
    });
    if (typeof notify === 'function') notify((name || `${lat.toFixed(2)}, ${lon.toFixed(2)}`).toUpperCase());
    if (typeof intelLog === 'function') intelLog('NAV', `Focus: ${name || lat + ',' + lon}`);
  }

  function setLayerEnabled(name, enable) {
    if (typeof layers !== 'object' || !layers || !layers[name]) return false;
    const isOn = !!layers[name].on;
    if (isOn !== !!enable) {
      try { toggleLayer(name); } catch (e) { console.warn('toggleLayer fail', name, e); return false; }
    }
    return true;
  }

  window.addEventListener('message', function (e) {
    const data = e.data;
    if (!data || typeof data !== 'object') return;
    switch (data.type) {
      case 'worldview:focus':
        if (typeof data.lat === 'number' && typeof data.lon === 'number') {
          flyTo(data.lat, data.lon, data.name, data.alt, data.pitch);
        }
        break;
      case 'worldview:layer':
        if (data.name) {
          setLayerEnabled(data.name, !!data.enable);
          post(snapshotState());
        }
        break;
      case 'worldview:layers':
        if (data.layers && typeof data.layers === 'object') {
          for (const k of Object.keys(data.layers)) setLayerEnabled(k, !!data.layers[k]);
          post(snapshotState());
        }
        break;
      case 'worldview:mode':
        if (typeof setMode === 'function' && data.mode) {
          try { setMode(data.mode); } catch (err) {}
          post(snapshotState());
        }
        break;
      case 'worldview:state':
        post(snapshotState());
        break;
    }
  });

  // Announce ready when Cesium boot completes
  function announceReady() {
    if (typeof viewer !== 'undefined' && viewer) {
      post({ type: 'worldview:ready' });
      post(snapshotState());
    } else {
      setTimeout(announceReady, 500);
    }
  }
  announceReady();
})();
