import './style.css';

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

type WellContents = [liquidId: number, volumeUl: number];

class Plate {
	x: number;
	y: number;
	wells: WellContents[][];
	t3: THREE.Object3D | undefined;

	constructor(x: number, y: number) {
		this.x = x;
		this.y = y;
		this.wells = Array.from({ length: 12 }, () =>
			Array.from({ length: 8 }, (): WellContents => [0, 0])
		);
	}
}

class Pipette {
	z: number;
	liquidId: number;
	volumeUl: number;
	tipAttached: boolean;
	t3Base: THREE.Object3D | undefined;
	t3Tip: THREE.Object3D | undefined;

	constructor(z: number) {
		this.z = z;
		this.liquidId = 0;
		this.volumeUl = 0;
		this.tipAttached = true;
	}
}

class PipetteHead {
	x: number;
	y: number;
	pipettes: Pipette[];

	isMoving: boolean;
	moveStart: number;
	fromX: number;
	toX: number;
	fromY: number;
	toY: number;

	constructor(x: number, y: number) {
		this.x = x;
		this.y = y;
		this.pipettes = Array.from({ length: 8 }, () => new Pipette(10));
		this.isMoving = false;
		this.moveStart = 0;
		this.fromX = 0;
		this.toX = 0;
		this.fromY = 0;
		this.toY = 0;
	}
}

let pipetteHead: PipetteHead;
let plates: Plate[] = [];
let appElement: HTMLDivElement;
let clock: THREE.Timer;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let renderer: THREE.WebGLRenderer;
let controls: OrbitControls;
let plateTemplate: THREE.Object3D;
let reservoirTemplate: THREE.Object3D;
let pipetteBaseTemplate: THREE.Object3D;
let pipetteTipTemplate: THREE.Object3D;

async function setup(): Promise<void> {
	// Setup world model
	pipetteHead = new PipetteHead(0, 0);
	plates = [];

	for (let row = 0; row < 2; row += 1) {
		for (let column = 0; column < 2; column += 1) {
			plates.push(new Plate(
				column * 13,
				row * 9
			));
		}
	}

	// Setup THREE.js
	const app = document.querySelector<HTMLDivElement>('#app');

	if (!app) {
		throw new Error('Missing #app element');
	}

	appElement = app;

	[
		plateTemplate,
		reservoirTemplate,
		pipetteBaseTemplate,
		pipetteTipTemplate
	] = await Promise.all([
		loadAsset('plate.glb'),
		loadAsset('reservoir.glb'),
		loadAsset('pipette_base.glb'),
		loadAsset('pipette_tip.glb')
	]);

	setModelMaterial(plateTemplate, new THREE.Color("#9196c8").getHex(), 0.4, 0);
	setModelMaterial(pipetteBaseTemplate, new THREE.Color("#bfbfbf").getHex(), 0.2, 0.8);
	setModelMaterial(pipetteTipTemplate, new THREE.Color("#e2e2e2").getHex(), 0.4, 0);
	setModelShadows(plateTemplate, true, true);
	setModelShadows(pipetteBaseTemplate, true, true);
	setModelShadows(pipetteTipTemplate, true, true);

	clock = new THREE.Timer();
	clock.connect(document);

	scene = new THREE.Scene();
	scene.background = new THREE.Color('white');

	camera = new THREE.PerspectiveCamera(55, 1, 0.1, 500);
	camera.position.set(0, 30, 0);
	camera.lookAt(0, 0, 0);

	renderer = new THREE.WebGLRenderer({ antialias: true });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = THREE.PCFSoftShadowMap;
	appElement.appendChild(renderer.domElement);

	controls = new OrbitControls(camera, renderer.domElement);
	controls.target.set(0, 0, 0);

	const ambient = new THREE.AmbientLight("white", 0.1);
	scene.add(ambient);

	const keyLight = new THREE.PointLight(0xffffff, 10000);
	keyLight.position.copy(worldToScene(60, -20, 40));
	scene.add(keyLight);

	const fillLight = new THREE.PointLight(0xffffff, 2000);
	fillLight.position.copy(worldToScene(-30, 10, 40));
	scene.add(fillLight);

	const floorGrid = new THREE.GridHelper(400, 400, 0xd0d0d0, 0xe6e6e6);
	floorGrid.position.copy(worldToScene(0, 0, 0));
	scene.add(floorGrid);

	// Create scene objects for all world objects
	for (const plate of plates) {
		const t3 = plateTemplate.clone();
		plate.t3 = t3;
		scene.add(t3);
	}

	for (const pipette of pipetteHead.pipettes) {
		const t3Base = pipetteBaseTemplate.clone();
		const t3Tip = pipetteTipTemplate.clone();
		pipette.t3Base = t3Base;
		pipette.t3Tip = t3Tip;
		scene.add(t3Base);
		scene.add(t3Tip);
	}

	window.addEventListener('resize', resize);
	resize();
}

function update() {
	const t = clock.getElapsed();

	if (pipetteHead.isMoving) {
		pipetteHead.x = accLerp(pipetteHead.fromX, pipetteHead.toX, pipetteHead.moveStart, t);
		pipetteHead.y = accLerp(pipetteHead.fromY, pipetteHead.toY, pipetteHead.moveStart, t);

		if (pipetteHead.x == pipetteHead.toX && pipetteHead.y == pipetteHead.toY) {
			pipetteHead.isMoving = false;
		}
	} else {
		pipetteHead.moveStart = t;
		pipetteHead.fromX = pipetteHead.x;
		pipetteHead.fromY = pipetteHead.y;
		pipetteHead.toX = Math.floor(Math.random() * 25);
		pipetteHead.toY = Math.round(Math.random()) * 9;
		pipetteHead.isMoving = true;
	}

	// Update world state to scene objects
	for (const plate of plates) {
		plate.t3?.position.copy(worldToScene(plate.x, plate.y, 0));
	}

	for (let channel = 0; channel < pipetteHead.pipettes.length; channel += 1) {
		const pipette = pipetteHead.pipettes[channel];
		const y = pipetteHead.y + channel;

		pipette.t3Base?.position.copy(worldToScene(pipetteHead.x, y, pipette.z));
		pipette.t3Tip?.position.copy(worldToScene(pipetteHead.x, y, pipette.z - 2));
		pipette.t3Tip && (pipette.t3Tip.visible = pipette.tipAttached);
	}
}

function worldToScene(x: number, y: number, z: number): THREE.Vector3 {
	return new THREE.Vector3(x, z, -y);
}

const DEFAULT_MOTION_MAX_V = 20;
const DEFAULT_MOTION_MAX_ACC = 60;

function accLerp(
	from: number,
	to: number,
	start: number,
	cur: number,
	maxV = DEFAULT_MOTION_MAX_V,
	maxAcc = DEFAULT_MOTION_MAX_ACC
): number {
	const distance = to - from;
	const travelDistance = Math.abs(distance);

	if (travelDistance === 0) {
		return to;
	}

	const elapsed = Math.max(0, cur - start);

	if (elapsed === 0) {
		return from;
	}

	const direction = Math.sign(distance);
	const accelTimeToMaxV = maxV / maxAcc;
	const accelDistanceToMaxV = 0.5 * maxAcc * accelTimeToMaxV * accelTimeToMaxV;
	const reachesMaxV = accelDistanceToMaxV * 2 <= travelDistance;

	let traveled: number;
	let totalTime: number;

	if (reachesMaxV) {
		const cruiseDistance = travelDistance - accelDistanceToMaxV * 2;
		const cruiseTime = cruiseDistance / maxV;
		const decelStartTime = accelTimeToMaxV + cruiseTime;
		totalTime = decelStartTime + accelTimeToMaxV;

		if (elapsed < accelTimeToMaxV) {
			traveled = 0.5 * maxAcc * elapsed * elapsed;
		} else if (elapsed < decelStartTime) {
			traveled = accelDistanceToMaxV + maxV * (elapsed - accelTimeToMaxV);
		} else if (elapsed < totalTime) {
			const decelTime = elapsed - decelStartTime;
			traveled = accelDistanceToMaxV + cruiseDistance + maxV * decelTime - 0.5 * maxAcc * decelTime * decelTime;
		} else {
			return to;
		}
	} else {
		const peakV = Math.sqrt(travelDistance * maxAcc);
		const accelTime = peakV / maxAcc;
		totalTime = accelTime * 2;

		if (elapsed < accelTime) {
			traveled = 0.5 * maxAcc * elapsed * elapsed;
		} else if (elapsed < totalTime) {
			const decelTime = elapsed - accelTime;
			traveled = travelDistance * 0.5 + peakV * decelTime - 0.5 * maxAcc * decelTime * decelTime;
		} else {
			return to;
		}
	}

	return from + direction * Math.min(traveled, travelDistance);
}

const modelLoader = new GLTFLoader();
const modelAssetUrls = import.meta.glob('../assets/*.glb', {
	query: '?url',
	import: 'default',
	eager: true
}) as Record<string, string>;

function loadAsset(assetFileName: string): Promise<THREE.Object3D> {
	const assetUrl = modelAssetUrls[`../assets/${assetFileName}`];

	if (!assetUrl) {
		return Promise.reject(new Error(`Missing model asset: ${assetFileName}`));
	}

	return new Promise((resolve, reject) => {
		modelLoader.load(
			assetUrl,
			(gltf) => {
				const object = gltf.scene;
				object.scale.setScalar(100);
				resolve(object);
			},
			undefined,
			reject
		);
	});
}

function setModelMaterial(model: THREE.Object3D, color: number, roughness: number, metalness: number): void {
	const material = new THREE.MeshStandardMaterial({
		color,
		roughness,
		metalness
	});

	model.traverse((object) => {
		if (object instanceof THREE.Mesh) {
			object.material = material;
		}
	});
}

function setModelShadows(model: THREE.Object3D, castShadow: boolean, receiveShadow: boolean): void {
	model.traverse((object) => {
		if (object instanceof THREE.Mesh) {
			object.castShadow = castShadow;
			object.receiveShadow = receiveShadow;
		}
	});
}

function resize(): void {
	const width = appElement.clientWidth;
	const height = appElement.clientHeight;

	renderer.setSize(width, height, false);
	camera.aspect = width / height;
	camera.updateProjectionMatrix();
}

function animate(timestamp?: number): void {
	clock.update(timestamp);
	update();
	controls.update();
	renderer.render(scene, camera);
	requestAnimationFrame(animate);
}

setup()
	.then(() => {
		// Start animation loop
		animate();
	})
	.catch((error: unknown) => {
		console.error('Failed to set up simulation:', error);
	});
