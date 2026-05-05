// ═══════════════════════════════════════════════════════════════════════════
// WORLDVIEW — CESIUM ENGINE, POST-PROCESSING, MODES
// ═══════════════════════════════════════════════════════════════════════════

let viewer, scene;
let postCRT, postNVG, postFLIR, postBloom;
let currentMode = 'normal';

async function initCesium() {
  Cesium.Ion.defaultAccessToken = CONFIG.cesiumToken;

  viewer = new Cesium.Viewer('cesiumContainer', {
    animation:        false,
    baseLayerPicker:  false,
    fullscreenButton: false,
    geocoder:         false,
    homeButton:       false,
    infoBox:          false,
    sceneModePicker:  false,
    selectionIndicator: false,
    timeline:         false,
    navigationHelpButton: false,
    creditContainer:  document.createElement('div'),
    terrainProvider:  await Cesium.CesiumTerrainProvider.fromIonAssetId(1),
  });

  scene = viewer.scene;
  scene.globe.enableLighting = true;
  scene.globe.dynamicAtmosphereLighting = true;
  scene.skyAtmosphere.show = true;
  scene.globe.showGroundAtmosphere = true;
  scene.skyAtmosphere.hueShift = 0.0;
  scene.skyAtmosphere.saturationShift = -0.1;

  // Cesium OSM Buildings — free 3D building tileset (worldwide)
  try {
    const osmBuildings = await Cesium.Cesium3DTileset.fromIonAssetId(96188);
    osmBuildings.style = new Cesium.Cesium3DTileStyle({
      color: {
        conditions: [
          ['true', "color('rgba(40, 80, 50, 0.75)')"],
        ],
      },
    });
    viewer.scene.primitives.add(osmBuildings);
  } catch (e) {
    // OSM Buildings unavailable — continue without
  }

  // Google 3D Tiles if key provided (higher quality, needs API key)
  if (CONFIG.googleMapsApiKey) {
    try {
      const tileset = await Cesium.Cesium3DTileset.fromUrl(
        `https://tile.googleapis.com/v1/3dtiles/root.json?key=${CONFIG.googleMapsApiKey}`
      );
      viewer.scene.primitives.add(tileset);
      notify('GOOGLE 3D TILES LOADED');
    } catch (e) {
      notify('GOOGLE 3D TILES UNAVAILABLE', 'warn');
    }
  }

  // Camera change → update coords
  viewer.camera.changed.addEventListener(() => {
    const pos = viewer.camera.positionCartographic;
    if (pos) {
      const lat = Cesium.Math.toDegrees(pos.latitude).toFixed(6);
      const lon = Cesium.Math.toDegrees(pos.longitude).toFixed(6);
      const alt = Math.round(pos.height).toLocaleString();
      document.getElementById('coords').textContent =
        `LAT: ${lat} | LON: ${lon} | ALT: ${alt}m`;
    }
  });

  // Entity click
  viewer.screenSpaceEventHandler.setInputAction(e => {
    const picked = viewer.scene.pick(e.position);
    if (picked && picked.id) {
      selectEntity(picked.id);
    } else {
      deselectEntity();
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  setupPostProcessing();
}

// ═══════════════════════════════════════════════════════════════════════════
// GLSL POST-PROCESSING SHADERS
// ═══════════════════════════════════════════════════════════════════════════
function setupPostProcessing() {
  // CRT
  postCRT = new Cesium.PostProcessStage({
    fragmentShader: `
      uniform sampler2D colorTexture;
      in vec2 v_textureCoordinates;
      uniform float u_curvature;
      uniform float u_scanlines;
      uniform float u_time;
      vec2 crtCurve(vec2 uv, float c) {
        uv = (uv - 0.5) * 2.0;
        uv *= 1.0 + dot(uv.yx, uv.yx) * c;
        return uv * 0.5 + 0.5;
      }
      float rand(vec2 co) {
        return fract(sin(dot(co, vec2(12.9898,78.233))) * 43758.5453);
      }
      void main() {
        vec2 uv = crtCurve(v_textureCoordinates, u_curvature);
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
          out_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return;
        }
        float ab = 0.0015;
        vec4 col;
        col.r = texture(colorTexture, uv + vec2(ab, 0.0)).r;
        col.g = texture(colorTexture, uv).g;
        col.b = texture(colorTexture, uv - vec2(ab, 0.0)).b;
        col.a = 1.0;
        col.rgb = mix(col.rgb, vec3(dot(col.rgb, vec3(0.3,0.6,0.1))), 0.5);
        col.r *= 1.3; col.g *= 0.9; col.b *= 0.3;
        float sl = sin(uv.y * 900.0) * 0.5 + 0.5;
        col.rgb *= mix(1.0, sl, u_scanlines * 0.08);
        col.rgb += rand(uv + fract(u_time * 0.01)) * 0.02;
        vec2 vig = uv * (1.0 - uv.yx);
        float v = pow(clamp(vig.x * vig.y * 16.0, 0.0, 1.0), 0.4);
        col.rgb *= v;
        out_FragColor = col;
      }
    `,
    uniforms: {
      u_curvature: 0.08,
      u_scanlines: 5.0,
      u_time: () => performance.now() * 0.001,
    },
  });
  postCRT.enabled = false;
  scene.postProcessStages.add(postCRT);

  // NVG
  postNVG = new Cesium.PostProcessStage({
    fragmentShader: `
      uniform sampler2D colorTexture;
      in vec2 v_textureCoordinates;
      uniform float u_time;
      uniform float u_brightness;
      float rand(vec2 co) {
        return fract(sin(dot(co, vec2(12.9898,78.233))) * 43758.5453);
      }
      void main() {
        vec4 col = texture(colorTexture, v_textureCoordinates);
        float luma = dot(col.rgb, vec3(0.3, 0.59, 0.11));
        float amp = pow(luma, 0.6) * u_brightness;
        amp = clamp(amp, 0.0, 1.0);
        vec3 nvg = mix(vec3(0.0, 0.02, 0.0), vec3(0.35, 1.0, 0.25), amp);
        nvg += vec3(0.0, 0.05, 0.0);
        float noise = rand(v_textureCoordinates + fract(u_time * 0.05)) * 0.05;
        nvg += noise;
        vec2 vig = v_textureCoordinates * (1.0 - v_textureCoordinates.yx);
        float v = pow(clamp(vig.x * vig.y * 14.0, 0.0, 1.0), 0.5);
        nvg *= v;
        if (luma > 0.85) nvg = mix(nvg, vec3(0.8, 1.0, 0.8), (luma - 0.85) * 3.0);
        out_FragColor = vec4(nvg, 1.0);
      }
    `,
    uniforms: {
      u_time: () => performance.now() * 0.001,
      u_brightness: 1.6,
    },
  });
  postNVG.enabled = false;
  scene.postProcessStages.add(postNVG);

  // FLIR
  postFLIR = new Cesium.PostProcessStage({
    fragmentShader: `
      uniform sampler2D colorTexture;
      in vec2 v_textureCoordinates;
      uniform float u_time;
      vec3 ironPalette(float t) {
        t = clamp(t, 0.0, 1.0);
        vec3 cold = vec3(0.02, 0.02, 0.15);
        vec3 mid1 = vec3(0.5, 0.0, 0.5);
        vec3 mid2 = vec3(0.9, 0.3, 0.0);
        vec3 hot = vec3(1.0, 1.0, 0.9);
        if (t < 0.33) return mix(cold, mid1, t / 0.33);
        if (t < 0.66) return mix(mid1, mid2, (t - 0.33) / 0.33);
        return mix(mid2, hot, (t - 0.66) / 0.34);
      }
      float rand(vec2 co) {
        return fract(sin(dot(co, vec2(12.9898,78.233))) * 43758.5453);
      }
      void main() {
        vec4 col = texture(colorTexture, v_textureCoordinates);
        float luma = dot(col.rgb, vec3(0.3, 0.59, 0.11));
        vec2 px = vec2(1.0/1920.0, 1.0/1080.0);
        float e = 0.0;
        e += dot(texture(colorTexture, v_textureCoordinates + vec2(-px.x,-px.y)).rgb, vec3(0.3,0.59,0.11));
        e += dot(texture(colorTexture, v_textureCoordinates + vec2( px.x,-px.y)).rgb, vec3(0.3,0.59,0.11));
        e += dot(texture(colorTexture, v_textureCoordinates + vec2(-px.x, px.y)).rgb, vec3(0.3,0.59,0.11));
        e += dot(texture(colorTexture, v_textureCoordinates + vec2( px.x, px.y)).rgb, vec3(0.3,0.59,0.11));
        float edge = abs(luma * 4.0 - e);
        float thermal = clamp(luma * 1.5 + edge * 0.3, 0.0, 1.0);
        vec3 flir = ironPalette(thermal);
        flir += rand(v_textureCoordinates + fract(u_time * 0.03)) * 0.015;
        vec2 vig = v_textureCoordinates * (1.0 - v_textureCoordinates.yx);
        float v = pow(clamp(vig.x * vig.y * 14.0, 0.0, 1.0), 0.4);
        flir *= v;
        out_FragColor = vec4(flir, 1.0);
      }
    `,
    uniforms: { u_time: () => performance.now() * 0.001 },
  });
  postFLIR.enabled = false;
  scene.postProcessStages.add(postFLIR);

  // Bloom
  postBloom = new Cesium.PostProcessStage({
    fragmentShader: `
      uniform sampler2D colorTexture;
      in vec2 v_textureCoordinates;
      uniform float u_strength;
      void main() {
        vec4 col = texture(colorTexture, v_textureCoordinates);
        float bright = dot(col.rgb, vec3(0.3, 0.59, 0.11));
        vec4 bloom = col * max(0.0, bright - 0.6) * u_strength;
        out_FragColor = clamp(col + bloom, 0.0, 1.5);
      }
    `,
    uniforms: { u_strength: 3.0 },
  });
  postBloom.enabled = true;
  scene.postProcessStages.add(postBloom);
}

// ═══════════════════════════════════════════════════════════════════════════
// MODE SWITCHING
// ═══════════════════════════════════════════════════════════════════════════
function setMode(mode) {
  currentMode = mode;
  postCRT.enabled  = (mode === 'crt');
  postNVG.enabled  = (mode === 'nvg');
  postFLIR.enabled = (mode === 'flir');

  const overlay = document.getElementById('filter-overlay');
  overlay.className = mode === 'nvg' ? 'nvg' : '';

  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });

  const labels = { normal:'NORMAL MODE', nvg:'NIGHT VISION ACTIVE', flir:'FLIR THERMAL ACTIVE', crt:'CRT MODE ACTIVE' };
  notify(labels[mode] || mode.toUpperCase());
}

// ═══════════════════════════════════════════════════════════════════════════
// DISPLAY CONTROLS
// ═══════════════════════════════════════════════════════════════════════════
function setScanlineIntensity(val) {
  document.documentElement.style.setProperty('--scanline-opacity', val * 0.008);
  if (postCRT) postCRT.uniforms.u_scanlines = parseFloat(val);
}
function setBloom(val) {
  if (postBloom) postBloom.uniforms.u_strength = parseFloat(val) * 0.8;
}

function setInitialCamera() {
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(0, 20, 15000000),
    orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
  });
}
