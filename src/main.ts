import './style.css';

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import plateModelUrl from '../assets/plate.glb?url';

const BLENDER_METERS_TO_SCENE_CENTIMETERS = 100;

const app = document.querySelector<HTMLDivElement>('#app');

if (!app) {
  throw new Error('Missing #app element');
}

const appElement = app;

const scene = new THREE.Scene();
scene.background = new THREE.Color("white");

const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
camera.position.set(3, 2.5, 4);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
appElement.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0);
controls.enableDamping = true;

const plateMaterial = new THREE.MeshStandardMaterial({
  color: 0xBBBBBB,
  roughness: 0.45,
  metalness: 0.05
});

const modelLoader = new GLTFLoader();
modelLoader.load(
  plateModelUrl,
  (gltf) => {
    const plate = gltf.scene;

    plate.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.material = plateMaterial;
      }
    });

    plate.scale.setScalar(BLENDER_METERS_TO_SCENE_CENTIMETERS);
    plate.position.set(0, 0, 0);
    scene.add(plate);
  },
  undefined,
  (error) => {
    console.error('Failed to load plate model:', error);
  }
);

const diagonalLight = new THREE.DirectionalLight(0xffffff, 3);
diagonalLight.position.set(3, 5, 4);
scene.add(diagonalLight);

const ambientLight = new THREE.AmbientLight(0xffffff, 1);
scene.add(ambientLight);

function resizeRenderer(): void {
  const width = appElement.clientWidth;
  const height = appElement.clientHeight;

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
