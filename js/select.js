import * as THREE from "three";
import { ShapeUtils } from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { STLExporter } from "three/addons/exporters/STLExporter.js";

const container = document.getElementById("viewer");
const fileInput = document.getElementById("stlInput");
const infoEl = document.getElementById("info");
const brushRadiusInput = document.getElementById("brushRadius");
const btnMode = document.getElementById("btnMode");
const btnClear = document.getElementById("btnClear");
const btnClose = document.getElementById("btnClose");
const btnExtrude = document.getElementById("btnExtrude");
const extrudeAxisSelect = document.getElementById("extrudeAxis");
const extrudePosInput = document.getElementById("extrudePos");
const btnDelete = document.getElementById("btnDelete");
const btnUndo = document.getElementById("btnUndo");
const btnDownload = document.getElementById("btnDownload");

/* ===== Three base ===== */
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0e1626);

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
const grid = new THREE.GridHelper(200, 20, 0x446688, 0x223344);
grid.position.y = -40;
scene.add(grid);

/* ===== Colores ===== */
const BASE_COLOR = new THREE.Color(0x7dd3fc);   // azul base
const SEL_COLOR  = new THREE.Color(0xff6b6b);   // rojo selección

const material = new THREE.MeshStandardMaterial({
  vertexColors: true,
  metalness: 0.2,
  roughness: 0.6,
});

/* ===== Estado ===== */
const loader = new STLLoader();
let mesh = null;
let bbox = null;
let selectedSet = new Set();
let boundaryLines = null;

const boundaryMat = new THREE.LineBasicMaterial({ color: 0xfbbf24 }); // amarillo

let isPaintMode = false;
let isPainting  = false;

/* ===== Undo ===== */
const undoStack = [];
let preExtrusionState = null; // base guardada antes de la primera extrusión; permite re-extruir sin apilar

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

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

/* ===== UI helpers ===== */
function setEnabled(enabled) {
  brushRadiusInput.disabled = !enabled;
  btnMode.disabled = !enabled;
  btnClear.disabled = !enabled;
  btnClose.disabled = !enabled;
  btnExtrude.disabled = !enabled;
  extrudeAxisSelect.disabled = !enabled;
  extrudePosInput.disabled = !enabled;
  btnDelete.disabled = !enabled;
  btnDownload.disabled = !enabled;
  if (!enabled) btnUndo.disabled = true;
}

function updateInfo() {
  if (!mesh) return;
  const total = Math.floor(mesh.geometry.attributes.position.count / 3);
  const sel = countSelectedTriangles();
  infoEl.textContent =
    `Triángulos: ${total.toLocaleString()} | Seleccionados: ${sel.toLocaleString()}`;
}

function countSelectedTriangles() {
  return selectedSet.size;
}

/* ===== Cámara ===== */
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

/* ===== Colores de vértice ===== */
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

/* ===== Pintura ===== */
function paintAtPoint(worldPoint) {
  if (!mesh) return;

  const pos = mesh.geometry.attributes.position;
  const col = mesh.geometry.attributes.color;
  const radius = Number(brushRadiusInput.value) || 5;
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
  if (!mesh || !isPainting) return;
  getMouseNDC(event);
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObject(mesh);
  if (hits.length > 0) paintAtPoint(hits[0].point);
}

/* ===== Eventos de ratón ===== */
renderer.domElement.addEventListener("mousedown", (e) => {
  if (!isPaintMode || e.button !== 0) return;
  isPainting = true;
  tryPaint(e);
});

renderer.domElement.addEventListener("mousemove", (e) => {
  if (!isPaintMode) return;
  tryPaint(e);
});

window.addEventListener("mouseup", () => { isPainting = false; });

/* ===== Botones ===== */
btnMode.addEventListener("click", () => {
  isPaintMode = !isPaintMode;
  orbitControls.enabled = !isPaintMode;
  btnMode.textContent = isPaintMode ? "Modo: Pintar" : "Modo: Orbitar";
  btnMode.classList.toggle("btn--ghost", !isPaintMode);
  renderer.domElement.style.cursor = isPaintMode ? "crosshair" : "grab";
});

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

btnUndo.addEventListener("click", () => {
  if (!undoStack.length) return;
  preExtrusionState = null;
  restoreState(undoStack.pop());
  btnUndo.disabled = undoStack.length === 0;
});

btnDelete.addEventListener("click", () => {
  if (!mesh) return;
  pushUndo();
  preExtrusionState = null;

  const pos = mesh.geometry.attributes.position;

  const newVerts = [];
  for (let i = 0; i < pos.count; i += 3) {
    const isSelected = selectedSet.has(i / 3);
    if (!isSelected) {
      for (let j = 0; j < 3; j++) {
        newVerts.push(pos.getX(i + j), pos.getY(i + j), pos.getZ(i + j));
      }
    }
  }

  if (newVerts.length === 0) {
    infoEl.textContent = "No quedarían triángulos tras eliminar la selección.";
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

btnDownload.addEventListener("click", () => {
  if (!mesh) return;

  const pos = mesh.geometry.attributes.position;

  const exportVerts = [];
  for (let i = 0; i < pos.count; i += 3) {
    const isSelected = selectedSet.has(i / 3);
    if (!isSelected) {
      for (let j = 0; j < 3; j++) {
        exportVerts.push(pos.getX(i + j), pos.getY(i + j), pos.getZ(i + j));
      }
    }
  }

  const exportGeom = new THREE.BufferGeometry();
  exportGeom.setAttribute("position", new THREE.Float32BufferAttribute(exportVerts, 3));
  exportGeom.computeVertexNormals();

  const exporter = new STLExporter();
  const result = exporter.parse(new THREE.Mesh(exportGeom, material), { binary: true });
  exportGeom.dispose();

  const blob = new Blob([result], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "resultado.stl";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

/* ===== Aristas abiertas ===== */

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

/* ===== Cerrar agujero en selección ===== */

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

  // Normal por el método de Newell
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

  // Asegurar CCW
  let area = 0;
  for (let i = 0; i < poly2D.length; i++) {
    const p = poly2D[i], q = poly2D[(i + 1) % poly2D.length];
    area += p.x * q.y - q.x * p.y;
  }
  const orderedLoop = area < 0 ? [...loop].reverse() : loop;
  const orderedPoly2D = area < 0 ? [...poly2D].reverse() : poly2D;

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

btnClose.addEventListener("click", () => {
  if (!mesh) return;

  if (selectedSet.size === 0) {
    infoEl.textContent = "Selecciona primero una zona de la malla.";
    return;
  }

  const pos = mesh.geometry.attributes.position;
  const triCount = Math.floor(pos.count / 3);

  const size = new THREE.Vector3();
  bbox.getSize(size);
  const tol = Math.max(size.x, size.y, size.z) * 1e-4;

  function qv(idx) {
    return `${Math.round(pos.getX(idx) / tol)},${Math.round(pos.getY(idx) / tol)},${Math.round(pos.getZ(idx) / tol)}`;
  }

  // Construir mapa de aristas
  const edgeMap = new Map();
  for (let tri = 0; tri < triCount; tri++) {
    const base = tri * 3;
    for (let e = 0; e < 3; e++) {
      const vA = base + e;
      const vB = base + (e + 1) % 3;
      const kA = qv(vA), kB = qv(vB);
      const key = kA < kB ? `${kA}||${kB}` : `${kB}||${kA}`;
      if (!edgeMap.has(key)) edgeMap.set(key, []);
      edgeMap.get(key).push({ tri, vA, vB });
    }
  }

  // Aristas frontera:
  // 1) Seleccionado ↔ no seleccionado: borde interior de la selección
  // 2) Borde abierto de la malla dentro de la selección (p. ej. base abierta de un escaneo)
  const segments = [];
  edgeMap.forEach((entries) => {
    if (entries.length === 2) {
      const sel0 = selectedSet.has(entries[0].tri);
      const sel1 = selectedSet.has(entries[1].tri);
      if (sel0 === sel1) return;
      // Usar vértices del lado NO seleccionado para continuidad con la malla restante
      const side = sel0 ? entries[1] : entries[0];
      const pA = new THREE.Vector3(pos.getX(side.vA), pos.getY(side.vA), pos.getZ(side.vA));
      const pB = new THREE.Vector3(pos.getX(side.vB), pos.getY(side.vB), pos.getZ(side.vB));
      segments.push([pA, pB]);
    } else if (entries.length === 1 && selectedSet.has(entries[0].tri)) {
      // Borde abierto de la malla perteneciente a un triángulo seleccionado
      const { vA, vB } = entries[0];
      const pA = new THREE.Vector3(pos.getX(vA), pos.getY(vA), pos.getZ(vA));
      const pB = new THREE.Vector3(pos.getX(vB), pos.getY(vB), pos.getZ(vB));
      segments.push([pA, pB]);
    }
  });

  if (!segments.length) {
    infoEl.textContent = "No se encontraron bordes en la selección.";
    return;
  }

  const loops = buildLoops3D(segments, tol);
  if (!loops.length) {
    infoEl.textContent = "No se pudo construir el contorno para cerrar.";
    return;
  }

  const newVerts = [];
  for (const loop of loops) newVerts.push(...triangulateLoop3D(loop));

  if (!newVerts.length) {
    infoEl.textContent = "No se pudo triangular el cierre.";
    return;
  }

  pushUndo();
  preExtrusionState = null;

  // Añadir los nuevos triángulos (color base) a la geometría existente
  const capVertCount = newVerts.length / 3;
  const capCol = new Float32Array(capVertCount * 3);
  for (let i = 0; i < capVertCount; i++) {
    capCol[i * 3] = BASE_COLOR.r; capCol[i * 3 + 1] = BASE_COLOR.g; capCol[i * 3 + 2] = BASE_COLOR.b;
  }

  const allPos = new Float32Array(pos.array.length + newVerts.length);
  allPos.set(pos.array);
  allPos.set(newVerts, pos.array.length);

  const existingCol = mesh.geometry.attributes.color.array;
  const allCol = new Float32Array(existingCol.length + capCol.length);
  allCol.set(existingCol);
  allCol.set(capCol, existingCol.length);

  const newGeom = new THREE.BufferGeometry();
  newGeom.setAttribute("position", new THREE.Float32BufferAttribute(allPos, 3));
  newGeom.setAttribute("color", new THREE.Float32BufferAttribute(allCol, 3));
  newGeom.computeVertexNormals();
  newGeom.computeBoundingBox();
  newGeom.computeBoundingSphere();

  mesh.geometry.dispose();
  mesh.geometry = newGeom;
  bbox = newGeom.boundingBox.clone();

  updateBoundaryLines(newGeom);
  const capTris = newVerts.length / 9;
  infoEl.textContent = `Tapa añadida (${capTris} triángulos). Ahora pulsa "Eliminar selección".`;
  updateInfo();
});

/* ===== Extruir bordes abiertos a plano ===== */

function updateExtrudePosDefault() {
  if (!bbox) return;
  const axis = extrudeAxisSelect.value;
  const val = axis === 'z' ? bbox.min.z : axis === 'y' ? bbox.min.y : bbox.min.x;
  extrudePosInput.value = val.toFixed(2);
}

extrudeAxisSelect.addEventListener("change", updateExtrudePosDefault);

btnExtrude.addEventListener("click", () => {
  if (!mesh) return;

  // Si ya se extruía antes, volver a la base y recalcular (alargar/acortar sin apilar undo).
  // Si es la primera vez, guardar undo + guardar base.
  if (preExtrusionState) {
    restoreState(preExtrusionState);
  } else {
    pushUndo();
    preExtrusionState = captureState();
  }

  const axis = extrudeAxisSelect.value;           // 'x' | 'y' | 'z'
  const planeVal = parseFloat(extrudePosInput.value) || 0;

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

  // Mapa de aristas para encontrar bordes abiertos
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
  // Grafo dirigido: kA → [kB, …] siguiendo la dirección vA→vB del triángulo
  const dirAdj = new Map();
  const vertPos = new Map();

  edgeMap.forEach((entries) => {
    if (entries.length !== 1) return;
    const { vA, vB } = entries[0];
    const P = new THREE.Vector3(pos.getX(vA), pos.getY(vA), pos.getZ(vA));
    const Q = new THREE.Vector3(pos.getX(vB), pos.getY(vB), pos.getZ(vB));
    const Pp = project(P), Qp = project(Q);

    // Paredes: winding consistente con la malla CCW (normal exterior = derecha de P→Q)
    // (P, Pp, Q) + (Q, Pp, Qp)
    newVerts.push(P.x, P.y, P.z,  Pp.x, Pp.y, Pp.z,  Q.x, Q.y, Q.z);
    newVerts.push(Q.x, Q.y, Q.z,  Pp.x, Pp.y, Pp.z,  Qp.x, Qp.y, Qp.z);

    // Registrar arista dirigida para la tapa
    const kA = qvVec(P), kB = qvVec(Q);
    vertPos.set(kA, P); vertPos.set(kB, Q);
    if (!dirAdj.has(kA)) dirAdj.set(kA, []);
    dirAdj.get(kA).push(kB);
  });

  if (!newVerts.length) {
    infoEl.textContent = "La malla no tiene bordes abiertos para extruir.";
    return;
  }

  // Construir loops dirigidos (preservan el winding de la malla) para la tapa
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

  // La normal de la tapa debe apuntar ALEJÁNDOSE del centro del mesh
  const meshCenter = new THREE.Vector3();
  bbox.getCenter(meshCenter);
  const meshAxisVal = axis === 'z' ? meshCenter.z : axis === 'y' ? meshCenter.y : meshCenter.x;
  // Si el plano está por debajo del mesh, la tapa debe mirar hacia abajo (signo negativo del eje)
  const expectedAxisSign = Math.sign(planeVal - meshAxisVal); // -1 si plano abajo, +1 si arriba

  for (const loop of loops) {
    const capVerts = triangulateLoop3D(loop.map(p => project(p)));
    if (capVerts.length < 9) continue;

    // Normal del primer triángulo de la tapa
    const ta = new THREE.Vector3(capVerts[0], capVerts[1], capVerts[2]);
    const tb = new THREE.Vector3(capVerts[3], capVerts[4], capVerts[5]);
    const tc = new THREE.Vector3(capVerts[6], capVerts[7], capVerts[8]);
    const capNorm = new THREE.Vector3().crossVectors(tb.clone().sub(ta), tc.clone().sub(ta));
    const actualSign = axis === 'z' ? Math.sign(capNorm.z)
                     : axis === 'y' ? Math.sign(capNorm.y)
                     : Math.sign(capNorm.x);

    if (expectedAxisSign !== 0 && actualSign !== 0 && actualSign !== expectedAxisSign) {
      // Normal apunta al interior: invertir winding de todos los triángulos
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
    infoEl.textContent = "No se pudo generar la extrusión.";
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
  newGeom.setAttribute("color", new THREE.Float32BufferAttribute(allCol, 3));
  newGeom.computeVertexNormals();
  newGeom.computeBoundingBox();
  newGeom.computeBoundingSphere();

  mesh.geometry.dispose();
  mesh.geometry = newGeom;
  bbox = newGeom.boundingBox.clone();

  updateBoundaryLines(newGeom);
  const newTris = newVerts.length / 9;
  infoEl.textContent = `Extrusión a ${axis.toUpperCase()}=${planeVal} completada (${loops.length} bucle(s), ${newTris} triángulos nuevos).`;
  updateInfo();
});

/* ===== Carga STL ===== */
function loadGeometryFromBuffer(buffer, filename) {
  let geometry = loader.parse(buffer);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  if (geometry.index) geometry = geometry.toNonIndexed();

  initVertexColors(geometry);

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
  updateBoundaryLines(geometry);
  fitCameraToObject(mesh);
  setEnabled(true);

  const size = new THREE.Vector3();
  bbox.getSize(size);
  brushRadiusInput.value = (Math.max(size.x, size.y, size.z) * 0.05).toFixed(2);
  updateExtrudePosDefault();

  infoEl.textContent = `Cargado: ${filename} | ` + (() => {
    const total = Math.floor(geometry.attributes.position.count / 3);
    return `Triángulos: ${total.toLocaleString()}`;
  })();
  updateInfo();
}

fileInput.addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => loadGeometryFromBuffer(e.target.result, file.name);
  reader.readAsArrayBuffer(file);
});

// Carga automática del archivo de muestra
fetch("samples/sample_Lower_clean.stl")
  .then((res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.arrayBuffer();
  })
  .then((buffer) => loadGeometryFromBuffer(buffer, "texto.stl"))
  .catch(() => {
    infoEl.textContent = "Carga un STL para empezar.";
  });

/* ===== Loop + Resize ===== */
setEnabled(false);

function animate() {
  requestAnimationFrame(animate);
  orbitControls.update();
  renderer.render(scene, camera);
}
animate();

window.addEventListener("resize", () => {
  const w = container.clientWidth;
  const h = container.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
});
