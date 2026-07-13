import './style.css';

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import pipetteBaseModelUrl from '../assets/pipette_base.glb?url';
import pipetteTipModelUrl from '../assets/pipette_tip.glb?url';
import plateModelUrl from '../assets/plate.glb?url';

const BLENDER_METERS_TO_SCENE_CENTIMETERS = 100;
const PLATE_GRID_COLUMNS = 4;
const PLATE_GRID_ROWS = 2;
const PLATE_GRID_COLUMN_SPACING_CM = 13;
const PLATE_GRID_ROW_SPACING_CM = 9;

const app = document.querySelector<HTMLDivElement>('#app');

if (!app) {
  throw new Error('Missing #app element');
}

const appElement = app;

const scene = new THREE.Scene();
scene.background = new THREE.Color("white");

const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 500);
camera.position.set(35, 30, 45);

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

let plateMeshTemplate: THREE.Object3D | null = null;
let pipetteTipMesh: THREE.Object3D | null = null;
let pipetteBaseMesh: THREE.Object3D | null = null;

function prepareModel(model: THREE.Object3D): THREE.Object3D {
  model.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.material = plateMaterial;
    }
  });

  model.scale.setScalar(BLENDER_METERS_TO_SCENE_CENTIMETERS);
  return model;
}

function createPlateGrid(plateTemplate: THREE.Object3D): THREE.Group {
  const plateGrid = new THREE.Group();
  const xOriginOffset = ((PLATE_GRID_COLUMNS - 1) * PLATE_GRID_COLUMN_SPACING_CM) / 2;
  const zOriginOffset = ((PLATE_GRID_ROWS - 1) * PLATE_GRID_ROW_SPACING_CM) / 2;

  for (let row = 0; row < PLATE_GRID_ROWS; row += 1) {
    for (let column = 0; column < PLATE_GRID_COLUMNS; column += 1) {
      const plate = plateTemplate.clone(true);
      plate.position.set(
        column * PLATE_GRID_COLUMN_SPACING_CM - xOriginOffset,
        0,
        row * PLATE_GRID_ROW_SPACING_CM - zOriginOffset
      );
      plateGrid.add(plate);
    }
  }

  return plateGrid;
}

const modelLoader = new GLTFLoader();
modelLoader.load(
  plateModelUrl,
  (gltf) => {
    plateMeshTemplate = prepareModel(gltf.scene);
    plateMeshTemplate.position.set(0, 0, 0);
    scene.add(createPlateGrid(plateMeshTemplate));
  },
  undefined,
  (error) => {
    console.error('Failed to load plate model:', error);
  }
);

modelLoader.load(
  pipetteTipModelUrl,
  (gltf) => {
    pipetteTipMesh = prepareModel(gltf.scene);
    pipetteTipMesh.position.set(0.5, 7, 0.5);
    scene.add(pipetteTipMesh);
  },
  undefined,
  (error) => {
    console.error('Failed to load pipette tip model:', error);
  }
);

modelLoader.load(
  pipetteBaseModelUrl,
  (gltf) => {
    pipetteBaseMesh = prepareModel(gltf.scene);
    pipetteBaseMesh.position.set(0.5, 9, 0.5);
    scene.add(pipetteBaseMesh);
  },
  undefined,
  (error) => {
    console.error('Failed to load pipette base model:', error);
  }
);

const diagonalLight = new THREE.DirectionalLight(0xffffff, 3);
diagonalLight.position.set(30, 50, 40);
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
