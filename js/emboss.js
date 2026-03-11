import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { STLExporter } from "three/addons/exporters/STLExporter.js";
import { FontLoader } from "three/addons/loaders/FontLoader.js";
import { TextGeometry } from "three/addons/geometries/TextGeometry.js";
import { Brush, Evaluator, ADDITION, SUBTRACTION } from "three-bvh-csg";

const container = document.getElementById("viewer2");
const fileInput = document.getElementById("stlInput2");
const infoEl = document.getElementById("info2");

const textInput = document.getElementById("textInput");
const modeSelect = document.getElementById("modeSelect");
const sizeInput = document.getElementById("sizeInput");
const depthInput = document.getElementById("depthInput");
const faceSelect = document.getElementById("faceSelect");
const marginRange = document.getElementById("marginRange");
const marginLabel = document.getElementById("marginLabel");

const btnPreviewText = document.getElementById("btnPreviewText");
const btnApplyText = document.getElementById("btnApplyText");
const btnReset = document.getElementById("btnReset2");
const btnDownload = document.getElementById("btnDownload2");

function setEnabled(enabled) {
  modeSelect.disabled = !enabled;
  sizeInput.disabled = !enabled;
  depthInput.disabled = !enabled;
  faceSelect.disabled = !enabled;
  marginRange.disabled = !enabled;
  btnPreviewText.disabled = !enabled;
  btnApplyText.disabled = !enabled;
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

const textMaterial = new THREE.MeshStandardMaterial({
  color: 0xffd166,
  metalness: 0.1,
  roughness: 0.7,
});

/* ===== State ===== */
const loader = new STLLoader();
const exporter = new STLExporter();
const evaluator = new Evaluator();
// Solo trabajamos con posición y normales para evitar problemas de atributos
evaluator.attributes = ["position", "normal"];

let font = null;
let originalGeometry = null;
let workingGeometry = null;
let bbox = null;
let mesh = null;
let previewTextMesh = null;

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

function ensureFontLoaded() {
  if (font) return Promise.resolve(font);
  const fl = new FontLoader();
  // Typeface JSON served by the same three version CDN
  const url = "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/fonts/helvetiker_regular.typeface.json";
  return new Promise((resolve, reject) => {
    fl.load(
      url,
      (f) => {
        font = f;
        resolve(f);
      },
      undefined,
      (err) => reject(err)
    );
  });
}

function getFaceNormalAndOrigin(faceKey) {
  const center = new THREE.Vector3();
  bbox.getCenter(center);

  const n = new THREE.Vector3();
  const origin = center.clone();

  if (faceKey === "x+") { n.set(1, 0, 0); origin.x = bbox.max.x; }
  if (faceKey === "x-") { n.set(-1, 0, 0); origin.x = bbox.min.x; }
  if (faceKey === "y+") { n.set(0, 1, 0); origin.y = bbox.max.y; }
  if (faceKey === "y-") { n.set(0, -1, 0); origin.y = bbox.min.y; }
  if (faceKey === "z+") { n.set(0, 0, 1); origin.z = bbox.max.z; }
  if (faceKey === "z-") { n.set(0, 0, -1); origin.z = bbox.min.z; }

  return { n, origin };
}

function buildTextMesh() {
  const text = (textInput.value || "").trim() || "TEXTO";
  const size = Number(sizeInput.value) || 10;
  const depth = Number(depthInput.value) || 2;

  const geom = new TextGeometry(text, {
    font,
    size,
    height: depth,
    curveSegments: 8,
    bevelEnabled: false,
  });
  geom.computeBoundingBox();
  const b = geom.boundingBox;
  const center = new THREE.Vector3();
  b.getCenter(center);
  geom.translate(-center.x, -center.y, -center.z);

  const textMesh = new THREE.Mesh(geom, textMaterial);

  // Place on chosen face
  const faceKey = faceSelect.value;
  const { n, origin } = getFaceNormalAndOrigin(faceKey);
  const margin = Number(marginRange.value) || 0;
  marginLabel.textContent = margin.toFixed(1);

  // Orientation: TextGeometry extrudes along +Z in its local space.
  // We rotate so local +Z aligns with face normal.
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n.clone().normalize());
  textMesh.quaternion.copy(q);

  // Move it onto the face, then apply margin (outward along normal)
  textMesh.position.copy(origin).addScaledVector(n, margin);
  textMesh.updateMatrixWorld(true);

  return textMesh;
}

// Dejar geometría lista para CSG: sólo position/normal, opcionalmente sin índice
function sanitizeGeometryForCSG(geometry) {
  let g = geometry;

  // Trabajar sobre un clon para no tocar el original
  g = g.clone();

  // Opcional: trabajar en no-indexada (CSG suele ir mejor así)
  if (g.index) {
    g = g.toNonIndexed();
  }

  // Eliminar atributos que puedan no coincidir entre geometrías (uv, color, etc.)
  const keep = new Set(["position", "normal"]);
  for (const key in g.attributes) {
    if (!keep.has(key)) {
      g.deleteAttribute(key);
    }
  }

  if (!g.attributes.normal) {
    g.computeVertexNormals();
  }
  g.computeBoundingBox();
  g.computeBoundingSphere();

  return g;
}

// Geometría del texto con la transformación mundial ya aplicada (para CSG)
async function buildTextGeometryWorld() {
  await ensureFontLoaded();

  const mesh = buildTextMesh();
  // Clonamos la geometría antes de hornear la matriz
  const g = mesh.geometry.clone();
  g.applyMatrix4(mesh.matrixWorld);
  return sanitizeGeometryForCSG(g);
}

function clearPreview() {
  if (previewTextMesh) {
    scene.remove(previewTextMesh);
    previewTextMesh.geometry.dispose();
    previewTextMesh = null;
  }
}

async function previewText() {
  if (!workingGeometry || !bbox) return;
  await ensureFontLoaded();
  clearPreview();
  previewTextMesh = buildTextMesh();
  scene.add(previewTextMesh);
}

async function applyTextCSG() {
  if (!originalGeometry || !bbox) return;
  await ensureFontLoaded();
  clearPreview();

  const mode = modeSelect.value; // emboss | deboss

  // Usar geometrías saneadas y compatibles en los Brushes
  const baseGeom = sanitizeGeometryForCSG(originalGeometry);

  const textGeomWorld = await buildTextGeometryWorld();

  const a = new Brush(baseGeom);
  const b = new Brush(textGeomWorld);

  const op = mode === "emboss" ? ADDITION : SUBTRACTION;
  const result = evaluator.evaluate(a, b, op);

  // Result is a Brush (Mesh-like). Take its geometry.
  workingGeometry = result.geometry.clone();
  workingGeometry.computeVertexNormals();
  workingGeometry.computeBoundingBox();
  workingGeometry.computeBoundingSphere();

  replaceMesh(workingGeometry);

  const info = describeGeometry(workingGeometry);
  infoEl.textContent =
    `Aplicado: ${mode === "emboss" ? "relieve" : "grabado"} | ` +
    `Triángulos: ${info.triangles.toLocaleString()} | ` +
    `Tamaño: ${info.size.x.toFixed(2)} × ${info.size.y.toFixed(2)} × ${info.size.z.toFixed(2)}`;
}

function downloadBinarySTL(geometry, filename = "texto.stl") {
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

/* ===== Events ===== */
marginRange.addEventListener("input", () => {
  marginLabel.textContent = Number(marginRange.value).toFixed(1);
});

btnPreviewText.addEventListener("click", () => {
  previewText().catch((e) => {
    console.error(e);
    infoEl.textContent = "Error previsualizando texto (mira consola).";
  });
});

btnApplyText.addEventListener("click", () => {
  applyTextCSG().catch((e) => {
    console.error(e);
    infoEl.textContent = "Error aplicando CSG (mira consola).";
  });
});

btnReset.addEventListener("click", () => {
  if (!originalGeometry) return;
  clearPreview();
  workingGeometry = originalGeometry.clone();
  replaceMesh(workingGeometry);
  const info = describeGeometry(workingGeometry);
  infoEl.textContent =
    `Original restaurado. Triángulos: ${info.triangles.toLocaleString()} | ` +
    `Tamaño: ${info.size.x.toFixed(2)} × ${info.size.y.toFixed(2)} × ${info.size.z.toFixed(2)}`;
});

btnDownload.addEventListener("click", () => {
  if (!workingGeometry) return;
  downloadBinarySTL(workingGeometry, "texto.stl");
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
    clearPreview();

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

