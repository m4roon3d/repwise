import React, { useEffect, useId, useRef, useState } from 'react';
import { ANIMATION_LIBRARY } from '../data/animations';
import { OrbitIcon, PauseIcon, PlayIcon } from './Icons';

const ANGLE_PRESETS = [
  { id: 'front', label: 'Front', yaw: 0 },
  { id: 'three_quarter', label: '3/4', yaw: 38 },
  { id: 'side', label: 'Side', yaw: 90 },
  { id: 'back', label: 'Back', yaw: 180 },
];

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function easeInOutSine(t) {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

function interpolatePose3D(poses, progress) {
  const segments = poses.length - 1;
  const scaled = progress * segments;
  const idx = Math.min(segments - 1, Math.floor(scaled));
  const localT = easeInOutSine(scaled - idx);
  const from = poses[idx];
  const to = poses[idx + 1];

  const out = {};
  for (const key of Object.keys(from)) {
    out[key] = [
      lerp(from[key][0], to[key][0], localT),
      lerp(from[key][1], to[key][1], localT),
      lerp(from[key][2], to[key][2], localT),
    ];
  }
  return out;
}

/**
 * Projects a 3D world point [x, y, z] into 2D SVG coordinates [sx, sy, depth]
 * using perspective camera orbit around vertical Y-axis (yawDeg) and elevation (pitchDeg).
 */
function projectPoint(pt, yawDeg, pitchDeg, targetY, viewW = 260, viewH = 188) {
  const yaw = (yawDeg * Math.PI) / 180;
  const pitch = (pitchDeg * Math.PI) / 180;

  const x0 = pt[0];
  const y0 = pt[1] - targetY;
  const z0 = pt[2];

  // Rotate around Y axis (camera orbits clockwise around athlete)
  const cosY = Math.cos(yaw);
  const sinY = Math.sin(yaw);
  const rx = x0 * cosY - z0 * sinY;
  const rz = x0 * sinY + z0 * cosY;

  // Apply gentle downward camera pitch
  const cosP = Math.cos(pitch);
  const sinP = Math.sin(pitch);
  const ry = y0 * cosP - rz * sinP;
  const depth = y0 * sinP + rz * cosP;

  const camDist = 3.35;
  const focal = 250;
  const scale = focal / Math.max(0.8, camDist - depth);

  return {
    x: viewW / 2 + rx * scale,
    y: viewH / 2 - ry * scale + 6,
    z: depth,
    scale,
  };
}

function normalizeYaw(deg) {
  return ((deg % 360) + 360) % 360;
}

function closestPresetId(yawDeg) {
  const norm = normalizeYaw(yawDeg);
  for (const preset of ANGLE_PRESETS) {
    const diff = Math.min(Math.abs(norm - preset.yaw), 360 - Math.abs(norm - preset.yaw));
    if (diff <= 9) return preset.id;
  }
  return 'custom';
}

function prefersReducedMotion() {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

export default function ExerciseAnimator({ animationKey = 'squat', compact = false }) {
  const uid = useId().replace(/:/g, '');
  const glowId = `glow-${uid}`;
  const config = ANIMATION_LIBRARY[animationKey] || ANIMATION_LIBRARY.squat;

  // Respect the OS reduce-motion setting: start paused (the user can still press Play).
  const [playing, setPlaying] = useState(() => !prefersReducedMotion());
  const [inView, setInView] = useState(true);
  const [pageVisible, setPageVisible] = useState(() => typeof document === 'undefined' || !document.hidden);
  const [speed, setSpeed] = useState(1);
  const [progress, setProgress] = useState(0);
  const [yaw, setYaw] = useState(config.defaultYaw ?? 38);
  const [autoOrbit, setAutoOrbit] = useState(false);

  const rootRef = useRef(null);
  const rafRef = useRef(null);
  const lastTimeRef = useRef(null);
  const dragRef = useRef({ active: false, startX: 0, startYaw: 0 });

  useEffect(() => {
    setProgress(0);
    setYaw(config.defaultYaw ?? 38);
    setAutoOrbit(false);
    lastTimeRef.current = null;
  }, [animationKey, config.defaultYaw]);

  // Only animate while the card is on screen and the tab is visible (a day can show 6+ cards).
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { rootMargin: '120px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onVisibility = () => setPageVisible(!document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    if ((!playing && !autoOrbit) || !inView || !pageVisible) {
      lastTimeRef.current = null;
      return undefined;
    }

    const tick = (now) => {
      if (lastTimeRef.current !== null) {
        const dt = Math.min(60, now - lastTimeRef.current);
        if (playing) {
          setProgress((prev) => (prev + (dt * speed) / config.cycleMs) % 1);
        }
        if (autoOrbit && !dragRef.current.active) {
          setYaw((prev) => normalizeYaw(prev + dt * 0.036));
        }
      }
      lastTimeRef.current = now;
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [playing, autoOrbit, speed, config.cycleMs, inView, pageVisible]);

  const handlePointerDown = (e) => {
    setAutoOrbit(false);
    dragRef.current = { active: true, startX: e.clientX, startYaw: yaw };
    if (e.currentTarget.setPointerCapture) {
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Ignore in jsdom / unsupported environments
      }
    }
  };

  const handlePointerMove = (e) => {
    if (!dragRef.current.active) return;
    const dx = e.clientX - dragRef.current.startX;
    setYaw(normalizeYaw(dragRef.current.startYaw + dx * 0.7));
  };

  const handlePointerUp = () => {
    dragRef.current.active = false;
  };

  const pose3D = interpolatePose3D(config.poses, progress);
  const pitch = 15;
  const targetY = config.cameraTargetY ?? 0.82;
  const proj = (pt) => projectPoint(pt, yaw, pitch, targetY);

  // Project all joints once
  const p = {};
  for (const key of Object.keys(pose3D)) {
    p[key] = proj(pose3D[key]);
  }

  // Build 3D perspective floor grid
  const gridLines = [];
  for (let i = -3; i <= 3; i++) {
    const c = i * 0.32;
    const a1 = proj([c, 0, -0.96]);
    const a2 = proj([c, 0, 0.96]);
    const b1 = proj([-0.96, 0, c]);
    const b2 = proj([0.96, 0, c]);
    gridLines.push({ key: `gx-${i}`, x1: a1.x, y1: a1.y, x2: a2.x, y2: a2.y });
    gridLines.push({ key: `gz-${i}`, x1: b1.x, y1: b1.y, x2: b2.x, y2: b2.y });
  }

  // Build 3D equipment primitives with depth for painter's sorting
  const drawItems = [];

  const addLine = (id, ptA, ptB, color, width, dash = null, opacity = 1) => {
    const a = Array.isArray(ptA) ? proj(ptA) : ptA;
    const b = Array.isArray(ptB) ? proj(ptB) : ptB;
    drawItems.push({
      id,
      depth: (a.z + b.z) / 2,
      render: () => (
        <line
          key={id}
          x1={a.x}
          y1={a.y}
          x2={b.x}
          y2={b.y}
          stroke={color}
          strokeWidth={width}
          strokeLinecap="round"
          strokeDasharray={dash || undefined}
          opacity={opacity}
        />
      ),
    });
  };

  const addPoly = (id, pts3D, fill, stroke, strokeWidth = 1.4, opacity = 1) => {
    const projected = pts3D.map((pt) => (Array.isArray(pt) ? proj(pt) : pt));
    const avgZ = projected.reduce((s, q) => s + q.z, 0) / projected.length;
    const pointsAttr = projected.map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(' ');
    drawItems.push({
      id,
      depth: avgZ,
      render: () => (
        <polygon
          key={id}
          points={pointsAttr}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
          opacity={opacity}
        />
      ),
    });
  };

  const addWeight = (id, pt, radius = 6.2, fill = '#10b981') => {
    const q = Array.isArray(pt) ? proj(pt) : pt;
    drawItems.push({
      id,
      depth: q.z + 0.03,
      render: () => (
        <g key={id}>
          <circle cx={q.x} cy={q.y} r={radius} fill={fill} stroke="#064e3b" strokeWidth="1.6" />
          <circle cx={q.x - 1.5} cy={q.y - 1.5} r={radius * 0.32} fill="rgba(255,255,255,0.32)" />
        </g>
      ),
    });
  };

  // Contextual 3D Equipment
  if (config.equipment === 'mat') {
    addPoly(
      'mat-poly',
      [
        [-0.42, 0.01, -0.95],
        [0.42, 0.01, -0.95],
        [0.42, 0.01, 0.92],
        [-0.42, 0.01, 0.92],
      ],
      'rgba(30, 41, 59, 0.72)',
      '#334155',
      1.5
    );
  }

  if (config.equipment === 'bench_press') {
    addPoly(
      'bench-top',
      [
        [-0.17, 0.44, -0.74],
        [0.17, 0.44, -0.74],
        [0.17, 0.44, 0.28],
        [-0.17, 0.44, 0.28],
      ],
      'rgba(51, 65, 85, 0.85)',
      '#64748b',
      1.5
    );
    addLine('bench-leg-1', [0, 0.44, -0.58], [0, 0, -0.58], '#475569', 4);
    addLine('bench-leg-2', [0, 0.44, 0.16], [0, 0, 0.16], '#475569', 4);
    addWeight('db-l', p.lHand, 6.2);
    addWeight('db-r', p.rHand, 6.2);
  }

  if (config.equipment === 'seated_bench_db') {
    addPoly(
      'seat-pad',
      [
        [-0.18, 0.54, -0.18],
        [0.18, 0.54, -0.18],
        [0.18, 0.54, 0.22],
        [-0.18, 0.54, 0.22],
      ],
      'rgba(51, 65, 85, 0.8)',
      '#64748b',
      1.3
    );
    addPoly(
      'back-pad',
      [
        [-0.16, 0.54, -0.18],
        [0.16, 0.54, -0.18],
        [0.16, 1.24, -0.22],
        [-0.16, 1.24, -0.22],
      ],
      'rgba(51, 65, 85, 0.65)',
      '#64748b',
      1.3
    );
    addLine('seat-post', [0, 0.54, 0], [0, 0, 0], '#475569', 4);
    addWeight('db-l', p.lHand, 5.8);
    addWeight('db-r', p.rHand, 5.8);
  }

  if (config.equipment === 'leg_curl_machine') {
    addPoly(
      'lc-seat',
      [
        [-0.2, 0.54, -0.28],
        [0.2, 0.54, -0.28],
        [0.2, 0.54, 0.24],
        [-0.2, 0.54, 0.24],
      ],
      'rgba(51, 65, 85, 0.8)',
      '#64748b',
      1.3
    );
    addPoly(
      'lc-back',
      [
        [-0.18, 0.54, -0.28],
        [0.18, 0.54, -0.28],
        [0.18, 1.18, -0.34],
        [-0.18, 1.18, -0.34],
      ],
      'rgba(51, 65, 85, 0.6)',
      '#64748b',
      1.3
    );
    addLine('lc-post', [0, 0.54, 0], [0, 0, 0], '#475569', 4);
    addLine('lc-roller', pose3D.lAnkle, pose3D.rAnkle, '#10b981', 7);
    addLine('lc-pivot-arm', [0.22, 0.58, 0.28], pose3D.lAnkle, '#64748b', 2.4, '3 2');
  }

  if (config.equipment === 'cable_row') {
    addPoly(
      'row-seat',
      [
        [-0.18, 0.48, -0.44],
        [0.18, 0.48, -0.44],
        [0.18, 0.48, 0.04],
        [-0.18, 0.48, 0.04],
      ],
      'rgba(51, 65, 85, 0.8)',
      '#64748b',
      1.3
    );
    addLine('row-post', [0, 0.48, -0.2], [0, 0, -0.2], '#475569', 4);
    addLine('row-tower', [0, 0, 0.88], [0, 1.45, 0.88], '#334155', 4.5);
    const midHand = [
      (pose3D.lHand[0] + pose3D.rHand[0]) / 2,
      (pose3D.lHand[1] + pose3D.rHand[1]) / 2,
      (pose3D.lHand[2] + pose3D.rHand[2]) / 2,
    ];
    addLine('row-cable', [0, 0.90, 0.88], midHand, '#10b981', 2.2, '4 3');
    addLine('row-handle', pose3D.lHand, pose3D.rHand, '#38bdf8', 4);
  }

  if (config.equipment === 'lat_pulldown') {
    addPoly(
      'lat-seat',
      [
        [-0.18, 0.52, -0.20],
        [0.18, 0.52, -0.20],
        [0.18, 0.52, 0.22],
        [-0.18, 0.52, 0.22],
      ],
      'rgba(51, 65, 85, 0.8)',
      '#64748b',
      1.3
    );
    addLine('lat-post', [0, 0.52, 0], [0, 0, 0], '#475569', 4);
    const midHand = [
      (pose3D.lHand[0] + pose3D.rHand[0]) / 2,
      (pose3D.lHand[1] + pose3D.rHand[1]) / 2,
      (pose3D.lHand[2] + pose3D.rHand[2]) / 2,
    ];
    addLine('lat-cable', [0, 2.02, 0.14], midHand, '#10b981', 2.2, '4 3');
    addLine('lat-bar', pose3D.lHand, pose3D.rHand, '#38bdf8', 4.5);
  }

  if (config.equipment === 'pallof_cable') {
    addLine('pf-tower', [0.88, 0, 0.22], [0.88, 1.75, 0.22], '#334155', 4.5);
    const midHand = [
      (pose3D.lHand[0] + pose3D.rHand[0]) / 2,
      (pose3D.lHand[1] + pose3D.rHand[1]) / 2,
      (pose3D.lHand[2] + pose3D.rHand[2]) / 2,
    ];
    addLine('pf-cable', [0.88, 1.18, 0.22], midHand, '#10b981', 2.4, '4 3');
    addWeight('pf-handle', midHand, 5, '#38bdf8');
  }

  if (config.equipment === 'pullup_bar') {
    addLine('pu-post-l', [0.62, 0, 0], [0.62, 1.96, 0], '#334155', 4.5);
    addLine('pu-post-r', [-0.62, 0, 0], [-0.62, 1.96, 0], '#334155', 4.5);
    addLine('pu-bar', [0.62, 1.96, 0], [-0.62, 1.96, 0], '#38bdf8', 5);
  }

  if (config.equipment === 'pushdown_cable') {
    const midHand = [
      (pose3D.lHand[0] + pose3D.rHand[0]) / 2,
      (pose3D.lHand[1] + pose3D.rHand[1]) / 2,
      (pose3D.lHand[2] + pose3D.rHand[2]) / 2,
    ];
    addLine('pd-tower', [0, 0, 0.36], [0, 2.05, 0.36], '#334155', 4.5);
    addLine('pd-cable', [0, 2.05, 0.36], midHand, '#10b981', 2.2, '4 3');
    addLine('pd-bar', pose3D.lHand, pose3D.rHand, '#38bdf8', 4.5);
  }

  if (config.equipment === 'goblet') {
    const midHand = [
      (pose3D.lHand[0] + pose3D.rHand[0]) / 2,
      (pose3D.lHand[1] + pose3D.rHand[1]) / 2,
      (pose3D.lHand[2] + pose3D.rHand[2]) / 2,
    ];
    addWeight('goblet-wt', midHand, 7.2);
  }

  if (config.equipment === 'dumbbells_pair') {
    addWeight('db-l', p.lHand, 5.8);
    addWeight('db-r', p.rHand, 5.8);
  }

  // Color palette with depth-aware foreground vs background contrast
  const legPrimary = config.focus === 'legs';
  const armPrimary = config.focus === 'arms';
  const torsoPrimary = config.focus === 'torso';

  const sideShade = (zVal, primary) => {
    const isNear = zVal >= 0;
    if (primary) return isNear ? '#34d399' : '#059669';
    return isNear ? '#38bdf8' : '#0284c7';
  };

  // Anatomical 3D Torso Volume (ribcage-to-pelvis quad)
  addPoly(
    'torso-quad',
    [p.lShoulder, p.rShoulder, p.rHip, p.lHip],
    torsoPrimary ? 'rgba(16, 185, 129, 0.26)' : 'rgba(226, 232, 240, 0.16)',
    torsoPrimary ? '#34d399' : '#cbd5e1',
    2.2
  );

  // Spine center line (neck to mid-pelvis)
  const midPelvis = [
    (pose3D.lHip[0] + pose3D.rHip[0]) / 2,
    (pose3D.lHip[1] + pose3D.rHip[1]) / 2,
    (pose3D.lHip[2] + pose3D.rHip[2]) / 2,
  ];
  addLine('spine', p.neck, proj(midPelvis), torsoPrimary ? '#6ee7b7' : '#e2e8f0', 4.2);

  // Legs (Left & Right bilateral segments)
  const lLegColor = sideShade((p.lKnee.z + p.lHip.z) / 2, legPrimary);
  const rLegColor = sideShade((p.rKnee.z + p.rHip.z) / 2, legPrimary);
  addLine('l-thigh', p.lHip, p.lKnee, lLegColor, 6.4);
  addLine('l-shin', p.lKnee, p.lAnkle, lLegColor, 5.4);
  addLine('l-foot', p.lAnkle, p.lFoot, lLegColor, 4.2);

  addLine('r-thigh', p.rHip, p.rKnee, rLegColor, 6.4);
  addLine('r-shin', p.rKnee, p.rAnkle, rLegColor, 5.4);
  addLine('r-foot', p.rAnkle, p.rFoot, rLegColor, 4.2);

  // Arms (Left & Right bilateral segments)
  const lArmColor = sideShade((p.lElbow.z + p.lShoulder.z) / 2, armPrimary);
  const rArmColor = sideShade((p.rElbow.z + p.rShoulder.z) / 2, armPrimary);
  addLine('l-uarm', p.lShoulder, p.lElbow, lArmColor, 5.2);
  addLine('l-farm', p.lElbow, p.lHand, lArmColor, 4.4);

  addLine('r-uarm', p.rShoulder, p.rElbow, rArmColor, 5.2);
  addLine('r-farm', p.rElbow, p.rHand, rArmColor, 4.4);

  // Head + subtle facing direction dot so orientation is unambiguous at every angle
  drawItems.push({
    id: 'head',
    depth: p.head.z + 0.02,
    render: () => {
      const nose = proj([pose3D.head[0], pose3D.head[1] - 0.01, pose3D.head[2] + 0.10]);
      return (
        <g key="head">
          <circle
            cx={p.head.x}
            cy={p.head.y}
            r={Math.max(8, p.head.scale * 0.105)}
            fill="#f8fafc"
            stroke="#10b981"
            strokeWidth="2"
          />
          {nose.z > p.head.z - 0.02 && (
            <circle cx={nose.x} cy={nose.y} r="2.2" fill="#0f172a" />
          )}
        </g>
      );
    },
  });

  // Key joint nodes (shoulders, elbows, hips, knees)
  const jointNodes = [
    ['j-ls', p.lShoulder],
    ['j-rs', p.rShoulder],
    ['j-le', p.lElbow],
    ['j-re', p.rElbow],
    ['j-lh', p.lHip],
    ['j-rh', p.rHip],
    ['j-lk', p.lKnee],
    ['j-rk', p.rKnee],
  ];
  for (const [id, jp] of jointNodes) {
    drawItems.push({
      id,
      depth: jp.z + 0.015,
      render: () => (
        <circle
          key={id}
          cx={jp.x}
          cy={jp.y}
          r="3"
          fill="#0b0f17"
          stroke={jp.z >= 0 ? '#34d399' : '#0284c7'}
          strokeWidth="1.8"
        />
      ),
    });
  }

  // Painter's algorithm sort: back-to-front (lowest depth first)
  drawItems.sort((a, b) => a.depth - b.depth);

  const phaseIndex = progress < 0.2 ? 0 : progress < 0.65 ? 1 : 2;
  const phaseText = config.phaseLabels[phaseIndex] || '';
  const activePreset = autoOrbit ? 'orbit' : closestPresetId(yaw);

  return (
    <div ref={rootRef} className={`animator-box ${compact ? 'animator-compact' : ''}`}>
      <div className="animator-header">
        <span className="animator-badge">{config.label}</span>
        <span className="animator-phase">{phaseText}</span>
      </div>

      {/* Multi-Angle Camera Switcher */}
      <div className="angle-toolbar" role="group" aria-label="Camera angle">
        {ANGLE_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className={`angle-pill ${activePreset === preset.id ? 'angle-pill-active' : ''}`}
            onClick={() => {
              setAutoOrbit(false);
              setYaw(preset.yaw);
            }}
          >
            {preset.label}
          </button>
        ))}
        <button
          type="button"
          className={`angle-pill angle-orbit ${autoOrbit ? 'angle-pill-active' : ''}`}
          onClick={() => setAutoOrbit((o) => !o)}
          aria-pressed={autoOrbit}
        >
          <OrbitIcon size={13} />
          <span>360°</span>
        </button>
        <span className="angle-deg">{Math.round(yaw)}°</span>
      </div>

      {/* Interactive 3D Viewport (Drag horizontally to rotate) */}
      <div
        className="animator-stage"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        title="Drag left or right to rotate angle"
      >
        <svg
          viewBox="0 0 260 188"
          className="animator-svg"
          role="img"
          aria-label={`${config.label} form animation at ${Math.round(yaw)} degrees`}
        >
          <defs>
            <radialGradient id={glowId} cx="50%" cy="52%" r="50%">
              <stop offset="0%" stopColor="rgba(16,185,129,0.20)" />
              <stop offset="100%" stopColor="rgba(16,185,129,0)" />
            </radialGradient>
          </defs>

          <circle cx="130" cy="96" r="76" fill={`url(#${glowId})`} />

          {/* 3D Perspective Floor Grid */}
          <g stroke="#1e293b" strokeWidth="1" opacity="0.75">
            {gridLines.map((gl) => (
              <line key={gl.key} x1={gl.x1} y1={gl.y1} x2={gl.x2} y2={gl.y2} />
            ))}
          </g>

          {/* Depth-sorted 3D Skeleton & Equipment */}
          {drawItems.map((item) => item.render())}
        </svg>

        <span className="drag-hint">Drag to rotate</span>
      </div>

      {config.angleHint && <div className="angle-hint">{config.angleHint}</div>}

      <div className="animator-controls">
        <button
          type="button"
          className="mini-btn"
          onClick={() => setPlaying((pl) => !pl)}
          aria-label={playing ? 'Pause animation' : 'Play animation'}
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
          <span>{playing ? 'Pause' : 'Play'}</span>
        </button>

        <button
          type="button"
          className={`mini-btn ${speed === 0.5 ? 'mini-btn-active' : ''}`}
          onClick={() => setSpeed((s) => (s === 1 ? 0.5 : 1))}
        >
          {speed === 0.5 ? '0.5x Slow' : '1x'}
        </button>

        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={progress}
          aria-label="Scrub movement phase"
          className="scrub-slider"
          onChange={(e) => {
            setPlaying(false);
            setProgress(parseFloat(e.target.value));
          }}
        />
      </div>
    </div>
  );
}
