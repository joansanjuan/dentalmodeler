import * as THREE from "three";
import { ShapeUtils } from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { STLExporter } from "three/addons/exporters/STLExporter.js";
import * as BufferGeometryUtils from "three/addons/utils/BufferGeometryUtils.js";

/* ======================
   CONTADOR + FORM
====================== */
const countEl = document.getElementById("count");
const hintEl = document.getElementById("hint");
const btnAdd = document.getElementById("btnAdd");
const btnReset = document.getElementById("btnReset");
const yearEl = document.getElementById("year");

const form = document.getElementById("form");
const formMsg = document.getElementById("formMsg");

let count = 0;
function renderCounter() {
  countEl.textContent = count;
  hintEl.textContent = count === 0 ? "Pulsa “Sumar” para empezar." : "¡Bien! Esto es JS funcionando.";
}
btnAdd.addEventListener("click", () => { count++; renderCounter(); });
btnReset.addEventListener("click", () => { count = 0; renderCounter(); });

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const data = new FormData(form);
  formMsg.textContent = `Demo OK: recibido mensaje de ${data.get("email")}`;
  form.reset();
});

yearEl.textContent = new Date().getFullYear();
renderCounter();

/* ======================
   VISOR STL + CORTE
====================== */
const container = document.getElementById("viewer");
const fileInput = document.getElementById("stlInput");
const stlInfo = document.getElementById("stlInfo");

const axisSelect = document.getElementById("axisSelect");
const sideSelect = document.getElementById("sideSelect");
const planeRange = document.getElementById("planeRange");
const planeValueLabel = document.getElementById("planeValueLabel");

const btnCut = document.getElementById("btnCut");
const btnRepair = document.getElementById("btnRepair");
const btnResetModel = document.getElementById("btnResetModel");
const btnDownload = document.getElementById("btnDownload");

// Three.js base
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

// Luces
scene.add(new THREE.HemisphereLight(0xffffff, 0x223355, 0.9));
const dir1 = new THREE.DirectionalLight(0xffffff, 0.9);
dir1.position.set(1, 1, 1);
scene.add(dir1);
const dir2 = new THREE.DirectionalLight(0xffffff, 0.5);
dir2.position.set(-1, 0.4, -0.8);
scene.add(dir2);

// Helpers
scene.add(new THREE.AxesHelper(60));
const grid = new THREE.GridHelper(200, 20, 0x446688, 0x223344);
grid.position.y = -40;
scene.add(grid);

// Material del modelo
const modelMaterial = new THREE.MeshStandardMaterial({
  color: 0x7dd3fc,
  metalness: 0.2,
  roughness: 0.6,
});

// Plano visible
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

// Estado
let originalGeometry = null; // BufferGeometry original
let workingGeometry = null;  // BufferGeometry recortada / actual
let currentMesh = null;      // Mesh en escena
let bbox = null;             // Box3 del original

const loader = new STLLoader();

/* ===== Helpers UI / cámara ===== */

function setControlsEnabled(enabled) {
  planeRange.disabled = !enabled;
  btnCut.disabled = !enabled;
  btnRepair.disabled = !enabled;
  btnResetModel.disabled = !enabled;
  btnDownload.disabled = !enabled;
  axisSelect.disabled = !enabled;
  sideSelect.disabled = !enabled;
}

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

function replaceMeshWithGeometry(geometry) {
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  if (currentMesh) {
    scene.remove(currentMesh);
    currentMesh.geometry.dispose();
  }

  currentMesh = new THREE.Mesh(geometry, modelMaterial);
  scene.add(currentMesh);
  fitCameraToObject(currentMesh);
}

function describeGeometry(geometry) {
  const pos = geometry.attributes.position;
  const triangles = Math.floor(pos.count / 3);
  const b = geometry.boundingBox || new THREE.Box3().setFromBufferAttribute(pos);
  const size = new THREE.Vector3();
  b.getSize(size);
  return { triangles, size };
}

/* ===== Plano visible + slider con rango real ===== */

function updatePlaneRangeFromBBox() {
  const axis = axisSelect.value;
  const min = bbox.min[axis];
  const max = bbox.max[axis];

  planeRange.min = String(min);
  planeRange.max = String(max);

  const span = max - min;
  const step = span > 0 ? span / 2000 : 0.001;
  planeRange.step = String(step);

  const center = (min + max) / 2;
  planeRange.value = String(center);
  planeValueLabel.textContent = center.toFixed(3);
}

function getPlaneValue() {
  return Number(planeRange.value);
}

function ensurePlaneVisual() {
  const axis = axisSelect.value;
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
  if (!planeMesh || !planeOutline) return;

  const axis = axisSelect.value;
  const value = getPlaneValue();

  const center = new THREE.Vector3();
  bbox.getCenter(center);

  planeMesh.position.copy(center);
  planeOutline.position.copy(center);

  planeMesh.rotation.set(0, 0, 0);
  planeOutline.rotation.set(0, 0, 0);

  // PlaneGeometry está en XY (normal +Z)
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

function refreshPlaneUIAndVisual() {
  updatePlaneRangeFromBBox();
  ensurePlaneVisual();
  updatePlaneVisualTransform();
}

/* ======================
   CORTE GEOMÉTRICO (CLIPPING) — SIN CSG
====================== */

/**
 * Devuelve la distancia firmada al plano (n·p - d)
 * Plano: normal n (unitaria) y constante d.
 */
function signedDistance(n, d, p) {
  return n.x * p.x + n.y * p.y + n.z * p.z - d;
}

/**
 * Intersección del segmento AB con el plano. Devuelve punto.
 * asume que A y B están en lados opuestos (o uno en el plano).
 */
function intersectSegmentPlane(a, da, b, db) {
  const t = da / (da - db); // da + t (db-da) = 0
  return new THREE.Vector3(
    a.x + (b.x - a.x) * t,
    a.y + (b.y - a.y) * t,
    a.z + (b.z - a.z) * t
  );
}

/**
 * Clipa un polígono contra un half-space definido por un plano.
 * Implementación tipo Sutherland–Hodgman.
 * keepPositive: si true, conserva dist >= 0; si false, conserva dist <= 0.
 * Retorna lista de vertices (Vector3) del polígono resultante (0..N).
 */
function clipPolygonToPlane(poly, n, d, keepPositive) {
  const out = [];
  const eps = 1e-9;

  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];

    const da0 = signedDistance(n, d, a);
    const db0 = signedDistance(n, d, b);

    const da = keepPositive ? da0 : -da0;
    const db = keepPositive ? db0 : -db0;

    const aIn = da >= -eps;
    const bIn = db >= -eps;

    if (aIn && bIn) {
      // dentro -> dentro: conservar B
      out.push(b.clone());
    } else if (aIn && !bIn) {
      // sale: añadir intersección
      const p = intersectSegmentPlane(a, da0, b, db0);
      out.push(p);
    } else if (!aIn && bIn) {
      // entra: intersección + B
      const p = intersectSegmentPlane(a, da0, b, db0);
      out.push(p);
      out.push(b.clone());
    }
    // fuera->fuera: nada
  }

  return out;
}

/* ======================
   REPARAR GEOMETRÍA STL ORIGINAL
   (soldar vértices cercanos y limpiar triángulos degenerados)
====================== */

function repairGeometry(geometry) {
  // Trabajamos sobre una copia
  let geom = geometry.clone();

  // Asegurar que tenemos un índice para poder usar mergeVertices correctamente
  if (!geom.index) {
    geom = geom.toNonIndexed();
  }

  const beforeVerts = geom.attributes.position.count;

  // Soldar vértices muy cercanos (tolerancia en unidades del modelo)
  const tol = (bbox
    ? Math.max(
        bbox.max.x - bbox.min.x,
        bbox.max.y - bbox.min.y,
        bbox.max.z - bbox.min.z
      ) * 1e-5
    : 1e-4);

  geom = BufferGeometryUtils.mergeVertices(geom, tol);

  // Opcional: eliminar triángulos degenerados (área ~ 0)
  if (geom.index) {
    const index = geom.index;
    const pos = geom.attributes.position;
    const newIndices = [];
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const epsArea = 1e-14;

    for (let i = 0; i < index.count; i += 3) {
      const i0 = index.getX(i);
      const i1 = index.getX(i + 1);
      const i2 = index.getX(i + 2);

      a.fromBufferAttribute(pos, i0);
      b.fromBufferAttribute(pos, i1);
      c.fromBufferAttribute(pos, i2);

      const areaVec = b.clone().sub(a).cross(c.clone().sub(a));
      if (areaVec.lengthSq() > epsArea) {
        newIndices.push(i0, i1, i2);
      }
    }

    if (newIndices.length > 0 && newIndices.length !== index.count) {
      geom.setIndex(newIndices);
    }
  }

  geom.computeVertexNormals();
  geom.computeBoundingBox();
  geom.computeBoundingSphere();

  const afterVerts = geom.attributes.position.count;

  return {
    geometry: geom,
    stats: {
      beforeVerts,
      afterVerts,
    },
  };
}

/* ======================
   CAP (CERRAR MALLA) EN EL PLANO DE CORTE
====================== */

function axisToPlane2D(axis, v3) {
  // Proyección al plano de corte (eje constante)
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
  // signed area * 0.5
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a * 0.5;
}

function pointInPolygon2D(point, poly) {
  // Ray casting
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const denom = (yj - yi);
    if (denom === 0) continue;
    const intersect =
      (yi > point.y) !== (yj > point.y) &&
      point.x < ((xj - xi) * (point.y - yi)) / denom + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function quantKey(v2, tol) {
  const ix = Math.round(v2.x / tol);
  const iy = Math.round(v2.y / tol);
  return `${ix},${iy}`;
}

function buildLoopsFromSegments(axis, segments2D, tol) {
  // Unifica puntos por cuantización y construye bucles conectando segmentos.
  const pointIndexByKey = new Map();
  const points = [];

  function getIndex(v2) {
    const key = quantKey(v2, tol);
    let idx = pointIndexByKey.get(key);
    if (idx == null) {
      idx = points.length;
      points.push(v2);
      pointIndexByKey.set(key, idx);
    }
    return idx;
  }

  const edges = [];
  const adjacency = new Map(); // idx -> array of {to, edgeId}

  function addAdj(a, b, edgeId) {
    if (!adjacency.has(a)) adjacency.set(a, []);
    adjacency.get(a).push({ to: b, edgeId });
  }

  for (const [p, q] of segments2D) {
    const a = getIndex(p);
    const b = getIndex(q);
    if (a === b) continue;
    const edgeId = edges.length;
    edges.push({ a, b, used: false });
    addAdj(a, b, edgeId);
    addAdj(b, a, edgeId);
  }

  const loops = [];

  function nextNeighbor(prev, current, usedEdgeIds) {
    const nbrs = adjacency.get(current) || [];
    // Prefer neighbor not equal prev and via unused edge
    for (const n of nbrs) {
      if (usedEdgeIds.has(n.edgeId)) continue;
      if (n.to !== prev) return n;
    }
    // Fallback: any unused
    for (const n of nbrs) {
      if (!usedEdgeIds.has(n.edgeId)) return n;
    }
    return null;
  }

  // Mark edges as used by edgeId set while walking
  const usedEdgeIds = new Set();

  for (let startEdgeId = 0; startEdgeId < edges.length; startEdgeId++) {
    if (usedEdgeIds.has(startEdgeId)) continue;
    const e0 = edges[startEdgeId];
    usedEdgeIds.add(startEdgeId);

    const loopIdxs = [e0.a, e0.b];
    let prev = e0.a;
    let current = e0.b;

    let guard = 0;
    while (guard++ < 200000) {
      const nxt = nextNeighbor(prev, current, usedEdgeIds);
      if (!nxt) break;
      usedEdgeIds.add(nxt.edgeId);
      const nextIndex = nxt.to;

      if (nextIndex === loopIdxs[0]) {
        // cerrado
        break;
      }

      loopIdxs.push(nextIndex);
      prev = current;
      current = nextIndex;
    }

    if (loopIdxs.length >= 3 && loopIdxs[0] !== loopIdxs[loopIdxs.length - 1]) {
      const loop = loopIdxs.map((idx) => points[idx]);
      loops.push(loop);
    }
  }

  // Filtrar loops degenerados (área casi cero)
  return loops.filter((l) => Math.abs(polygonArea2D(l)) > tol * tol);
}

function addCapTriangles(outVerts, axis, planeValue, keepPositive, loops2D) {
  if (!loops2D.length) return;

  // Clasificar loops por área (abs) desc
  const loops = loops2D
    .map((pts) => {
      const area = polygonArea2D(pts);
      const absArea = Math.abs(area);
      // Punto representativo (centroide simple)
      let cx = 0, cy = 0;
      for (const p of pts) { cx += p.x; cy += p.y; }
      cx /= pts.length; cy /= pts.length;
      return { pts, area, absArea, rep: new THREE.Vector2(cx, cy) };
    })
    .sort((a, b) => b.absArea - a.absArea);

  // Encontrar padres (para holes) por contención
  for (let i = 0; i < loops.length; i++) {
    loops[i].parent = -1;
    for (let j = 0; j < loops.length; j++) {
      if (i === j) continue;
      if (loops[j].absArea <= loops[i].absArea) continue; // solo podría contener si es mayor
      if (pointInPolygon2D(loops[i].rep, loops[j].pts)) {
        // escoger el contenedor más pequeño (mínima absArea entre contenedores)
        if (loops[i].parent === -1 || loops[j].absArea < loops[loops[i].parent].absArea) {
          loops[i].parent = j;
        }
      }
    }
  }

  // Agrupar holes por outer
  const outers = [];
  for (let i = 0; i < loops.length; i++) {
    if (loops[i].parent === -1) outers.push(i);
  }
  const holesByOuter = new Map(); // outerIdx -> array of hole loops
  for (let i = 0; i < loops.length; i++) {
    const p = loops[i].parent;
    if (p !== -1) {
      if (!holesByOuter.has(p)) holesByOuter.set(p, []);
      holesByOuter.get(p).push(i);
    }
  }

  // Normal deseada del “tapón”: apunta hacia el lado eliminado (outward de la pieza resultante)
  const n = new THREE.Vector3(
    axis === "x" ? 1 : 0,
    axis === "y" ? 1 : 0,
    axis === "z" ? 1 : 0
  );
  const desiredNormal = keepPositive ? n.clone().multiplyScalar(-1) : n.clone();

  for (const outerIdx of outers) {
    const outerLoop = loops[outerIdx].pts.map((p) => p.clone());
    const holesIdxs = holesByOuter.get(outerIdx) || [];
    const holes = holesIdxs.map((hi) => loops[hi].pts.map((p) => p.clone()));

    // Asegurar winding: outer CCW, holes CW
    if (polygonArea2D(outerLoop) < 0) outerLoop.reverse();
    for (const h of holes) {
      if (polygonArea2D(h) > 0) h.reverse();
    }

    const tri = ShapeUtils.triangulateShape(outerLoop, holes);
    // `tri` son índices dentro del array combinado: contour + holes (aplanado)
    const allPts = [outerLoop, ...holes].flat();

    for (const [ia, ib, ic] of tri) {
      const a2 = allPts[ia];
      const b2 = allPts[ib];
      const c2 = allPts[ic];

      const a3 = plane2DToAxis3D(axis, planeValue, a2);
      const b3 = plane2DToAxis3D(axis, planeValue, b2);
      const c3 = plane2DToAxis3D(axis, planeValue, c2);

      // Ajustar winding para que la normal sea la deseada
      const ab = b3.clone().sub(a3);
      const ac = c3.clone().sub(a3);
      const normal = ab.cross(ac);
      if (normal.dot(desiredNormal) < 0) {
        // swap b y c
        outVerts.push(a3.x, a3.y, a3.z);
        outVerts.push(c3.x, c3.y, c3.z);
        outVerts.push(b3.x, b3.y, b3.z);
      } else {
        outVerts.push(a3.x, a3.y, a3.z);
        outVerts.push(b3.x, b3.y, b3.z);
        outVerts.push(c3.x, c3.y, c3.z);
      }
    }
  }
}

/**
 * Recorta una geometría (BufferGeometry) NO-indexada contra un plano, conservando un lado.
 * Retorna nueva BufferGeometry no-indexada.
 */
function sliceGeometryByPlane(inputGeometry, axis, planeValue, keepPositive) {
  // Convertir a no-indexada para simplificar
  const geom = inputGeometry.index ? inputGeometry.toNonIndexed() : inputGeometry;
  const pos = geom.attributes.position;
  const v = new THREE.Vector3();

  // Plano: normal según eje y d = planeValue (porque n·p = axisValue)
  const n = new THREE.Vector3(
    axis === "x" ? 1 : 0,
    axis === "y" ? 1 : 0,
    axis === "z" ? 1 : 0
  );
  const d = planeValue;

  const outVerts = []; // flat numbers [x,y,z,...]
  const segments2D = []; // pares [Vector2, Vector2] en el plano de corte
  const eps = 1e-9;

  // Iterar triángulos
  for (let i = 0; i < pos.count; i += 3) {
    const a = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
    const b = new THREE.Vector3(pos.getX(i + 1), pos.getY(i + 1), pos.getZ(i + 1));
    const c = new THREE.Vector3(pos.getX(i + 2), pos.getY(i + 2), pos.getZ(i + 2));

    // Capturar segmento(s) de intersección tri-plano (para poder "tapar")
    const da0 = signedDistance(n, d, a);
    const db0 = signedDistance(n, d, b);
    const dc0 = signedDistance(n, d, c);

    const ptsOnPlane = [];
    function maybeAddIntersection(p1, d1, p2, d2) {
      const on1 = Math.abs(d1) <= eps;
      const on2 = Math.abs(d2) <= eps;
      if (on1 && on2) return; // arista completa en el plano: lo ignoramos (caso raro)
      if (on1) { ptsOnPlane.push(p1.clone()); return; }
      if (on2) { ptsOnPlane.push(p2.clone()); return; }
      if ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) {
        ptsOnPlane.push(intersectSegmentPlane(p1, d1, p2, d2));
      }
    }
    maybeAddIntersection(a, da0, b, db0);
    maybeAddIntersection(b, db0, c, dc0);
    maybeAddIntersection(c, dc0, a, da0);

    // Normalizar: si hay más de 2 por duplicados, deduplicar por cuantización
    if (ptsOnPlane.length >= 2) {
      const span =
        (bbox ? (axis === "x" ? (bbox.max.y - bbox.min.y) + (bbox.max.z - bbox.min.z)
                      : axis === "y" ? (bbox.max.x - bbox.min.x) + (bbox.max.z - bbox.min.z)
                                     : (bbox.max.x - bbox.min.x) + (bbox.max.y - bbox.min.y))
              : 1);
      const tol = Math.max(span * 1e-9, 1e-7);
      const uniq = new Map();
      for (const p of ptsOnPlane) {
        const p2 = axisToPlane2D(axis, p);
        uniq.set(quantKey(p2, tol), p2);
      }
      const arr = [...uniq.values()];
      if (arr.length === 2) {
        segments2D.push([arr[0], arr[1]]);
      }
    }

    // Clip tri (como polígono de 3 vértices)
    const poly = [a, b, c];
    const clipped = clipPolygonToPlane(poly, n, d, keepPositive);

    if (clipped.length < 3) continue;

    // Triangulación fan: (0, i, i+1)
    const p0 = clipped[0];
    for (let k = 1; k < clipped.length - 1; k++) {
      const p1 = clipped[k];
      const p2 = clipped[k + 1];

      outVerts.push(p0.x, p0.y, p0.z);
      outVerts.push(p1.x, p1.y, p1.z);
      outVerts.push(p2.x, p2.y, p2.z);
    }
  }

  // Construir bucles del contorno y añadir “tapa” triangulada
  if (segments2D.length) {
    // Tolerancia en coordenadas del plano según tamaño del modelo
    const size = bbox ? bbox.getSize(new THREE.Vector3()) : new THREE.Vector3(1, 1, 1);
    const span2D =
      axis === "x" ? Math.max(size.y, size.z) :
      axis === "y" ? Math.max(size.x, size.z) :
                     Math.max(size.x, size.y);
    const tol = Math.max(span2D * 1e-5, 1e-4);
    const loops2D = buildLoopsFromSegments(axis, segments2D, tol);
    addCapTriangles(outVerts, axis, planeValue, keepPositive, loops2D);
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(outVerts, 3));
  out.computeVertexNormals();
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

/* ===== Export STL ===== */

function normalizeForExport(geometry) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  g.clearGroups?.();
  g.setDrawRange(0, g.attributes.position.count);
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

function downloadBinarySTL(geometry, filename = "corte.stl") {
  const exporter = new STLExporter();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
  const result = exporter.parse(mesh, { binary: true });
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

/* ===== Eventos UI ===== */

planeRange.addEventListener("input", () => {
  if (!bbox) return;
  planeValueLabel.textContent = getPlaneValue().toFixed(3);
  updatePlaneVisualTransform();
});

axisSelect.addEventListener("change", () => {
  if (!bbox) return;
  refreshPlaneUIAndVisual();
});

btnResetModel.addEventListener("click", () => {
  if (!originalGeometry) return;
  workingGeometry = originalGeometry.clone();
  replaceMeshWithGeometry(workingGeometry);

  const info = describeGeometry(workingGeometry);
  stlInfo.textContent =
    `Original restaurado. Triángulos: ${info.triangles.toLocaleString()} | ` +
    `Tamaño: ${info.size.x.toFixed(2)} × ${info.size.y.toFixed(2)} × ${info.size.z.toFixed(2)}`;
});

btnCut.addEventListener("click", () => {
  if (!originalGeometry || !bbox) return;

  const axis = axisSelect.value;
  const keepPositive = sideSelect.value === "positive";
  const planeValue = getPlaneValue();

  const cut = sliceGeometryByPlane(originalGeometry, axis, planeValue, keepPositive);
  workingGeometry = cut;

  replaceMeshWithGeometry(workingGeometry);

  const info = describeGeometry(workingGeometry);
  stlInfo.textContent =
    `Corte aplicado (${axis.toUpperCase()} = ${planeValue.toFixed(3)}, ${keepPositive ? "≥" : "≤"}). ` +
    `Triángulos: ${info.triangles.toLocaleString()} | ` +
    `Tamaño: ${info.size.x.toFixed(2)} × ${info.size.y.toFixed(2)} × ${info.size.z.toFixed(2)}`;
});

btnRepair.addEventListener("click", () => {
  if (!originalGeometry) return;

  const { geometry: repaired, stats } = repairGeometry(originalGeometry);

  originalGeometry = repaired.clone();
  workingGeometry = repaired.clone();
  bbox = repaired.boundingBox.clone();

  replaceMeshWithGeometry(workingGeometry);
  refreshPlaneUIAndVisual();

  const info = describeGeometry(workingGeometry);
  const changed =
    stats.afterVerts !== stats.beforeVerts
      ? ` | Vértices: ${stats.beforeVerts.toLocaleString()} → ${stats.afterVerts.toLocaleString()}`
      : "";

  stlInfo.textContent =
    `STL reparado. Triángulos: ${info.triangles.toLocaleString()} | ` +
    `Tamaño: ${info.size.x.toFixed(2)} × ${info.size.y.toFixed(2)} × ${info.size.z.toFixed(2)}` +
    changed;
});

btnDownload.addEventListener("click", () => {
  if (!workingGeometry) return;
  const exportGeom = normalizeForExport(workingGeometry);
  downloadBinarySTL(exportGeom, "corte.stl");
});

/* ===== Carga STL ===== */

fileInput.addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    const geometry = loader.parse(e.target.result); // binario/ASCII OK en ArrayBuffer
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    originalGeometry = geometry.clone();
    workingGeometry = geometry.clone();
    bbox = geometry.boundingBox.clone();

    replaceMeshWithGeometry(workingGeometry);

    setControlsEnabled(true);
    refreshPlaneUIAndVisual();

    const info = describeGeometry(workingGeometry);
    stlInfo.textContent =
      `Cargado: ${file.name} | Triángulos: ${info.triangles.toLocaleString()} | ` +
      `Tamaño: ${info.size.x.toFixed(2)} × ${info.size.y.toFixed(2)} × ${info.size.z.toFixed(2)}`;
  };

  reader.readAsArrayBuffer(file);
});

/* ===== Loop + Resize ===== */

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
