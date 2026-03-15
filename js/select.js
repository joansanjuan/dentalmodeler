import * as THREE from "three";
import { ShapeUtils } from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { STLExporter } from "three/addons/exporters/STLExporter.js";
import { FontLoader } from "three/addons/loaders/FontLoader.js";
import { TextGeometry } from "three/addons/geometries/TextGeometry.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { Brush, Evaluator, ADDITION, SUBTRACTION } from "three-bvh-csg";

/* ===== Spinner helpers ===== */
const spinnerOverlay = document.getElementById("spinnerOverlay");
function showSpinner() { spinnerOverlay.classList.add("active"); }
function hideSpinner() { spinnerOverlay.classList.remove("active"); }
// Yields two frames so the browser paints the spinner, then runs fn synchronously
function withSpinner(fn) {
  showSpinner();
  return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => {
    try { fn(); } finally { hideSpinner(); resolve(); }
  })));
}

/* ===== DOM elements ===== */
const container        = document.getElementById("viewer");
const stlInput         = document.getElementById("stlInput");
const dropZone         = document.getElementById("dropZone");
const infoEl           = document.getElementById("info");

const brushRadiusRange = document.getElementById("brushRadiusRange");

const btnClear         = document.getElementById("btnClear");
const btnUndo          = document.getElementById("btnUndo");
const btnRedo          = document.getElementById("btnRedo");
const btnClose         = document.getElementById("btnClose");
const btnDelete        = document.getElementById("btnDelete");
const btnDownload      = document.getElementById("btnDownload");

const planeTypeSelect      = document.getElementById("planeTypeSelect");
const axisPositionControl  = document.getElementById("axisPositionControl");
const extrudePosRange      = document.getElementById("extrudePosRange");
const btnExtrude           = document.getElementById("btnExtrude");

const textInput        = document.getElementById("textInput");
const sizeRange        = document.getElementById("sizeRange");
const depthRange       = document.getElementById("depthRange");

const btnAutoBase           = document.getElementById("btnAutoBase");
const btnHollow             = document.getElementById("btnHollow");
const hollowThicknessInput  = document.getElementById("hollowThicknessInput");
const btnTestVoxel          = document.getElementById("btnTestVoxel");
const btnClearVoxel         = document.getElementById("btnClearVoxel");
const btnToggleMesh         = document.getElementById("btnToggleMesh");
const btnDownloadVoxel      = document.getElementById("btnDownloadVoxel");
const btnErodeVoxel         = document.getElementById("btnErodeVoxel");
const btnDownloadEroded     = document.getElementById("btnDownloadEroded");
const voxelSizeInput        = document.getElementById("voxelSizeInput");
const voxelThicknessInput   = document.getElementById("voxelThicknessInput");
const btnPickTextPoint      = document.getElementById("btnPickTextPoint");
const pickInfo              = document.getElementById("pickInfo");
const btnApplyText          = document.getElementById("btnApplyText");
const btnReset              = document.getElementById("btnReset");
const btnUpdateTextPreview  = document.getElementById("btnUpdateTextPreview");

const brushRadiusVal   = document.getElementById("brushRadiusVal");
const extrudePosVal    = document.getElementById("extrudePosVal");
const sizeVal          = document.getElementById("sizeVal");
const depthVal         = document.getElementById("depthVal");

const segSection  = document.getElementById("segSection");
const btnLoadSeg  = document.getElementById("btnLoadSeg");
const segInput    = document.getElementById("segInput");
const segInfo     = document.getElementById("segInfo");

const btnDetectPlane   = document.getElementById("btnDetectPlane");
const planeOffsetRange = document.getElementById("planeOffsetRange");
const planeOffsetVal   = document.getElementById("planeOffsetVal");
const planeControls    = document.getElementById("planeControls");

/* ===== Mode switcher ===== */
const modeBtns   = document.querySelectorAll(".mode-btn");
const modePanels = document.querySelectorAll(".mode-panel");

modeBtns.forEach(btn => {
  btn.addEventListener("click", () => {
    const mode = btn.dataset.mode;
    modeBtns.forEach(b => b.classList.toggle("active", b === btn));
    modePanels.forEach(p => { p.style.display = p.dataset.mode === mode ? "" : "none"; });
  });
});

/* ===== Three.js scene setup ===== */
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xe8ecf1);

const camera = new THREE.PerspectiveCamera(
  60,
  container.clientWidth / container.clientHeight,
  0.1,
  100000
);
camera.position.set(0, 0, 100);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(container.clientWidth, container.clientHeight);
container.appendChild(renderer.domElement);

const orbitControls = new OrbitControls(camera, renderer.domElement);
orbitControls.enableDamping = true;
orbitControls.mouseButtons = {
  LEFT:   -1,                   // handled manually (select / brush)
  MIDDLE: THREE.MOUSE.PAN,      // rueda pulsada = trasladar
  RIGHT:  THREE.MOUSE.ROTATE,   // botón derecho = orbitar
};

scene.add(new THREE.HemisphereLight(0xffffff, 0x223355, 0.9));
const d1 = new THREE.DirectionalLight(0xffffff, 0.9);
d1.position.set(1, 1, 1);
scene.add(d1);
const d2 = new THREE.DirectionalLight(0xffffff, 0.5);
d2.position.set(-1, 0.4, -0.8);
scene.add(d2);


/* ===== Colors & materials ===== */
const BASE_COLOR = new THREE.Color(0x7dd3fc);
const SEL_COLOR  = new THREE.Color(0xff6b6b);

const material = new THREE.MeshStandardMaterial({
  vertexColors: true,
  metalness: 0.2,
  roughness: 0.6,
});

const backMaterial = new THREE.MeshStandardMaterial({
  color: new THREE.Color(0x7dd3fc).multiplyScalar(0.45),
  side: THREE.BackSide,
  metalness: 0.1,
  roughness: 0.8,
});

const textMaterial = new THREE.MeshStandardMaterial({
  color: 0xffd166,
  metalness: 0.1,
  roughness: 0.7,
});

const boundaryMat = new THREE.LineBasicMaterial({ color: 0xfbbf24 });

/* ===== State ===== */
const loader   = new STLLoader();
const exporter = new STLExporter();
const evaluator = new Evaluator();
evaluator.attributes = ["position", "normal"];

let mesh           = null;
let innerMesh      = null;
let bbox           = null;
let selectedSet    = new Set();
let boundaryLines  = null;
let isPainting     = false;
let preExtrusionState = null;
let loadedFilename = "result";

// Emboss/deboss state
let font             = null;
let originalGeometry = null;
let previewTextMesh  = null;
let pickRectMesh     = null;   // rectangle outline shown while isPickingTextPoint
let pickRectDims     = null;   // { w, h } cached text bbox for the rectangle

// Text placement
let isPickingTextPoint = false;
let currentHoverHit    = null;   // the picked point (set on click, not on hover)
let previewParamsKey   = "";

// Segmentation state
let objOriginalIndices  = null;  // index buffer saved before toNonIndexed (for JSON label mapping)
let segmentationColors  = null;  // Float32Array: per-vertex base colors when seg is loaded

function restoreBaseColor(col, i) {
  if (segmentationColors) {
    col.setXYZ(i, segmentationColors[i*3], segmentationColors[i*3+1], segmentationColors[i*3+2]);
  } else {
    col.setXYZ(i, BASE_COLOR.r, BASE_COLOR.g, BASE_COLOR.b);
  }
}

function fdiToColor(label) {
  if (!label) return new THREE.Color(0xf9a8b8); // gingiva: pink
  const quadrant = Math.floor(label / 10); // 1–4
  const tooth    = (label % 10) - 1;       // 0–7
  const hue = ((quadrant - 1) * 0.25 + tooth * 0.03125) % 1;
  return new THREE.Color().setHSL(hue, 0.65, 0.55);
}

/* ===== Undo / Redo stacks ===== */
const undoStack = [];
const redoStack = [];

function captureState() {
  return {
    positions: new Float32Array(mesh.geometry.attributes.position.array),
    colors:    new Float32Array(mesh.geometry.attributes.color.array),
    selected:  new Set(selectedSet),
  };
}

function restoreState(state) {
  const newGeom = new THREE.BufferGeometry();
  newGeom.setAttribute("position", new THREE.Float32BufferAttribute(state.positions.slice(), 3));
  newGeom.setAttribute("color",    new THREE.Float32BufferAttribute(state.colors.slice(), 3));
  newGeom.computeVertexNormals();
  newGeom.computeBoundingBox();
  newGeom.computeBoundingSphere();
  mesh.geometry.dispose();
  mesh.geometry = newGeom;
  innerMesh.geometry = newGeom;
  bbox = newGeom.boundingBox.clone();
  selectedSet = new Set(state.selected);
  updateBoundaryLines(newGeom);
  updateExtrudePosDefault();
  updateInfo();
}

function pushUndo() {
  undoStack.push(captureState());
  if (undoStack.length > 20) undoStack.shift();
  redoStack.length = 0;
  btnUndo.disabled = false;
  btnRedo.disabled = true;
}

/* ===== Extrusion plane visualization ===== */
let extrudePlane = null;
const extrudePlaneMat = new THREE.MeshBasicMaterial({
  color: 0x3b82f6,
  transparent: true,
  opacity: 0.2,
  side: THREE.DoubleSide,
  depthWrite: false,
});

function updateExtrusionPlane() {
  if (extrudePlane) {
    scene.remove(extrudePlane);
    extrudePlane.geometry.dispose();
    extrudePlane = null;
  }
  if (!mesh || !bbox) return;
  const axis = planeTypeSelect.value;
  if (axis === 'none' || axis === 'occlusal') return;
  const pos = parseFloat(extrudePosRange.value) || 0;
  const size = new THREE.Vector3();
  bbox.getSize(size);
  const center = new THREE.Vector3();
  bbox.getCenter(center);
  const planeSize = Math.max(size.x, size.y, size.z) * 1.5;
  const geom = new THREE.PlaneGeometry(planeSize, planeSize);
  extrudePlane = new THREE.Mesh(geom, extrudePlaneMat);
  if (axis === 'y') {
    extrudePlane.rotation.x = Math.PI / 2;
    extrudePlane.position.set(center.x, pos, center.z);
  } else if (axis === 'z') {
    extrudePlane.position.set(center.x, center.y, pos);
  } else {
    extrudePlane.rotation.y = Math.PI / 2;
    extrudePlane.position.set(pos, center.y, center.z);
  }
  scene.add(extrudePlane);
}

/* ===== Segmentation JSON ===== */
function applySegJSON(text) {
  let json;
  try { json = JSON.parse(text); }
  catch { segInfo.textContent = "Invalid JSON file."; return; }

  const labels = json.labels;
  if (!Array.isArray(labels)) { segInfo.textContent = "No 'labels' array found in JSON."; return; }

  const col = mesh.geometry.attributes.color;
  const n   = col.count;
  const buf = new Float32Array(n * 3);
  const uniqueTeeth = new Set();

  for (let i = 0; i < n; i++) {
    const origIdx = objOriginalIndices ? objOriginalIndices[i] : i;
    const label   = (origIdx < labels.length) ? labels[origIdx] : 0;
    if (label !== 0) uniqueTeeth.add(label);
    const c = fdiToColor(label);
    buf[i*3] = c.r; buf[i*3+1] = c.g; buf[i*3+2] = c.b;
    col.setXYZ(i, c.r, c.g, c.b);
  }
  col.needsUpdate = true;
  segmentationColors = buf;
  selectedSet.clear();
  updateInfo();

  const jaw = json.jaw ? ` · ${json.jaw}` : "";
  segInfo.textContent = `${uniqueTeeth.size} teeth detected${jaw}`;
}

btnLoadSeg.addEventListener("click", () => segInput.click());

segInput.addEventListener("change", (e) => {
  const f = e.target.files?.[0];
  if (!f || !mesh) return;
  const reader = new FileReader();
  reader.onload = (ev) => { applySegJSON(ev.target.result); segInput.value = ""; };
  reader.readAsText(f);
});

/* ===== Occlusal plane state ===== */
let occlusalPlane       = null;   // THREE.Mesh helper
let occlusalNormal      = null;   // THREE.Vector3 detected normal
let occlusalCenter      = null;   // THREE.Vector3 detected center (offset=0)

const occlusalPlaneMat = new THREE.MeshBasicMaterial({
  color: 0x10b981, transparent: true, opacity: 0.25,
  side: THREE.DoubleSide, depthWrite: false,
});

/* Jacobi eigendecomposition for 3×3 symmetric matrix.
   S = [[s00,s01,s02],[s01,s11,s12],[s02,s12,s22]]
   Returns [{val, vec}, ...] sorted ascending by eigenvalue. */
function jacobi3(S) {
  let a = S.map(r => [...r]);
  let v = [[1,0,0],[0,1,0],[0,0,1]]; // columns = eigenvectors
  for (let iter = 0; iter < 60; iter++) {
    let max = 0, p = 0, q = 1;
    for (let i = 0; i < 3; i++)
      for (let j = i+1; j < 3; j++)
        if (Math.abs(a[i][j]) > max) { max = Math.abs(a[i][j]); p = i; q = j; }
    if (max < 1e-12) break;
    const tau = (a[q][q] - a[p][p]) / (2 * a[p][q]);
    const t   = tau >= 0 ? 1/(tau + Math.sqrt(1+tau*tau)) : 1/(tau - Math.sqrt(1+tau*tau));
    const c   = 1 / Math.sqrt(1 + t*t);
    const s   = t * c;
    const app = a[p][p], aqq = a[q][q], apq = a[p][q];
    a[p][p] = app - t*apq;
    a[q][q] = aqq + t*apq;
    a[p][q] = a[q][p] = 0;
    for (let r = 0; r < 3; r++) {
      if (r !== p && r !== q) {
        const apr = a[p][r], aqr = a[q][r];
        a[p][r] = a[r][p] = c*apr - s*aqr;
        a[q][r] = a[r][q] = s*apr + c*aqr;
      }
    }
    for (let r = 0; r < 3; r++) {
      const vp = v[r][p], vq = v[r][q];
      v[r][p] = c*vp - s*vq;
      v[r][q] = s*vp + c*vq;
    }
  }
  return [0,1,2]
    .map(i => ({ val: a[i][i], vec: new THREE.Vector3(v[0][i], v[1][i], v[2][i]).normalize() }))
    .sort((a, b) => a.val - b.val);
}

function runOcclusalDetection() {
  const pos = mesh.geometry.attributes.position.array;
  const n   = pos.length / 3;

  // 1. Global centroid
  let cx=0, cy=0, cz=0;
  for (let i=0; i<pos.length; i+=3) { cx+=pos[i]; cy+=pos[i+1]; cz+=pos[i+2]; }
  cx/=n; cy/=n; cz/=n;

  // 2. Global covariance → initial normal (smallest eigenvalue)
  let c00=0,c01=0,c02=0,c11=0,c12=0,c22=0;
  for (let i=0; i<pos.length; i+=3) {
    const dx=pos[i]-cx, dy=pos[i+1]-cy, dz=pos[i+2]-cz;
    c00+=dx*dx; c01+=dx*dy; c02+=dx*dz; c11+=dy*dy; c12+=dy*dz; c22+=dz*dz;
  }
  const inv = 1/n;
  const eig1 = jacobi3([[c00*inv,c01*inv,c02*inv],[c01*inv,c11*inv,c12*inv],[c02*inv,c12*inv,c22*inv]]);
  let normal = eig1[0].vec;

  // 3. Project all verts, take top 15% (cuspid tips)
  const projs = [];
  for (let i=0; i<pos.length; i+=3)
    projs.push(normal.x*(pos[i]-cx) + normal.y*(pos[i+1]-cy) + normal.z*(pos[i+2]-cz));
  const sorted = projs.slice().sort((a,b) => b-a);
  const threshold = sorted[Math.floor(sorted.length * 0.15)];

  // 4. Centroid + covariance of cuspid region
  let tx=0,ty=0,tz=0,tn=0;
  let d00=0,d01=0,d02=0,d11=0,d12=0,d22=0;
  for (let i=0; i<pos.length; i+=3) {
    if (projs[i/3] < threshold) continue;
    tx+=pos[i]; ty+=pos[i+1]; tz+=pos[i+2]; tn++;
  }
  if (!tn) return { normal, center: new THREE.Vector3(cx,cy,cz) };
  tx/=tn; ty/=tn; tz/=tn;
  for (let i=0; i<pos.length; i+=3) {
    if (projs[i/3] < threshold) continue;
    const dx=pos[i]-tx, dy=pos[i+1]-ty, dz=pos[i+2]-tz;
    d00+=dx*dx; d01+=dx*dy; d02+=dx*dz; d11+=dy*dy; d12+=dy*dz; d22+=dz*dz;
  }
  const inv2 = 1/tn;
  const eig2 = jacobi3([[d00*inv2,d01*inv2,d02*inv2],[d01*inv2,d11*inv2,d12*inv2],[d02*inv2,d12*inv2,d22*inv2]]);
  normal = eig2[0].vec;
  if (normal.y < 0) normal.negate(); // ensure normal points generally upward

  // Compute center using only PERIPHERAL vertices (outer rim of the arch).
  // Key: palate vertices are always INTERIOR to the horseshoe arch in the plane ⊥ N.
  // The highest peripheral vertex = cusp tip. Palate apex is interior → excluded.
  const nVerts = pos.length / 3;

  // Orthonormal basis in the plane ⊥ normal
  const pu = new THREE.Vector3(Math.abs(normal.x) < 0.9 ? 1 : 0, Math.abs(normal.x) < 0.9 ? 0 : 1, 0);
  pu.addScaledVector(normal, -normal.dot(pu)).normalize();
  const pv = new THREE.Vector3().crossVectors(normal, pu);

  // Project every vertex onto (N, U, V)
  const projN = new Float32Array(nVerts);
  const projU = new Float32Array(nVerts);
  const projV = new Float32Array(nVerts);
  for (let vi = 0; vi < nVerts; vi++) {
    const x = pos[vi*3], y = pos[vi*3+1], z = pos[vi*3+2];
    projN[vi] = normal.x*x + normal.y*y + normal.z*z;
    projU[vi] = pu.x*x + pu.y*y + pu.z*z;
    projV[vi] = pv.x*x + pv.y*y + pv.z*z;
  }

  // 2D centroid reference: prefer the centroid of BOUNDARY vertices (gingival margin ring)
  // because it is always robustly inside the horseshoe regardless of whether the scan
  // has a closed base or not. Fallback to all-vertex centroid for closed (solid) meshes.
  const triCount2 = Math.floor(pos.length / 9);
  const bBox = mesh.geometry.boundingBox || new THREE.Box3().setFromBufferAttribute({ array: pos, itemSize: 3, count: nVerts });
  const bSz = new THREE.Vector3(); bBox.getSize(bSz);
  const tolB = Math.max(bSz.x, bSz.y, bSz.z) * 1e-4 || 1e-6;
  function qvB(idx) {
    return `${Math.round(pos[idx*3]/tolB)},${Math.round(pos[idx*3+1]/tolB)},${Math.round(pos[idx*3+2]/tolB)}`;
  }
  const bEdgeMap = new Map();
  for (let tri = 0; tri < triCount2; tri++) {
    for (let e = 0; e < 3; e++) {
      const vA = tri*3+e, vB = tri*3+(e+1)%3;
      const key = (() => { const a = qvB(vA), b = qvB(vB); return a < b ? `${a}||${b}` : `${b}||${a}`; })();
      if (!bEdgeMap.has(key)) bEdgeMap.set(key, { vA, count: 0 });
      bEdgeMap.get(key).count++;
    }
  }
  let cu = 0, cv = 0, bCount = 0;
  bEdgeMap.forEach(({ vA, count }) => {
    if (count !== 1) return;
    cu += projU[vA]; cv += projV[vA]; bCount++;
  });
  if (bCount > 0) { cu /= bCount; cv /= bCount; }
  else {
    // Closed mesh (solid model): use all-vertex centroid
    for (let vi = 0; vi < nVerts; vi++) { cu += projU[vi]; cv += projV[vi]; }
    cu /= nVerts; cv /= nVerts;
  }

  // Radial distance from 2D centroid
  const radial = new Float32Array(nVerts);
  for (let vi = 0; vi < nVerts; vi++) {
    const du = projU[vi] - cu, dv = projV[vi] - cv;
    radial[vi] = Math.sqrt(du*du + dv*dv);
  }

  // Keep only the outer 25% (most peripheral) — palate is always interior, never here
  const rArr = Array.from(radial).sort((a, b) => b - a);
  const rThresh = rArr[Math.floor(nVerts * 0.25)];

  // Among peripheral vertices, take the top 15% by N projection (the cusp tips)
  const periProjs = [];
  for (let vi = 0; vi < nVerts; vi++)
    if (radial[vi] >= rThresh) periProjs.push(projN[vi]);
  periProjs.sort((a, b) => b - a);
  const pNThresh = periProjs[Math.floor(periProjs.length * 0.15)];

  let ox = 0, oy = 0, oz = 0, on2 = 0;
  for (let vi = 0; vi < nVerts; vi++) {
    if (radial[vi] < rThresh || projN[vi] < pNThresh) continue;
    ox += pos[vi*3]; oy += pos[vi*3+1]; oz += pos[vi*3+2]; on2++;
  }
  const center = on2 > 0
    ? new THREE.Vector3(ox / on2, oy / on2, oz / on2)
    : new THREE.Vector3(tx, ty, tz);

  return { normal, center };
}

function showOcclusalPlane(center, normal) {
  if (occlusalPlane) { scene.remove(occlusalPlane); occlusalPlane.geometry.dispose(); }
  const size = new THREE.Vector3();
  bbox.getSize(size);
  const planeSize = Math.max(size.x, size.y, size.z) * 1.6;
  const geo = new THREE.PlaneGeometry(planeSize, planeSize);
  occlusalPlane = new THREE.Mesh(geo, occlusalPlaneMat);
  occlusalPlane.position.copy(center);
  occlusalPlane.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1), normal);
  occlusalPlane.renderOrder = 1;
  scene.add(occlusalPlane);
}

function updateOcclusalOffset() {
  if (!occlusalPlane || !occlusalNormal || !occlusalCenter) return;
  const offset = parseFloat(planeOffsetRange.value);
  occlusalPlane.position.copy(occlusalCenter).addScaledVector(occlusalNormal, offset);
}

btnDetectPlane.addEventListener("click", () => {
  if (!mesh) return;
  withSpinner(() => {
  const result = runOcclusalDetection();
  occlusalNormal = result.normal;
  occlusalCenter = result.center.clone();

  // set offset slider range based on model size
  const size = new THREE.Vector3();
  bbox.getSize(size);
  const halfRange = Math.max(size.x, size.y, size.z) * 0.6;
  planeOffsetRange.min  = (-halfRange).toFixed(2);
  planeOffsetRange.max  = ( halfRange).toFixed(2);
  planeOffsetRange.step = (halfRange / 200).toFixed(3);
  planeOffsetRange.value = 0;
  planeOffsetVal.textContent = "0.0";

  showOcclusalPlane(occlusalCenter, occlusalNormal);
  planeControls.style.display = "";
  }); // withSpinner
});

planeOffsetRange.addEventListener("input", () => {
  planeOffsetVal.textContent = parseFloat(planeOffsetRange.value).toFixed(1);
  updateOcclusalOffset();
});


/* ===== Range slider sync helpers ===== */
brushRadiusRange.addEventListener("input", () => {
  brushRadiusVal.textContent = parseFloat(brushRadiusRange.value).toFixed(2);
});

extrudePosRange.addEventListener("input", () => {
  extrudePosVal.textContent = parseFloat(extrudePosRange.value).toFixed(2);
  updateExtrusionPlane();
});

sizeRange.addEventListener("input", () => { sizeVal.textContent = parseFloat(sizeRange.value).toFixed(1); });

depthRange.addEventListener("input", () => { depthVal.textContent = parseFloat(depthRange.value).toFixed(1); });

/* ===== updateExtrudePosDefault ===== */
function updateExtrudePosDefault() {
  if (!bbox) return;
  const axis = planeTypeSelect.value;
  if (axis === 'none' || axis === 'occlusal') return;
  const minV = axis === 'y' ? bbox.min.y : axis === 'z' ? bbox.min.z : bbox.min.x;
  const maxV = axis === 'y' ? bbox.max.y : axis === 'z' ? bbox.max.z : bbox.max.x;
  const range = maxV - minV;
  extrudePosRange.min = (minV - range * 2.0).toFixed(2);
  extrudePosRange.max = (maxV + range * 2.0).toFixed(2);
  extrudePosRange.step = (range / 500).toFixed(3);
  extrudePosRange.value = minV.toFixed(2);
  extrudePosVal.textContent = parseFloat(minV).toFixed(2);
  updateExtrusionPlane();
}

/* ===== updateBrushRange ===== */
function updateBrushRange() {
  if (!bbox) return;
  const size = new THREE.Vector3();
  bbox.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z);
  brushRadiusRange.min = (maxDim * 0.001).toFixed(3);
  brushRadiusRange.max = (maxDim * 0.05).toFixed(2);
  brushRadiusRange.step = (maxDim * 0.001).toFixed(3);
  brushRadiusRange.value = 1;
  brushRadiusVal.textContent = "1.00";
}

/* ===== setEnabled ===== */
function setEnabled(enabled) {
  brushRadiusRange.disabled = !enabled;
  btnDelete.disabled   = !enabled;
  btnDownload.disabled       = !enabled;
  planeTypeSelect.disabled   = !enabled;
  extrudePosRange.disabled   = !enabled;
  btnExtrude.disabled        = !enabled;
  sizeRange.disabled         = !enabled;
  depthRange.disabled        = !enabled;
  btnPickTextPoint.disabled  = !enabled;
  btnApplyText.disabled      = !enabled;
  btnReset.disabled          = !enabled;
  btnDetectPlane.disabled = !enabled;
  btnAutoBase.disabled           = !enabled;
  btnHollow.disabled             = !enabled;
  hollowThicknessInput.disabled  = !enabled;
  btnTestVoxel.disabled          = !enabled;
  btnClearVoxel.disabled         = !enabled;
  btnToggleMesh.disabled         = !enabled;
  btnDownloadVoxel.disabled      = !enabled;
  btnErodeVoxel.disabled         = !enabled;
  voxelSizeInput.disabled        = !enabled;
  voxelThicknessInput.disabled   = !enabled;
  if (!enabled) { btnUndo.disabled = true; btnRedo.disabled = true; }
}

/* ===== Info text ===== */
function updateInfo() {
  if (!mesh) return;
  const total = Math.floor(mesh.geometry.attributes.position.count / 3);
  const sel = selectedSet.size;
  infoEl.textContent = `Triangles: ${total.toLocaleString()} | Selected: ${sel.toLocaleString()}`;
}

/* ===== Camera fit ===== */
function fitCameraToObject(object) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const fov = (camera.fov * Math.PI) / 180;
  let cameraZ = Math.abs((maxDim / 2) / Math.tan(fov / 2)) * 1.6;
  camera.near = Math.max(cameraZ / 100, 0.01);
  camera.far = cameraZ * 200;
  camera.updateProjectionMatrix();
  camera.position.set(center.x + cameraZ, center.y + cameraZ * 0.35, center.z + cameraZ);
  orbitControls.target.copy(center);
  orbitControls.update();
}

/* ===== Vertex colors ===== */
function initVertexColors(geometry) {
  const count = geometry.attributes.position.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3]     = BASE_COLOR.r;
    colors[i * 3 + 1] = BASE_COLOR.g;
    colors[i * 3 + 2] = BASE_COLOR.b;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
}

/* ===== Paint logic ===== */
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();


/* ===== Brush cursor ===== */
const brushCursorMat = new THREE.MeshBasicMaterial({
  color: 0xef4444, transparent: true, opacity: 0.7,
  side: THREE.DoubleSide, depthTest: false,
});
let brushCursor = null;
let brushCursorRadius = -1;

function updateBrushCursor(event) {
  if (!mesh || isPickingTextPoint) { if (brushCursor) brushCursor.visible = false; return null; }

  getMouseNDC(event);
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObject(mesh);
  if (!hits.length) { if (brushCursor) brushCursor.visible = false; return null; }

  const radius = Number(brushRadiusRange.value) || 1;
  if (!brushCursor || brushCursorRadius !== radius) {
    if (brushCursor) { scene.remove(brushCursor); brushCursor.geometry.dispose(); }
    const geo = new THREE.RingGeometry(radius * 0.9, radius, 64);
    brushCursor = new THREE.Mesh(geo, brushCursorMat);
    brushCursor.renderOrder = 999;
    brushCursorRadius = radius;
    scene.add(brushCursor);
  }

  const hit = hits[0];
  const normal = hit.face.normal.clone().transformDirection(mesh.matrixWorld).normalize();
  brushCursor.position.copy(hit.point).addScaledVector(normal, 0.05);
  brushCursor.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
  brushCursor.visible = true;
  return hit;
}

renderer.domElement.addEventListener("mouseleave", () => {
  if (brushCursor) brushCursor.visible = false;
});

function paintAtPoint(worldPoint) {
  if (!mesh) return;
  const pos = mesh.geometry.attributes.position;
  const col = mesh.geometry.attributes.color;
  const radius = Number(brushRadiusRange.value) || 1;
  const radiusSq = radius * radius;
  const centroid = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    centroid.set(
      (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3,
      (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3,
      (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3
    );
    if (centroid.distanceToSquared(worldPoint) <= radiusSq) {
      selectedSet.add(i / 3);
      for (let j = 0; j < 3; j++) {
        col.setXYZ(i + j, SEL_COLOR.r, SEL_COLOR.g, SEL_COLOR.b);
      }
    }
  }
  col.needsUpdate = true;
  updateInfo();
}

function getMouseNDC(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x =  ((event.clientX - rect.left) / rect.width)  * 2 - 1;
  mouse.y = -((event.clientY - rect.top)  / rect.height) * 2 + 1;
}


renderer.domElement.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return;
  if (isPickingTextPoint) {
    getMouseNDC(e);
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObject(mesh);
    if (hits.length > 0) {
      currentHoverHit = hits[0];
      isPickingTextPoint = false;
      btnPickTextPoint.classList.remove("active");
      orbitControls.enabled = true;
      renderer.domElement.style.cursor = "";
      clearPickRect();
      btnUpdateTextPreview.style.display = "none";
      pickInfo.textContent = "Point set";
      previewParamsKey = "";
      withSpinner(() => {
        if (!occlusalNormal && mesh) {
          const result = runOcclusalDetection();
          occlusalNormal = result.normal;
          occlusalCenter = result.center.clone();
        }
        updateHoverPreview();
      });
    }
    return;
  }
  if (!mesh) return;
  getMouseNDC(e);
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObject(mesh);
  if (hits.length > 0) {
    isPainting = true;
    pushUndo();
    paintAtPoint(hits[0].point);
  } else {
    clearSelection();
  }
});

renderer.domElement.addEventListener("mousemove", (e) => {
  updateBrushCursor(e);
  if (isPickingTextPoint && mesh) {
    getMouseNDC(e);
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObject(mesh);
    updatePickRect(hits.length > 0 ? hits[0] : null);
    return;
  }
  if (!isPainting || !mesh) return;
  getMouseNDC(e);
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObject(mesh);
  if (hits.length > 0) paintAtPoint(hits[0].point);
});

window.addEventListener("mouseup", (e) => {
  if (e.button === 0) isPainting = false;
});

/* ===== Boundary lines ===== */
function clearBoundaryLines() {
  if (boundaryLines) {
    scene.remove(boundaryLines);
    boundaryLines.geometry.dispose();
    boundaryLines = null;
  }
}

function updateBoundaryLines(geometry) {
  if (boundaryLines) {
    scene.remove(boundaryLines);
    boundaryLines.geometry.dispose();
    boundaryLines = null;
  }
  const pos = geometry.attributes.position;
  const triCount = Math.floor(pos.count / 3);
  const box = geometry.boundingBox || new THREE.Box3().setFromBufferAttribute(pos);
  const size = new THREE.Vector3();
  box.getSize(size);
  const tol = Math.max(size.x, size.y, size.z) * 1e-4;
  function qv(idx) {
    return `${Math.round(pos.getX(idx) / tol)},${Math.round(pos.getY(idx) / tol)},${Math.round(pos.getZ(idx) / tol)}`;
  }
  const edgeMap = new Map();
  for (let tri = 0; tri < triCount; tri++) {
    const base = tri * 3;
    for (let e = 0; e < 3; e++) {
      const vA = base + e;
      const vB = base + (e + 1) % 3;
      const kA = qv(vA), kB = qv(vB);
      const key = kA < kB ? `${kA}||${kB}` : `${kB}||${kA}`;
      if (!edgeMap.has(key)) edgeMap.set(key, []);
      edgeMap.get(key).push({ vA, vB });
    }
  }
  const lineVerts = [];
  edgeMap.forEach((entries) => {
    if (entries.length === 1) {
      const { vA, vB } = entries[0];
      lineVerts.push(
        pos.getX(vA), pos.getY(vA), pos.getZ(vA),
        pos.getX(vB), pos.getY(vB), pos.getZ(vB)
      );
    }
  });
  if (!lineVerts.length) return;
  const lineGeom = new THREE.BufferGeometry();
  lineGeom.setAttribute("position", new THREE.Float32BufferAttribute(lineVerts, 3));
  boundaryLines = new THREE.LineSegments(lineGeom, boundaryMat);
  scene.add(boundaryLines);
}

/* ===== Close hole helpers ===== */
function buildLoops3D(segments, tol) {
  const keyToIdx = new Map();
  const points = [];

  function getIdx(v) {
    const key = `${Math.round(v.x / tol)},${Math.round(v.y / tol)},${Math.round(v.z / tol)}`;
    if (!keyToIdx.has(key)) { keyToIdx.set(key, points.length); points.push(v.clone()); }
    return keyToIdx.get(key);
  }

  const edges = [];
  const adj = new Map();

  for (const [p, q] of segments) {
    const a = getIdx(p);
    const b = getIdx(q);
    if (a === b) continue;
    const eid = edges.length;
    edges.push({ a, b });
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a).push({ to: b, eid });
    adj.get(b).push({ to: a, eid });
  }

  const usedEdges = new Set();
  const loops = [];

  for (let startEid = 0; startEid < edges.length; startEid++) {
    if (usedEdges.has(startEid)) continue;
    const { a, b } = edges[startEid];
    usedEdges.add(startEid);
    const idxs = [a, b];
    let prev = a, curr = b;

    for (let guard = 0; guard < 200000; guard++) {
      const nbrs = adj.get(curr) || [];
      let next = null;
      for (const n of nbrs) {
        if (!usedEdges.has(n.eid) && n.to !== prev) { next = n; break; }
      }
      if (!next) {
        for (const n of nbrs) {
          if (!usedEdges.has(n.eid)) { next = n; break; }
        }
      }
      if (!next) break;
      usedEdges.add(next.eid);
      if (next.to === idxs[0]) break;
      idxs.push(next.to);
      prev = curr; curr = next.to;
    }

    if (idxs.length >= 3) loops.push(idxs.map(i => points[i]));
  }

  return loops;
}

function triangulateLoop3D(loop) {
  if (loop.length < 3) return [];

  const normal = new THREE.Vector3();
  for (let i = 0; i < loop.length; i++) {
    const c = loop[i];
    const n = loop[(i + 1) % loop.length];
    normal.x += (c.y - n.y) * (c.z + n.z);
    normal.y += (c.z - n.z) * (c.x + n.x);
    normal.z += (c.x - n.x) * (c.y + n.y);
  }
  normal.normalize();

  const up = Math.abs(normal.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const uAxis = new THREE.Vector3().crossVectors(up, normal).normalize();
  const vAxis = new THREE.Vector3().crossVectors(normal, uAxis).normalize();

  const centroid = loop.reduce((acc, p) => acc.add(p), new THREE.Vector3()).divideScalar(loop.length);
  const poly2D = loop.map(p => {
    const d = p.clone().sub(centroid);
    return new THREE.Vector2(d.dot(uAxis), d.dot(vAxis));
  });

  let area = 0;
  for (let i = 0; i < poly2D.length; i++) {
    const p = poly2D[i], q = poly2D[(i + 1) % poly2D.length];
    area += p.x * q.y - q.x * p.y;
  }
  const orderedLoop    = area < 0 ? [...loop].reverse()    : loop;
  const orderedPoly2D  = area < 0 ? [...poly2D].reverse()  : poly2D;

  let tris;
  try { tris = ShapeUtils.triangulateShape(orderedPoly2D, []); }
  catch { return []; }

  const verts = [];
  for (const [ia, ib, ic] of tris) {
    const a = orderedLoop[ia], b = orderedLoop[ib], c = orderedLoop[ic];
    verts.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  }
  return verts;
}

/* ===== Clear selection ===== */
function clearSelection() {
  if (!mesh || !selectedSet.size) return;
  pushUndo();
  const col = mesh.geometry.attributes.color;
  for (let i = 0; i < col.count; i++) restoreBaseColor(col, i);
  selectedSet.clear();
  col.needsUpdate = true;
  updateInfo();
}

/* ===== Button: Undo ===== */
btnUndo.addEventListener("click", () => {
  if (!undoStack.length) return;
  preExtrusionState = null;
  redoStack.push(captureState());
  restoreState(undoStack.pop());
  btnUndo.disabled = undoStack.length === 0;
  btnRedo.disabled = false;
});

/* ===== Button: Redo ===== */
btnRedo.addEventListener("click", () => {
  if (!redoStack.length) return;
  preExtrusionState = null;
  undoStack.push(captureState());
  btnUndo.disabled = false;
  restoreState(redoStack.pop());
  btnRedo.disabled = redoStack.length === 0;
});

/* ===== Boundary smoothing after delete ===== */
function smoothBoundary(verts, iterations = 3, rings = 2) {
  const vc = verts.length / 3;
  const tc = vc / 3;

  // Soldar vértices por posición cuantizada
  const TOL = 1e4;
  const keyToC = new Map();
  const cXYZ = [];
  const vToC = new Int32Array(vc);
  for (let i = 0; i < vc; i++) {
    const x = verts[i*3], y = verts[i*3+1], z = verts[i*3+2];
    const k = `${Math.round(x*TOL)},${Math.round(y*TOL)},${Math.round(z*TOL)}`;
    let ci = keyToC.get(k);
    if (ci === undefined) { ci = cXYZ.length / 3; keyToC.set(k, ci); cXYZ.push(x, y, z); }
    vToC[i] = ci;
  }

  const C = cXYZ.length / 3;
  const adj = Array.from({length: C}, () => new Set());
  const edgeUse = new Map();

  for (let t = 0; t < tc; t++) {
    const a = vToC[t*3], b = vToC[t*3+1], c = vToC[t*3+2];
    adj[a].add(b); adj[a].add(c);
    adj[b].add(a); adj[b].add(c);
    adj[c].add(a); adj[c].add(b);
    for (const [u, v] of [[a,b],[b,c],[c,a]]) {
      const ek = u < v ? `${u}_${v}` : `${v}_${u}`;
      edgeUse.set(ek, (edgeUse.get(ek) || 0) + 1);
    }
  }

  // Marcar vértices de borde y expandir 'rings' anillos
  const smooth = new Uint8Array(C);
  let frontier = [];
  for (const [ek, cnt] of edgeUse) {
    if (cnt === 1) {
      const sep = ek.indexOf('_');
      const u = +ek.slice(0, sep), v = +ek.slice(sep + 1);
      if (!smooth[u]) { smooth[u] = 1; frontier.push(u); }
      if (!smooth[v]) { smooth[v] = 1; frontier.push(v); }
    }
  }
  for (let r = 1; r < rings; r++) {
    const next = [];
    for (const v of frontier) for (const nb of adj[v]) if (!smooth[nb]) { smooth[nb] = 1; next.push(nb); }
    frontier = next;
  }

  // Suavizado Laplaciano (blend 50%)
  const cx = new Float64Array(cXYZ.filter((_, i) => i % 3 === 0));
  const cy = new Float64Array(cXYZ.filter((_, i) => i % 3 === 1));
  const cz = new Float64Array(cXYZ.filter((_, i) => i % 3 === 2));
  for (let iter = 0; iter < iterations; iter++) {
    for (let i = 0; i < C; i++) {
      if (!smooth[i] || !adj[i].size) continue;
      let sx = 0, sy = 0, sz = 0;
      for (const nb of adj[i]) { sx += cx[nb]; sy += cy[nb]; sz += cz[nb]; }
      const w = adj[i].size;
      cx[i] = cx[i] * 0.5 + (sx / w) * 0.5;
      cy[i] = cy[i] * 0.5 + (sy / w) * 0.5;
      cz[i] = cz[i] * 0.5 + (sz / w) * 0.5;
    }
  }

  for (let i = 0; i < vc; i++) {
    const ci = vToC[i];
    verts[i*3] = cx[ci]; verts[i*3+1] = cy[ci]; verts[i*3+2] = cz[ci];
  }
}

/* ===== Button: Delete selection ===== */
btnDelete.addEventListener("click", () => {
  if (!mesh) return;
  withSpinner(() => {
  pushUndo();
  preExtrusionState = null;

  const pos = mesh.geometry.attributes.position;
  const newVerts = [];
  for (let i = 0; i < pos.count; i += 3) {
    if (!selectedSet.has(i / 3)) {
      for (let j = 0; j < 3; j++) {
        newVerts.push(pos.getX(i + j), pos.getY(i + j), pos.getZ(i + j));
      }
    }
  }

  if (newVerts.length === 0) {
    infoEl.textContent = "No triangles would remain after deleting the selection.";
    return;
  }

  smoothBoundary(newVerts, 8, 4);

  const newGeom = new THREE.BufferGeometry();
  newGeom.setAttribute("position", new THREE.Float32BufferAttribute(newVerts, 3));
  newGeom.computeVertexNormals();
  newGeom.computeBoundingBox();
  newGeom.computeBoundingSphere();
  initVertexColors(newGeom);

  selectedSet.clear();
  mesh.geometry.dispose();
  mesh.geometry = newGeom;
  innerMesh.geometry = newGeom;

  updateBoundaryLines(newGeom);
  updateInfo();
  }); // withSpinner
});

/* ===== Button: Download STL ===== */
btnDownload.addEventListener("click", () => {
  if (!mesh) return;
  const pos = mesh.geometry.attributes.position;
  const exportVerts = [];
  for (let i = 0; i < pos.count; i += 3) {
    if (!selectedSet.has(i / 3)) {
      for (let j = 0; j < 3; j++) {
        exportVerts.push(pos.getX(i + j), pos.getY(i + j), pos.getZ(i + j));
      }
    }
  }
  const exportGeom = new THREE.BufferGeometry();
  exportGeom.setAttribute("position", new THREE.Float32BufferAttribute(exportVerts, 3));
  exportGeom.computeVertexNormals();

  const result = exporter.parse(new THREE.Mesh(exportGeom, material), { binary: true });
  exportGeom.dispose();

  const blob = new Blob([result], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${loadedFilename}_Model.stl`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

/* ===== Button: Close hole ===== */
btnClose.addEventListener("click", () => {
  if (!mesh) return;

  const pos = mesh.geometry.attributes.position;
  const triCount = Math.floor(pos.count / 3);
  const sv = new THREE.Vector3(); bbox.getSize(sv);
  const tol = Math.max(sv.x, sv.y, sv.z) * 1e-4;

  function qv(idx) {
    return `${Math.round(pos.getX(idx)/tol)},${Math.round(pos.getY(idx)/tol)},${Math.round(pos.getZ(idx)/tol)}`;
  }

  const edgeMap = new Map();
  for (let tri = 0; tri < triCount; tri++) {
    const base = tri * 3;
    for (let e = 0; e < 3; e++) {
      const vA = base + e, vB = base + (e + 1) % 3;
      const kA = qv(vA), kB = qv(vB);
      const key = kA < kB ? `${kA}||${kB}` : `${kB}||${kA}`;
      if (!edgeMap.has(key)) edgeMap.set(key, []);
      edgeMap.get(key).push({ tri, vA, vB });
    }
  }

  const segments = [];
  if (selectedSet.size === 0) {
    // No selection → close ALL open holes (border edges: only 1 adjacent triangle)
    edgeMap.forEach((entries) => {
      if (entries.length === 1) {
        const { vA, vB } = entries[0];
        segments.push([
          new THREE.Vector3(pos.getX(vA), pos.getY(vA), pos.getZ(vA)),
          new THREE.Vector3(pos.getX(vB), pos.getY(vB), pos.getZ(vB)),
        ]);
      }
    });
  } else {
    // With selection → fill boundary of selected region
    edgeMap.forEach((entries) => {
      if (entries.length === 2) {
        const sel0 = selectedSet.has(entries[0].tri);
        const sel1 = selectedSet.has(entries[1].tri);
        if (sel0 === sel1) return;
        const side = sel0 ? entries[1] : entries[0];
        segments.push([
          new THREE.Vector3(pos.getX(side.vA), pos.getY(side.vA), pos.getZ(side.vA)),
          new THREE.Vector3(pos.getX(side.vB), pos.getY(side.vB), pos.getZ(side.vB)),
        ]);
      } else if (entries.length === 1 && selectedSet.has(entries[0].tri)) {
        const { vA, vB } = entries[0];
        segments.push([
          new THREE.Vector3(pos.getX(vA), pos.getY(vA), pos.getZ(vA)),
          new THREE.Vector3(pos.getX(vB), pos.getY(vB), pos.getZ(vB)),
        ]);
      }
    });
  }

  if (!segments.length) {
    infoEl.textContent = selectedSet.size === 0
      ? "No open holes found in this mesh."
      : "No boundary edges found in the selection.";
    return;
  }

  const loops = buildLoops3D(segments, tol);
  if (!loops.length) { infoEl.textContent = "Could not build boundary loops."; return; }

  const newVerts = [];
  for (const loop of loops) newVerts.push(...triangulateLoop3D(loop));
  if (!newVerts.length) { infoEl.textContent = "Could not triangulate the closure."; return; }

  pushUndo();
  preExtrusionState = null;

  const capVertCount = newVerts.length / 3;
  const capCol = new Float32Array(capVertCount * 3);
  for (let i = 0; i < capVertCount; i++) {
    capCol[i*3] = BASE_COLOR.r; capCol[i*3+1] = BASE_COLOR.g; capCol[i*3+2] = BASE_COLOR.b;
  }

  const allPos = new Float32Array(pos.array.length + newVerts.length);
  allPos.set(pos.array); allPos.set(newVerts, pos.array.length);

  const existingCol = mesh.geometry.attributes.color.array;
  const allCol = new Float32Array(existingCol.length + capCol.length);
  allCol.set(existingCol); allCol.set(capCol, existingCol.length);

  const newGeom = new THREE.BufferGeometry();
  newGeom.setAttribute("position", new THREE.Float32BufferAttribute(allPos, 3));
  newGeom.setAttribute("color",    new THREE.Float32BufferAttribute(allCol, 3));
  newGeom.computeVertexNormals(); newGeom.computeBoundingBox(); newGeom.computeBoundingSphere();

  mesh.geometry.dispose(); mesh.geometry = newGeom;
  innerMesh.geometry = newGeom;
  bbox = newGeom.boundingBox.clone();
  updateBoundaryLines(newGeom);

  const capTris = newVerts.length / 9;
  infoEl.textContent = selectedSet.size === 0
    ? `Closed ${loops.length} hole(s) — ${capTris} triangles added.`
    : `Cap added (${capTris} triangles). Now click "Delete selection".`;
  updateInfo();
});

/* ===== Plane type change ===== */
planeTypeSelect.addEventListener("change", () => {
  const type = planeTypeSelect.value;
  axisPositionControl.style.display = (type === 'x' || type === 'y' || type === 'z') ? "" : "none";
  btnDetectPlane.style.display      = type === 'occlusal' ? "" : "none";
  if (type !== 'occlusal') planeControls.style.display = "none";
  // hide occlusal plane mesh when switching away
  if (type !== 'occlusal' && occlusalPlane) {
    scene.remove(occlusalPlane); occlusalPlane.geometry.dispose(); occlusalPlane = null;
    occlusalNormal = null; occlusalCenter = null;
  }
  updateExtrudePosDefault();
  updateExtrusionPlane();
  refreshPickedPreview();
});

/* Remove disconnected mesh islands, keeping only the largest connected component */
function removeDisconnectedIslands(geom) {
  const pos = geom.attributes.position;
  const triCount = Math.floor(pos.count / 3);
  if (triCount === 0) return geom;

  const box = geom.boundingBox || new THREE.Box3().setFromBufferAttribute(pos);
  const size = new THREE.Vector3();
  box.getSize(size);
  const tol = Math.max(size.x, size.y, size.z) * 1e-4 || 1e-6;

  // Map quantized vertex key → triangle indices
  const vertToTris = new Map();
  function qv(idx) {
    return `${Math.round(pos.getX(idx) / tol)},${Math.round(pos.getY(idx) / tol)},${Math.round(pos.getZ(idx) / tol)}`;
  }
  for (let tri = 0; tri < triCount; tri++) {
    for (let v = 0; v < 3; v++) {
      const key = qv(tri * 3 + v);
      if (!vertToTris.has(key)) vertToTris.set(key, []);
      vertToTris.get(key).push(tri);
    }
  }

  // BFS — find all connected components
  const visited = new Uint8Array(triCount);
  const components = [];
  for (let start = 0; start < triCount; start++) {
    if (visited[start]) continue;
    const component = [];
    const queue = [start];
    visited[start] = 1;
    while (queue.length) {
      const tri = queue.pop();
      component.push(tri);
      for (let v = 0; v < 3; v++) {
        for (const nb of vertToTris.get(qv(tri * 3 + v))) {
          if (!visited[nb]) { visited[nb] = 1; queue.push(nb); }
        }
      }
    }
    components.push(component);
  }

  if (components.length <= 1) return geom;

  // Keep largest component
  components.sort((a, b) => b.length - a.length);
  const kept = components[0];

  const srcPos = pos.array;
  const srcCol = geom.attributes.color ? geom.attributes.color.array : null;
  const newPos = new Float32Array(kept.length * 9);
  const newCol = srcCol ? new Float32Array(kept.length * 9) : null;
  kept.forEach((tri, i) => {
    const s = tri * 9, d = i * 9;
    newPos.set(srcPos.subarray(s, s + 9), d);
    if (newCol) newCol.set(srcCol.subarray(s, s + 9), d);
  });

  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(newPos, 3));
  if (newCol) out.setAttribute("color", new THREE.Float32BufferAttribute(newCol, 3));
  out.computeVertexNormals();
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

/* ===== Extrude core (supports any plane: normal + point) ===== */
function performExtrude(projectFn, planeNormal, planePoint, description) {
  if (!mesh) return;

  if (preExtrusionState) {
    restoreState(preExtrusionState);
  } else {
    pushUndo();
    preExtrusionState = captureState();
  }

  const pos = mesh.geometry.attributes.position;
  const triCount = Math.floor(pos.count / 3);
  const size = new THREE.Vector3();
  bbox.getSize(size);
  const tol = Math.max(size.x, size.y, size.z) * 1e-4;

  function qv(idx) {
    return `${Math.round(pos.getX(idx)/tol)},${Math.round(pos.getY(idx)/tol)},${Math.round(pos.getZ(idx)/tol)}`;
  }
  function qvVec(v) {
    return `${Math.round(v.x/tol)},${Math.round(v.y/tol)},${Math.round(v.z/tol)}`;
  }

  const edgeMap = new Map();
  for (let tri = 0; tri < triCount; tri++) {
    const base = tri * 3;
    for (let e = 0; e < 3; e++) {
      const vA = base + e, vB = base + (e+1) % 3;
      const kA = qv(vA), kB = qv(vB);
      const key = kA < kB ? `${kA}||${kB}` : `${kB}||${kA}`;
      if (!edgeMap.has(key)) edgeMap.set(key, []);
      edgeMap.get(key).push({ vA, vB });
    }
  }

  const newVerts = [];
  const dirAdj = new Map();
  const vertPos = new Map();

  edgeMap.forEach((entries) => {
    if (entries.length !== 1) return;
    const { vA, vB } = entries[0];
    const P = new THREE.Vector3(pos.getX(vA), pos.getY(vA), pos.getZ(vA));
    const Q = new THREE.Vector3(pos.getX(vB), pos.getY(vB), pos.getZ(vB));
    const Pp = projectFn(P), Qp = projectFn(Q);
    newVerts.push(P.x, P.y, P.z,  Pp.x, Pp.y, Pp.z,  Q.x, Q.y, Q.z);
    newVerts.push(Q.x, Q.y, Q.z,  Pp.x, Pp.y, Pp.z,  Qp.x, Qp.y, Qp.z);
    const kA = qvVec(P), kB = qvVec(Q);
    vertPos.set(kA, P); vertPos.set(kB, Q);
    if (!dirAdj.has(kA)) dirAdj.set(kA, []);
    dirAdj.get(kA).push(kB);
  });

  if (!newVerts.length) { infoEl.textContent = "The mesh has no open edges to extrude."; return; }

  const visitedKeys = new Set();
  const loops = [];
  for (const startKey of dirAdj.keys()) {
    if (visitedKeys.has(startKey)) continue;
    const loop = [];
    let cur = startKey;
    for (let guard = 0; guard < 200000; guard++) {
      if (visitedKeys.has(cur)) break;
      visitedKeys.add(cur);
      loop.push(vertPos.get(cur));
      const next = (dirAdj.get(cur) || []).find(k => !visitedKeys.has(k));
      if (!next) break;
      cur = next;
    }
    if (loop.length >= 3) loops.push(loop);
  }

  const meshCenter = new THREE.Vector3();
  bbox.getCenter(meshCenter);
  const expectedAxisSign = Math.sign(planePoint.clone().sub(meshCenter).dot(planeNormal));

  for (const loop of loops) {
    const capVerts = triangulateLoop3D(loop.map(p => projectFn(p)));
    if (capVerts.length < 9) continue;
    const ta = new THREE.Vector3(capVerts[0], capVerts[1], capVerts[2]);
    const tb = new THREE.Vector3(capVerts[3], capVerts[4], capVerts[5]);
    const tc = new THREE.Vector3(capVerts[6], capVerts[7], capVerts[8]);
    const capNorm = new THREE.Vector3().crossVectors(tb.clone().sub(ta), tc.clone().sub(ta));
    const actualSign = Math.sign(capNorm.dot(planeNormal));
    if (expectedAxisSign !== 0 && actualSign !== 0 && actualSign !== expectedAxisSign) {
      for (let i = 0; i < capVerts.length; i += 9) {
        for (let k = 0; k < 3; k++) {
          const tmp = capVerts[i+3+k]; capVerts[i+3+k] = capVerts[i+6+k]; capVerts[i+6+k] = tmp;
        }
      }
    }
    newVerts.push(...capVerts);
  }

  if (!newVerts.length) { infoEl.textContent = "Could not generate the extrusion."; return; }

  const existingPos = pos.array;
  const existingCol = mesh.geometry.attributes.color.array;
  const capVertCount = newVerts.length / 3;
  const capCol = new Float32Array(capVertCount * 3);
  for (let i = 0; i < capVertCount; i++) {
    capCol[i*3] = BASE_COLOR.r; capCol[i*3+1] = BASE_COLOR.g; capCol[i*3+2] = BASE_COLOR.b;
  }

  const allPos = new Float32Array(existingPos.length + newVerts.length);
  allPos.set(existingPos); allPos.set(newVerts, existingPos.length);
  const allCol = new Float32Array(existingCol.length + capCol.length);
  allCol.set(existingCol); allCol.set(capCol, existingCol.length);

  let newGeom = new THREE.BufferGeometry();
  newGeom.setAttribute("position", new THREE.Float32BufferAttribute(allPos, 3));
  newGeom.setAttribute("color",    new THREE.Float32BufferAttribute(allCol, 3));
  newGeom.computeVertexNormals();
  newGeom.computeBoundingBox();
  newGeom.computeBoundingSphere();
  newGeom = removeDisconnectedIslands(newGeom);
  mesh.geometry.dispose();
  mesh.geometry = newGeom;
  innerMesh.geometry = newGeom;
  bbox = newGeom.boundingBox.clone();
  clearBoundaryLines();
  updateExtrusionPlane();

  const newTris = newVerts.length / 9;
  infoEl.textContent = `Extruded to ${description} (${loops.length} loop(s), ${newTris} new triangles).`;
  updateInfo();
}

/* ===== Last voxel result (for STL download) ===== */
let lastVoxelState = null;
let lastVoxelGrid  = null; // { gx, gy, gz, voxSz, oX, oY, oZ }
let lastVoxelSolid = null; // solidified version (filled interior)

/* ===== Voxel → binary STL ===== */
// Generates a blocky (Minecraft-style) mesh from the voxel occupancy.
// A face is emitted wherever an occupied voxel (state !== 2) borders an
// empty one (state === 2 or outside the grid).
function voxelsToSTLBuffer(state, gx, gy, gz, voxSz, oX, oY, oZ) {
  const isOcc = (ix, iy, iz) => {
    if (ix<0||ix>=gx||iy<0||iy>=gy||iz<0||iz>=gz) return false;
    return state[ix + iy*gx + iz*gx*gy] !== 2;
  };

  // Collect triangles as flat array: [nx,ny,nz, x1,y1,z1, x2,y2,z2, x3,y3,z3, ...]
  const tris = [];
  const quad = (nx,ny,nz, ax,ay,az, bx,by,bz, cx,cy,cz, dx,dy,dz) => {
    tris.push(nx,ny,nz, ax,ay,az, bx,by,bz, cx,cy,cz); // tri 1: A,B,C
    tris.push(nx,ny,nz, ax,ay,az, cx,cy,cz, dx,dy,dz); // tri 2: A,C,D
  };

  for (let iz=0; iz<gz; iz++) {
    for (let iy=0; iy<gy; iy++) {
      for (let ix=0; ix<gx; ix++) {
        if (!isOcc(ix,iy,iz)) continue;
        const x0=oX+ix*voxSz, x1=x0+voxSz;
        const y0=oY+iy*voxSz, y1=y0+voxSz;
        const z0=oZ+iz*voxSz, z1=z0+voxSz;
        if (!isOcc(ix-1,iy,iz)) quad(-1,0,0, x0,y0,z0, x0,y0,z1, x0,y1,z1, x0,y1,z0);
        if (!isOcc(ix+1,iy,iz)) quad( 1,0,0, x1,y0,z0, x1,y1,z0, x1,y1,z1, x1,y0,z1);
        if (!isOcc(ix,iy-1,iz)) quad(0,-1,0, x0,y0,z0, x1,y0,z0, x1,y0,z1, x0,y0,z1);
        if (!isOcc(ix,iy+1,iz)) quad(0, 1,0, x0,y1,z0, x0,y1,z1, x1,y1,z1, x1,y1,z0);
        if (!isOcc(ix,iy,iz-1)) quad(0,0,-1, x0,y0,z0, x0,y1,z0, x1,y1,z0, x1,y0,z0);
        if (!isOcc(ix,iy,iz+1)) quad(0,0, 1, x0,y0,z1, x1,y0,z1, x1,y1,z1, x0,y1,z1);
      }
    }
  }

  const nTri = tris.length / 12; // 12 floats per triangle
  const buf  = new ArrayBuffer(80 + 4 + nTri * 50);
  const dv   = new DataView(buf);
  dv.setUint32(80, nTri, true);
  let off = 84;
  for (let t=0; t<nTri; t++) {
    const b = t * 12;
    for (let f=0; f<12; f++) dv.setFloat32(off + f*4, tris[b+f], true);
    dv.setUint16(off + 48, 0, true);
    off += 50;
  }
  return buf;
}

/* ===== Voxel occupancy — surface rasterisation + flood fill ===== */
// Robust against any triangle orientation (no projection-axis degeneracy).
//
// Step 1 — Surface: for each triangle mark every voxel whose centre is within
//   halfDiag (half cube space-diagonal) of the nearest point on that triangle.
//   Uses exact point-to-triangle distance via clamped barycentric coords.
// Step 2 — Outside: BFS from the 6 bounding-box faces through non-surface voxels.
// Step 3 — Inside: voxels that are neither surface nor reachable from outside.
function buildOccupancy(posArr, nTri, voxSz, oX, oY, oZ, gx, gy, gz) {
  const total = gx * gy * gz;
  const SURF = 1, OUT = 2;
  const state = new Uint8Array(total);

  const halfDiag = voxSz * Math.sqrt(3) * 0.5;
  const hd2 = halfDiag * halfDiag;

  // ── Step 1: rasterise triangles → surface voxels ──────────────────────────
  for (let t = 0; t < nTri; t++) {
    const b9 = t * 9;
    const ax=posArr[b9],   ay=posArr[b9+1], az=posArr[b9+2];
    const bx=posArr[b9+3], by=posArr[b9+4], bz=posArr[b9+5];
    const cx=posArr[b9+6], cy=posArr[b9+7], cz=posArr[b9+8];
    const ex=bx-ax, ey=by-ay, ez=bz-az; // AB
    const fx=cx-ax, fy=cy-ay, fz=cz-az; // AC
    const d00=ex*ex+ey*ey+ez*ez, d01=ex*fx+ey*fy+ez*fz, d11=fx*fx+fy*fy+fz*fz;
    const den = d00*d11 - d01*d01;

    const ixA=Math.max(0,    Math.floor((Math.min(ax,bx,cx)-halfDiag-oX)/voxSz));
    const ixB=Math.min(gx-1, Math.ceil ((Math.max(ax,bx,cx)+halfDiag-oX)/voxSz));
    const iyA=Math.max(0,    Math.floor((Math.min(ay,by,cy)-halfDiag-oY)/voxSz));
    const iyB=Math.min(gy-1, Math.ceil ((Math.max(ay,by,cy)+halfDiag-oY)/voxSz));
    const izA=Math.max(0,    Math.floor((Math.min(az,bz,cz)-halfDiag-oZ)/voxSz));
    const izB=Math.min(gz-1, Math.ceil ((Math.max(az,bz,cz)+halfDiag-oZ)/voxSz));

    for (let ix=ixA; ix<=ixB; ix++) {
      const px = oX+(ix+0.5)*voxSz - ax;
      for (let iy=iyA; iy<=iyB; iy++) {
        const py = oY+(iy+0.5)*voxSz - ay;
        for (let iz=izA; iz<=izB; iz++) {
          const pz = oZ+(iz+0.5)*voxSz - az;
          // Barycentric coords of voxel centre in triangle plane
          const d20=px*ex+py*ey+pz*ez, d21=px*fx+py*fy+pz*fz;
          let v, w;
          if (Math.abs(den)>1e-12) { v=(d11*d20-d01*d21)/den; w=(d00*d21-d01*d20)/den; }
          else                     { v=w=1/3; }
          const u=1-v-w;
          // Nearest point on triangle via clamped bary
          const uc=Math.max(0,u), vc=Math.max(0,v), wc=Math.max(0,w);
          const s=uc+vc+wc;
          const nX=(vc*ex+wc*fx)/s, nY=(vc*ey+wc*fy)/s, nZ=(vc*ez+wc*fz)/s;
          const dX=px-nX, dY=py-nY, dZ=pz-nZ;
          if (dX*dX+dY*dY+dZ*dZ <= hd2) state[ix+iy*gx+iz*gx*gy] = SURF;
        }
      }
    }
  }

  // ── Step 2: BFS flood fill from all 6 boundary faces ──────────────────────
  const queue = new Int32Array(total);
  let head = 0, tail = 0;
  const seed = (i) => { if (!state[i]) { state[i]=OUT; queue[tail++]=i; } };

  for (let ix=0;ix<gx;ix++) for (let iy=0;iy<gy;iy++) {
    seed(ix+iy*gx); seed(ix+iy*gx+(gz-1)*gx*gy);
  }
  for (let ix=0;ix<gx;ix++) for (let iz=0;iz<gz;iz++) {
    seed(ix+iz*gx*gy); seed(ix+(gy-1)*gx+iz*gx*gy);
  }
  for (let iy=0;iy<gy;iy++) for (let iz=0;iz<gz;iz++) {
    seed(iy*gx+iz*gx*gy); seed((gx-1)+iy*gx+iz*gx*gy);
  }

  while (head < tail) {
    const i = queue[head++];
    const iz=(i/(gx*gy))|0, rem=i-iz*gx*gy, iy=(rem/gx)|0, ix=rem-iy*gx;
    let n;
    if (ix>0)    { n=i-1;      if(!state[n]){state[n]=OUT;queue[tail++]=n;} }
    if (ix<gx-1) { n=i+1;      if(!state[n]){state[n]=OUT;queue[tail++]=n;} }
    if (iy>0)    { n=i-gx;     if(!state[n]){state[n]=OUT;queue[tail++]=n;} }
    if (iy<gy-1) { n=i+gx;     if(!state[n]){state[n]=OUT;queue[tail++]=n;} }
    if (iz>0)    { n=i-gx*gy;  if(!state[n]){state[n]=OUT;queue[tail++]=n;} }
    if (iz<gz-1) { n=i+gx*gy;  if(!state[n]){state[n]=OUT;queue[tail++]=n;} }
  }

  // ── Step 3: return state as-is (0=inside, 1=surface, 2=outside) ──────────
  // Callers decide what to do with each category:
  //  • visualisation → draw state===1 (surface shell, always correct)
  //  • hollow test   → state===0 means "thick interior" → can hollow
  return state;
}

/* ===== Hollow shell ===== */
function performHollow(thickness) {
  if (!mesh) return;

  if (!occlusalNormal) {
    const result = runOcclusalDetection();
    occlusalNormal = result.normal;
    occlusalCenter = result.center.clone();
  }

  pushUndo();

  const N = occlusalNormal.clone().normalize();
  const posArr = mesh.geometry.attributes.position.array;
  const nTri = Math.floor(posArr.length / 9);

  // Quantize helper
  const bx = mesh.geometry.boundingBox || new THREE.Box3().setFromBufferAttribute(mesh.geometry.attributes.position);
  const sz = new THREE.Vector3(); bx.getSize(sz);
  const tol = Math.max(sz.x, sz.y, sz.z) * 1e-4 || 1e-6;
  const qv = (i3) => `${Math.round(posArr[i3]/tol)},${Math.round(posArr[i3+1]/tol)},${Math.round(posArr[i3+2]/tol)}`;

  // ── 1. Projection range along N ────────────────────────────────────────────
  let minP = Infinity, maxP = -Infinity;
  for (let i = 0; i < posArr.length; i += 3) {
    const p = N.x*posArr[i] + N.y*posArr[i+1] + N.z*posArr[i+2];
    if (p < minP) minP = p;
    if (p > maxP) maxP = p;
  }

  // ── 2. Detect flat base cap faces ──────────────────────────────────────────
  const EPS = Math.max(sz.x, sz.y, sz.z) * 0.01;
  const baseTri = new Uint8Array(nTri);
  for (let t = 0; t < nTri; t++) {
    const b = t * 9;
    const ax = posArr[b+3]-posArr[b],   ay = posArr[b+4]-posArr[b+1], az = posArr[b+5]-posArr[b+2];
    const cx = posArr[b+6]-posArr[b],   cy = posArr[b+7]-posArr[b+1], cz = posArr[b+8]-posArr[b+2];
    const fnx = ay*cz-az*cy, fny = az*cx-ax*cz, fnz = ax*cy-ay*cx;
    const flen = Math.sqrt(fnx*fnx + fny*fny + fnz*fnz);
    if (flen < 1e-12) continue;
    if (Math.abs((fnx*N.x + fny*N.y + fnz*N.z) / flen) < 0.9) continue;
    const p0 = N.x*posArr[b]   + N.y*posArr[b+1] + N.z*posArr[b+2];
    const p1 = N.x*posArr[b+3] + N.y*posArr[b+4] + N.z*posArr[b+5];
    const p2 = N.x*posArr[b+6] + N.y*posArr[b+7] + N.z*posArr[b+8];
    if ((Math.abs(p0-minP)<EPS && Math.abs(p1-minP)<EPS && Math.abs(p2-minP)<EPS) ||
        (Math.abs(p0-maxP)<EPS && Math.abs(p1-maxP)<EPS && Math.abs(p2-maxP)<EPS))
      baseTri[t] = 1;
  }

  // ── 3. Angle-weighted vertex normals + position map ─────────────────────────
  // Also store the actual vertex position per key so we can do spatial lookup.
  const vnMap  = new Map(); // key → {nx,ny,nz, px,py,pz}

  for (let t = 0; t < nTri; t++) {
    if (baseTri[t]) continue;
    const b = t * 9;
    const pts = [
      [posArr[b],   posArr[b+1], posArr[b+2]],
      [posArr[b+3], posArr[b+4], posArr[b+5]],
      [posArr[b+6], posArr[b+7], posArr[b+8]],
    ];
    const ks = [qv(b), qv(b+3), qv(b+6)];

    const ax = pts[1][0]-pts[0][0], ay = pts[1][1]-pts[0][1], az = pts[1][2]-pts[0][2];
    const cx = pts[2][0]-pts[0][0], cy = pts[2][1]-pts[0][1], cz = pts[2][2]-pts[0][2];
    const fnx = ay*cz-az*cy, fny = az*cx-ax*cz, fnz = ax*cy-ay*cx;

    for (let v = 0; v < 3; v++) {
      const v1 = (v+1)%3, v2 = (v+2)%3;
      const e1x = pts[v1][0]-pts[v][0], e1y = pts[v1][1]-pts[v][1], e1z = pts[v1][2]-pts[v][2];
      const e2x = pts[v2][0]-pts[v][0], e2y = pts[v2][1]-pts[v][1], e2z = pts[v2][2]-pts[v][2];
      const l1 = Math.sqrt(e1x*e1x + e1y*e1y + e1z*e1z);
      const l2 = Math.sqrt(e2x*e2x + e2y*e2y + e2z*e2z);
      const angle = (l1 > 1e-10 && l2 > 1e-10)
        ? Math.acos(Math.max(-1, Math.min(1, (e1x*e2x + e1y*e2y + e1z*e2z) / (l1*l2))))
        : 0;
      const key = ks[v];
      let e = vnMap.get(key);
      if (!e) { e = {nx:0,ny:0,nz:0, px:pts[v][0],py:pts[v][1],pz:pts[v][2]}; vnMap.set(key, e); }
      e.nx += fnx * angle; e.ny += fny * angle; e.nz += fnz * angle;
    }
  }
  vnMap.forEach(e => {
    const len = Math.sqrt(e.nx*e.nx + e.ny*e.ny + e.nz*e.nz);
    if (len > 0) { e.nx /= len; e.ny /= len; e.nz /= len; }
  });

  // ── 3b. Voxelised inside/outside — thin-zone detection ──────────────────────
  // Build a 3D occupancy grid using 3-axis majority vote (X, Y, Z column ray
  // casting). Each axis independently fills a grid; a voxel is "inside" if at
  // least 2 of 3 axes agree. This eliminates false results from degenerate
  // triangles that are nearly parallel to any single projection axis.
  const voxSz = 0.5; // mm — fine enough to detect sub-1 mm cusp thickness
  const pad   = voxSz * 2;
  const oX = bx.min.x - pad, oY = bx.min.y - pad, oZ = bx.min.z - pad;
  const gx = Math.ceil((bx.max.x - bx.min.x + 2*pad) / voxSz) + 1;
  const gy = Math.ceil((bx.max.y - bx.min.y + 2*pad) / voxSz) + 1;
  const gz = Math.ceil((bx.max.z - bx.min.z + 2*pad) / voxSz) + 1;

  // state: 0=inside solid, 1=surface shell, 2=outside
  const state = buildOccupancy(posArr, nTri, voxSz, oX, oY, oZ, gx, gy, gz);

  // Per-vertex: is the inward-offset point in solid interior (state===0)?
  // state===0 means there's enough solid material → can hollow.
  // state===1 (surface) or ===2 (outside) → thin zone → stay solid.
  const safeOff = new Map();
  vnMap.forEach((e, key) => {
    const px = e.px - thickness*e.nx;
    const py = e.py - thickness*e.ny;
    const pz = e.pz - thickness*e.nz;
    const ix = Math.floor((px-oX)/voxSz);
    const iy = Math.floor((py-oY)/voxSz);
    const iz = Math.floor((pz-oZ)/voxSz);
    const inside = ix>=0 && ix<gx && iy>=0 && iy<gy && iz>=0 && iz<gz
                   && state[ix + iy*gx + iz*gx*gy] === 0;
    safeOff.set(key, inside ? thickness : 0);
  });

  // ── 4. Build outer + inner tris, track boundary edges ─────────────────────
  // Vertices where safeOff < thickness are "thin" (teeth) → stay solid (no inner tri)
  const SOLID_THRESH = thickness * 0.999;
  const solidKeys = new Set();
  safeOff.forEach((d, key) => { if (d < SOLID_THRESH) solidKeys.add(key); });

  const verts = [];
  const outerEdgeMap = new Map(); // all non-base tri edges
  const innerEdgeMap = new Map(); // hollow (non-solid) tri edges only

  for (let t = 0; t < nTri; t++) {
    if (baseTri[t]) continue;
    const b = t * 9;
    const ks = [qv(b), qv(b+3), qv(b+6)];
    const outerP = [[posArr[b],posArr[b+1],posArr[b+2]],
                    [posArr[b+3],posArr[b+4],posArr[b+5]],
                    [posArr[b+6],posArr[b+7],posArr[b+8]]];

    // Outer tri always
    verts.push(posArr[b],   posArr[b+1], posArr[b+2],
               posArr[b+3], posArr[b+4], posArr[b+5],
               posArr[b+6], posArr[b+7], posArr[b+8]);
    for (let e = 0; e < 3; e++) {
      const vA = e, vB = (e+1)%3;
      const ek = ks[vA] < ks[vB] ? `${ks[vA]}||${ks[vB]}` : `${ks[vB]}||${ks[vA]}`;
      if (!outerEdgeMap.has(ek)) outerEdgeMap.set(ek, { oA: outerP[vA], oB: outerP[vB], kA: ks[vA], kB: ks[vB], count: 0 });
      outerEdgeMap.get(ek).count++;
    }

    // Inner tri only if all 3 vertices are in the hollow zone
    const isHollow = !ks.some(k => solidKeys.has(k));
    if (!isHollow) continue;

    const ip = ks.map((k, vi) => {
      const e  = vnMap.get(k) || {nx:0,ny:0,nz:0};
      const d  = safeOff.get(k) ?? thickness;
      const i3 = b + vi*3;
      return [posArr[i3] - d*e.nx, posArr[i3+1] - d*e.ny, posArr[i3+2] - d*e.nz];
    });
    verts.push(...ip[0], ...ip[2], ...ip[1]);

    for (let e = 0; e < 3; e++) {
      const vA = e, vB = (e+1)%3;
      const ek = ks[vA] < ks[vB] ? `${ks[vA]}||${ks[vB]}` : `${ks[vB]}||${ks[vA]}`;
      if (!innerEdgeMap.has(ek)) innerEdgeMap.set(ek, { oA: outerP[vA], oB: outerP[vB], kA: ks[vA], kB: ks[vB], count: 0 });
      innerEdgeMap.get(ek).count++;
    }
  }

  // ── 5. Wall tris ───────────────────────────────────────────────────────────
  // (a) Outer boundary edges (open bottom rim) — only where both verts are hollow
  outerEdgeMap.forEach(({ oA, oB, kA, kB, count }) => {
    if (count !== 1) return;
    if (solidKeys.has(kA) || solidKeys.has(kB)) return;
    const eA = vnMap.get(kA) || {nx:0,ny:0,nz:0};
    const eB = vnMap.get(kB) || {nx:0,ny:0,nz:0};
    const dA = safeOff.get(kA) ?? thickness;
    const dB = safeOff.get(kB) ?? thickness;
    const iA = [oA[0]-dA*eA.nx, oA[1]-dA*eA.ny, oA[2]-dA*eA.nz];
    const iB = [oB[0]-dB*eB.nx, oB[1]-dB*eB.ny, oB[2]-dB*eB.nz];
    verts.push(...oA, ...oB, ...iB);
    verts.push(...oA, ...iB, ...iA);
  });

  // (b) Hollow↔solid sealing walls: inner boundary edges → back to outer surface
  innerEdgeMap.forEach(({ oA, oB, kA, kB, count }) => {
    if (count !== 1) return;
    const eA = vnMap.get(kA) || {nx:0,ny:0,nz:0};
    const eB = vnMap.get(kB) || {nx:0,ny:0,nz:0};
    const dA = safeOff.get(kA) ?? thickness;
    const dB = safeOff.get(kB) ?? thickness;
    const iA = [oA[0]-dA*eA.nx, oA[1]-dA*eA.ny, oA[2]-dA*eA.nz];
    const iB = [oB[0]-dB*eB.nx, oB[1]-dB*eB.ny, oB[2]-dB*eB.nz];
    verts.push(...iA, ...iB, ...oB);
    verts.push(...iA, ...oB, ...oA);
  });

  // ── 6. Build geometry ──────────────────────────────────────────────────────
  const newPosArr = new Float32Array(verts);
  const nVerts = newPosArr.length / 3;
  const newColArr = new Float32Array(nVerts * 3);
  for (let i = 0; i < nVerts; i++) {
    newColArr[i*3]   = BASE_COLOR.r;
    newColArr[i*3+1] = BASE_COLOR.g;
    newColArr[i*3+2] = BASE_COLOR.b;
  }

  const newGeom = new THREE.BufferGeometry();
  newGeom.setAttribute('position', new THREE.BufferAttribute(newPosArr, 3));
  newGeom.setAttribute('color',    new THREE.BufferAttribute(newColArr, 3));
  newGeom.computeVertexNormals();
  newGeom.computeBoundingBox();
  newGeom.computeBoundingSphere();

  mesh.geometry.dispose();
  mesh.geometry = newGeom;
  innerMesh.geometry = newGeom;
  bbox = newGeom.boundingBox.clone();
  clearBoundaryLines();
  updateExtrudePosDefault();
  const baseFaceCount = Array.from(baseTri).filter(Boolean).length;
  infoEl.textContent = `Hollow: ${thickness} mm wall · ${Math.floor(nVerts/3).toLocaleString()} triangles (removed ${baseFaceCount} base face${baseFaceCount!==1?'s':''})`;
  updateInfo();
}

/* ===== Voxel hollow helpers ===== */

// Build a Three.js BufferGeometry from an occupancy grid (state!==2 = occupied).
// Only exposes faces adjacent to empty voxels (marching-cubes-style cube faces).
function voxelsToGeometry(state, gx, gy, gz, voxSz, oX, oY, oZ) {
  const slab = gx * gy;
  const isOcc = (ix, iy, iz) => {
    if (ix<0||ix>=gx||iy<0||iy>=gy||iz<0||iz>=gz) return false;
    return state[ix + iy*gx + iz*slab] !== 2;
  };
  const pos = [];
  const quad = (ax,ay,az, bx,by,bz, cx,cy,cz, dx,dy,dz) => {
    pos.push(ax,ay,az, bx,by,bz, cx,cy,cz,
             ax,ay,az, cx,cy,cz, dx,dy,dz);
  };
  for (let iz=0; iz<gz; iz++) for (let iy=0; iy<gy; iy++) for (let ix=0; ix<gx; ix++) {
    if (!isOcc(ix,iy,iz)) continue;
    const x0=oX+ix*voxSz, x1=x0+voxSz;
    const y0=oY+iy*voxSz, y1=y0+voxSz;
    const z0=oZ+iz*voxSz, z1=z0+voxSz;
    if (!isOcc(ix-1,iy,iz)) quad(x0,y0,z0, x0,y0,z1, x0,y1,z1, x0,y1,z0);
    if (!isOcc(ix+1,iy,iz)) quad(x1,y0,z0, x1,y1,z0, x1,y1,z1, x1,y0,z1);
    if (!isOcc(ix,iy-1,iz)) quad(x0,y0,z0, x1,y0,z0, x1,y0,z1, x0,y0,z1);
    if (!isOcc(ix,iy+1,iz)) quad(x0,y1,z0, x0,y1,z1, x1,y1,z1, x1,y1,z0);
    if (!isOcc(ix,iy,iz-1)) quad(x0,y0,z0, x0,y1,z0, x1,y1,z0, x1,y0,z0);
    if (!isOcc(ix,iy,iz+1)) quad(x0,y0,z1, x1,y0,z1, x1,y1,z1, x0,y1,z1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  geo.computeVertexNormals();
  return geo;
}

// Extend the eroded solid in the "down" direction (opposite to occlusal up) all
// the way to the grid boundary.  When the solid is subsequently subtracted from
// the original mesh, this punches an opening through the base plate.
function extendSolidToBase(solid, gx, gy, gz, upNx, upNy, upNz) {
  const slab = gx * gy;
  const ax = Math.abs(upNx), ay = Math.abs(upNy), az = Math.abs(upNz);

  if (ay >= ax && ay >= az) {
    if (upNy > 0) { // down = -Y → fill toward iy=0
      for (let iz=0; iz<gz; iz++) for (let ix=0; ix<gx; ix++) {
        let first = -1;
        for (let iy=0; iy<gy; iy++) if (solid[ix+iy*gx+iz*slab]!==2){first=iy;break;}
        if (first<=0) continue;
        for (let iy=0; iy<first; iy++) solid[ix+iy*gx+iz*slab]=1;
      }
    } else {         // down = +Y → fill toward iy=gy-1
      for (let iz=0; iz<gz; iz++) for (let ix=0; ix<gx; ix++) {
        let last = -1;
        for (let iy=gy-1; iy>=0; iy--) if (solid[ix+iy*gx+iz*slab]!==2){last=iy;break;}
        if (last<0||last>=gy-1) continue;
        for (let iy=last+1; iy<gy; iy++) solid[ix+iy*gx+iz*slab]=1;
      }
    }
  } else if (ax >= ay && ax >= az) {
    if (upNx > 0) { // down = -X
      for (let iz=0; iz<gz; iz++) for (let iy=0; iy<gy; iy++) {
        let first = -1;
        for (let ix=0; ix<gx; ix++) if (solid[ix+iy*gx+iz*slab]!==2){first=ix;break;}
        if (first<=0) continue;
        for (let ix=0; ix<first; ix++) solid[ix+iy*gx+iz*slab]=1;
      }
    } else {         // down = +X
      for (let iz=0; iz<gz; iz++) for (let iy=0; iy<gy; iy++) {
        let last = -1;
        for (let ix=gx-1; ix>=0; ix--) if (solid[ix+iy*gx+iz*slab]!==2){last=ix;break;}
        if (last<0||last>=gx-1) continue;
        for (let ix=last+1; ix<gx; ix++) solid[ix+iy*gx+iz*slab]=1;
      }
    }
  } else {
    if (upNz > 0) { // down = -Z
      for (let iy=0; iy<gy; iy++) for (let ix=0; ix<gx; ix++) {
        let first = -1;
        for (let iz=0; iz<gz; iz++) if (solid[ix+iy*gx+iz*slab]!==2){first=iz;break;}
        if (first<=0) continue;
        for (let iz=0; iz<first; iz++) solid[ix+iy*gx+iz*slab]=1;
      }
    } else {         // down = +Z
      for (let iy=0; iy<gy; iy++) for (let ix=0; ix<gx; ix++) {
        let last = -1;
        for (let iz=gz-1; iz>=0; iz--) if (solid[ix+iy*gx+iz*slab]!==2){last=iz;break;}
        if (last<0||last>=gz-1) continue;
        for (let iz=last+1; iz<gz; iz++) solid[ix+iy*gx+iz*slab]=1;
      }
    }
  }
}

function performHollowVoxel(thickness) {
  if (!mesh) return;

  if (!occlusalNormal) {
    const result = runOcclusalDetection();
    occlusalNormal = result.normal;
    occlusalCenter = result.center.clone();
  }

  pushUndo();

  const upN  = occlusalNormal.clone().normalize();
  // Voxel size: ~4 voxels per wall thickness, clamped to [0.5, 1.0] mm.
  const voxSz = Math.max(0.5, Math.min(1.0, thickness / 4));

  const posArr = mesh.geometry.attributes.position.array;
  const nTri   = Math.floor(posArr.length / 9);

  mesh.geometry.computeBoundingBox();
  const bbx = mesh.geometry.boundingBox;
  const pad  = voxSz * 2;
  const oX = bbx.min.x - pad, oY = bbx.min.y - pad, oZ = bbx.min.z - pad;
  const gx = Math.ceil((bbx.max.x - bbx.min.x + 2*pad) / voxSz) + 1;
  const gy = Math.ceil((bbx.max.y - bbx.min.y + 2*pad) / voxSz) + 1;
  const gz = Math.ceil((bbx.max.z - bbx.min.z + 2*pad) / voxSz) + 1;

  // Build strictly-interior solid (same pipeline as testVoxelize).
  const state = buildOccupancy(posArr, nTri, voxSz, oX, oY, oZ, gx, gy, gz);
  let solid = solidifyAlongNormal(state, gx, gy, gz, upN.x, upN.y, upN.z);
  for (let i = 0; i < solid.length; i++) if (state[i] === 1) solid[i] = 2;

  // Erode N layers inward → leaves wall of ≈ thickness mm.
  const N = Math.max(1, Math.round(thickness / voxSz));
  for (let p = 0; p < N; p++) solid = erodeOccupancy(solid, gx, gy, gz);

  // Extend solid toward the base → opens the bottom after subtraction.
  extendSolidToBase(solid, gx, gy, gz, upN.x, upN.y, upN.z);

  // Convert eroded solid to a mesh and subtract from original.
  const voxGeo  = voxelsToGeometry(solid, gx, gy, gz, voxSz, oX, oY, oZ);
  const brushA  = new Brush(sanitizeGeometryForCSG(mesh.geometry));
  const brushB  = new Brush(sanitizeGeometryForCSG(voxGeo));
  const csgResult = evaluator.evaluate(brushA, brushB, SUBTRACTION);

  let newGeom = csgResult.geometry.clone();
  newGeom.computeVertexNormals();
  newGeom.computeBoundingBox();
  newGeom.computeBoundingSphere();
  if (newGeom.index) newGeom = newGeom.toNonIndexed();
  newGeom = removeDegenerateTris(newGeom);
  initVertexColors(newGeom);

  mesh.geometry.dispose();
  mesh.geometry      = newGeom;
  innerMesh.geometry = newGeom;
  bbox = newGeom.boundingBox ? newGeom.boundingBox.clone() : new THREE.Box3().setFromBufferAttribute(newGeom.attributes.position);
  clearBoundaryLines();
  updateExtrudePosDefault();

  const nTris = Math.floor(newGeom.attributes.position.count / 3);
  infoEl.textContent = `Hollow: ${thickness} mm wall · ${nTris.toLocaleString()} triangles`;
  updateInfo();
}

/* ===== Button: Make hollow ===== */
btnHollow.addEventListener("click", () => {
  if (!mesh) return;
  withSpinner(() => {
    const thickness = Math.max(0.1, parseFloat(hollowThicknessInput.value) || 2);
    performHollowVoxel(thickness);
  });
});

/* ===== Test: Voxelization visualization ===== */
let voxelDebugMesh = null;

function clearVoxelDebug() {
  if (voxelDebugMesh) {
    scene.remove(voxelDebugMesh);
    voxelDebugMesh.geometry.dispose();
    voxelDebugMesh.material.dispose();
    voxelDebugMesh = null;
  }
}

function testVoxelize() {
  if (!mesh) return;

  const voxSz = Math.max(0.1, parseFloat(voxelSizeInput.value) || 0.5);

  const posArr = mesh.geometry.attributes.position.array;
  const nTri   = Math.floor(posArr.length / 9);

  mesh.geometry.computeBoundingBox();
  const bbx = mesh.geometry.boundingBox;
  const pad  = voxSz * 2;
  const oX = bbx.min.x - pad, oY = bbx.min.y - pad, oZ = bbx.min.z - pad;
  const gx = Math.ceil((bbx.max.x - bbx.min.x + 2*pad) / voxSz) + 1;
  const gy = Math.ceil((bbx.max.y - bbx.min.y + 2*pad) / voxSz) + 1;
  const gz = Math.ceil((bbx.max.z - bbx.min.z + 2*pad) / voxSz) + 1;

  if (!occlusalNormal) {
    const result = runOcclusalDetection();
    occlusalNormal = result.normal;
    occlusalCenter = result.center.clone();
  }
  const upN = occlusalNormal.clone().normalize();

  // Step 1: surface rasterisation — marks voxels that touch the mesh (state===1).
  const state = buildOccupancy(posArr, nTri, voxSz, oX, oY, oZ, gx, gy, gz);

  // Step 2: fill interior using single-axis scanline along the occlusal up direction.
  const solid = solidifyAlongNormal(state, gx, gy, gz, upN.x, upN.y, upN.z);

  // Step 3: remove every voxel that intersects the mesh surface (state===1).
  // These straddle the surface and would protrude outward.
  // What remains is strictly inside the model.
  for (let i = 0; i < solid.length; i++) {
    if (state[i] === 1) solid[i] = 2;
  }

  showVoxelWireframe(solid, gx, gy, gz, voxSz, oX, oY, oZ, 1, 0x44aaff);

  lastVoxelState = solid;
  lastVoxelGrid  = { gx, gy, gz, voxSz, oX, oY, oZ };
  lastVoxelSolid = solid;
  btnDownloadVoxel.disabled = false;
  btnErodeVoxel.disabled    = false;
}

// Draw wireframe edges for voxels matching targetState.
// targetState=1 → surface shell; targetState=0 → eroded interior.
function showVoxelWireframe(state, gx, gy, gz, voxSz, oX, oY, oZ, targetState, color) {
  clearVoxelDebug();
  const linePos = [];
  for (let iz = 0; iz < gz; iz++) {
    for (let iy = 0; iy < gy; iy++) {
      for (let ix = 0; ix < gx; ix++) {
        if (state[ix + iy*gx + iz*gx*gy] !== targetState) continue;
        const x0=oX+ix*voxSz, x1=x0+voxSz;
        const y0=oY+iy*voxSz, y1=y0+voxSz;
        const z0=oZ+iz*voxSz, z1=z0+voxSz;
        linePos.push(x0,y0,z0, x1,y0,z0,  x0,y1,z0, x1,y1,z0,
                     x0,y0,z1, x1,y0,z1,  x0,y1,z1, x1,y1,z1,
                     x0,y0,z0, x0,y1,z0,  x1,y0,z0, x1,y1,z0,
                     x0,y0,z1, x0,y1,z1,  x1,y0,z1, x1,y1,z1,
                     x0,y0,z0, x0,y0,z1,  x1,y0,z0, x1,y0,z1,
                     x0,y1,z0, x0,y1,z1,  x1,y1,z0, x1,y1,z1);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(linePos), 3));
  const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.6 });
  voxelDebugMesh = new THREE.LineSegments(geo, mat);
  scene.add(voxelDebugMesh);
}

btnTestVoxel.addEventListener("click", () => {
  if (!mesh) return;
  withSpinner(() => testVoxelize());
});

btnClearVoxel.addEventListener("click", () => clearVoxelDebug());

btnToggleMesh.addEventListener("click", () => {
  if (!mesh) return;
  const hide = mesh.visible;
  mesh.visible      = !hide;
  innerMesh.visible = !hide;
  const icon = btnToggleMesh.querySelector("i");
  icon.setAttribute("data-lucide", hide ? "eye" : "eye-off");
  btnToggleMesh.childNodes[btnToggleMesh.childNodes.length - 1].textContent = hide ? " Show model" : " Hide model";
  lucide.createIcons();
});

btnDownloadVoxel.addEventListener("click", () => {
  if (!lastVoxelSolid || !lastVoxelGrid) return;
  const { gx, gy, gz, voxSz, oX, oY, oZ } = lastVoxelGrid;
  const buf  = voxelsToSTLBuffer(lastVoxelSolid, gx, gy, gz, voxSz, oX, oY, oZ);
  const blob = new Blob([buf], { type: "application/octet-stream" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `${loadedFilename || "model"}_voxel.stl`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

// Fill the interior of the surface shell using a single-axis scanline aligned
// with the occlusal "up" direction.  For each column parallel to the dominant
// axis, voxels between the first and last SURF voxel in that column are marked
// occupied.  Unlike the 3-axis majority-vote approach, this does NOT fill
// inter-dental gaps: a column passing through a gap sees no surface voxels on
// both sides along the up axis, so it is left empty.
function solidifyAlongNormal(state, gx, gy, gz, upNx, upNy, upNz) {
  const total = gx * gy * gz;
  const slab  = gx * gy;
  const solid = new Uint8Array(total).fill(2);

  // Dominant axis most aligned with the up vector
  const ax = Math.abs(upNx), ay = Math.abs(upNy), az = Math.abs(upNz);

  if (ay >= ax && ay >= az) {
    // Y dominant — scan each (ix, iz) column along Y
    for (let iz = 0; iz < gz; iz++) {
      for (let ix = 0; ix < gx; ix++) {
        let lo = -1, hi = -1;
        for (let iy = 0; iy < gy; iy++) {
          if (state[ix + iy*gx + iz*slab] === 1) { if (lo < 0) lo = iy; hi = iy; }
        }
        if (lo < 0) continue;
        for (let iy = lo; iy <= hi; iy++) solid[ix + iy*gx + iz*slab] = 1;
      }
    }
  } else if (ax >= ay && ax >= az) {
    // X dominant — scan each (iy, iz) column along X
    for (let iz = 0; iz < gz; iz++) {
      for (let iy = 0; iy < gy; iy++) {
        let lo = -1, hi = -1;
        for (let ix = 0; ix < gx; ix++) {
          if (state[ix + iy*gx + iz*slab] === 1) { if (lo < 0) lo = ix; hi = ix; }
        }
        if (lo < 0) continue;
        for (let ix = lo; ix <= hi; ix++) solid[ix + iy*gx + iz*slab] = 1;
      }
    }
  } else {
    // Z dominant — scan each (ix, iy) column along Z
    for (let iy = 0; iy < gy; iy++) {
      for (let ix = 0; ix < gx; ix++) {
        let lo = -1, hi = -1;
        for (let iz = 0; iz < gz; iz++) {
          if (state[ix + iy*gx + iz*slab] === 1) { if (lo < 0) lo = iz; hi = iz; }
        }
        if (lo < 0) continue;
        for (let iz = lo; iz <= hi; iz++) solid[ix + iy*gx + iz*slab] = 1;
      }
    }
  }

  return solid;
}

// Single-pass morphological erosion.
// A voxel is kept only if all 5 non-bottom face-neighbours are occupied.
// The -Z direction is intentionally ignored: voxels whose only empty neighbour
// is below them (the base opening) are never eroded, so the hollow result
// stays open at the bottom after subtraction (original − eroded).
function erodeOccupancy(state, gx, gy, gz) {
  const result = new Uint8Array(state.length).fill(2);
  const stride = gx, slab = gx * gy;
  for (let iz = 0; iz < gz; iz++) {
    for (let iy = 0; iy < gy; iy++) {
      for (let ix = 0; ix < gx; ix++) {
        const i = ix + iy*stride + iz*slab;
        if (state[i] === 2) continue;
        const keep =
          ix > 0    && state[i - 1]     !== 2 &&
          ix < gx-1 && state[i + 1]     !== 2 &&
          iy > 0    && state[i - stride] !== 2 &&
          iy < gy-1 && state[i + stride] !== 2 &&
          iz < gz-1 && state[i + slab]   !== 2;
          // -Z omitted: bottom face is never an erosion trigger
        if (keep) result[i] = 1;
      }
    }
  }
  return result;
}

btnErodeVoxel.addEventListener("click", () => {
  if (!lastVoxelSolid || !lastVoxelGrid) return;
  const { gx, gy, gz, voxSz, oX, oY, oZ } = lastVoxelGrid;
  const thickness = Math.max(0.1, parseFloat(hollowThicknessInput.value) || 2);
  const N = Math.max(1, Math.round(thickness / voxSz));

  let state = lastVoxelSolid;
  for (let pass = 0; pass < N; pass++) state = erodeOccupancy(state, gx, gy, gz);

  showVoxelWireframe(state, gx, gy, gz, voxSz, oX, oY, oZ, 1, 0xff8833);
  btnDownloadEroded.disabled = false;
  lastVoxelState = state;
  lastVoxelGrid  = { gx, gy, gz, voxSz, oX, oY, oZ };
});

btnDownloadEroded.addEventListener("click", () => {
  if (!lastVoxelState || !lastVoxelGrid) return;
  const { gx, gy, gz, voxSz, oX, oY, oZ } = lastVoxelGrid;
  // Use the already-eroded state (0=occupied, 2=empty)
  const buf  = voxelsToSTLBuffer(lastVoxelState, gx, gy, gz, voxSz, oX, oY, oZ);
  const blob = new Blob([buf], { type: "application/octet-stream" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `${loadedFilename || "model"}_eroded.stl`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

/* ===== Button: Auto base ===== */
btnAutoBase.addEventListener("click", () => {
  if (!mesh) return;
  withSpinner(() => {
    // Ensure occlusal normal is available
    if (!occlusalNormal) {
      const result = runOcclusalDetection();
      occlusalNormal = result.normal;
      occlusalCenter = result.center.clone();
    }
    const N = occlusalNormal.clone().normalize();
    const pos = mesh.geometry.attributes.position;
    const triCount = Math.floor(pos.count / 3);

    // Full range of the model along N
    let minD = Infinity, maxD = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      const d = pos.getX(i) * N.x + pos.getY(i) * N.y + pos.getZ(i) * N.z;
      if (d < minD) minD = d;
      if (d > maxD) maxD = d;
    }

    // Detect boundary (open) edges and find mean projection of their vertices along N
    const box = mesh.geometry.boundingBox || new THREE.Box3().setFromBufferAttribute(pos);
    const sz = new THREE.Vector3(); box.getSize(sz);
    const tol = Math.max(sz.x, sz.y, sz.z) * 1e-4 || 1e-6;
    function qv(idx) {
      return `${Math.round(pos.getX(idx)/tol)},${Math.round(pos.getY(idx)/tol)},${Math.round(pos.getZ(idx)/tol)}`;
    }
    const edgeMap = new Map();
    for (let tri = 0; tri < triCount; tri++) {
      for (let e = 0; e < 3; e++) {
        const vA = tri * 3 + e, vB = tri * 3 + (e + 1) % 3;
        const kA = qv(vA), kB = qv(vB);
        const key = kA < kB ? `${kA}||${kB}` : `${kB}||${kA}`;
        if (!edgeMap.has(key)) edgeMap.set(key, { vA, vB, count: 0 });
        edgeMap.get(key).count++;
      }
    }
    let boundarySum = 0, boundaryN = 0;
    edgeMap.forEach(({ vA, vB, count }) => {
      if (count !== 1) return;
      boundarySum += pos.getX(vA)*N.x + pos.getY(vA)*N.y + pos.getZ(vA)*N.z;
      boundarySum += pos.getX(vB)*N.x + pos.getY(vB)*N.y + pos.getZ(vB)*N.z;
      boundaryN += 2;
    });

    // Upper arch: boundary is above the mesh midpoint (base at top, occlusal at bottom)
    const mid = (minD + maxD) / 2;
    const boundaryMean = boundaryN > 0 ? boundarySum / boundaryN : minD;
    const baseAtTop = boundaryMean > mid;

    const planeD = baseAtTop ? maxD + 10 : minD - 10;
    const C = N.clone().multiplyScalar(planeD);
    const label = baseAtTop ? 'upper arch +10 mm' : 'lower arch −10 mm';

    performExtrude(
      p => p.clone().addScaledVector(N, -(p.clone().sub(C).dot(N))),
      N, C,
      `auto base (${label})`
    );
  });
});

/* ===== Button: Extrude to plane ===== */
btnExtrude.addEventListener("click", () => {
  if (!mesh) return;
  const type = planeTypeSelect.value;
  if (type === 'none') return;

  withSpinner(() => {
    if (type === 'occlusal') {
      if (!occlusalNormal) { infoEl.textContent = "Detect the occlusal plane first."; return; }
      const N = occlusalNormal.clone();
      const C = occlusalCenter ? occlusalCenter.clone().addScaledVector(N, parseFloat(planeOffsetRange.value) || 0)
                                : (occlusalPlane ? occlusalPlane.position.clone() : new THREE.Vector3());
      performExtrude(p => p.clone().addScaledVector(N, -(p.clone().sub(C).dot(N))), N, C,
        `occlusal plane (offset ${parseFloat(planeOffsetRange.value).toFixed(1)})`);
    } else {
      const planeVal = parseFloat(extrudePosRange.value) || 0;
      const N = type === 'y' ? new THREE.Vector3(0,1,0)
              : type === 'z' ? new THREE.Vector3(0,0,1)
              :                new THREE.Vector3(1,0,0);
      const C = N.clone().multiplyScalar(planeVal);
      performExtrude(p => p.clone().addScaledVector(N, -(p.clone().sub(C).dot(N))), N, C,
        `${type.toUpperCase()}=${planeVal.toFixed(2)}`);
    }
  });
});

/* ===== Pick text point button ===== */
btnPickTextPoint.addEventListener("click", () => {
  if (!mesh) return;
  if (isPickingTextPoint) {
    isPickingTextPoint = false;
    btnPickTextPoint.classList.remove("active");
    renderer.domElement.style.cursor = "";
    pickInfo.textContent = currentHoverHit ? "Point set" : "No point picked";
    clearPickRect();
  } else {
    isPickingTextPoint = true;
    btnPickTextPoint.classList.add("active");
    pickInfo.textContent = "Click on the mesh…";
    renderer.domElement.style.cursor = "crosshair";
    computePickRectDims();
    // If font not loaded yet, load it silently so dims are ready when the user hovers
    if (!font) ensureFontLoaded().then(() => { if (isPickingTextPoint) computePickRectDims(); });
  }
});

/* ===== Text slider → refresh preview if point already picked ===== */
function refreshPickedPreview() {
  if (currentHoverHit && font && bbox) {
    previewParamsKey = ""; // force geometry rebuild
    withSpinner(() => updateHoverPreview());
  }
}
// Text field: show "Update preview" button instead of live refresh when a point is picked
textInput.addEventListener("input", () => {
  if (isPickingTextPoint) computePickRectDims();
  if (currentHoverHit) {
    btnUpdateTextPreview.style.display = "";
  } else {
    refreshPickedPreview();
  }
});

// Size / depth sliders still refresh live
[sizeRange, depthRange].forEach(el => {
  el.addEventListener("input", () => {
    if (isPickingTextPoint) computePickRectDims();
    refreshPickedPreview();
  });
});

btnUpdateTextPreview.addEventListener("click", () => {
  btnUpdateTextPreview.style.display = "none";
  if (isPickingTextPoint) computePickRectDims();
  refreshPickedPreview();
});

planeTypeSelect.addEventListener("change", refreshPickedPreview);

/* ===== Emboss ===== */

function ensureFontLoaded() {
  if (font) return Promise.resolve(font);
  const fl = new FontLoader();
  const url = "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/fonts/helvetiker_regular.typeface.json";
  return new Promise((resolve, reject) => {
    fl.load(url, (f) => { font = f; resolve(f); }, undefined, (err) => reject(err));
  });
}

/* Compute text placement transform.
   - UP: occlusal normal if detected, otherwise the selected plane axis (Y/Z/X), or world Y.
   - Extrusion direction (n): surface normal projected onto plane ⊥ UP.
   - xAxis: cross(UP, n) → reading direction.
*/
function getTextTransform() {
  // Derive UP from active plane: occlusal normal, or the selected axis, or world Y fallback
  let UP;
  if (occlusalNormal && occlusalNormal.lengthSq() > 0.5) {
    UP = occlusalNormal.clone().normalize();
  } else {
    const axis = planeTypeSelect.value;
    if      (axis === 'y') UP = new THREE.Vector3(0, 1, 0);
    else if (axis === 'z') UP = new THREE.Vector3(0, 0, 1);
    else if (axis === 'x') UP = new THREE.Vector3(1, 0, 0);
    else                   UP = new THREE.Vector3(0, 1, 0); // 'none' fallback
  }
  let n;

  if (currentHoverHit && currentHoverHit.face) {
    // Project surface normal onto plane ⊥ UP so n ⊥ UP
    const sn = currentHoverHit.face.normal.clone().transformDirection(mesh.matrixWorld);
    n = sn.clone().addScaledVector(UP, -sn.dot(UP));
    if (n.lengthSq() < 0.001) {
      // Surface nearly parallel to UP — pick an arbitrary perpendicular
      n = new THREE.Vector3(Math.abs(UP.x) < 0.9 ? 1 : 0, 0, Math.abs(UP.x) < 0.9 ? 0 : 1);
      n.addScaledVector(UP, -n.dot(UP));
    }
    n.normalize();
  } else {
    // No pick yet — default to a direction from plane type selector, projected ⊥ UP
    const axis = planeTypeSelect.value;
    n = axis === 'x' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
    n.addScaledVector(UP, -n.dot(UP));
    if (n.lengthSq() < 0.001) n.set(0, 0, 1);
    n.normalize();
  }

  const xAxis = new THREE.Vector3().crossVectors(UP, n).normalize();
  // basis: (xAxis, Y, n) is right-handed when n ⊥ Y
  const quat = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(xAxis, UP, n)
  );

  let origin;
  if (currentHoverHit) {
    origin = currentHoverHit.point.clone();
  } else {
    origin = new THREE.Vector3();
    bbox.getCenter(origin);
    const axis = planeTypeSelect.value;
    if (axis === 'x') origin.x = bbox.max.x;
    else origin.z = bbox.max.z;
  }

  return { pos: origin, quat, n };
}

function buildTextMesh() {
  const text  = (textInput.value || "").trim() || "TEXT";
  const size  = Number(sizeRange.value)  || 2;
  const depth = Number(depthRange.value) || 1;

  const geom = new TextGeometry(text, {
    font, size, height: depth * 1.5, curveSegments: 8, bevelEnabled: false,
  });
  geom.computeBoundingBox();
  const c = new THREE.Vector3();
  geom.boundingBox.getCenter(c);
  geom.translate(-c.x, -c.y, -c.z);

  const tm = new THREE.Mesh(geom, textMaterial);
  const { pos, quat } = getTextTransform();
  tm.position.copy(pos);
  tm.quaternion.copy(quat);
  tm.updateMatrixWorld(true);
  return tm;
}

function sanitizeGeometryForCSG(geometry) {
  let g = geometry.clone();
  if (g.index) g = g.toNonIndexed();
  const keep = new Set(["position", "normal"]);
  for (const key in g.attributes) {
    if (!keep.has(key)) g.deleteAttribute(key);
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/**
 * For each lateral position in the text (perpendicular to n), cast a ray along n
 * to find the actual mesh surface depth. Snap the back face of each letter column
 * to that surface so every letter protrudes by exactly `depth`, following curvature.
 */
function conformTextGeometryToMesh(geom, n, depth, textCenter) {
  const pos = geom.attributes.position;
  const cache = new Map();
  const ray = new THREE.Raycaster();
  ray.firstHitOnly = true;
  const nNeg = n.clone().negate();

  for (let i = 0; i < pos.count; i++) {
    const v = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));

    // How far is this vertex from the text center along n?
    const dz = v.clone().sub(textCenter).dot(n);

    // Lateral position: project v onto the plane ⊥ n through textCenter
    // lateral = v − dz·n
    const lateral = v.clone().sub(n.clone().multiplyScalar(dz));

    // Cache key: quantise lateral position (0.1 mm buckets)
    const key = `${(lateral.x * 10) | 0},${(lateral.y * 10) | 0},${(lateral.z * 10) | 0}`;

    if (!cache.has(key)) {
      // Start ray far outside the mesh along +n, shoot toward −n
      const ro = lateral.clone().addScaledVector(n, 1e4);
      ray.set(ro, nNeg);
      const hits = ray.intersectObject(mesh);
      // First hit = outermost surface facing +n direction
      cache.set(key, hits.length > 0 ? hits[0].point.clone() : lateral.clone());
    }

    const surf = cache.get(key);
    // Text height = depth * 1.5 → dz ranges [-0.75·depth, +0.75·depth]
    // Formula: np = surf + (dz + depth·0.25)·n
    //   front face (dz=+0.75·depth): protrudes +depth above surface
    //   back  face (dz=-0.75·depth): goes -0.5·depth inside mesh (clean CSG)
    const np = surf.clone().addScaledVector(n, dz + depth * 0.25);
    pos.setXYZ(i, np.x, np.y, np.z);
  }

  pos.needsUpdate = true;
  geom.computeVertexNormals();
}

async function buildTextGeometryWorld() {
  await ensureFontLoaded();
  const m = buildTextMesh();
  const textCenter = m.position.clone();
  const g = m.geometry.clone();
  g.applyMatrix4(m.matrixWorld);
  const depth = Number(depthRange.value) || 1;
  const { n } = getTextTransform();
  conformTextGeometryToMesh(g, n, depth, textCenter);
  return sanitizeGeometryForCSG(g);
}

function clearPickRect() {
  if (pickRectMesh) {
    scene.remove(pickRectMesh);
    pickRectMesh.geometry.dispose();
    pickRectMesh = null;
  }
}

// Compute text bounding box dims from font (synchronous if font already loaded)
function computePickRectDims() {
  if (!font) { pickRectDims = null; return; }
  const text  = (textInput.value || "").trim() || "TEXT";
  const size  = Number(sizeRange.value)  || 2;
  const depth = Number(depthRange.value) || 1;
  const tg = new TextGeometry(text, { font, size, height: depth * 1.5, curveSegments: 4, bevelEnabled: false });
  tg.computeBoundingBox();
  const bb = tg.boundingBox;
  pickRectDims = { w: bb.max.x - bb.min.x, h: bb.max.y - bb.min.y };
  tg.dispose();
}

// Update (or create) the rectangle outline at a hover hit during pick mode
function updatePickRect(hit) {
  if (!hit || !isPickingTextPoint || !pickRectDims) { clearPickRect(); return; }
  const { w, h } = pickRectDims;

  // Same UP logic as getTextTransform
  let UP;
  if (occlusalNormal && occlusalNormal.lengthSq() > 0.5) {
    UP = occlusalNormal.clone().normalize();
  } else {
    const axis = planeTypeSelect.value;
    if      (axis === 'y') UP = new THREE.Vector3(0, 1, 0);
    else if (axis === 'z') UP = new THREE.Vector3(0, 0, 1);
    else if (axis === 'x') UP = new THREE.Vector3(1, 0, 0);
    else                   UP = new THREE.Vector3(0, 1, 0);
  }

  // Extrusion direction n: surface normal projected ⊥ UP
  const sn = hit.face.normal.clone().transformDirection(mesh.matrixWorld);
  let n = sn.clone().addScaledVector(UP, -sn.dot(UP));
  if (n.lengthSq() < 0.001) {
    n = new THREE.Vector3(Math.abs(UP.x) < 0.9 ? 1 : 0, 0, Math.abs(UP.x) < 0.9 ? 0 : 1);
    n.addScaledVector(UP, -n.dot(UP));
  }
  n.normalize();
  const xAxis = new THREE.Vector3().crossVectors(UP, n).normalize();

  // Four corners of the bbox rectangle, offset slightly along hit normal to avoid z-fighting
  const origin = hit.point.clone().addScaledVector(sn, 0.05);
  const hw = w / 2, hh = h / 2;
  const corners = [
    origin.clone().addScaledVector(xAxis, -hw).addScaledVector(UP, -hh),
    origin.clone().addScaledVector(xAxis,  hw).addScaledVector(UP, -hh),
    origin.clone().addScaledVector(xAxis,  hw).addScaledVector(UP,  hh),
    origin.clone().addScaledVector(xAxis, -hw).addScaledVector(UP,  hh),
  ];

  // 4 edges as pairs
  const verts = new Float32Array([
    ...corners[0].toArray(), ...corners[1].toArray(),
    ...corners[1].toArray(), ...corners[2].toArray(),
    ...corners[2].toArray(), ...corners[3].toArray(),
    ...corners[3].toArray(), ...corners[0].toArray(),
  ]);

  if (!pickRectMesh) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    pickRectMesh = new THREE.LineSegments(geo,
      new THREE.LineBasicMaterial({ color: 0x00d4ff, depthTest: false }));
    pickRectMesh.renderOrder = 999;
    scene.add(pickRectMesh);
  } else {
    pickRectMesh.geometry.attributes.position.array.set(verts);
    pickRectMesh.geometry.attributes.position.needsUpdate = true;
  }
}

function clearPreview() {
  clearPickRect();
  if (previewTextMesh) {
    scene.remove(previewTextMesh);
    previewTextMesh.geometry.dispose();
    previewTextMesh = null;
    previewParamsKey = "";
  }
}

/* Build conformed preview — geometry placed in world space, no mesh transform needed */
function updateHoverPreview() {
  if (!font || !currentHoverHit || !bbox) {
    if (previewTextMesh) previewTextMesh.visible = false;
    return;
  }
  const key = `${textInput.value}|${sizeRange.value}|${depthRange.value}`;
  if (key !== previewParamsKey || !previewTextMesh) {
    if (previewTextMesh) {
      scene.remove(previewTextMesh);
      previewTextMesh.geometry.dispose();
      previewTextMesh = null;
    }
    const text  = (textInput.value || "").trim() || "TEXT";
    const size  = Number(sizeRange.value)  || 2;
    const depth = Number(depthRange.value) || 1;
    const tgeom = new TextGeometry(text, { font, size, height: depth * 1.5, curveSegments: 8, bevelEnabled: false });
    tgeom.computeBoundingBox();
    const c = new THREE.Vector3();
    tgeom.boundingBox.getCenter(c);
    tgeom.translate(-c.x, -c.y, -c.z);

    // Apply world-space transform
    const { pos: tpos, quat: tquat, n } = getTextTransform();
    const mat = new THREE.Matrix4().compose(tpos, tquat, new THREE.Vector3(1, 1, 1));
    tgeom.applyMatrix4(mat);

    // Conform to mesh surface
    conformTextGeometryToMesh(tgeom, n, depth, tpos.clone());

    const edges = new THREE.EdgesGeometry(tgeom);
    tgeom.dispose();
    // Geometry is already in world space — use identity transform on the LineSegments
    previewTextMesh = new THREE.LineSegments(edges,
      new THREE.LineBasicMaterial({ color: 0xffd166, depthTest: false }));
    previewTextMesh.renderOrder = 998;
    scene.add(previewTextMesh);
    previewParamsKey = key;
  }
  previewTextMesh.visible = true;
}

/* Remove zero/near-zero area triangles from a non-indexed geometry */
function removeDegenerateTris(geom) {
  const pos = geom.attributes.position;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const verts = [];
  const MIN_AREA_SQ = 1e-12;
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    const areaSq = b.clone().sub(a).cross(c.clone().sub(a)).lengthSq();
    if (areaSq > MIN_AREA_SQ) verts.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  }
  if (verts.length === pos.count * 3) return geom;
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  out.computeVertexNormals();
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

/* Auto-clean a freshly loaded mesh: degenerate tris → duplicate tris → islands.
   Returns { geom, removed } where removed is a summary string (empty if nothing changed). */
function autoCleanMesh(geom) {
  const before = Math.floor(geom.attributes.position.count / 3);
  const msgs = [];

  // 1. Degenerate triangles
  const afterDegen = removeDegenerateTris(geom);
  const degenRemoved = before - Math.floor(afterDegen.attributes.position.count / 3);
  if (degenRemoved > 0) msgs.push(`${degenRemoved} degenerate`);
  geom = afterDegen;

  // 2. Duplicate triangles (same 3 positions, any winding)
  {
    const pos = geom.attributes.position;
    const triCount = Math.floor(pos.count / 3);
    const box = geom.boundingBox || new THREE.Box3().setFromBufferAttribute(pos);
    const size = new THREE.Vector3();
    box.getSize(size);
    const tol = Math.max(size.x, size.y, size.z) * 1e-4 || 1e-6;
    function qv(idx) {
      return `${Math.round(pos.getX(idx) / tol)},${Math.round(pos.getY(idx) / tol)},${Math.round(pos.getZ(idx) / tol)}`;
    }
    const seen = new Set();
    const keep = [];
    for (let tri = 0; tri < triCount; tri++) {
      const keys = [qv(tri * 3), qv(tri * 3 + 1), qv(tri * 3 + 2)].sort();
      const key = keys.join('|');
      if (!seen.has(key)) { seen.add(key); keep.push(tri); }
    }
    if (keep.length < triCount) {
      const src = pos.array;
      const newPos = new Float32Array(keep.length * 9);
      keep.forEach((tri, i) => newPos.set(src.subarray(tri * 9, tri * 9 + 9), i * 9));
      const g2 = new THREE.BufferGeometry();
      g2.setAttribute("position", new THREE.Float32BufferAttribute(newPos, 3));
      g2.computeVertexNormals();
      g2.computeBoundingBox();
      g2.computeBoundingSphere();
      msgs.push(`${triCount - keep.length} duplicate`);
      geom = g2;
    }
  }

  // 3. Disconnected islands — keep only largest component
  {
    const beforeIsland = Math.floor(geom.attributes.position.count / 3);
    const cleaned = removeDisconnectedIslands(geom);
    const islandRemoved = beforeIsland - Math.floor(cleaned.attributes.position.count / 3);
    if (islandRemoved > 0) msgs.push(`${islandRemoved} island tris`);
    geom = cleaned;
  }

  return { geom, removed: msgs.length ? `Cleaned: ${msgs.join(', ')} removed.` : "" };
}

async function applyTextCSG() {
  if (!mesh || !bbox) return;
  await ensureFontLoaded();
  clearPreview();

  const baseGeom = sanitizeGeometryForCSG(mesh.geometry);
  const textGeomWorld = await buildTextGeometryWorld();

  const a = new Brush(baseGeom);
  const b = new Brush(textGeomWorld);

  const result = evaluator.evaluate(a, b, ADDITION);

  const resultGeom = result.geometry.clone();
  resultGeom.computeVertexNormals();
  resultGeom.computeBoundingBox();
  resultGeom.computeBoundingSphere();

  // Convert to non-indexed, remove degenerate triangles, add vertex colors
  let finalGeom = resultGeom;
  if (finalGeom.index) finalGeom = finalGeom.toNonIndexed();
  finalGeom = removeDegenerateTris(finalGeom);
  initVertexColors(finalGeom);
  selectedSet.clear();

  mesh.geometry.dispose();
  mesh.geometry = finalGeom;
  innerMesh.geometry = finalGeom;
  bbox = finalGeom.boundingBox ? finalGeom.boundingBox.clone() : new THREE.Box3().setFromBufferAttribute(finalGeom.attributes.position);

  clearBoundaryLines();

  const total = Math.floor(finalGeom.attributes.position.count / 3);
  infoEl.textContent = `Emboss applied | Triangles: ${total.toLocaleString()}`;
  updateInfo();
}

/* ===== Button: Apply CSG ===== */
btnApplyText.addEventListener("click", () => {
  showSpinner();
  // Double-rAF ensures spinner is painted before synchronous heavy work (raycasts + CSG) blocks the thread
  requestAnimationFrame(() => requestAnimationFrame(() => {
    applyTextCSG().catch((e) => {
      console.error(e);
      infoEl.textContent = "Error applying CSG (see console).";
    }).finally(() => hideSpinner());
  }));
});

/* ===== Button: Reset to original ===== */
btnReset.addEventListener("click", () => {
  if (!originalGeometry) return;
  clearPreview();
  selectedSet.clear();

  const geom = originalGeometry.clone();
  geom.computeVertexNormals();
  geom.computeBoundingBox();
  geom.computeBoundingSphere();

  let finalGeom = geom;
  if (finalGeom.index) finalGeom = finalGeom.toNonIndexed();
  initVertexColors(finalGeom);

  mesh.geometry.dispose();
  mesh.geometry = finalGeom;
  innerMesh.geometry = finalGeom;
  bbox = finalGeom.boundingBox.clone();

  updateBoundaryLines(finalGeom);
  updateExtrudePosDefault();

  const total = Math.floor(finalGeom.attributes.position.count / 3);
  infoEl.textContent = `Original restored. Triangles: ${total.toLocaleString()}`;
  updateInfo();
});

/* ===== Drag & drop ===== */
dropZone.addEventListener("click", () => stlInput.click());

dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("drag-over");
});

dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("drag-over");
});

dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("drag-over");
  const file = e.dataTransfer.files[0];
  if (file) loadFile(file);
});

stlInput.addEventListener("change", (e) => {
  const f = e.target.files?.[0];
  if (f) loadFile(f);
});

/* ===== Load file ===== */
const objLoader = new OBJLoader();

function loadOBJText(text, filename) {
  // Parse face→vertex indices directly from OBJ text (0-based, triangulated).
  const faceIndices = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('f ')) continue;
    const verts = t.split(/\s+/).slice(1).map(tok => parseInt(tok.split('/')[0]) - 1);
    for (let i = 1; i < verts.length - 1; i++) {
      faceIndices.push(verts[0], verts[i], verts[i + 1]);
    }
  }
  objOriginalIndices = faceIndices.length ? new Int32Array(faceIndices) : null;

  const group = objLoader.parse(text);
  const geos = [];
  group.traverse((child) => {
    if (child.isMesh && child.geometry) {
      let g = child.geometry.index ? child.geometry.toNonIndexed() : child.geometry.clone();
      if (!g.attributes.normal) g.computeVertexNormals();
      geos.push(g);
    }
  });
  if (!geos.length) { infoEl.textContent = "No geometry found in OBJ file."; return; }
  const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
  merged.computeVertexNormals();
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  segmentationColors = null;
  segSection.style.display = "";
  segInfo.textContent = "No segmentation loaded";
  loadGeometryFromParsed(merged, filename);
}

function loadFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  const reader = new FileReader();
  if (ext === 'obj') {
    reader.onload = (e) => {
      const text = e.target.result;

      loadOBJText(text, file.name);
    };
    reader.readAsText(file);
  } else {
    objOriginalIndices = null;
    segmentationColors = null;
    segSection.style.display = "none";
    reader.onload = (e) => loadGeometryFromBuffer(e.target.result, file.name);
    reader.readAsArrayBuffer(file);
  }
}

function loadGeometryFromBuffer(buffer, filename) {
  let geometry = loader.parse(buffer);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  if (geometry.index) geometry = geometry.toNonIndexed();
  loadGeometryFromParsed(geometry, filename);
}

function loadGeometryFromParsed(geometry, filename) {
  loadedFilename = filename.replace(/\.(stl|obj)$/i, "");
  textInput.value = loadedFilename;
  if (geometry.index) geometry = geometry.toNonIndexed();

  // Auto-clean: degenerate + duplicate tris, disconnected islands
  const { geom: cleanGeom, removed: cleanMsg } = autoCleanMesh(geometry);
  geometry = cleanGeom;

  initVertexColors(geometry);

  // Pre-load font so preview is ready on first hover
  ensureFontLoaded().catch(console.error);

  // Store original for reset
  originalGeometry = geometry.clone();

  // Reset occlusal plane on new load
  if (occlusalPlane) { scene.remove(occlusalPlane); occlusalPlane.geometry.dispose(); occlusalPlane = null; }
  occlusalNormal = null; occlusalCenter = null;
  planeControls.style.display = "none";

  if (mesh) {
    scene.remove(mesh);
    mesh.geometry.dispose();
  }
  if (innerMesh) {
    scene.remove(innerMesh);
  }

  mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);

  innerMesh = new THREE.Mesh(geometry, backMaterial);
  innerMesh.raycast = () => {};
  scene.add(innerMesh);

  selectedSet.clear();
  undoStack.length = 0;
  redoStack.length = 0;
  preExtrusionState = null;
  bbox = geometry.boundingBox.clone();

  clearPreview();
  currentHoverHit = null;
  isPickingTextPoint = false;
  btnPickTextPoint.classList.remove("active");
  btnUpdateTextPreview.style.display = "none";
  pickInfo.textContent = "No point picked";
  orbitControls.enabled = true;
  renderer.domElement.style.cursor = "";
  updateBoundaryLines(geometry);
  fitCameraToObject(mesh);
  setEnabled(true);
  updateBrushRange();
  updateExtrudePosDefault();

  const total = Math.floor(geometry.attributes.position.count / 3);
  infoEl.textContent = `Loaded: ${filename} | Triangles: ${total.toLocaleString()}${cleanMsg ? ' | ' + cleanMsg : ''}`;
  updateInfo();
}

/* ===== Auto-load sample ===== */
const _sampleParam = new URLSearchParams(location.search).get('sample');

if (_sampleParam === '01533UH2_upper') {
  const base = 'samples/01533UH2_upper/01533UH2_upper';
  fetch(`${base}.obj`)
    .then(r => { if (!r.ok) throw new Error(r.status); return r.text(); })
    .then(text => {
      loadOBJText(text, '01533UH2_upper.obj');
      return fetch(`${base}.json`);
    })
    .then(r => { if (!r.ok) throw new Error(r.status); return r.text(); })
    .then(text => applySegJSON(text))
    .catch(err => {
      console.error('Sample load failed:', err);
      infoEl.textContent = 'Load an STL to get started.';
    });
} else if (/[?&#]sample\b/.test(location.href)) {
  fetch('samples/sample_Lower_clean.stl')
    .then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
    .then(buffer => loadGeometryFromBuffer(buffer, 'sample_Lower_clean.stl'))
    .catch(err => {
      console.error('Sample load failed:', err);
      infoEl.textContent = 'Load an STL to get started.';
    });
} else {
  infoEl.textContent = 'Load an STL to get started.';
}

/* ===== Init ===== */
setEnabled(false);

/* ===== Animate loop ===== */
function animate() {
  requestAnimationFrame(animate);
  orbitControls.update();
  renderer.render(scene, camera);
}
animate();

/* ===== Resize ===== */
/* ===== Keyboard shortcuts ===== */
window.addEventListener("keydown", (e) => {
  if (!mesh) return;
  const tag = document.activeElement?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

  if (e.key === "Delete") {
    e.preventDefault();
    btnDelete.click();
  } else if (e.key === "Escape") {
    e.preventDefault();
    clearSelection();
  } else if (e.key === "z" && e.ctrlKey && !e.shiftKey) {
    e.preventDefault();
    btnUndo.click();
  } else if ((e.key === "y" && e.ctrlKey) || (e.key === "z" && e.ctrlKey && e.shiftKey)) {
    e.preventDefault();
    btnRedo.click();
  }
});

/* ===== Resize ===== */
window.addEventListener("resize", () => {
  const w = container.clientWidth;
  const h = container.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
});
