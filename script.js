(() => {
  'use strict';

  // ---------- Scene constants (logical canvas units) ----------
  const W = 960, H = 540;
  const GROUND = 462;      // y of the ground line
  const CLOUD = 104;       // y of the cloud base
  const SPEED = 175;       // tornado travel speed, px/s
  const GRAV = 520;
  const OBJ_X = 620;       // where the object stands
  const START_X = 140;     // where the tornado waits
  const TAU = Math.PI * 2;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- Data ----------
  const EF = [
    { mph: '65–85',    kmh: '105–137', label: 'Light' },
    { mph: '86–110',   kmh: '138–177', label: 'Moderate' },
    { mph: '111–135',  kmh: '178–217', label: 'Considerable' },
    { mph: '136–165',  kmh: '218–266', label: 'Severe' },
    { mph: '166–200',  kmh: '267–322', label: 'Devastating' },
    { mph: 'Over 200', kmh: 'over 322', label: 'Incredible' },
  ];

  const SEV = [
    { name: 'Minor',        color: '#e8d46a', ink: '#2a2305' },
    { name: 'Moderate',     color: '#efb04a', ink: '#2c1b02' },
    { name: 'Considerable', color: '#e98740', ink: '#2c1203' },
    { name: 'Severe',       color: '#dc573b', ink: '#1c0804' },
    { name: 'Devastating',  color: '#b73a4f', ink: '#ffffff' },
    { name: 'Total',        color: '#7f2a6e', ink: '#ffffff' },
  ];

  // Shape helpers. Coordinates are local to the object: x = 0 is its center,
  // y = 0 is the ground, negative y is up. `detach` is the lowest EF level
  // that tears the part off (99 = never).
  function R(cx, cy, w, h, color, detach = 99, o = {}) {
    return { shape: 'rect', cx, cy, w, h, color, detach, ...base(o) };
  }
  function C(cx, cy, r, color, detach = 99, o = {}) {
    return { shape: 'circle', cx, cy, r, color, detach, ...base(o) };
  }
  function E(cx, cy, rx, ry, color, detach = 99, o = {}) {
    return { shape: 'ellipse', cx, cy, rx, ry, color, detach, ...base(o) };
  }
  function Wheel(cx, cy, r, detach = 99, o = {}) {
    return { shape: 'wheel', cx, cy, r, color: '#1c1c1e', detach, ...base(o) };
  }
  function P(pts, color, detach = 99, o = {}) {
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    return { shape: 'poly', cx, cy, pts: pts.map(([x, y]) => [x - cx, y - cy]), color, detach, ...base(o) };
  }
  function base(o) {
    return { rot: o.rot || 0, mass: o.mass || 1, id: o.id, on: o.on, hole: o.hole, stroke: o.stroke };
  }

  function shingles() {
    const out = [];
    const slopes = [
      { a: [-122, -110], b: [0, -182], n: [-0.5, -0.866] },
      { a: [0, -182], b: [122, -110], n: [0.5, -0.866] },
    ];
    slopes.forEach((s, si) => {
      const dx = s.b[0] - s.a[0], dy = s.b[1] - s.a[1];
      const rot = Math.atan2(dy, dx);
      for (let i = 0; i < 5; i++) {
        const t = 0.12 + i * 0.19;
        out.push(R(s.a[0] + dx * t + s.n[0] * 4, s.a[1] + dy * t + s.n[1] * 4, 26, 7,
          i % 2 ? '#3b2a24' : '#4a352c', (i + si) % 2 ? 1 : 0, { rot, mass: 0.35 }));
      }
    });
    return out;
  }

  // A thin strip laid along the line from a to b (roof edges, trim).
  function strip(a, b, thick, color, detach, o = {}) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    return R((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.hypot(dx, dy), thick, color, detach,
      { ...o, rot: Math.atan2(dy, dx) });
  }

  function hash(a, b, s) {
    const x = Math.sin(a * 127.1 + b * 311.7 + s * 74.7) * 43758.5453;
    return x - Math.floor(x);
  }
  // frac[i] = share of items gone by EF i. Returns the EF level that removes this item.
  function levelFor(r, frac) {
    for (let i = 0; i < frac.length; i++) if (r < frac[i]) return i;
    return 99;
  }

  // Builds a multi-story building. Each floor has a dark inside with a frame
  // (columns + slab), an outer wall on top of that, and windows on the wall.
  function makeBuilding(o) {
    const N = o.floors, SH = 60, BASE = 6, width = o.width, bays = o.bays;
    const bw = width / bays;
    const lowBias = o.lowBias || 0;
    const up = (f) => (N > 1 ? f / (N - 1) : 0);
    const glassAt = (f, b) => levelFor(hash(f, b, o.seed) * (1 - lowBias) + lowBias * up(f), o.glassFrac);
    const facadeAt = o.facadeAt || ((f, b) => levelFor(hash(f, b + 100, o.seed) * (1 - lowBias) + lowBias * up(f), o.facadeFrac));
    const floorAt = o.floorAt || (() => 99);
    const parts = [R(0, -BASE / 2, width + 24, BASE, '#777777')];

    for (let f = 0; f < N; f++) {
      const yb = -BASE - f * SH, mid = yb - SH / 2, gone = floorAt(f);
      // One chunk per bay, so pieces break off at a sensible size.
      for (let b = 0; b < bays; b++) {
        const x = -width / 2 + bw * (b + 0.5);
        const sk = `sk${f}_${b}`, fa = `fa${f}_${b}`;
        parts.push(R(x, mid, bw, SH, '#1e2227', gone, { id: sk, mass: 2 }));
        parts.push(R(x, yb - 2, bw, 4, '#8f949b', gone, { on: sk, mass: 1 }));
        parts.push(R(x - bw / 2 + 3, mid, 6, SH, '#8f949b', gone, { on: sk, mass: 1 }));
        if (b === bays - 1) parts.push(R(x + bw / 2 - 3, mid, 6, SH, '#8f949b', gone, { on: sk, mass: 1 }));
        parts.push(R(x, mid, bw, SH, o.wall, facadeAt(f, b), { id: fa, on: sk, mass: 1.6, stroke: 'rgba(0,0,0,.14)' }));
        if (f === 0 && b === Math.floor(bays / 2)) {
          parts.push(R(x, yb - SH * 0.36, bw * 0.6, SH * 0.72, o.door || '#3d4a57', 2, { on: fa, hole: '#15181c', mass: 0.8 }));
        } else {
          parts.push(R(x, mid - SH * 0.04, bw * o.winW, SH * o.winH, o.glass, glassAt(f, b), { on: fa, hole: '#15181c', mass: 0.3 }));
        }
      }
    }

    const top = -BASE - N * SH;
    const topSk = (x) => `sk${N - 1}_${Math.min(bays - 1, Math.max(0, Math.floor((x + width / 2) / bw)))}`;
    for (let b = 0; b < bays; b++) {
      const x = -width / 2 + bw * (b + 0.5);
      parts.push(R(x, top - 5, bw, 10, o.trim, o.parapet[b % o.parapet.length], { on: topSk(x), mass: 0.6, stroke: 'rgba(0,0,0,.15)' }));
    }
    parts.push(R(width * 0.22, top - 22, Math.min(70, width * 0.2), 24, '#9aa1a8', o.hvacAt, { on: topSk(width * 0.22), mass: 1.2 }));
    let h = N * SH + BASE + 34;
    if (o.antennaAt != null) {
      parts.push(R(-width * 0.18, top - 70, 5, 130, '#b9bec4', o.antennaAt, { on: topSk(-width * 0.18), mass: 0.8 }));
      h += 100;
    }
    return { parts, h, halfW: width / 2 + 12, hC: h / 2, scale: Math.min(1, 330 / h), shakeK: 0.25 };
  }

  const OBJECTS = [
    {
      id: 'car', name: 'Car', h: 72, halfW: 77, hC: 36,
      fact: 'A family car weighs about 1,500 kg (3,300 lb).',
      bits: ['#cfe8f7', '#d6453d', '#9aa0a6'],
      motions: ['shake', 'slide', 'lift', 'fly', 'fly', 'fly'],
      sev: [0, 1, 2, 3, 4, 5],
      effects: [
        ['Rocked', 'The car rocks on its springs and loose things blow away. It stays put.'],
        ['Pushed', 'Flying debris can break the windows. A moving car can be shoved off the road.'],
        ['Lifted', 'Cars get lifted off the ground and flipped or rolled several meters.'],
        ['Thrown', 'Cars are picked up and thrown. Even heavy trucks can be tipped over.'],
        ['Tossed far', 'Cars are thrown long distances and crushed like tin cans.'],
        ['Flying missile', 'Car-sized objects fly through the air for more than 100 m (300 ft).'],
      ],
      parts: [
        P([[-48, -45], [-30, -72], [28, -72], [50, -45]], '#b8362f', 99, { id: 'cabin' }),
        P([[-40, -48], [-26, -68], [-3, -68], [-3, -48]], '#a9d8f2', 1, { on: 'cabin', hole: '#2b3038', mass: 0.3 }),
        P([[3, -48], [3, -68], [25, -68], [42, -48]], '#a9d8f2', 1, { on: 'cabin', hole: '#2b3038', mass: 0.3 }),
        P([[-76, -16], [-76, -38], [-58, -46], [62, -46], [76, -36], [76, -16]], '#d6453d', 99),
        R(0, -31, 1.5, 28, 'rgba(0,0,0,.28)'),
        R(10, -38, 8, 2.5, '#7a1f1a'),
        R(-74, -36, 4, 7, '#ff5a4e', 2, { mass: 0.2 }),
        C(71, -39, 4, '#ffe7a0', 2, { mass: 0.2 }),
        R(38, -50, 7, 4, '#b8362f', 1, { mass: 0.2 }),
        R(77, -22, 6, 10, '#9aa0a6', 3, { mass: 0.6 }),
        R(-77, -22, 6, 10, '#9aa0a6', 3, { mass: 0.6 }),
        Wheel(-46, -15, 15, 4, { mass: 1.2 }),
        Wheel(48, -15, 15, 4, { mass: 1.2 }),
      ],
    },
    {
      id: 'truck', name: 'Semi truck', short: 'Truck', h: 125, halfW: 155, hC: 60, scale: 0.85,
      fact: 'A semi truck with an empty trailer weighs about 15,000 kg (33,000 lb). Its big flat sides catch the wind like a sail.',
      bits: ['#cfe8f7', '#eceff2', '#2f6db5', '#9aa0a6'],
      motions: ['shake', { m: 'lift', h: 30, d: 40 }, { m: 'lift', h: 90, d: 110 }, { m: 'lift', h: 170, d: 200 }, 'fly', 'fly'],
      sev: [0, 2, 3, 4, 5, 5],
      effects: [
        ['Swaying', 'An empty trailer sways, and the driver struggles to stay in the lane.'],
        ['Blown over', 'Tall trucks with empty trailers get blown over on the highway.'],
        ['Rolled', 'Even loaded trucks roll over. Trailers get ripped open.'],
        ['Thrown', 'Heavy trucks are lifted and thrown. Trailers are torn apart.'],
        ['Tossed', 'Semi trucks are tossed through the air and wrecked.'],
        ['Shredded', 'Trucks are thrown far and torn into pieces.'],
      ],
      parts: [
        R(-45, -70, 210, 100, '#3a3f46', 99, { id: 'trailer' }),
        R(-115, -70, 70, 100, '#eceff2', 2, { id: 'tp1', on: 'trailer', mass: 1, stroke: 'rgba(0,0,0,.15)' }),
        R(-45, -70, 70, 100, '#e4e8ec', 3, { id: 'tp2', on: 'trailer', mass: 1, stroke: 'rgba(0,0,0,.15)' }),
        R(25, -70, 70, 100, '#eceff2', 2, { id: 'tp3', on: 'trailer', mass: 1, stroke: 'rgba(0,0,0,.15)' }),
        R(-115, -44, 70, 8, '#2f6db5', 99, { on: 'tp1' }),
        R(-45, -44, 70, 8, '#2f6db5', 99, { on: 'tp2' }),
        R(25, -44, 70, 8, '#2f6db5', 99, { on: 'tp3' }),
        R(-45, -18, 210, 5, '#555555'),
        R(20, -10, 5, 16, '#444444'),
        R(105, -24, 100, 8, '#444444'),
        P([[64, -22], [64, -100], [110, -100], [120, -80], [150, -70], [150, -22]], '#2f6db5', 99, { id: 'cab' }),
        P([[100, -94], [110, -94], [118, -78], [100, -78]], '#a9d8f2', 1, { on: 'cab', hole: '#2b3038', mass: 0.3 }),
        R(98, -28, 30, 10, '#bfc4c9', 3, { mass: 0.8 }),
        R(70, -112, 5, 30, '#b0b4b8', 3, { mass: 0.5 }),
        R(148, -48, 5, 22, '#9aa0a6', 3, { mass: 0.4 }),
        C(146, -32, 3.5, '#ffe7a0', 2, { mass: 0.2 }),
        R(152, -22, 8, 8, '#b0b4b8', 3, { mass: 0.5 }),
        Wheel(-128, -14, 14, 4, { mass: 1.2 }),
        Wheel(-98, -14, 14, 4, { mass: 1.2 }),
        Wheel(84, -14, 14, 4, { mass: 1.2 }),
        Wheel(132, -14, 14, 4, { mass: 1.2 }),
      ],
    },
    {
      id: 'bus', name: 'School bus', short: 'Bus', h: 125, halfW: 155, hC: 62, scale: 0.85,
      fact: 'A school bus weighs about 11,000 kg (24,000 lb). Its tall, flat side lets the wind push hard on it.',
      bits: ['#cfe8f7', '#f2b705', '#222222'],
      motions: ['shake', { m: 'lift', h: 30, d: 40 }, { m: 'lift', h: 80, d: 100 }, { m: 'lift', h: 170, d: 200 }, 'fly', 'fly'],
      sev: [0, 2, 3, 4, 5, 5],
      effects: [
        ['Rocking', 'The wind shoves on the big flat side. The bus rocks hard but stays up.'],
        ['Tipped over', 'An empty bus can be blown over onto its side.'],
        ['Rolled', 'Buses roll over and their windows shatter.'],
        ['Thrown', 'Buses are lifted and thrown, sometimes onto buildings.'],
        ['Tossed', 'Buses are thrown long distances and crushed.'],
        ['Shredded', 'Buses are thrown far and torn into pieces.'],
      ],
      parts: [
        P([[-150, -22], [-150, -116], [-142, -122], [110, -122], [118, -110], [118, -62], [150, -56], [150, -22]], '#f2b705', 99, { id: 'bus' }),
        R(-16, -60, 262, 4, '#222222', 99, { on: 'bus' }),
        R(-16, -48, 262, 3, '#222222', 99, { on: 'bus' }),
        ...Array.from({ length: 8 }, (_, i) =>
          R(-134 + i * 28, -96, 22, 26, '#a9d8f2', i % 3 === 0 ? 1 : 2, { on: 'bus', hole: '#2b3038', mass: 0.3 })),
        R(100, -58, 18, 68, '#2b3038', 2, { on: 'bus', mass: 0.8 }),
        R(100, -98, 14, 22, '#a9d8f2', 1, { on: 'bus', hole: '#2b3038', mass: 0.3 }),
        P([[111, -118], [117, -110], [117, -70], [111, -70]], '#a9d8f2', 1, { on: 'bus', hole: '#2b3038', mass: 0.3 }),
        C(84, -74, 7, '#d32f2f', 1, { mass: 0.3 }),
        R(-40, -124, 30, 4, '#d9a404', 1, { mass: 0.4 }),
        C(-146, -108, 3.5, '#ff5a4e', 2, { mass: 0.2 }),
        C(146, -38, 4, '#ffe7a0', 2, { mass: 0.2 }),
        R(153, -26, 6, 10, '#333333', 3, { mass: 0.5 }),
        R(-153, -26, 6, 10, '#333333', 3, { mass: 0.5 }),
        Wheel(-100, -16, 16, 4, { mass: 1.2 }),
        Wheel(88, -16, 16, 4, { mass: 1.2 }),
      ],
    },
    {
      id: 'cow', name: 'Cow', h: 92, halfW: 82, hC: 50,
      fact: 'A dairy cow weighs about 600 kg (1,300 lb).',
      bits: ['#8a6f4e', '#6b5a44', '#a08a66'],
      motions: ['shake', 'tumble', 'lift', 'fly', 'fly', 'fly'],
      sev: [1, 2, 3, 4, 5, 5],
      effects: [
        ['Struggling', 'Hard to stay standing. The cow turns its back to the wind and hunkers down.'],
        ['Knocked over', 'Cows get knocked off their feet and can be hurt by flying boards and metal.'],
        ['Lifted', 'Even a 600 kg cow can be lifted and dropped nearby. Farmers have found cattle moved across fields.'],
        ['Carried away', 'Livestock can be carried hundreds of meters away from the herd.'],
        ['Airborne', 'Whole barns, and the animals in them, are swept into the air.'],
        ['Swept away', 'Nothing on the farm stays in place: animals, barns and fences are all gone.'],
      ],
      parts: [
        R(-26, -20, 9, 34, '#d9d3c6'),
        R(38, -20, 9, 34, '#d9d3c6'),
        R(-26, -2, 10, 5, '#3a3330'),
        R(38, -2, 10, 5, '#3a3330'),
        R(-60, -56, 3, 28, '#e5e0d4', 99, { rot: 0.25 }),
        E(-64, -42, 4, 6, '#2b2b2b'),
        E(0, -58, 56, 24, '#f7f4ee'),
        E(-20, -64, 15, 10, '#2b2b2b', 99, { rot: -0.3 }),
        E(18, -52, 12, 8, '#2b2b2b', 99, { rot: 0.4 }),
        E(-42, -50, 7, 6, '#2b2b2b'),
        E(16, -36, 9, 5, '#efb3bd'),
        R(-38, -20, 9, 34, '#f4f1ea'),
        R(26, -20, 9, 34, '#f4f1ea'),
        R(-38, -2, 10, 5, '#3a3330'),
        R(26, -2, 10, 5, '#3a3330'),
        E(50, -80, 8, 3.5, '#f0ece2', 99, { rot: -0.4 }),
        R(60, -85, 3, 9, '#e6d6a5', 99, { rot: 0.4 }),
        E(64, -70, 16, 12, '#f7f4ee', 99, { rot: 0.35 }),
        E(66, -74, 5, 4, '#2b2b2b'),
        E(76, -63, 8, 7, '#efb3bd', 99, { rot: 0.35 }),
        C(80, -62, 1.5, '#7a4a50'),
        C(62, -74, 2.2, '#111111'),
      ],
    },
    {
      id: 'house', name: 'House', h: 182, halfW: 122, hC: 90,
      fact: 'A wood-frame family home. Well built, but not a storm shelter.',
      bits: ['#c9b28a', '#7a5a44', '#3b2a24', '#a9d8f2'],
      motions: ['shake', 'shake', 'shake', 'shake', 'shake', 'shake'],
      sev: [0, 1, 2, 3, 4, 5],
      effects: [
        ['Shingles off', 'Some shingles and gutters peel away. Siding may get damaged.'],
        ['Roof stripped', 'The roof is badly stripped, windows break and doors get pushed in.'],
        ['Roof torn off', 'The whole roof comes off. Mobile homes are destroyed.'],
        ['Walls collapse', 'Whole floors are destroyed. Only small inside rooms may still stand.'],
        ['Leveled', 'Even well-built houses are flattened into piles of debris.'],
        ['Swept clean', 'The house is ripped off its foundation. Only the bare slab is left.'],
      ],
      parts: [
        R(0, -5, 232, 10, '#7a7a7a'),
        R(-75, -60, 50, 100, '#e8dcc2', 3, { id: 'w1', mass: 2.4, stroke: 'rgba(0,0,0,.12)' }),
        R(-25, -60, 50, 100, '#e2d5b9', 4, { id: 'w2', mass: 2.4, stroke: 'rgba(0,0,0,.12)' }),
        R(25, -60, 50, 100, '#e8dcc2', 4, { id: 'w3', mass: 2.4, stroke: 'rgba(0,0,0,.12)' }),
        R(75, -60, 50, 100, '#e2d5b9', 3, { id: 'w4', mass: 2.4, stroke: 'rgba(0,0,0,.12)' }),
        R(-75, -68, 30, 28, '#a9d8f2', 1, { on: 'w1', hole: '#2a2d33', mass: 0.3, stroke: '#ffffff' }),
        R(-25, -37, 26, 54, '#8a5a3b', 2, { on: 'w2', hole: '#231913', mass: 0.8 }),
        R(25, -68, 30, 28, '#a9d8f2', 1, { on: 'w3', hole: '#2a2d33', mass: 0.3, stroke: '#ffffff' }),
        R(75, -68, 30, 28, '#a9d8f2', 1, { on: 'w4', hole: '#2a2d33', mass: 0.3, stroke: '#ffffff' }),
        R(62, -160, 18, 44, '#a0522d', 2, { mass: 1.2 }),
        P([[-122, -110], [0, -182], [0, -110]], '#5a3d31', 2, { mass: 1.8 }),
        P([[0, -110], [0, -182], [122, -110]], '#4e342a', 2, { mass: 1.8 }),
        ...shingles(),
        R(-70, -111, 104, 4, '#a3a3a3', 0, { mass: 0.4 }),
        R(70, -111, 104, 4, '#a3a3a3', 1, { mass: 0.4 }),
      ],
    },
    {
      id: 'mobile', name: 'Mobile home', short: 'Mobile home', h: 102, halfW: 175, hC: 55, scale: 0.85, shakeK: 0.8,
      fact: 'A single-wide mobile home is light for its size and often only loosely tied down. It is one of the worst places to be in a tornado.',
      bits: ['#e9e4d6', '#5b7ea3', '#cfe8f7', '#9a9a9a'],
      motions: ['shake', { m: 'lift', h: 40, d: 60 }, 'shake', 'shake', 'fly', 'fly'],
      sev: [1, 3, 4, 5, 5, 5],
      effects: [
        ['Skirting torn', 'The skirting and bits of siding and roof peel off.'],
        ['Rolled over', 'A home that is not tied down gets pushed off its blocks or rolled over.'],
        ['Destroyed', 'The walls and roof are torn apart. Mobile homes are destroyed at this strength.'],
        ['Scattered', 'Pieces are scattered across a wide area. Only the steel frame is left.'],
        ['Frame thrown', 'Even the steel frame is picked up and thrown.'],
        ['Gone', 'Nothing is left. The pieces are spread over a huge area.'],
      ],
      parts: [
        ...[-120, -60, 0, 60, 120].map((x) => R(x, -6, 14, 12, '#888888', 3, { mass: 1.5 })),
        R(0, -18, 300, 6, '#444444'),
        P([[150, -20], [174, -12], [150, -14]], '#444444'),
        ...[-120, -60, 0, 60, 120].map((x, i) =>
          R(x, -8, 60, 14, '#c8c2b4', i % 2 ? 1 : 0, { mass: 0.4, stroke: 'rgba(0,0,0,.15)' })),
        ...[-120, -60, 0, 60, 120].map((x, i) =>
          R(x, -56, 60, 70, i % 2 ? '#e4dfd0' : '#e9e4d6', 2, { id: 'mw' + i, mass: 1.2, stroke: 'rgba(0,0,0,.12)' })),
        ...[-120, -60, 0, 60, 120].map((x, i) => R(x, -38, 60, 5, '#5b7ea3', 99, { on: 'mw' + i })),
        R(-120, -62, 28, 20, '#a9d8f2', 1, { on: 'mw0', hole: '#2a2d33', mass: 0.3, stroke: '#ffffff' }),
        R(-60, -62, 28, 20, '#a9d8f2', 1, { on: 'mw1', hole: '#2a2d33', mass: 0.3, stroke: '#ffffff' }),
        R(0, -46, 20, 44, '#8a6e52', 1, { on: 'mw2', hole: '#231913', mass: 0.6 }),
        R(120, -62, 28, 20, '#a9d8f2', 1, { on: 'mw4', hole: '#2a2d33', mass: 0.3, stroke: '#ffffff' }),
        R(0, -18, 26, 6, '#777777', 1, { mass: 0.5 }),
        R(-104, -95, 104, 9, '#9a9a9a', 2, { mass: 0.8 }),
        R(0, -95, 104, 9, '#a3a3a3', 1, { mass: 0.8 }),
        R(104, -95, 104, 9, '#9a9a9a', 2, { mass: 0.8 }),
      ],
    },
    {
      id: 'barn', name: 'Barn', h: 238, halfW: 124, hC: 110, shakeK: 0.6,
      fact: 'A wooden barn is big but lightly built, so it breaks at lower wind speeds than a house.',
      bits: ['#a8322d', '#8b2621', '#e8d8a0', '#3a3a3a'],
      motions: ['shake', 'shake', 'shake', 'shake', 'shake', 'shake'],
      sev: [1, 2, 3, 4, 5, 5],
      effects: [
        ['Panels peeled', 'Some metal roof sheets and boards peel off.'],
        ['Roof torn off', 'The big doors blow in and the roof is ripped away.'],
        ['Walls collapse', 'The walls fall down. Hay and tools scatter across the field.'],
        ['Flattened', 'The barn is knocked down into a pile of boards.'],
        ['Swept away', 'Boards are scattered for hundreds of meters.'],
        ['Gone', 'Only the concrete floor is left. Some of the debris is never found.'],
      ],
      parts: [
        R(0, -4, 232, 8, '#777777'),
        R(-82.5, -52, 55, 96, '#a8322d', 2, { id: 'bw1', mass: 2, stroke: 'rgba(0,0,0,.2)' }),
        R(-27.5, -52, 55, 96, '#9e2e29', 3, { id: 'bw2', mass: 2, stroke: 'rgba(0,0,0,.2)' }),
        R(27.5, -52, 55, 96, '#a8322d', 3, { id: 'bw3', mass: 2, stroke: 'rgba(0,0,0,.2)' }),
        R(82.5, -52, 55, 96, '#9e2e29', 2, { id: 'bw4', mass: 2, stroke: 'rgba(0,0,0,.2)' }),
        R(0, -40, 60, 72, '#8b2621', 1, { id: 'door', on: 'bw2', hole: '#2a1a14', mass: 1, stroke: '#f1ece2' }),
        R(0, -40, 3, 94, '#f1ece2', 99, { on: 'door', rot: 0.695 }),
        R(0, -40, 3, 94, '#f1ece2', 99, { on: 'door', rot: -0.695 }),
        P([[-110, -100], [-100, -160], [0, -200], [100, -160], [110, -100]], '#a8322d', 2, { id: 'gable', mass: 2 }),
        R(0, -140, 34, 34, '#8b2621', 1, { on: 'gable', hole: '#2a1a14', mass: 0.6, stroke: '#f1ece2' }),
        R(0, -101, 224, 4, '#f1ece2', 2, { mass: 0.5 }),
        R(0, -214, 20, 22, '#f1ece2', 1, { mass: 0.6 }),
        P([[-15, -225], [0, -238], [15, -225]], '#3a3a3a', 1, { mass: 0.4 }),
        strip([-124, -100], [-102, -162], 10, '#3a3a3a', 1, { mass: 0.5 }),
        strip([-102, -162], [-51, -182], 10, '#444444', 0, { mass: 0.5 }),
        strip([-51, -182], [0, -202], 10, '#3a3a3a', 1, { mass: 0.5 }),
        strip([0, -202], [51, -182], 10, '#444444', 1, { mass: 0.5 }),
        strip([51, -182], [102, -162], 10, '#3a3a3a', 0, { mass: 0.5 }),
        strip([102, -162], [124, -100], 10, '#444444', 1, { mass: 0.5 }),
      ],
    },
    {
      id: 'tree', name: 'Tree', h: 240, halfW: 78, hC: 110,
      fact: 'A mature hardwood tree can weigh several tonnes.',
      bits: ['#4a8c3f', '#3f7d3a', '#5a9a48', '#6b4a2b'],
      motions: ['shake', 'tip', 'shake', 'shake', 'shake', 'shake'],
      sev: [1, 2, 3, 4, 5, 5],
      effects: [
        ['Branches break', 'Small branches snap off. Trees with shallow roots may lean.'],
        ['Uprooted', 'Some trees snap in half or get pulled out of the ground, roots and all.'],
        ['Snapped', 'Big trees snap or get uprooted. Forests are badly damaged.'],
        ['Stripped', 'Most trees are down. Standing trunks lose patches of bark.'],
        ['Debarked', 'Trees are stripped bare and broken into stubs.'],
        ['Shredded', 'Trees are fully debarked. Only splintered stumps remain.'],
      ],
      parts: [
        P([[-20, 0], [-11, -14], [11, -14], [20, 0]], '#5f4127'),
        R(0, -65, 22, 130, '#e2cfa4'),
        R(0, -16, 24, 33, '#6b4a2b', 3, { mass: 0.3 }),
        R(0, -49, 24, 33, '#654527', 4, { mass: 0.3 }),
        R(0, -82, 24, 33, '#6b4a2b', 3, { mass: 0.3 }),
        R(0, -114, 24, 32, '#654527', 4, { mass: 0.3 }),
        R(0, -160, 16, 64, '#6b4a2b', 2, { mass: 1.4 }),
        R(-26, -158, 6, 52, '#5f4127', 1, { rot: -0.95, mass: 0.6 }),
        R(26, -164, 6, 52, '#5f4127', 1, { rot: 0.95, mass: 0.6 }),
        R(-20, -122, 5, 38, '#5f4127', 2, { rot: -1.15, mass: 0.5 }),
        R(20, -126, 5, 38, '#5f4127', 2, { rot: 1.15, mass: 0.5 }),
        C(-58, -132, 20, '#356b31', 1, { mass: 0.4 }),
        C(56, -136, 20, '#3f7d3a', 2, { mass: 0.4 }),
        C(-42, -158, 28, '#3f7d3a', 1, { mass: 0.4 }),
        C(42, -162, 28, '#356b31', 1, { mass: 0.4 }),
        C(0, -150, 30, '#4a8c3f', 2, { mass: 0.4 }),
        C(-22, -190, 30, '#4a8c3f', 0, { mass: 0.4 }),
        C(24, -192, 30, '#3f7d3a', 0, { mass: 0.4 }),
        C(-40, -204, 20, '#5a9a48', 0, { mass: 0.4 }),
        C(40, -206, 20, '#4a8c3f', 1, { mass: 0.4 }),
        C(0, -214, 26, '#5a9a48', 2, { mass: 0.4 }),
        C(-4, -178, 28, '#3f7d3a', 2, { mass: 0.4 }),
      ],
    },
    {
      id: 'b3', name: '3-story building', short: '3-story',
      fact: 'A brick apartment building, about 10 m (33 ft) tall.',
      bits: ['#a4553f', '#cfe8f7', '#8f949b'],
      motions: ['shake', 'shake', 'shake', 'shake', 'shake', 'shake'],
      sev: [0, 1, 2, 3, 4, 5],
      effects: [
        ['Roof edge peeled', 'Bits of roof edging and loose rooftop items blow away.'],
        ['Windows broken', 'Flying debris breaks some windows. Roofing peels back.'],
        ['Roof lost', 'Most windows break and the roof covering is torn away.'],
        ['Top floor destroyed', 'The top floor’s walls collapse. The floors below are badly damaged.'],
        ['Mostly collapsed', 'Most walls fall down. Only part of the ground floor stands.'],
        ['Destroyed', 'The building is torn down to its foundation.'],
      ],
      ...makeBuilding({
        floors: 3, width: 300, bays: 5, seed: 3, winW: 0.5, winH: 0.5,
        wall: '#a4553f', glass: '#a9cde4', trim: '#7d4232', door: '#5a3a2a',
        glassFrac: [0, 0.3, 0.8, 1, 1, 1],
        facadeAt: (f) => (f === 2 ? 3 : 4),
        floorAt: (f) => [5, 4, 3][f],
        parapet: [0, 1, 0], hvacAt: 2,
      }),
    },
    {
      id: 'b7', name: '7-story building', short: '7-story',
      fact: 'A concrete office building, about 25 m (80 ft) tall.',
      bits: ['#c9c4b8', '#cfe8f7', '#8f949b'],
      motions: ['shake', 'shake', 'shake', 'shake', 'shake', 'shake'],
      sev: [0, 1, 2, 3, 4, 4],
      effects: [
        ['Barely touched', 'Some roofing and loose things on the roof blow away.'],
        ['A few windows', 'Flying debris breaks some windows, mostly on the lower floors.'],
        ['Windows blown out', 'Many windows break. Wind and rain rush inside.'],
        ['Walls stripped', 'Many outer wall panels are ripped off. The concrete frame still stands.'],
        ['Gutted', 'The outer walls are gone and the inside is wrecked, but the frame holds.'],
        ['Top floors fail', 'The upper floors can collapse. The rest of the frame is badly damaged.'],
      ],
      ...makeBuilding({
        floors: 7, width: 360, bays: 6, seed: 7, winW: 0.62, winH: 0.55, lowBias: 0.4,
        wall: '#c9c4b8', glass: '#86b0cf', trim: '#9e998e',
        glassFrac: [0, 0.18, 0.6, 1, 1, 1],
        facadeFrac: [0, 0, 0, 0.5, 1, 1],
        floorAt: (f) => (f >= 5 ? 5 : 99),
        parapet: [0, 0, 1], hvacAt: 2,
      }),
    },
    {
      id: 'b15', name: '15-story building', short: '15-story',
      fact: 'A steel and glass tower, about 50 m (165 ft) tall. Tall buildings are designed for strong wind.',
      bits: ['#cfe8f7', '#46596d', '#8f949b'],
      motions: ['shake', 'shake', 'shake', 'shake', 'shake', 'shake'],
      sev: [0, 0, 1, 2, 3, 4],
      effects: [
        ['Unharmed', 'The tower is built for wind like this. Almost nothing happens.'],
        ['A few windows', 'A handful of windows break from flying debris.'],
        ['Windows broken', 'Many windows on the lower and middle floors break.'],
        ['Glass gone', 'Most windows are blown out, and some wall panels are torn off.'],
        ['Skin stripped', 'Large parts of the outer walls are ripped away. The frame stands.'],
        ['Gutted', 'The outer walls are almost all gone, but the steel frame still stands. No tower like this has ever taken a direct EF5 hit, so this is a best guess.'],
      ],
      ...makeBuilding({
        floors: 15, width: 440, bays: 8, seed: 15, winW: 0.8, winH: 0.68, lowBias: 0.4,
        wall: '#46596d', glass: '#8fb8d6', trim: '#34434f',
        glassFrac: [0, 0.06, 0.35, 0.85, 1, 1],
        facadeFrac: [0, 0, 0, 0.15, 0.6, 1],
        parapet: [1, 2, 1], hvacAt: 3,
      }),
    },
    {
      id: 'b30', name: '30-story high-rise', short: '30-story',
      fact: 'A high-rise tower, about 110 m (360 ft) tall. Its steel frame is built to handle hurricane-force wind.',
      bits: ['#cfe8f7', '#3f556b', '#8f949b'],
      motions: ['shake', 'shake', 'shake', 'shake', 'shake', 'shake'],
      sev: [0, 0, 1, 1, 2, 3],
      effects: [
        ['Unharmed', 'The tower does not notice. It is built for wind this strong.'],
        ['Scratched', 'Maybe a cracked window or two from flying debris.'],
        ['Some windows', 'Some windows near the bottom break from flying debris.'],
        ['Many windows', 'Many windows break, mostly on the lower floors where debris flies.'],
        ['Glass stripped', 'Most windows are gone and some outer panels are torn off. The tower stands.'],
        ['Skin torn off', 'Much of the outer skin is ripped off, but the steel frame stands. No tower this tall has ever taken a direct EF5 hit, so this is a best guess.'],
      ],
      ...makeBuilding({
        floors: 30, width: 560, bays: 10, seed: 30, winW: 0.8, winH: 0.68, lowBias: 0.5,
        wall: '#3f556b', glass: '#9cc3e0', trim: '#2f3f4f',
        glassFrac: [0, 0.02, 0.18, 0.5, 0.9, 1],
        facadeFrac: [0, 0, 0, 0, 0.12, 0.5],
        parapet: [2, 3, 2], hvacAt: 4, antennaAt: 4,
      }),
    },
  ];
  const byId = Object.fromEntries(OBJECTS.map((o) => [o.id, o]));

  // ---------- Drawing helpers ----------
  function drawShape(c, p, fill) {
    const hole = !!fill;
    c.fillStyle = fill || p.color;
    switch (p.shape) {
      case 'rect':
        c.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        if (p.stroke && !hole) { c.strokeStyle = p.stroke; c.lineWidth = 1.5; c.strokeRect(-p.w / 2, -p.h / 2, p.w, p.h); }
        break;
      case 'circle':
        c.beginPath(); c.arc(0, 0, p.r, 0, TAU); c.fill();
        break;
      case 'ellipse':
        c.beginPath(); c.ellipse(0, 0, p.rx, p.ry, 0, 0, TAU); c.fill();
        break;
      case 'poly':
        c.beginPath();
        p.pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
        c.closePath(); c.fill();
        break;
      case 'wheel':
        c.beginPath(); c.arc(0, 0, p.r, 0, TAU); c.fill();
        c.fillStyle = '#8d949c'; c.beginPath(); c.arc(0, 0, p.r * 0.5, 0, TAU); c.fill();
        c.fillStyle = '#3a3d42'; c.beginPath(); c.arc(0, 0, p.r * 0.18, 0, TAU); c.fill();
        break;
    }
  }

  // Half of the part's height at a given rotation (for resting on the ground).
  function halfExtentY(p, rot) {
    const s = Math.abs(Math.sin(rot)), co = Math.abs(Math.cos(rot));
    switch (p.shape) {
      case 'rect': return 0.5 * (p.w * s + p.h * co);
      case 'ellipse': return Math.sqrt((p.rx * s) ** 2 + (p.ry * co) ** 2);
      case 'poly': return Math.max(...p.pts.map(([x, y]) => x * Math.sin(rot) + y * Math.cos(rot)));
      default: return p.r;
    }
  }

  function drawParts(c, parts, lookup) {
    for (const p of parts) {
      const hostGone = p.on && !lookup[p.on].attached;
      if (hostGone) continue;
      if (!p.attached && !p.hole) continue;
      c.save();
      c.translate(p.cx, p.cy);
      c.rotate(p.rot);
      drawShape(c, p, p.attached ? null : p.hole);
      c.restore();
    }
  }

  function drawThumb(canvas, def, box) {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = box.w * dpr;
    canvas.height = box.h * dpr;
    const c = canvas.getContext('2d');
    c.scale(dpr, dpr);
    const s = Math.min((box.w - 6) / (def.halfW * 2), (box.h - 4) / def.h);
    c.translate(box.w / 2, box.h - 2);
    c.scale(s, s);
    const parts = def.parts.map((p) => ({ ...p, attached: true }));
    const lookup = Object.fromEntries(parts.filter((p) => p.id).map((p) => [p.id, p]));
    drawParts(c, parts, lookup);
  }

  // ---------- Scene state ----------
  const canvas = document.getElementById('scene');
  const ctx = canvas.getContext('2d');
  let scale = 1, dpr = 1;

  const state = {
    ef: 2,
    objId: 'car',
    phase: 'idle', // idle | running | done
    tx: START_X,
    time: 0,
    camShake: 0,
    obj: null,
    debris: [],
    pending: [],
  };

  const rand = (a, b) => a + Math.random() * (b - a);

  // Tornado look
  const funnelParticles = Array.from({ length: 460 }, () => ({
    h: Math.random(), a: rand(0, TAU), sp: Math.random(), sz: rand(1.5, 4), sh: rand(150, 215),
  }));
  const dust = Array.from({ length: 110 }, () => ({
    a: rand(0, TAU), rf: rand(0.6, 2.0), y: Math.random(), sz: rand(5, 18), sp: rand(0.6, 1.3),
  }));
  const puffs = Array.from({ length: 30 }, (_, i) => ({
    x: i * 40 + rand(-10, 10), y: rand(CLOUD - 34, CLOUD - 6), r: rand(34, 70), sh: rand(0, 1),
  }));
  const blades = Array.from({ length: 170 }, () => ({
    x: rand(-10, W + 10), y: rand(GROUND + 3, H + 4), h: rand(6, 16), sh: rand(0, 1),
  })).sort((a, b) => a.y - b.y);
  const drops = Array.from({ length: 140 }, () => ({
    x: rand(0, W), y: rand(0, H), l: rand(8, 18), s: rand(0.8, 1.2),
  }));

  function tornadoR() { return 45 + state.ef * 17; }
  function omega() { return 4 + state.ef * 1.6; }

  function resetScene() {
    const def = byId[state.objId];
    const parts = def.parts.map((p) => ({ ...p, attached: true }));
    state.obj = {
      def, parts,
      lookup: Object.fromEntries(parts.filter((p) => p.id).map((p) => [p.id, p])),
      x: OBJ_X, lift: 0, rot: 0, pivot: 'center',
      hit: false, hitTime: 0, x0: OBJ_X, shake: 0,
      fly: null, gone: false,
    };
    state.debris = [];
    state.pending = [];
    state.tx = START_X;
    state.phase = 'idle';
    state.camShake = 0;
    updateStatus();
  }

  function sendTornado() {
    if (state.phase !== 'idle') resetScene();
    state.phase = 'running';
    updateStatus();
  }

  const sizeOf = (def) => def.scale || 1;
  const motionOf = (def, ef) => {
    const m = def.motions[ef];
    return typeof m === 'string' ? { m } : m;
  };

  // Transform a point in object space to world space.
  function localToWorld(px, py) {
    const o = state.obj;
    const s = sizeOf(o.def), hC = o.def.hC * s;
    let x = px * s, y = py * s;
    if (o.pivot === 'center') y += hC;
    const cs = Math.cos(o.rot), sn = Math.sin(o.rot);
    let xr = x * cs - y * sn, yr = x * sn + y * cs;
    if (o.pivot === 'center') yr -= hC;
    return [o.x + xr, GROUND - o.lift + yr];
  }

  function onHit() {
    const o = state.obj, ef = state.ef;
    o.hit = true;
    o.hitTime = state.time;
    o.x0 = o.x;
    const toGo = o.parts
      .filter((p) => p.detach <= ef)
      .sort((a, b) => a.detach - b.detach || a.cy - b.cy);
    const step = Math.min(0.04, 1.6 / Math.max(1, toGo.length));
    toGo.forEach((p, i) => {
      state.pending.push({ part: p, at: state.time + i * step + rand(0, 0.12) });
    });
    const nBits = 8 + ef * 7;
    for (let i = 0; i < nBits; i++) {
      const [wx, wy] = localToWorld(rand(-o.def.halfW, o.def.halfW) * 0.7, -rand(5, o.def.h * 0.8));
      const bit = { shape: 'rect', w: rand(2, 5), h: rand(2, 4), color: o.def.bits[i % o.def.bits.length], mass: 0.25 };
      spawnDebris(bit, wx, wy, rand(0, TAU));
    }
    if (!reduceMotion) state.camShake = Math.max(state.camShake, ef * 1.1);
  }

  function spawnDebris(part, x, y, rot, scale = 1) {
    const ef = state.ef;
    const up = (120 + ef * 70) * rand(0.6, 1.2) / Math.sqrt(part.mass);
    state.debris.push({
      part, x, y, rot, scale,
      vx: rand(-60, 60) + SPEED * 0.4,
      vy: -up,
      spin: rand(-1, 1) * (3 + ef * 2) / Math.sqrt(part.mass),
      phase: rand(0, TAU),
      flung: false, landed: false,
    });
  }

  function detachPart(p) {
    if (!p.attached) return;
    const o = state.obj;
    p.attached = false;
    const [wx, wy] = localToWorld(p.cx, p.cy);
    spawnDebris(p, wx, wy, o.rot + p.rot, sizeOf(o.def));
    // Anything mounted on this part goes with it.
    if (p.id) for (const q of o.parts) if (q.on === p.id && q.attached) detachPart(q);
  }

  // ---------- Update ----------
  function update(dt) {
    state.time += dt;
    const ef = state.ef, R = tornadoR(), om = omega();

    for (const p of funnelParticles) {
      p.h += dt * (0.05 + 0.1 * p.sp);
      if (p.h > 1) p.h -= 1;
      p.a += om * (1.4 - p.h * 0.6) * (0.8 + p.sp * 0.4) * dt;
    }
    for (const d of dust) d.a += om * 0.8 * d.sp * dt;
    for (const d of drops) {
      d.y += d.s * 620 * dt;
      d.x -= (60 + ef * 30) * dt;
      if (d.y > H) { d.y -= H + 20; d.x = rand(0, W + 200); }
      if (d.x < -20) d.x += W + 40;
    }

    if (state.phase === 'running') {
      state.tx += SPEED * dt;
      if (state.tx > W + R * 2.6) {
        state.phase = 'done';
        updateStatus();
      }
    }

    const o = state.obj;
    const contact = state.phase === 'running' && !o.gone &&
      Math.abs(o.x - state.tx) < R * 0.95 + o.def.halfW * sizeOf(o.def) * 0.4;
    if (contact && !o.hit) onHit();

    state.pending = state.pending.filter((pd) => {
      if (state.time >= pd.at) { detachPart(pd.part); return false; }
      return true;
    });

    updateObject(dt, contact);
    for (const d of state.debris) updateDebris(d, dt);
    state.debris = state.debris.filter((d) => d.x > -250 && d.x < W + 250 && d.y > -400);

    if (contact && ef >= 2 && !reduceMotion) state.camShake = Math.max(state.camShake, ef * 0.9);
    state.camShake *= Math.pow(0.02, dt);
  }

  function updateObject(dt, contact) {
    const o = state.obj, ef = state.ef;
    if (o.gone) return;
    const spec = motionOf(o.def, ef), motion = spec.m;
    const t = o.hit ? state.time - o.hitTime : 0;
    o.shake = contact ? (1.5 + ef * 1.2) * (o.def.shakeK || 1) : o.shake * Math.pow(0.001, dt);

    switch (motion) {
      case 'slide':
        if (contact) o.x += SPEED * 0.3 * dt;
        break;
      case 'tip':
        if (o.hit) {
          o.pivot = 'base';
          const k = Math.min(1, t / 0.9);
          o.rot = 1.48 * k * k;
        }
        break;
      case 'tumble':
        if (o.hit) {
          const k = Math.min(1, t / 0.9);
          o.lift = 38 * Math.sin(Math.PI * k);
          o.rot = TAU * (1 - Math.cos(Math.PI * k)) / 2;
          o.x = o.x0 + 50 * k;
        }
        break;
      case 'lift':
        if (o.hit) {
          const k = Math.min(1, t / 1.8);
          o.lift = (spec.h || 115) * Math.sin(Math.PI * k);
          o.rot = Math.PI * (1 - Math.cos(Math.PI * k)) / 2;
          o.x = o.x0 + (spec.d || 120) * k;
        }
        break;
      case 'fly':
        if (o.hit) {
          if (!o.fly) o.fly = { stage: 1, vx: 0, vy: 0 };
          const f = o.fly;
          if (f.stage === 1) {
            const target = state.tx + Math.cos(state.time * omega()) * tornadoR() * 0.45;
            o.x += (target - o.x) * Math.min(1, dt * 4);
            o.lift += (120 + ef * 45) * dt;
            o.rot += (2.5 + ef * 0.9) * dt;
            if (o.lift > 250 || t > 1.8) {
              f.stage = 2;
              f.vx = 260 + ef * 90;
              f.vy = 180;
            }
          } else {
            o.x += f.vx * dt;
            o.lift += f.vy * dt;
            f.vy -= 120 * dt;
            o.rot += (2 + ef) * dt;
            if (o.x > W + 260 || o.lift > H + 200) o.gone = true;
          }
        }
        break;
    }
  }

  function updateDebris(d, dt) {
    if (d.landed) return;
    const ef = state.ef, R = tornadoR();
    const inZone = !d.flung && state.phase === 'running' && Math.abs(d.x - state.tx) < R * 1.4;
    let ax, ay;

    if (inZone) {
      d.phase += omega() * dt;
      const heightAbove = GROUND - d.y;
      const target = state.tx + Math.cos(d.phase) * R * 0.9 * (0.6 + heightAbove / 320);
      ax = (target - d.x) * 8 - (d.vx - SPEED) * 2;
      ay = GRAV - (300 + ef * 170) / Math.pow(d.part.mass, 0.7);
      if (d.y < CLOUD + 60) {
        d.flung = true;
        d.vx += (d.x >= state.tx ? 1 : -0.4) * (150 + ef * 70);
        d.vy = rand(-60, 20);
      }
    } else {
      ax = -d.vx * 0.3;
      ay = GRAV;
    }

    d.vx += ax * dt;
    d.vy += ay * dt;
    d.vy = Math.max(-500, Math.min(700, d.vy));
    d.x += d.vx * dt;
    d.y += d.vy * dt;
    d.rot += d.spin * dt;

    const rest = GROUND - halfExtentY(d.part, d.rot) * d.scale;
    if (d.y >= rest && d.vy > 0) {
      d.y = rest;
      if (inZone) {
        d.vy = -d.vy * 0.3;
      } else {
        d.vy = 0;
        d.vx *= 0.45;
        d.spin *= 0.2;
        if (Math.abs(d.vx) < 8) {
          d.landed = true;
          // Settle onto whichever side is flattest.
          const q = Math.round(d.rot / (Math.PI / 2)) * (Math.PI / 2);
          d.rot = [q, q + Math.PI / 2].sort((a, b) => halfExtentY(d.part, a) - halfExtentY(d.part, b))[0];
          d.y = GROUND - halfExtentY(d.part, d.rot) * d.scale;
        }
      }
    }
  }

  // ---------- Render ----------
  function lerpColor(a, b, t) {
    const pa = a.match(/\w\w/g).map((h) => parseInt(h, 16));
    const pb = b.match(/\w\w/g).map((h) => parseInt(h, 16));
    return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * t)).join(',')})`;
  }

  function render() {
    const ef = state.ef, dark = ef / 5;
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    ctx.save();
    const sx = (Math.random() - 0.5) * state.camShake * 2;
    const sy = (Math.random() - 0.5) * state.camShake * 2;
    ctx.translate(sx, sy);

    // Sky
    const sky = ctx.createLinearGradient(0, 0, 0, GROUND);
    sky.addColorStop(0, lerpColor('3a4254', '1f232c', dark));
    sky.addColorStop(1, lerpColor('8c95a3', '4d5563', dark));
    ctx.fillStyle = sky;
    ctx.fillRect(-20, -20, W + 40, GROUND + 20);

    // Far hills
    ctx.fillStyle = lerpColor('55664f', '3b4638', dark);
    hill(GROUND - 34, 18, 0.006, 1.2);
    ctx.fillStyle = lerpColor('4a5f3d', '33422b', dark);
    hill(GROUND - 16, 12, 0.011, 3.1);

    // Ground
    const g = ctx.createLinearGradient(0, GROUND, 0, H);
    g.addColorStop(0, lerpColor('5a7a41', '3f5630', dark));
    g.addColorStop(1, lerpColor('3a5429', '26361b', dark));
    ctx.fillStyle = g;
    ctx.fillRect(-20, GROUND, W + 40, H - GROUND + 20);

    drawTornadoBody();
    drawFunnelParticles(false);
    drawDust(false);

    drawObject();
    drawDebris();

    drawFunnelParticles(true);
    drawDust(true);
    drawClouds(dark);
    drawGrass();
    drawRain();

    ctx.restore();
  }

  function hill(y, amp, freq, seed) {
    ctx.beginPath();
    ctx.moveTo(-20, GROUND + 1);
    for (let x = -20; x <= W + 20; x += 20) {
      ctx.lineTo(x, y - amp * (Math.sin(x * freq + seed) + 0.5 * Math.sin(x * freq * 2.3 + seed * 2)));
    }
    ctx.lineTo(W + 20, GROUND + 1);
    ctx.closePath();
    ctx.fill();
  }

  const axisX = (h) => state.tx + Math.sin(state.time * 1.3 + h * 3.2) * 14 * h - 30 * h * h;
  const funnelR = (h) => tornadoR() * (0.38 + 0.45 * h + 1.5 * Math.pow(h, 7));
  const hY = (h) => GROUND - h * (GROUND - CLOUD + 10);

  function drawTornadoBody() {
    const left = [], right = [];
    for (let h = 0; h <= 1.0001; h += 0.04) {
      const n = 1 + Math.sin(state.time * 5 + h * 20) * 0.05;
      left.push([axisX(h) - funnelR(h) * n, hY(h)]);
      right.push([axisX(h) + funnelR(h) * n, hY(h)]);
    }
    const path = new Path2D();
    path.moveTo(...left[0]);
    left.forEach((p) => path.lineTo(...p));
    right.reverse().forEach((p) => path.lineTo(...p));
    path.closePath();

    const v = ctx.createLinearGradient(0, GROUND, 0, CLOUD);
    v.addColorStop(0, 'rgba(138,128,112,0.6)');
    v.addColorStop(1, 'rgba(92,98,110,0.85)');
    ctx.fillStyle = v;
    ctx.fill(path);

    const R = tornadoR() * 2.4;
    const hz = ctx.createLinearGradient(state.tx - R, 0, state.tx + R, 0);
    hz.addColorStop(0.2, 'rgba(30,34,42,0.45)');
    hz.addColorStop(0.5, 'rgba(30,34,42,0)');
    hz.addColorStop(0.8, 'rgba(30,34,42,0.5)');
    ctx.fillStyle = hz;
    ctx.fill(path);
  }

  function drawFunnelParticles(front) {
    const count = 220 + state.ef * 45;
    for (let i = 0; i < count; i++) {
      const p = funnelParticles[i];
      const depth = Math.sin(p.a);
      if ((depth > 0) !== front) continue;
      const r = funnelR(p.h) * 1.02;
      const x = axisX(p.h) + Math.cos(p.a) * r;
      const y = hY(p.h);
      const s = p.sz * (1 + p.h * 1.5);
      ctx.fillStyle = `rgba(${p.sh | 0},${p.sh | 0},${(p.sh + 10) | 0},${front ? 0.5 : 0.22})`;
      ctx.fillRect(x - s * 1.8, y - s / 2, s * 3.6, s);
    }
  }

  function drawDust(front) {
    const R = tornadoR();
    for (const d of dust) {
      const depth = Math.sin(d.a);
      if ((depth > 0) !== front) continue;
      const x = state.tx + Math.cos(d.a) * R * d.rf;
      const y = GROUND - 2 - d.y * (26 + state.ef * 12) * (1.3 - d.rf * 0.3);
      ctx.fillStyle = `rgba(122,104,82,${front ? 0.32 : 0.2})`;
      ctx.beginPath();
      ctx.arc(x, y, d.sz * (0.8 + state.ef * 0.12), 0, TAU);
      ctx.fill();
    }
  }

  function drawClouds(dark) {
    const top = ctx.createLinearGradient(0, 0, 0, CLOUD);
    top.addColorStop(0, lerpColor('2b303b', '15181e', dark));
    top.addColorStop(1, lerpColor('4a515e', '2c3139', dark));
    ctx.fillStyle = top;
    ctx.fillRect(-20, -20, W + 40, CLOUD - 22);
    const span = W + 160;
    for (const p of puffs) {
      const x = ((p.x + state.time * 10) % span + span) % span - 80;
      ctx.fillStyle = lerpColor(p.sh > 0.5 ? '4d5461' : '434a56', p.sh > 0.5 ? '2e333c' : '262a32', dark);
      ctx.beginPath();
      ctx.ellipse(x, p.y, p.r, p.r * 0.45, 0, 0, TAU);
      ctx.fill();
    }
    // Wall cloud lowering over the tornado
    const R = tornadoR();
    ctx.fillStyle = lerpColor('3c424d', '22262d', dark);
    ctx.beginPath();
    ctx.ellipse(axisX(1), CLOUD - 2, R * 2.6, 24, 0, 0, TAU);
    ctx.fill();
  }

  function drawObject() {
    const o = state.obj;
    if (o.gone) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(-40, -400, W + 80, GROUND + 401);
    ctx.clip();
    const s = o.shake;
    ctx.translate(o.x + rand(-s, s), GROUND - o.lift + rand(-s, s) * 0.4);
    const sz = sizeOf(o.def), hC = o.def.hC * sz;
    if (o.pivot === 'center') {
      ctx.translate(0, -hC);
      ctx.rotate(o.rot);
      ctx.translate(0, hC);
    } else {
      ctx.rotate(o.rot);
    }
    ctx.scale(sz, sz);
    drawParts(ctx, o.parts, o.lookup);
    ctx.restore();
  }

  function drawDebris() {
    for (const d of state.debris) {
      ctx.save();
      ctx.translate(d.x, d.y);
      ctx.rotate(d.rot);
      ctx.scale(d.scale, d.scale);
      drawShape(ctx, d.part);
      ctx.restore();
    }
  }

  function drawGrass() {
    const R = tornadoR();
    ctx.lineWidth = 1.4;
    ctx.lineCap = 'round';
    for (const b of blades) {
      const dx = b.x - state.tx;
      const infl = Math.exp(-((dx / (R * 2.2)) ** 2)) * (0.5 + state.ef * 0.14);
      const lean = Math.sin(state.time * 2 + b.x * 0.05) * 0.12 + Math.sign(dx) * infl - 0.1;
      ctx.strokeStyle = b.sh > 0.5 ? 'rgba(120,150,80,.8)' : 'rgba(90,120,62,.8)';
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x + Math.sin(lean) * b.h, b.y - Math.cos(lean) * b.h);
      ctx.stroke();
    }
  }

  function drawRain() {
    const n = 40 + state.ef * 18;
    ctx.strokeStyle = 'rgba(200,210,225,.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const d = drops[i];
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x - d.l * 0.25, d.y + d.l);
    }
    ctx.stroke();
  }

  // ---------- Loop & sizing ----------
  function resize() {
    const cssW = canvas.clientWidth;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    scale = cssW / W;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssW * (H / W) * dpr);
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt);
    render();
    requestAnimationFrame(frame);
  }

  // ---------- UI ----------
  const el = (id) => document.getElementById(id);
  const efInput = el('ef');
  const sendBtn = el('sendBtn');
  const hint = el('stageHint');

  function buildObjectButtons() {
    const wrap = el('objects');
    for (const def of OBJECTS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'obj-btn';
      b.dataset.id = def.id;
      const cv = document.createElement('canvas');
      cv.setAttribute('aria-hidden', 'true');
      drawThumb(cv, def, { w: 52, h: 40 });
      const label = document.createElement('span');
      label.textContent = def.short || def.name;
      b.setAttribute('aria-label', def.name);
      b.append(cv, label);
      b.addEventListener('click', () => select(def.id, state.ef));
      wrap.append(b);
    }
  }

  function buildMatrix() {
    const table = el('matrix');
    const head = document.createElement('tr');
    head.innerHTML = '<td></td>' +
      EF.map((e, i) => `<th scope="col">EF${i}<small>${e.mph} mph</small></th>`).join('');
    const thead = document.createElement('thead');
    thead.append(head);
    const tbody = document.createElement('tbody');
    for (const def of OBJECTS) {
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      th.scope = 'row';
      const rh = document.createElement('div');
      rh.className = 'row-head';
      const cv = document.createElement('canvas');
      cv.setAttribute('aria-hidden', 'true');
      drawThumb(cv, def, { w: 40, h: 30 });
      rh.append(cv, document.createTextNode(def.name));
      th.append(rh);
      tr.append(th);
      def.effects.forEach(([title], ef) => {
        const td = document.createElement('td');
        const b = document.createElement('button');
        const sev = SEV[def.sev[ef]];
        b.type = 'button';
        b.className = 'cell';
        b.dataset.obj = def.id;
        b.dataset.ef = ef;
        b.style.background = sev.color;
        b.style.color = sev.ink;
        b.textContent = title;
        b.setAttribute('aria-label', `${def.name} at EF${ef}: ${title}`);
        b.addEventListener('click', () => {
          select(def.id, ef);
          document.querySelector('.lab').scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        td.append(b);
        tr.append(td);
      });
      tbody.append(tr);
    }
    table.append(thead, tbody);
  }

  function buildEfList() {
    el('efList').innerHTML = EF.map((e, i) =>
      `<li><span class="tag" style="background:${SEV[i].color};color:${SEV[i].ink}">EF${i}</span>` +
      `<span>${e.label}</span><span class="speed">${e.mph} mph</span></li>`).join('');
  }

  function buildMeter() {
    el('meter').innerHTML = '<span></span>'.repeat(6);
  }

  function select(objId, ef) {
    const changed = objId !== state.objId || ef !== state.ef;
    state.objId = objId;
    state.ef = ef;
    efInput.value = ef;
    updateUI();
    if (changed) resetScene();
  }

  function updateUI() {
    const def = byId[state.objId], ef = state.ef, e = EF[ef];
    const sevIdx = def.sev[ef], sev = SEV[sevIdx];
    const [title, text] = def.effects[ef];

    const badge = el('efBadge');
    badge.textContent = `EF${ef}`;
    badge.style.setProperty('--sev-color', SEV[ef].color);
    badge.style.setProperty('--sev-ink', SEV[ef].ink);
    el('efLabel').textContent = e.label;
    el('efWind').textContent = `${e.mph} mph`;
    el('efKmh').textContent = `(${e.kmh} km/h)`;
    el('stageChip').textContent = `EF${ef} · ${e.mph} mph`;
    const zoom = sizeOf(def);
    const note = el('stageNote');
    note.hidden = zoom > 0.95;
    note.textContent = `Zoomed out to ${Math.round(zoom * 100)}% to fit`;
    efInput.setAttribute('aria-valuetext', `EF${ef}, ${e.label}, ${e.mph} miles per hour`);

    document.querySelectorAll('.obj-btn').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.id === state.objId));
    });

    el('resKicker').textContent = `${def.name} vs EF${ef}`;
    el('resTitle').textContent = title;
    el('resText').textContent = text;
    el('resSev').textContent = sev.name;
    el('resFact').textContent = def.fact;
    [...el('meter').children].forEach((s, i) => {
      s.style.background = i <= sevIdx ? SEV[i].color : '';
    });

    document.querySelectorAll('.cell').forEach((c) => {
      const on = c.dataset.obj === state.objId && Number(c.dataset.ef) === ef;
      if (on) c.setAttribute('aria-current', 'true'); else c.removeAttribute('aria-current');
    });

    canvas.setAttribute('aria-label',
      `A ${e.label.toLowerCase()} EF${ef} tornado with winds of ${e.mph} mph next to a ${def.name.toLowerCase()}. Result: ${title}. ${text}`);
  }

  function updateStatus() {
    if (state.phase === 'idle') {
      hint.innerHTML = 'Press <strong>Send the tornado</strong> to start.';
      hint.classList.remove('hidden');
      sendBtn.disabled = false;
      sendBtn.textContent = 'Send the tornado';
    } else if (state.phase === 'running') {
      hint.classList.add('hidden');
      sendBtn.disabled = true;
      sendBtn.textContent = 'Tornado on the move…';
    } else {
      hint.innerHTML = 'The tornado has passed. Try another strength or object.';
      hint.classList.remove('hidden');
      sendBtn.disabled = false;
      sendBtn.textContent = 'Send it again';
    }
  }

  efInput.addEventListener('input', () => select(state.objId, Number(efInput.value)));
  sendBtn.addEventListener('click', sendTornado);
  el('resetBtn').addEventListener('click', resetScene);

  buildObjectButtons();
  buildMatrix();
  buildEfList();
  buildMeter();
  resetScene();
  updateUI();
  requestAnimationFrame(frame);
})();
