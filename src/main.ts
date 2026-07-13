import './style.css';

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const app = document.querySelector<HTMLDivElement>('#app');

if (!app) {
  throw new Error('Missing #app element');
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101214);

const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
camera.position.set(3, 2.5, 4);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
app.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0);
controls.enableDamping = true;

const cubeGeometry = new THREE.BoxGeometry(1, 1, 1);
const cubeMaterial = new THREE.MeshStandardMaterial({
  color: 0x4aa3ff,
  roughness: 0.45,
  metalness: 0.05
});
const cube = new THREE.Mesh(cubeGeometry, cubeMaterial);
scene.add(cube);

const diagonalLight = new THREE.DirectionalLight(0xffffff, 3);
diagonalLight.position.set(3, 5, 4);
scene.add(diagonalLight);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.35);
scene.add(ambientLight);

function resizeRenderer(): void {
  const width = app.clientWidth;
  const height = app.clientHeight;

  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function animate(): void {
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

window.addEventListener('resize', resizeRenderer);

resizeRenderer();
animate();
