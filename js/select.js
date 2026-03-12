import * as THREE from "three";
import { ShapeUtils } from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { STLExporter } from "three/addons/exporters/STLExporter.js";
import { FontLoader } from "three/addons/loaders/FontLoader.js";
import { TextGeometry } from "three/addons/geometries/TextGeometry.js";
import { Brush, Evaluator, ADDITION } from "three-bvh-csg";

/* ===== DOM elements ===== */
const container        = document.getElementById("viewer");
const stlInput         = document.getElementById("stlInput");
const dropZone         = document.getElementById("dropZone");
const infoEl           = document.getElementById("info");

const brushRadiusRange = document.getElementById("brushRadiusRange");

const btnClear         = document.getElementById("btnClear");
const btnUndo          = document.getElementById("btnUndo");
const btnClose         = document.getElementById("btnClose");
const btnDelete        = document.getElementById("btnDelete");
const btnDownload      = document.getElementById("btnDownload");

const extrudeAxisSelect = document.getElementById("extrudeAxisSelect");
const extrudePosRange   = document.getElementById("extrudePosRange");
const btnExtrude        = document.getElementById("btnExtrude");

const textInput        = document.getElementById("textInput");
const sizeRange        = document.getElementById("sizeRange");
const depthRange       = document.getElementById("depthRange");

const btnPickTextPoint = document.getElementById("btnPickTextPoint");
const pickInfo         = document.getElementById("pickInfo");
const btnApplyText     = document.getElementById("btnApplyText");
const btnReset         = document.getElementById("btnReset");

const brushRadiusVal   = document.getElementById("brushRadiusVal");
const extrudePosVal    = document.getElementById("extrudePosVal");
const sizeVal          = document.getElementById("sizeVal");
const depthVal         = document.getElementById("depthVal");

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

scene.add(new THREE.HemisphereLight(0xffffff, 0x223355, 0.9));
const d1 = new THREE.DirectionalLight(0xffffff, 0.9);
d1.position.set(1, 1, 1);
scene.add(d1);
const d2 = new THREE.DirectionalLight(0xffffff, 0.5);
d2.position.set(-1, 0.4, -0.8);
scene.add(d2);

scene.add(new THREE.AxesHelper(60));
// No GridHelper per requirements

/* ===== Colors & materials ===== */
const BASE_COLOR = new THREE.Color(0x7dd3fc);
const SEL_COLOR  = new THREE.Color(0xff6b6b);

const material = new THREE.MeshStandardMaterial({
  vertexColors: true,
  metalness: 0.2,
  roughness: 0.6,
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
let bbox           = null;
let selectedSet    = new Set();
let boundaryLines  = null;
let isPainting     = false;
let preExtrusionState = null;

// Emboss/deboss state
let font             = null;
let originalGeometry = null;
let previewTextMesh  = null;

// Text placement
let isPickingTextPoint = false;
let currentHoverHit    = null;   // the picked point (set on click, not on hover)
let previewParamsKey   = "";

/* ===== Undo stack ===== */
const undoStack = [];

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
  bbox = newGeom.boundingBox.clone();
  selectedSet = new Set(state.selected);
  updateBoundaryLines(newGeom);
  updateExtrudePosDefault();
  updateInfo();
}

function pushUndo() {
  undoStack.push(captureState());
  if (undoStack.length > 20) undoStack.shift();
  btnUndo.disabled = false;
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
  const axis = extrudeAxisSelect.value;
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
  const axis = extrudeAxisSelect.value;
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
  btnClear.disabled    = !enabled;
  btnClose.disabled    = !enabled;
  btnDelete.disabled   = !enabled;
  btnDownload.disabled = !enabled;
  extrudeAxisSelect.disabled = !enabled;
  extrudePosRange.disabled   = !enabled;
  btnExtrude.disabled        = !enabled;
  sizeRange.disabled         = !enabled;
  depthRange.disabled        = !enabled;
  btnPickTextPoint.disabled  = !enabled;
  btnApplyText.disabled      = !enabled;
  btnReset.disabled          = !enabled;
  if (!enabled) btnUndo.disabled = true;
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
  color: 0xef4444,
  transparent: true,
  opacity: 0.7,
  side: THREE.DoubleSide,
  depthTest: false,
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

function tryPaint(event) {
  if (!mesh || !isPainting || !event.shiftKey) return;
  getMouseNDC(event);
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObject(mesh);
  if (hits.length > 0) paintAtPoint(hits[0].point);
}

renderer.domElement.addEventListener("mousedown", (e) => {
  if (isPickingTextPoint && e.button === 0) {
    getMouseNDC(e);
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObject(mesh);
    if (hits.length > 0) {
      currentHoverHit = hits[0];
      isPickingTextPoint = false;
      btnPickTextPoint.classList.remove("active");
      orbitControls.enabled = true;
      renderer.domElement.style.cursor = "";
      pickInfo.textContent = "Point set";
      previewParamsKey = ""; // force rebuild at new surface location
      updateHoverPreview();
    }
    return;
  }
  if (!e.shiftKey || e.button !== 0) return;
  orbitControls.enabled = false;
  isPainting = true;
  tryPaint(e);
});

renderer.domElement.addEventListener("mousemove", (e) => {
  updateBrushCursor(e);
  if (!isPainting) return;
  tryPaint(e);
});

window.addEventListener("mouseup", () => {
  isPainting = false;
  orbitControls.enabled = true;
});

/* ===== Boundary lines ===== */
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

/* ===== Button: Clear ===== */
btnClear.addEventListener("click", () => {
  if (!mesh) return;
  const col = mesh.geometry.attributes.color;
  for (let i = 0; i < col.count; i++) {
    col.setXYZ(i, BASE_COLOR.r, BASE_COLOR.g, BASE_COLOR.b);
  }
  selectedSet.clear();
  col.needsUpdate = true;
  updateInfo();
});

/* ===== Button: Undo ===== */
btnUndo.addEventListener("click", () => {
  if (!undoStack.length) return;
  preExtrusionState = null;
  restoreState(undoStack.pop());
  btnUndo.disabled = undoStack.length === 0;
});

/* ===== Button: Delete selection ===== */
btnDelete.addEventListener("click", () => {
  if (!mesh) return;
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

  const newGeom = new THREE.BufferGeometry();
  newGeom.setAttribute("position", new THREE.Float32BufferAttribute(newVerts, 3));
  newGeom.computeVertexNormals();
  newGeom.computeBoundingBox();
  newGeom.computeBoundingSphere();
  initVertexColors(newGeom);

  selectedSet.clear();
  mesh.geometry.dispose();
  mesh.geometry = newGeom;

  updateBoundaryLines(newGeom);
  updateInfo();
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
  a.download = "result.stl";
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
  bbox = newGeom.boundingBox.clone();
  updateBoundaryLines(newGeom);

  const capTris = newVerts.length / 9;
  infoEl.textContent = selectedSet.size === 0
    ? `Closed ${loops.length} hole(s) — ${capTris} triangles added.`
    : `Cap added (${capTris} triangles). Now click "Delete selection".`;
  updateInfo();
});

/* ===== Extrude axis change ===== */
extrudeAxisSelect.addEventListener("change", () => {
  updateExtrudePosDefault();
  updateExtrusionPlane();
});

/* ===== Button: Extrude to plane ===== */
btnExtrude.addEventListener("click", () => {
  if (!mesh) return;

  if (preExtrusionState) {
    restoreState(preExtrusionState);
  } else {
    pushUndo();
    preExtrusionState = captureState();
  }

  const axis = extrudeAxisSelect.value;
  const planeVal = parseFloat(extrudePosRange.value) || 0;

  function project(p) {
    if (axis === 'z') return new THREE.Vector3(p.x, p.y, planeVal);
    if (axis === 'y') return new THREE.Vector3(p.x, planeVal, p.z);
    return new THREE.Vector3(planeVal, p.y, p.z);
  }

  const pos = mesh.geometry.attributes.position;
  const triCount = Math.floor(pos.count / 3);

  const size = new THREE.Vector3();
  bbox.getSize(size);
  const tol = Math.max(size.x, size.y, size.z) * 1e-4;

  function qv(idx) {
    return `${Math.round(pos.getX(idx) / tol)},${Math.round(pos.getY(idx) / tol)},${Math.round(pos.getZ(idx) / tol)}`;
  }
  function qvVec(v) {
    return `${Math.round(v.x / tol)},${Math.round(v.y / tol)},${Math.round(v.z / tol)}`;
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

  const newVerts = [];
  const dirAdj = new Map();
  const vertPos = new Map();

  edgeMap.forEach((entries) => {
    if (entries.length !== 1) return;
    const { vA, vB } = entries[0];
    const P = new THREE.Vector3(pos.getX(vA), pos.getY(vA), pos.getZ(vA));
    const Q = new THREE.Vector3(pos.getX(vB), pos.getY(vB), pos.getZ(vB));
    const Pp = project(P), Qp = project(Q);

    newVerts.push(P.x, P.y, P.z,  Pp.x, Pp.y, Pp.z,  Q.x, Q.y, Q.z);
    newVerts.push(Q.x, Q.y, Q.z,  Pp.x, Pp.y, Pp.z,  Qp.x, Qp.y, Qp.z);

    const kA = qvVec(P), kB = qvVec(Q);
    vertPos.set(kA, P); vertPos.set(kB, Q);
    if (!dirAdj.has(kA)) dirAdj.set(kA, []);
    dirAdj.get(kA).push(kB);
  });

  if (!newVerts.length) {
    infoEl.textContent = "The mesh has no open edges to extrude.";
    return;
  }

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
      const nexts = dirAdj.get(cur) || [];
      const next = nexts.find(k => !visitedKeys.has(k));
      if (!next) break;
      cur = next;
    }
    if (loop.length >= 3) loops.push(loop);
  }

  const meshCenter = new THREE.Vector3();
  bbox.getCenter(meshCenter);
  const meshAxisVal = axis === 'z' ? meshCenter.z : axis === 'y' ? meshCenter.y : meshCenter.x;
  const expectedAxisSign = Math.sign(planeVal - meshAxisVal);

  for (const loop of loops) {
    const capVerts = triangulateLoop3D(loop.map(p => project(p)));
    if (capVerts.length < 9) continue;

    const ta = new THREE.Vector3(capVerts[0], capVerts[1], capVerts[2]);
    const tb = new THREE.Vector3(capVerts[3], capVerts[4], capVerts[5]);
    const tc = new THREE.Vector3(capVerts[6], capVerts[7], capVerts[8]);
    const capNorm = new THREE.Vector3().crossVectors(tb.clone().sub(ta), tc.clone().sub(ta));
    const actualSign = axis === 'z' ? Math.sign(capNorm.z)
                     : axis === 'y' ? Math.sign(capNorm.y)
                     : Math.sign(capNorm.x);

    if (expectedAxisSign !== 0 && actualSign !== 0 && actualSign !== expectedAxisSign) {
      for (let i = 0; i < capVerts.length; i += 9) {
        for (let k = 0; k < 3; k++) {
          const tmp = capVerts[i + 3 + k];
          capVerts[i + 3 + k] = capVerts[i + 6 + k];
          capVerts[i + 6 + k] = tmp;
        }
      }
    }

    newVerts.push(...capVerts);
  }

  if (!newVerts.length) {
    infoEl.textContent = "Could not generate the extrusion.";
    return;
  }

  const existingPos = pos.array;
  const existingCol = mesh.geometry.attributes.color.array;
  const capVertCount = newVerts.length / 3;
  const capCol = new Float32Array(capVertCount * 3);
  for (let i = 0; i < capVertCount; i++) {
    capCol[i * 3] = BASE_COLOR.r; capCol[i * 3 + 1] = BASE_COLOR.g; capCol[i * 3 + 2] = BASE_COLOR.b;
  }

  const allPos = new Float32Array(existingPos.length + newVerts.length);
  allPos.set(existingPos);
  allPos.set(newVerts, existingPos.length);

  const allCol = new Float32Array(existingCol.length + capCol.length);
  allCol.set(existingCol);
  allCol.set(capCol, existingCol.length);

  const newGeom = new THREE.BufferGeometry();
  newGeom.setAttribute("position", new THREE.Float32BufferAttribute(allPos, 3));
  newGeom.setAttribute("color",    new THREE.Float32BufferAttribute(allCol, 3));
  newGeom.computeVertexNormals();
  newGeom.computeBoundingBox();
  newGeom.computeBoundingSphere();

  mesh.geometry.dispose();
  mesh.geometry = newGeom;
  bbox = newGeom.boundingBox.clone();

  updateBoundaryLines(newGeom);
  updateExtrusionPlane();

  const newTris = newVerts.length / 9;
  infoEl.textContent = `Extruded to ${axis.toUpperCase()}=${planeVal.toFixed(2)} (${loops.length} loop(s), ${newTris} new triangles).`;
  updateInfo();
});

/* ===== Pick text point button ===== */
btnPickTextPoint.addEventListener("click", () => {
  if (!mesh) return;
  if (isPickingTextPoint) {
    isPickingTextPoint = false;
    btnPickTextPoint.classList.remove("active");
    orbitControls.enabled = true;
    renderer.domElement.style.cursor = "";
    pickInfo.textContent = currentHoverHit ? "Point set" : "No point picked";
  } else {
    isPickingTextPoint = true;
    btnPickTextPoint.classList.add("active");
    pickInfo.textContent = "Click on the mesh…";
    orbitControls.enabled = false;
    renderer.domElement.style.cursor = "crosshair";
  }
});

/* ===== Text slider → refresh preview if point already picked ===== */
function refreshPickedPreview() {
  if (currentHoverHit && font && bbox) {
    previewParamsKey = ""; // force geometry rebuild
    updateHoverPreview();
  }
}
[textInput, sizeRange, depthRange].forEach(el => {
  el.addEventListener("input", refreshPickedPreview);
});
extrudeAxisSelect.addEventListener("change", refreshPickedPreview);

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
   - Extrusion direction (n): surface normal projected onto XZ plane → always ⊥ world Y.
   - yAxis: world Y → letters stand upright.
   - xAxis: cross(Y, n) → reading direction, horizontal, given by pick location.
*/
function getTextTransform() {
  const UP = new THREE.Vector3(0, 1, 0);
  let n;

  if (currentHoverHit && currentHoverHit.face) {
    // Project surface normal onto XZ plane so n ⊥ world Y
    const sn = currentHoverHit.face.normal.clone().transformDirection(mesh.matrixWorld);
    n = new THREE.Vector3(sn.x, 0, sn.z);
    if (n.lengthSq() < 0.001) n.set(1, 0, 0); // nearly-horizontal surface fallback
    n.normalize();
  } else {
    // No pick yet — default to a horizontal direction from axis selector
    const axis = extrudeAxisSelect.value;
    n = axis === 'x' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
  }

  // n ⊥ Y guaranteed → cross(Y, n) is always valid and horizontal
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
    const axis = extrudeAxisSelect.value;
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
    font, size, height: depth, curveSegments: 8, bevelEnabled: false,
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
    // Offset so back face (dz = -depth/2) sits slightly INSIDE the mesh (by 15% of depth).
    // This guarantees a clean CSG union with no coplanar / interior triangles.
    // front face (dz = +depth/2) protrudes by ~85% of depth above the surface.
    const penetration = depth * 0.15;
    const np = surf.clone().addScaledVector(n, dz + depth * 0.5 - penetration);
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

function clearPreview() {
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
    const tgeom = new TextGeometry(text, { font, size, height: depth, curveSegments: 8, bevelEnabled: false });
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

  // Convert to non-indexed and add vertex colors
  let finalGeom = resultGeom;
  if (finalGeom.index) finalGeom = finalGeom.toNonIndexed();
  initVertexColors(finalGeom);
  selectedSet.clear();

  mesh.geometry.dispose();
  mesh.geometry = finalGeom;
  bbox = finalGeom.boundingBox ? finalGeom.boundingBox.clone() : new THREE.Box3().setFromBufferAttribute(finalGeom.attributes.position);

  updateBoundaryLines(finalGeom);

  const total = Math.floor(finalGeom.attributes.position.count / 3);
  infoEl.textContent = `Emboss applied | Triangles: ${total.toLocaleString()}`;
  updateInfo();
}

/* ===== Button: Apply CSG ===== */
btnApplyText.addEventListener("click", () => {
  applyTextCSG().catch((e) => {
    console.error(e);
    infoEl.textContent = "Error applying CSG (see console).";
  });
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
function loadFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => loadGeometryFromBuffer(e.target.result, file.name);
  reader.readAsArrayBuffer(file);
}

function loadGeometryFromBuffer(buffer, filename) {
  let geometry = loader.parse(buffer);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  if (geometry.index) geometry = geometry.toNonIndexed();

  initVertexColors(geometry);

  // Pre-load font so preview is ready on first hover
  ensureFontLoaded().catch(console.error);

  // Store original for reset
  originalGeometry = geometry.clone();

  if (mesh) {
    scene.remove(mesh);
    mesh.geometry.dispose();
  }

  mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);

  selectedSet.clear();
  undoStack.length = 0;
  preExtrusionState = null;
  bbox = geometry.boundingBox.clone();

  clearPreview();
  currentHoverHit = null;
  isPickingTextPoint = false;
  btnPickTextPoint.classList.remove("active");
  pickInfo.textContent = "No point picked";
  orbitControls.enabled = true;
  renderer.domElement.style.cursor = "";
  updateBoundaryLines(geometry);
  fitCameraToObject(mesh);
  setEnabled(true);
  updateBrushRange();
  updateExtrudePosDefault();

  const total = Math.floor(geometry.attributes.position.count / 3);
  infoEl.textContent = `Loaded: ${filename} | Triangles: ${total.toLocaleString()}`;
  updateInfo();
}

/* ===== Auto-load sample (only on ?sample or #sample) ===== */
const isSampleRoute = /[?&#]sample\b/.test(location.href);
if (isSampleRoute) {
  fetch("samples/sample_Lower_clean.stl")
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.arrayBuffer();
    })
    .then((buffer) => loadGeometryFromBuffer(buffer, "sample_Lower_clean.stl"))
    .catch((err) => {
      console.error("Sample load failed:", err);
      infoEl.textContent = "Load an STL to get started.";
    });
} else {
  infoEl.textContent = "Load an STL to get started.";
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
window.addEventListener("resize", () => {
  const w = container.clientWidth;
  const h = container.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
});
