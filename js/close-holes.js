import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { STLExporter } from "three/addons/exporters/STLExporter.js";
import { ShapeUtils } from "three";

const container = document.getElementById("viewer3");
const fileInput = document.getElementById("stlInput3");
const infoEl = document.getElementById("info3");

const planeAxisSelect = document.getElementById("planeAxisSelect");
const planePosRange = document.getElementById("planePosRange");
const planePosLabel = document.getElementById("planePosLabel");
const thresholdInput = document.getElementById("thresholdInput");

const btnPreviewCap = document.getElementById("btnPreviewCap");
const btnApplyCap = document.getElementById("btnApplyCap");
const btnReset = document.getElementById("btnReset3");
const btnDownload = document.getElementById("btnDownload3");

function setEnabled(enabled) {
  planeAxisSelect.disabled = !enabled;
  planePosRange.disabled = !enabled;
  thresholdInput.disabled = !enabled;
  btnPreviewCap.disabled = !enabled;
  btnApplyCap.disabled = !enabled;
  btnReset.disabled = !enabled;
  btnDownload.disabled = !enabled;
}

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

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

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

const modelMaterial = new THREE.MeshStandardMaterial({
  color: 0x7dd3fc,
  metalness: 0.2,
  roughness: 0.6,
});

const planeMat = new THREE.MeshBasicMaterial({
  color: 0xffd166,
  transparent: true,
  opacity: 0.22,
  side: THREE.DoubleSide,
  depthWrite: false,
});
const planeOutlineMat = new THREE.LineBasicMaterial({ color: 0xffd166 });
let planeMesh = null;
let planeOutline = null;

const capMaterial = new THREE.MeshStandardMaterial({
  color: 0x22c55e,
  metalness: 0.1,
  roughness: 0.7,
  transparent: true,
  opacity: 0.6,
});

/* ===== State ===== */
const loader = new STLLoader();
const exporter = new STLExporter();

let originalGeometry = null;
let workingGeometry = null;
let bbox = null;
let mesh = null;
let previewCapMesh = null;

function fitCameraToObject(object) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  const maxDim = Math.max(size.x, size.y, size.z);
  const fov = (camera.fov * Math.PI) / 180;
  let cameraZ = Math.abs((maxDim / 2) / Math.tan(fov / 2));
  cameraZ *= 1.6;

  camera.near = Math.max(cameraZ / 100, 0.01);
  camera.far = cameraZ * 200;
  camera.updateProjectionMatrix();

  camera.position.set(center.x + cameraZ, center.y + cameraZ * 0.35, center.z + cameraZ);
  controls.target.copy(center);
  controls.update();
}

function replaceMesh(geometry) {
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  if (mesh) {
    scene.remove(mesh);
    mesh.geometry.dispose();
  }
  mesh = new THREE.Mesh(geometry, modelMaterial);
  scene.add(mesh);
  fitCameraToObject(mesh);
}

function describeGeometry(geometry) {
  const pos = geometry.attributes.position;
  const triangles = Math.floor(pos.count / 3);
  const b = geometry.boundingBox || new THREE.Box3().setFromBufferAttribute(pos);
  const size = new THREE.Vector3();
  b.getSize(size);
  return { triangles, size };
}

/* ===== Helpers de plano / proyección ===== */
function updatePlaneSliderFromBBox() {
  if (!bbox) return;
  const axis = planeAxisSelect.value; // x, y, z
  const min = bbox.min[axis];
  const max = bbox.max[axis];
  planePosRange.min = String(min);
  planePosRange.max = String(max);
  const center = (min + max) / 2;
  planePosRange.value = String(center);
  planePosLabel.textContent = center.toFixed(3);
}

function getPlaneValue() {
  return Number(planePosRange.value);
}

function ensurePlaneVisual() {
  if (!bbox) return;

  const axis = planeAxisSelect.value;
  const size = new THREE.Vector3();
  bbox.getSize(size);

  const margin = 1.1;
  let w = 1, h = 1;

  if (axis === "x") { w = size.z * margin; h = size.y * margin; } // YZ
  if (axis === "y") { w = size.x * margin; h = size.z * margin; } // XZ
  if (axis === "z") { w = size.x * margin; h = size.y * margin; } // XY

  const planeGeom = new THREE.PlaneGeometry(Math.max(w, 1e-6), Math.max(h, 1e-6));

  if (!planeMesh) {
    planeMesh = new THREE.Mesh(planeGeom, planeMat);
    scene.add(planeMesh);

    const edges = new THREE.EdgesGeometry(planeGeom);
    planeOutline = new THREE.LineSegments(edges, planeOutlineMat);
    scene.add(planeOutline);
  } else {
    planeMesh.geometry.dispose();
    planeOutline.geometry.dispose();
    planeMesh.geometry = planeGeom;
    planeOutline.geometry = new THREE.EdgesGeometry(planeGeom);
  }

  updatePlaneVisualTransform();
}

function updatePlaneVisualTransform() {
  if (!planeMesh || !planeOutline || !bbox) return;

  const axis = planeAxisSelect.value;
  const value = getPlaneValue();

  const center = new THREE.Vector3();
  bbox.getCenter(center);

  planeMesh.position.copy(center);
  planeOutline.position.copy(center);

  planeMesh.rotation.set(0, 0, 0);
  planeOutline.rotation.set(0, 0, 0);

  if (axis === "x") {
    planeMesh.rotation.y = Math.PI / 2;       // YZ
    planeOutline.rotation.y = Math.PI / 2;
  } else if (axis === "y") {
    planeMesh.rotation.x = -Math.PI / 2;      // XZ
    planeOutline.rotation.x = -Math.PI / 2;
  }

  planeMesh.position[axis] = value;
  planeOutline.position[axis] = value;

  planeMesh.updateMatrixWorld(true);
  planeOutline.updateMatrixWorld(true);
}

function axisToPlane2D(axis, v3) {
  if (axis === "x") return new THREE.Vector2(v3.y, v3.z); // YZ
  if (axis === "y") return new THREE.Vector2(v3.x, v3.z); // XZ
  return new THREE.Vector2(v3.x, v3.y); // XY
}

function plane2DToAxis3D(axis, planeValue, v2) {
  if (axis === "x") return new THREE.Vector3(planeValue, v2.x, v2.y);
  if (axis === "y") return new THREE.Vector3(v2.x, planeValue, v2.y);
  return new THREE.Vector3(v2.x, v2.y, planeValue);
}

function polygonArea2D(points) {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a * 0.5;
}

/* ===== Detección de bordes abiertos y loops ===== */
function findBoundaryLoops(geometry) {
  const hasIndex = geometry.index !== null && geometry.index !== undefined;
  const geom = hasIndex ? geometry.toNonIndexed() : geometry.clone();
  const index = geom.index ? geom.index.array : null;
  const pos = geom.attributes.position;

  const indexArray = index
    ? index
    : (() => {
        const arr = new Uint32Array(pos.count);
        for (let i = 0; i < arr.length; i++) arr[i] = i;
        geom.setIndex(new THREE.BufferAttribute(arr, 1));
        return arr;
      })();

  const edgeMap = new Map();

  function addEdge(a, b) {
    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
    const dir = { from: a, to: b };
    const entry = edgeMap.get(key) || { count: 0, dir };
    entry.count++;
    entry.dir = dir;
    edgeMap.set(key, entry);
  }

  for (let i = 0; i < indexArray.length; i += 3) {
    const i0 = indexArray[i];
    const i1 = indexArray[i + 1];
    const i2 = indexArray[i + 2];
    addEdge(i0, i1);
    addEdge(i1, i2);
    addEdge(i2, i0);
  }

  const boundaryDirs = [];
  edgeMap.forEach((e) => {
    if (e.count === 1) boundaryDirs.push(e.dir);
  });

  const nextMap = new Map();
  for (const { from, to } of boundaryDirs) {
    if (!nextMap.has(from)) nextMap.set(from, []);
    nextMap.get(from).push(to);
  }

  const used = new Set();
  const loops = [];

  function edgeKey(a, b) {
    return `${a}_${b}`;
  }

  for (const { from, to } of boundaryDirs) {
    const startKey = edgeKey(from, to);
    if (used.has(startKey)) continue;

    const loop = [from, to];
    used.add(startKey);
    let current = to;
    let guard = 0;

    while (guard++ < 100000) {
      const candidates = nextMap.get(current) || [];
      let next = null;
      for (const c of candidates) {
        const k = edgeKey(current, c);
        if (!used.has(k)) {
          next = c;
          break;
        }
      }
      if (next === null) break;
      if (next === loop[0]) {
        // Cerrado
        break;
      }
      loop.push(next);
      used.add(edgeKey(current, next));
      current = next;
    }

    if (loop.length >= 3) {
      loops.push(loop);
    }
  }

  return { geom, loops, indexArray };
}

/* ===== Construcción de tapa en el plano ===== */
function buildCapGeometryOnPlane(geometry, axis, planeValue, threshold) {
  if (!geometry) return null;

  const { geom, loops, indexArray } = findBoundaryLoops(geometry);
  const pos = geom.attributes.position;

  if (!loops.length) return null;

  const capVerts = [];

  // 1) Calcular distancia media de cada loop al plano y filtrar por umbral
  const candidates = [];
  for (const loop of loops) {
    let sumDist = 0;
    for (const idx of loop) {
      const v = new THREE.Vector3(pos.getX(idx), pos.getY(idx), pos.getZ(idx));
      const dist = Math.abs(v[axis] - planeValue);
      sumDist += dist;
    }
    const avgDist = sumDist / loop.length;
    if (avgDist <= threshold) {
      candidates.push({ loop, avgDist });
    }
  }

  if (!candidates.length) return null;

  // 2) Usar solo el loop más cercano al plano (para evitar tapar contornos exteriores)
  candidates.sort((a, b) => a.avgDist - b.avgDist);
  const loopsToUse = [candidates[0].loop];

  for (const loop of loopsToUse) {
    const poly2D = loop.map((idx) => {
      const v = new THREE.Vector3(pos.getX(idx), pos.getY(idx), pos.getZ(idx));
      v[axis] = planeValue;
      return axisToPlane2D(axis, v);
    });

    if (poly2D.length < 3) continue;

    if (polygonArea2D(poly2D) < 0) poly2D.reverse();

    const triangles = ShapeUtils.triangulateShape(poly2D, []);
    for (const [ia, ib, ic] of triangles) {
      const a2 = poly2D[ia];
      const b2 = poly2D[ib];
      const c2 = poly2D[ic];
      const a3 = plane2DToAxis3D(axis, planeValue, a2);
      const b3 = plane2DToAxis3D(axis, planeValue, b2);
      const c3 = plane2DToAxis3D(axis, planeValue, c2);
      capVerts.push(a3.x, a3.y, a3.z);
      capVerts.push(b3.x, b3.y, b3.z);
      capVerts.push(c3.x, c3.y, c3.z);
    }
  }

  if (!capVerts.length) return null;

  const hasIndex = geometry.index !== null && geometry.index !== undefined;
  const baseGeom = hasIndex ? geometry.toNonIndexed() : geometry.clone();
  const basePos = baseGeom.attributes.position;
  const baseArray = Array.from(basePos.array);
  const allVerts = baseArray.concat(capVerts);

  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(allVerts, 3));
  out.computeVertexNormals();
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

function clearPreviewCap() {
  if (previewCapMesh) {
    scene.remove(previewCapMesh);
    previewCapMesh.geometry.dispose();
    previewCapMesh = null;
  }
}

function downloadBinarySTL(geometry, filename = "hole-closed.stl") {
  const m = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
  const result = exporter.parse(m, { binary: true });
  const blob = new Blob([result], { type: "application/octet-stream" });

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ===== Eventos ===== */
planePosRange.addEventListener("input", () => {
  planePosLabel.textContent = getPlaneValue().toFixed(3);
  updatePlaneVisualTransform();
});

planeAxisSelect.addEventListener("change", () => {
  if (!bbox) return;
  updatePlaneSliderFromBBox();
  ensurePlaneVisual();
});

btnPreviewCap.addEventListener("click", () => {
  if (!workingGeometry || !bbox) return;
  clearPreviewCap();

  const axis = planeAxisSelect.value;
  const planeValue = getPlaneValue();
  const threshold = Number(thresholdInput.value) || 0.5;

  const capGeom = buildCapGeometryOnPlane(workingGeometry, axis, planeValue, threshold);
  if (!capGeom) {
    infoEl.textContent = "No se ha podido generar tapa para ese plano/umbral.";
    return;
  }

  previewCapMesh = new THREE.Mesh(capGeom, capMaterial);
  scene.add(previewCapMesh);
  infoEl.textContent = "Previsualización de tapa generada. Si te gusta, pulsa 'Aplicar tapa'.";
});

btnApplyCap.addEventListener("click", () => {
  if (!workingGeometry || !bbox) return;

  const axis = planeAxisSelect.value;
  const planeValue = getPlaneValue();
  const threshold = Number(thresholdInput.value) || 0.5;

  const capGeom = buildCapGeometryOnPlane(workingGeometry, axis, planeValue, threshold);
  if (!capGeom) {
    infoEl.textContent = "No se ha podido generar tapa para ese plano/umbral.";
    return;
  }

  clearPreviewCap();
  workingGeometry = capGeom;
  replaceMesh(workingGeometry);

  const info = describeGeometry(workingGeometry);
  infoEl.textContent =
    `Tapa aplicada en plano ${axis.toUpperCase()} = ${planeValue.toFixed(3)}. ` +
    `Triángulos: ${info.triangles.toLocaleString()} | ` +
    `Tamaño: ${info.size.x.toFixed(2)} × ${info.size.y.toFixed(2)} × ${info.size.z.toFixed(2)}`;
});

btnReset.addEventListener("click", () => {
  if (!originalGeometry) return;
  clearPreviewCap();
  workingGeometry = originalGeometry.clone();
  replaceMesh(workingGeometry);
  const info = describeGeometry(workingGeometry);
  infoEl.textContent =
    `Original restaurado. Triángulos: ${info.triangles.toLocaleString()} | ` +
    `Tamaño: ${info.size.x.toFixed(2)} × ${info.size.y.toFixed(2)} × ${info.size.z.toFixed(2)}`;
});

btnDownload.addEventListener("click", () => {
  if (!workingGeometry) return;
  downloadBinarySTL(workingGeometry, "hole-closed.stl");
});

fileInput.addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    const geometry = loader.parse(e.target.result);
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    originalGeometry = geometry.clone();
    workingGeometry = geometry.clone();
    bbox = geometry.boundingBox.clone();

    replaceMesh(workingGeometry);
    setEnabled(true);
    clearPreviewCap();
    updatePlaneSliderFromBBox();
    ensurePlaneVisual();

    const size = new THREE.Vector3();
    bbox.getSize(size);
    const approxThreshold = Math.max(size.x, size.y, size.z) * 0.02;
    thresholdInput.value = approxThreshold.toFixed(2);

    const info = describeGeometry(workingGeometry);
    infoEl.textContent =
      `Cargado: ${file.name} | Triángulos: ${info.triangles.toLocaleString()} | ` +
      `Tamaño: ${info.size.x.toFixed(2)} × ${info.size.y.toFixed(2)} × ${info.size.z.toFixed(2)}`;
  };
  reader.readAsArrayBuffer(file);
});

/* ===== Loop + Resize ===== */
setEnabled(false);

function animate() {
  requestAnimationFrame(animate);
  controls.update();
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

