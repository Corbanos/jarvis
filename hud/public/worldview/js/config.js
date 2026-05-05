// ═══════════════════════════════════════════════════════════════════════════
// WORLDVIEW — CONFIG & EMBEDDED DATA
// ═══════════════════════════════════════════════════════════════════════════

const CONFIG = {
  cesiumToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiI3NzkxNjI5MS0yYTkzLTRmZDUtYTc3NS02NTQ1OTFhOTM0NzMiLCJpZCI6NDEzODg0LCJpYXQiOjE3NzUzNDcwMTh9.F2xAL5RFp0Du6zmLL3kpZdWYOm0tesUpwVsFDyxhtNA',
  googleMapsApiKey: '',
  proxy: 'https://corsproxy.io/?url=',
  flightRefresh:   30000,
  militaryRefresh: 45000,
  seismicRefresh:  120000,
  weatherRefresh:  300000,
  fireRefresh:     180000,
  aqiRefresh:      300000,
  shipRefresh:     60000,
  issRefresh:      5000,
  satPropagateInterval: 2000,
};

// ═══════════════════════════════════════════════════════════════════════════
// LANDMARKS — 35 locations across all continents
// ═══════════════════════════════════════════════════════════════════════════
const LANDMARKS = [
  // North America
  { key:'Q', name:'PENTAGON',         city:'Washington DC',  lon:-77.0558, lat:38.8719, alt:1200,  heading:0,   pitch:-35 },
  { key:'W', name:'EMPIRE STATE',     city:'New York',       lon:-73.9857, lat:40.7484, alt:1000,  heading:-20, pitch:-35 },
  { key:'E', name:'GOLDEN GATE',      city:'San Francisco',  lon:-122.4786,lat:37.8199, alt:1200,  heading:0,   pitch:-30 },
  { key:'R', name:'WHITE HOUSE',      city:'Washington DC',  lon:-77.0365, lat:38.8977, alt:500,   heading:0,   pitch:-40 },
  { key:'T', name:'TIMES SQUARE',     city:'New York',       lon:-73.9855, lat:40.7580, alt:400,   heading:10,  pitch:-35 },
  { key:'Y', name:'AREA 51',          city:'Nevada',         lon:-115.8111,lat:37.2350, alt:8000,  heading:0,   pitch:-45 },
  // Europe
  { key:'U', name:'EIFFEL TOWER',     city:'Paris',          lon:2.2945,   lat:48.8584, alt:800,   heading:30,  pitch:-30 },
  { key:'I', name:'BIG BEN',          city:'London',         lon:-0.1245,  lat:51.5007, alt:500,   heading:10,  pitch:-40 },
  { key:'O', name:'COLOSSEUM',        city:'Rome',           lon:12.4924,  lat:41.8902, alt:800,   heading:-10, pitch:-35 },
  { key:'P', name:'KREMLIN',          city:'Moscow',         lon:37.6173,  lat:55.7520, alt:1000,  heading:20,  pitch:-35 },
  { key:'A', name:'BRANDENBURG GATE', city:'Berlin',         lon:13.3777,  lat:52.5163, alt:600,   heading:0,   pitch:-35 },
  { key:'S', name:'SAGRADA FAMILIA',  city:'Barcelona',      lon:2.1744,   lat:41.4036, alt:600,   heading:0,   pitch:-35 },
  // Middle East
  { key:'D', name:'BURJ KHALIFA',     city:'Dubai',          lon:55.2744,  lat:25.1972, alt:2000,  heading:0,   pitch:-30 },
  { key:'F', name:'MECCA',            city:'Saudi Arabia',   lon:39.8262,  lat:21.4225, alt:2000,  heading:0,   pitch:-35 },
  // Asia
  { key:'G', name:'TOKYO TOWER',      city:'Tokyo',          lon:139.7454, lat:35.6586, alt:800,   heading:0,   pitch:-30 },
  { key:'H', name:'GREAT WALL',       city:'Beijing',        lon:116.5704, lat:40.4319, alt:3000,  heading:0,   pitch:-30 },
  { key:'J', name:'TAJ MAHAL',        city:'Agra',           lon:78.0421,  lat:27.1751, alt:800,   heading:0,   pitch:-30 },
  { key:'K', name:'DMZ',              city:'Korea',          lon:126.6778, lat:37.9500, alt:5000,  heading:0,   pitch:-40 },
  { key:'L', name:'FORBIDDEN CITY',   city:'Beijing',        lon:116.3972, lat:39.9169, alt:1200,  heading:0,   pitch:-35 },
  // Oceania
  { key:'Z', name:'OPERA HOUSE',      city:'Sydney',         lon:151.2153, lat:-33.8568,alt:800,   heading:-40, pitch:-30 },
  // Africa
  { key:'X', name:'PYRAMIDS OF GIZA', city:'Cairo',          lon:31.1342,  lat:29.9792, alt:1500,  heading:0,   pitch:-30 },
  { key:'C', name:'TABLE MOUNTAIN',   city:'Cape Town',      lon:18.4037,  lat:-33.9628,alt:3000,  heading:0,   pitch:-30 },
  // South America
  { key:'V', name:'CHRIST REDEEMER',  city:'Rio de Janeiro', lon:-43.2105, lat:-22.9519,alt:1500,  heading:0,   pitch:-30 },
  { key:'B', name:'MACHU PICCHU',     city:'Peru',           lon:-72.5450, lat:-13.1631,alt:3000,  heading:0,   pitch:-30 },
  // Military/Intel
  { key:'N', name:'CHEYENNE MTN',     city:'Colorado',       lon:-104.8610,lat:38.7443, alt:4000,  heading:0,   pitch:-35 },
  { key:'M', name:'CAMP HUMPHREYS',   city:'South Korea',    lon:127.0200, lat:36.9630, alt:3000,  heading:0,   pitch:-35 },
];

// ═══════════════════════════════════════════════════════════════════════════
// GLOBAL CCTV CAMERAS — Real public traffic camera feeds
// Static list used as initial seeds. loadCCTV() also fetches live camera
// lists from NYC DOT, TfL JamCams, Caltrans, and other open APIs.
// ═══════════════════════════════════════════════════════════════════════════
const CCTV_CAMERAS_STATIC = [
  // NYC DOT (publicly accessible JPEG snapshots via nyctmc.org)
  { id:'nyc01', name:'TIMES SQUARE',        city:'NYC',     lon:-73.9855, lat:40.7580, url:'https://webcams.nyctmc.org/api/cameras/b78de427-3882-465e-9ad1-0e01aef4eff0/image' },
  { id:'nyc02', name:'FDR @ 42ND ST',       city:'NYC',     lon:-73.9712, lat:40.7489, url:'https://webcams.nyctmc.org/api/cameras/e083da4b-690f-44d8-87f7-f13a1e090e33/image' },
  { id:'nyc03', name:'BROOKLYN BRIDGE',      city:'NYC',     lon:-73.9969, lat:40.7061, url:'https://webcams.nyctmc.org/api/cameras/3e5acee6-1b90-4023-b35f-8cf80ec67e56/image' },
  { id:'nyc04', name:'HOLLAND TUNNEL',       city:'NYC',     lon:-74.0110, lat:40.7268, url:'https://webcams.nyctmc.org/api/cameras/f3cb87ac-52b7-4980-8ed9-3e0acf48e1f0/image' },
  { id:'nyc05', name:'GW BRIDGE',            city:'NYC',     lon:-73.9526, lat:40.8517, url:'https://webcams.nyctmc.org/api/cameras/7e6ac7bc-4b8c-4f63-8a63-ef6a3e1948df/image' },
  { id:'nyc06', name:'LINCOLN TUNNEL',       city:'NYC',     lon:-74.0021, lat:40.7627, url:'https://webcams.nyctmc.org/api/cameras/a7c45be4-c4e3-4ef6-a443-96d00f90c2fd/image' },
  { id:'nyc07', name:'QUEENS MIDTOWN',       city:'NYC',     lon:-73.9614, lat:40.7494, url:'https://webcams.nyctmc.org/api/cameras/7e823a4c-7736-4f46-9d7f-9e5d5f5b7c56/image' },
  { id:'nyc08', name:'VERRAZANO BRIDGE',     city:'NYC',     lon:-74.0446, lat:40.6066, url:'https://webcams.nyctmc.org/api/cameras/8db3fd76-3e5c-4a9f-8ae3-a08cbbd7c3b4/image' },
  // London TfL JamCams (publicly accessible S3 snapshots — hundreds available)
  { id:'lon01', name:'TOWER BRIDGE',         city:'London',  lon:-0.0754, lat:51.5055, url:'https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00001.06577.jpg' },
  { id:'lon02', name:'TRAFALGAR SQ',         city:'London',  lon:-0.1276, lat:51.5080, url:'https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00001.01251.jpg' },
  { id:'lon03', name:'PICCADILLY CIRCUS',    city:'London',  lon:-0.1340, lat:51.5100, url:'https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00001.08717.jpg' },
  { id:'lon04', name:'OXFORD CIRCUS',        city:'London',  lon:-0.1419, lat:51.5152, url:'https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00001.01245.jpg' },
  { id:'lon05', name:'WATERLOO BRIDGE',      city:'London',  lon:-0.1170, lat:51.5083, url:'https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00001.03110.jpg' },
  { id:'lon06', name:'WESTMINSTER',          city:'London',  lon:-0.1246, lat:51.4995, url:'https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00001.03129.jpg' },
  { id:'lon07', name:'EMBANKMENT',           city:'London',  lon:-0.1222, lat:51.5069, url:'https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00001.03100.jpg' },
  { id:'lon08', name:'HYDE PARK CORNER',     city:'London',  lon:-0.1526, lat:51.5028, url:'https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00001.01265.jpg' },
  // Chicago (CDOT)
  { id:'chi01', name:'LAKE SHORE DRIVE N',   city:'Chicago', lon:-87.6130, lat:41.9100, url:'https://cwwp2.dot.il.gov/daaborern/images/D01/090-0037.jpg' },
  { id:'chi02', name:'MICHIGAN AVE',         city:'Chicago', lon:-87.6244, lat:41.8862, url:'https://cwwp2.dot.il.gov/daaborern/images/D01/094-0018.jpg' },
  { id:'chi03', name:'I-90/94 @ ADDISON',    city:'Chicago', lon:-87.7170, lat:41.9471, url:'https://cwwp2.dot.il.gov/daaborern/images/D01/090-0058.jpg' },
  { id:'chi04', name:'I-55 @ CICERO',        city:'Chicago', lon:-87.7448, lat:41.7925, url:'https://cwwp2.dot.il.gov/daaborern/images/D01/055-0041.jpg' },
  // Austin TX (austinmobility.io)
  { id:'atx01', name:'6TH & CONGRESS',      city:'Austin',  lon:-97.7431, lat:30.2677, url:'https://cctv.austinmobility.io/image/2.jpg' },
  { id:'atx02', name:'I-35 & 51ST',         city:'Austin',  lon:-97.7215, lat:30.3109, url:'https://cctv.austinmobility.io/image/10.jpg' },
  { id:'atx03', name:'MOPAC & BARTON',      city:'Austin',  lon:-97.7694, lat:30.2500, url:'https://cctv.austinmobility.io/image/15.jpg' },
  { id:'atx04', name:'I-35 & RIVERSIDE',    city:'Austin',  lon:-97.7331, lat:30.2432, url:'https://cctv.austinmobility.io/image/22.jpg' },
  // California — Caltrans (publicly accessible JPEG snapshots)
  { id:'cal01', name:'I-405 @ WILSHIRE',     city:'LA',      lon:-118.4340,lat:34.0595, url:'https://cwwp2.dot.ca.gov/data/d7/cctv/image/i405-nb-wilshire/i405-nb-wilshire.jpg' },
  { id:'cal02', name:'US-101 @ HOLLYWOOD',   city:'LA',      lon:-118.3400,lat:34.1015, url:'https://cwwp2.dot.ca.gov/data/d7/cctv/image/us101-nb-hollywood/us101-nb-hollywood.jpg' },
  { id:'cal03', name:'I-80 BAY BRIDGE',      city:'SF',      lon:-122.3535,lat:37.8158, url:'https://cwwp2.dot.ca.gov/data/d4/cctv/image/i80-bay-bridge-toll/i80-bay-bridge-toll.jpg' },
  { id:'cal04', name:'I-5 @ DOWNTOWN',       city:'San Diego',lon:-117.1628,lat:32.7157, url:'https://cwwp2.dot.ca.gov/data/d11/cctv/image/i5-nb-front/i5-nb-front.jpg' },
  // Georgia DOT
  { id:'gdot01',name:'I-75 @ I-85',          city:'Atlanta', lon:-84.3880, lat:33.7490, url:'https://navigator-c2c.dot.ga.gov/snapshots/CCTV-ATL-014--1.jpg' },
  { id:'gdot02',name:'I-285 @ PEACHTREE',    city:'Atlanta', lon:-84.3694, lat:33.8879, url:'https://navigator-c2c.dot.ga.gov/snapshots/CCTV-ATL-050--1.jpg' },
  // Florida DOT (SunGuide)
  { id:'fl01',  name:'I-95 @ DOWNTOWN',      city:'Miami',   lon:-80.2102, lat:25.7685, url:'https://fl511.com/map/Ede24/camera/8006/image' },
  { id:'fl02',  name:'I-4 @ DOWNTOWN',       city:'Orlando', lon:-81.3789, lat:28.5383, url:'https://fl511.com/map/Ede24/camera/9071/image' },
  // Washington State DOT
  { id:'wa01',  name:'I-5 @ DOWNTOWN',       city:'Seattle', lon:-122.3295,lat:47.6062, url:'https://images.wsdot.wa.gov/nw/005vc06644.jpg' },
  { id:'wa02',  name:'SR-520 BRIDGE',        city:'Seattle', lon:-122.2880,lat:47.6388, url:'https://images.wsdot.wa.gov/nw/520vc00252.jpg' },
  // Texas DOT (Houston)
  { id:'txh01', name:'I-610 @ GALLERIA',     city:'Houston', lon:-95.4613, lat:29.7351, url:'https://its.txdot.gov/ITS_WEB/FrontEnd/snapshots/houston/cctv_164_dmz.jpg' },
  { id:'txh02', name:'I-45 @ DOWNTOWN',      city:'Houston', lon:-95.3630, lat:29.7580, url:'https://its.txdot.gov/ITS_WEB/FrontEnd/snapshots/houston/cctv_001_dmz.jpg' },
  // Denver (COtrip)
  { id:'den01', name:'I-25 @ DOWNTOWN',      city:'Denver',  lon:-104.9903,lat:39.7392, url:'https://www.cotrip.org/dimages/camera?imageURL=remote/CTMCCC-camera-image-I25_University.jpg' },
  // Arizona DOT
  { id:'az01',  name:'I-10 @ DOWNTOWN',      city:'Phoenix', lon:-112.0740,lat:33.4484, url:'https://www.az511.com/map/Cameras/camera/1010/image' },
  // New Jersey DOT
  { id:'nj01',  name:'NJ TURNPIKE @ 14',     city:'Newark',  lon:-74.1745, lat:40.7357, url:'https://511nj.org/data/camera/snapshots/516.jpg' },
  // International — public webcams
  { id:'par01', name:'EIFFEL TOWER',          city:'Paris',   lon:2.2945,   lat:48.8584, url:'https://www.parisphotos.org/webcam/eiffel-tower.jpg' },
  { id:'tok01', name:'SHIBUYA CROSSING',      city:'Tokyo',   lon:139.7005, lat:35.6590, url:'https://cam.shibuya-cam.com/images/shibuya.jpg' },
  { id:'dxb01', name:'BURJ KHALIFA',          city:'Dubai',   lon:55.2744,  lat:25.1972, url:'https://www.earthcam.com/js/image.php?cam=burjkhalifa' },
];

// Live camera API endpoints to fetch additional cameras at runtime
const CCTV_LIVE_APIS = [
  {
    name: 'NYC DOT',
    url: 'https://webcams.nyctmc.org/api/cameras/',
    parser: (data) => (Array.isArray(data) ? data : []).filter(c => c.latitude && c.longitude).map(c => ({
      id: 'nyc_' + (c.id || c.cameraID || Math.random().toString(36).substring(7)),
      name: (c.name || c.cameraName || 'NYC CAM').toUpperCase().substring(0, 30),
      city: 'NYC',
      lon: c.longitude,
      lat: c.latitude,
      url: `https://webcams.nyctmc.org/api/cameras/${c.id || c.cameraID}/image`,
    })),
  },
  {
    name: 'TfL JamCams',
    url: 'https://api.tfl.gov.uk/Place/Type/JamCam',
    parser: (data) => (Array.isArray(data) ? data : []).filter(c => c.lat && c.lon).map(c => ({
      id: 'tfl_' + (c.id || Math.random().toString(36).substring(7)),
      name: (c.commonName || 'LONDON CAM').toUpperCase().substring(0, 30),
      city: 'London',
      lon: c.lon,
      lat: c.lat,
      url: (c.additionalProperties || []).find(p => p.key === 'imageUrl')?.value || `https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/${c.id}.jpg`,
    })),
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// NUCLEAR POWER PLANTS — Global (source: IAEA PRIS)
// ═══════════════════════════════════════════════════════════════════════════
const NUCLEAR_PLANTS = [
  { name:'PALO VERDE',      country:'USA',    lon:-112.862, lat:33.388,  reactors:3, mw:3937 },
  { name:'VOGTLE',           country:'USA',    lon:-81.759,  lat:33.142,  reactors:4, mw:4600 },
  { name:'SOUTH TEXAS',     country:'USA',    lon:-96.048,  lat:28.795,  reactors:2, mw:2700 },
  { name:'DIABLO CANYON',   country:'USA',    lon:-120.856, lat:35.211,  reactors:2, mw:2256 },
  { name:'HINKLEY POINT C', country:'UK',     lon:-3.130,   lat:51.208,  reactors:2, mw:3260 },
  { name:'FLAMANVILLE',     country:'France', lon:-1.881,   lat:49.538,  reactors:3, mw:5200 },
  { name:'GRAVELINES',      country:'France', lon:2.107,    lat:51.015,  reactors:6, mw:5460 },
  { name:'KASHIWAZAKI',     country:'Japan',  lon:138.597,  lat:37.426,  reactors:7, mw:8212 },
  { name:'ZAPORIZHZHIA',    country:'Ukraine',lon:34.588,   lat:47.507,  reactors:6, mw:5700 },
  { name:'BRUCE',           country:'Canada', lon:-81.597,  lat:44.325,  reactors:8, mw:6384 },
  { name:'BARAKAH',         country:'UAE',    lon:52.244,   lat:23.958,  reactors:4, mw:5600 },
  { name:'TAISHAN',         country:'China',  lon:112.986,  lat:21.919,  reactors:2, mw:3500 },
  { name:'KOODANKULAM',     country:'India',  lon:77.713,   lat:8.167,   reactors:2, mw:2000 },
  { name:'KOEBERG',         country:'S.Africa',lon:18.435,  lat:-33.677, reactors:2, mw:1860 },
  { name:'LENINGRAD II',    country:'Russia', lon:29.778,   lat:59.832,  reactors:2, mw:2400 },
  { name:'OLKILUOTO',       country:'Finland',lon:21.447,   lat:61.235,  reactors:3, mw:2860 },
  { name:'RINGHALS',        country:'Sweden', lon:12.113,   lat:57.264,  reactors:3, mw:3956 },
  { name:'DOEL',            country:'Belgium',lon:4.259,    lat:51.326,  reactors:4, mw:2911 },
  { name:'ANGRA',           country:'Brazil', lon:-44.457,  lat:-23.008, reactors:2, mw:1990 },
  { name:'SHIN KORI',       country:'S.Korea',lon:129.338,  lat:35.321,  reactors:4, mw:5600 },
];

// ═══════════════════════════════════════════════════════════════════════════
// MILITARY BASES — Global (publicly known locations)
// ═══════════════════════════════════════════════════════════════════════════
const MILITARY_BASES = [
  // US Bases
  { name:'PENTAGON',               country:'USA',     branch:'DOD HQ',    lon:-77.0558, lat:38.8719 },
  { name:'FORT LIBERTY',           country:'USA',     branch:'ARMY',      lon:-79.0060, lat:35.1390 },
  { name:'CAMP PENDLETON',         country:'USA',     branch:'USMC',      lon:-117.3795,lat:33.2065 },
  { name:'NELLIS AFB',             country:'USA',     branch:'USAF',      lon:-115.0340,lat:36.2360 },
  { name:'NORFOLK NAVAL',          country:'USA',     branch:'USN',       lon:-76.3310, lat:36.9460 },
  { name:'PEARL HARBOR',           country:'USA',     branch:'USN',       lon:-157.9500,lat:21.3540 },
  { name:'DIEGO GARCIA',           country:'UK/US',   branch:'USN/RAF',   lon:72.4110,  lat:-7.3133 },
  { name:'RAMSTEIN AB',            country:'Germany', branch:'USAF',      lon:7.6003,   lat:49.4369 },
  { name:'YOKOSUKA',               country:'Japan',   branch:'USN',       lon:139.6600, lat:35.2833 },
  { name:'CAMP HUMPHREYS',         country:'S.Korea', branch:'ARMY',      lon:127.0200, lat:36.9630 },
  { name:'INCIRLIK AB',            country:'Turkey',  branch:'USAF',      lon:35.4259,  lat:37.0021 },
  { name:'AL UDEID AB',            country:'Qatar',   branch:'USAF',      lon:51.3149,  lat:25.1174 },
  { name:'THULE AB',               country:'Greenland',branch:'USSF',     lon:-68.7030, lat:76.5310 },
  // Russian
  { name:'KALININGRAD',            country:'Russia',  branch:'NAVY',      lon:20.5100,  lat:54.7100 },
  { name:'SEVASTOPOL',             country:'Crimea',  branch:'NAVY',      lon:33.5254,  lat:44.6167 },
  { name:'VLADIVOSTOK',            country:'Russia',  branch:'NAVY',      lon:131.9000, lat:43.1056 },
  { name:'ENGELS-2',               country:'Russia',  branch:'STRAT',     lon:46.2000,  lat:51.4800 },
  // Chinese
  { name:'ZHANJIANG',              country:'China',   branch:'PLAN',      lon:110.3900, lat:21.2710 },
  { name:'DJIBOUTI BASE',          country:'Djibouti',branch:'PLA',       lon:43.1456,  lat:11.5890 },
  { name:'FIERY CROSS REEF',       country:'SCS',     branch:'PLA',       lon:112.8920, lat:9.5500  },
  // Other
  { name:'PINE GAP',               country:'Australia',branch:'SIGINT',   lon:133.7370, lat:-23.7990 },
  { name:'GCHQ CHELTENHAM',        country:'UK',      branch:'SIGINT',    lon:-2.1228,  lat:51.8985 },
  { name:'NSA FORT MEADE',         country:'USA',     branch:'SIGINT',    lon:-76.7714, lat:39.1090 },
  { name:'MOSSAD HQ',              country:'Israel',  branch:'INTEL',     lon:34.8054,  lat:32.1486 },
];

// ═══════════════════════════════════════════════════════════════════════════
// EMBEDDED TLE DATA (20 well-known satellites — fallback if CelesTrak offline)
// ═══════════════════════════════════════════════════════════════════════════
const EMBEDDED_TLES = [
  { name:'ISS (ZARYA)',      l1:'1 25544U 98067A   24001.50000000  .00016717  00000-0  10270-3 0  9993', l2:'2 25544  51.6416  47.9792 0009058  45.2256 315.1044 15.49533519440720' },
  { name:'HUBBLE',           l1:'1 20580U 90037B   24001.50000000  .00000882  00000-0  37660-4 0  9993', l2:'2 20580  28.4697 358.5063 0002521 252.7424 107.3235 15.10218786483710' },
  { name:'NOAA 19',          l1:'1 33591U 09005A   24001.50000000  .00000067  00000-0  63398-4 0  9998', l2:'2 33591  99.1920  54.8003 0013997 332.4793  27.5491 14.12438543768550' },
  { name:'TERRA',            l1:'1 25994U 99068A   24001.50000000  .00000068  00000-0  61800-4 0  9991', l2:'2 25994  98.1987  65.4291 0001361  87.0978 273.0357 14.57125040275046' },
  { name:'AQUA',             l1:'1 27424U 02022A   24001.50000000  .00000063  00000-0  59330-4 0  9994', l2:'2 27424  98.2160  66.7720 0000700  73.8890 286.2397 14.57107940143762' },
  { name:'GPS IIR-11',       l1:'1 27663U 03005A   24001.50000000 -.00000017  00000-0  00000-0 0  9998', l2:'2 27663  55.3900 225.6803 0142250 281.0543  77.5985  2.00567498153320' },
  { name:'GPS IIR-14',       l1:'1 28474U 04045A   24001.50000000 -.00000006  00000-0  00000-0 0  9999', l2:'2 28474  54.9000 285.6803 0142250 280.0543  78.5985  2.00570013121534' },
  { name:'STARLINK-1007',    l1:'1 44713U 19074A   24001.50000000  .00001048  00000-0  72621-4 0  9991', l2:'2 44713  53.0540 357.0940 0001430  82.3960 277.7300 15.06390240224090' },
  { name:'STARLINK-1008',    l1:'1 44714U 19074B   24001.50000000  .00001040  00000-0  72210-4 0  9994', l2:'2 44714  53.0540 357.1030 0001440  82.4000 277.7260 15.06390670224092' },
  { name:'STARLINK-1009',    l1:'1 44715U 19074C   24001.50000000  .00001052  00000-0  72830-4 0  9990', l2:'2 44715  53.0540 357.1120 0001450  82.4040 277.7220 15.06390900224098' },
  { name:'IRIDIUM 100',      l1:'1 41917U 17003E   24001.50000000  .00000082  00000-0  22427-4 0  9990', l2:'2 41917  86.3951 128.7300 0001842  99.1879 260.9483 14.34217817367025' },
  { name:'SENTINEL-1A',      l1:'1 39634U 14016A   24001.50000000 -.00000076  00000-0 -10720-4 0  9997', l2:'2 39634  98.1835  71.5283 0001310  91.9180 268.2158 14.59196602516855' },
  { name:'SENTINEL-2A',      l1:'1 40697U 15028A   24001.50000000 -.00000080  00000-0 -93700-5 0  9999', l2:'2 40697  98.5680  74.9360 0001043  90.2170 269.9140 14.30818559449174' },
  { name:'GOES-16',          l1:'1 41866U 16071A   24001.50000000 -.00000304  00000-0  00000-0 0  9997', l2:'2 41866   0.0520 277.8390 0001340 228.8420  27.9560  1.00270804 26413' },
  { name:'LANDSAT 8',        l1:'1 39084U 13008A   24001.50000000  .00000042  00000-0  21760-4 0  9991', l2:'2 39084  98.2197  66.3498 0001450  95.6040 264.5300 14.57147745575670' },
  { name:'JASON-3',          l1:'1 41240U 16002A   24001.50000000  .00000059  00000-0  35370-4 0  9995', l2:'2 41240  66.0400  42.6800 0008900 288.8100  70.9800 12.80834290381524' },
  { name:'CRYOSAT-2',        l1:'1 36508U 10013A   24001.50000000 -.00000089  00000-0 -53100-5 0  9998', l2:'2 36508  92.0216  80.4490 0001480  96.5400 263.5980 14.52155001727124' },
  { name:'SUOMI NPP',        l1:'1 37849U 11061A   24001.50000000  .00000054  00000-0  44730-4 0  9997', l2:'2 37849  98.7120  55.5900 0001180  83.5400 276.5900 14.19555742627183' },
  { name:'METEOR-M 2',       l1:'1 40069U 14037A   24001.50000000  .00000080  00000-0  57060-4 0  9995', l2:'2 40069  98.5920  84.5400 0001340  77.1000 283.0300 14.20700127499780' },
  { name:'SWARM-A',          l1:'1 39452U 13067A   24001.50000000  .00000087  00000-0  34130-4 0  9991', l2:'2 39452  87.3560  91.4800 0006490 293.7100  66.3400 13.02228456538073' },
];

// ═══════════════════════════════════════════════════════════════════════════
// MAJOR SHIPPING LANES — Waypoints for simulated maritime traffic
// ═══════════════════════════════════════════════════════════════════════════
const SHIPPING_LANES = [
  { name:'SUEZ-GIBRALTAR',      pts:[{lon:32.35,lat:31.25},{lon:25.0,lat:35.0},{lon:15.0,lat:36.5},{lon:5.0,lat:36.0},{lon:-5.35,lat:35.9}] },
  { name:'MALACCA STRAIT',      pts:[{lon:104.0,lat:1.3},{lon:100.0,lat:3.5},{lon:98.0,lat:5.0},{lon:95.0,lat:6.0}] },
  { name:'ENGLISH CHANNEL',     pts:[{lon:1.5,lat:51.0},{lon:0.0,lat:50.7},{lon:-1.5,lat:50.5},{lon:-3.0,lat:50.2}] },
  { name:'PANAMA-CARIBBEAN',    pts:[{lon:-79.5,lat:9.0},{lon:-78.0,lat:10.0},{lon:-75.0,lat:12.0},{lon:-70.0,lat:15.0}] },
  { name:'SOUTH CHINA SEA',     pts:[{lon:114.0,lat:22.3},{lon:112.0,lat:18.0},{lon:110.0,lat:14.0},{lon:108.0,lat:10.0}] },
  { name:'NORTH ATLANTIC',      pts:[{lon:-74.0,lat:40.5},{lon:-50.0,lat:45.0},{lon:-30.0,lat:48.0},{lon:-10.0,lat:50.0}] },
  { name:'CAPE OF GOOD HOPE',   pts:[{lon:18.4,lat:-34.3},{lon:20.0,lat:-35.5},{lon:25.0,lat:-34.0},{lon:30.0,lat:-31.0}] },
  { name:'PERSIAN GULF',        pts:[{lon:56.3,lat:25.5},{lon:54.0,lat:26.0},{lon:52.0,lat:26.5},{lon:50.0,lat:27.0}] },
  { name:'JAPAN-KOREA STRAIT',  pts:[{lon:129.5,lat:33.5},{lon:130.5,lat:34.0},{lon:132.0,lat:34.5},{lon:135.0,lat:34.7}] },
  { name:'BOSPHORUS',           pts:[{lon:29.0,lat:41.0},{lon:29.05,lat:41.05},{lon:29.1,lat:41.1},{lon:29.0,lat:41.2}] },
];

// ═══════════════════════════════════════════════════════════════════════════
// TRAFFIC CITIES
// ═══════════════════════════════════════════════════════════════════════════
const TRAFFIC_CITIES = [
  { name:'LONDON',    lon:-0.0875, lat:51.506, bbox:'51.495,-0.105,51.515,-0.070' },
  { name:'MANHATTAN', lon:-73.987, lat:40.755, bbox:'40.745,-74.005,40.765,-73.970' },
  { name:'SHIBUYA',   lon:139.699, lat:35.659, bbox:'35.650,139.690,35.670,139.710' },
  { name:'PARIS',     lon:2.350,   lat:48.858, bbox:'48.848,2.330,48.868,2.370' },
  { name:'DUBAI',     lon:55.270,  lat:25.197, bbox:'25.187,55.250,25.207,55.290' },
];
