import './style.css';

import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import 'monaco-editor/esm/vs/basic-languages/python/python.contribution.js';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker.js?worker';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { PythonWorkerRequest, PythonWorkerResponse } from './pythonWorkerMessages';
import PythonRuntimeWorker from './pythonRuntime.worker?worker';
import defaultScript from './defaultScript.py?raw';
import { SharedSerialPipe } from './sharedSerialPipe';

type MonacoEnvironment = {
	getWorker: () => Worker;
};

(self as unknown as { MonacoEnvironment: MonacoEnvironment }).MonacoEnvironment = {
	getWorker() {
		return new EditorWorker();
	}
};

const MODEL_IMPORT_SCALE = 100;
const PIPETTE_MAX_VOL = 300;
const WELL_MAX_VOL = 200;
const LIQUID_MESH_HEIGHT = 0.016;

class Well {
	volumeUl: number;
	fromVol: number;
	toVol: number;
	aspirateStart: number;
	t3: THREE.Mesh | undefined;

	constructor(volumeUl = 0) {
		this.volumeUl = volumeUl;
		this.fromVol = volumeUl;
		this.toVol = volumeUl;
		this.aspirateStart = 0;
	}
}

class Plate {
	x: number;
	y: number;
	wells: Well[][];
	t3: THREE.Object3D | undefined;

	constructor(x: number, y: number) {
		this.x = x;
		this.y = y;
		this.wells = Array.from({ length: 12 }, () =>
			Array.from({ length: 8 }, () => new Well())
		);
	}
}

type PipetteState = 'neutral' | 'lowering' | 'aspirating' | 'raising';

class Pipette {
	z: number;
	fromZ: number;
	toZ: number;
	moveStart: number;
	state: PipetteState;
	volumeUl: number;
	aspirationVol: number;
	tipAttached: boolean;
	t3Base: THREE.Object3D | undefined;
	t3Tip: THREE.Object3D | undefined;

	constructor(z: number) {
		this.z = z;
		this.fromZ = z;
		this.toZ = z;
		this.moveStart = 0;
		this.state = 'neutral';
		this.volumeUl = 0;
		this.aspirationVol = 0;
		this.tipAttached = true;
	}
}

const PIPETTE_NEUTRAL_Z = 10;
const PIPETTE_ASPIRATE_Z = 8;

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
		this.pipettes = Array.from({ length: 8 }, () => new Pipette(PIPETTE_NEUTRAL_Z));
		this.isMoving = false;
		this.moveStart = 0;
		this.fromX = 0;
		this.toX = 0;
		this.fromY = 0;
		this.toY = 0;
	}
}

class RingBuffer {
	private bytes: Uint8Array;
	private readIndex = 0;
	private writeIndex = 0;
	private byteCount = 0;

	constructor(capacity: number) {
		this.bytes = new Uint8Array(capacity);
	}

	write(data: Uint8Array): number {
		const writeLength = Math.min(data.length, this.bytes.length - this.byteCount);

		if (writeLength <= 0) {
			return 0;
		}

		const firstChunkLength = Math.min(writeLength, this.bytes.length - this.writeIndex);
		const secondChunkLength = writeLength - firstChunkLength;

		this.bytes.set(data.subarray(0, firstChunkLength), this.writeIndex);

		if (secondChunkLength > 0) {
			this.bytes.set(data.subarray(firstChunkLength, writeLength), 0);
		}

		this.writeIndex = (this.writeIndex + writeLength) % this.bytes.length;
		this.byteCount += writeLength;

		return writeLength;
	}

	read(length: number): Uint8Array {
		const readLength = Math.max(0, Math.min(length, this.available()));
		const data = new Uint8Array(readLength);

		if (readLength <= 0) {
			return data;
		}

		const firstChunkLength = Math.min(readLength, this.bytes.length - this.readIndex);
		const secondChunkLength = readLength - firstChunkLength;

		data.set(this.bytes.subarray(this.readIndex, this.readIndex + firstChunkLength), 0);

		if (secondChunkLength > 0) {
			data.set(this.bytes.subarray(0, secondChunkLength), firstChunkLength);
		}

		this.readIndex = (this.readIndex + readLength) % this.bytes.length;
		this.byteCount -= readLength;

		return data;
	}

	clear(): void {
		this.readIndex = 0;
		this.writeIndex = 0;
		this.byteCount = 0;
	}

	available(): number {
		return this.byteCount;
	}
}

let pipetteHead: PipetteHead;
let plates: Plate[] = [];

function getWellAt(x: number, y: number): Well | undefined {
	for (const plate of plates) {
		const localX = x - plate.x;
		const localY = y - plate.y;
		const col = Math.round(localX);
		const row = Math.round(localY);

		if (
			col >= 0 &&
			col < plate.wells.length &&
			row >= 0 &&
			row < plate.wells[col].length &&
			Math.abs(localX - col) < 0.5 &&
			Math.abs(localY - row) < 0.5
		) {
			return plate.wells[col][row];
		}
	}

	return undefined;
}

let simulationElement: HTMLDivElement;
let scriptEditor: monaco.editor.IStandaloneCodeEditor;
let runScriptButton: HTMLButtonElement;
let resetWorldButton: HTMLButtonElement;
let scriptStatusElement: HTMLSpanElement;
let scriptOutputElement: HTMLPreElement;

let pythonWorker: Worker;
let py2JsBuffer: RingBuffer;
let js2PyPipe: SharedSerialPipe | undefined;
let isPythonWorkerReady = false;
let commandsIn: string = "";

let clock: THREE.Timer;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let renderer: THREE.WebGLRenderer;
let controls: OrbitControls;
let plateTemplate: THREE.Object3D;
let reservoirTemplate: THREE.Object3D;
let pipetteBaseTemplate: THREE.Object3D;
let pipetteTipTemplate: THREE.Object3D;
let liquidTemplate: THREE.Mesh;

async function setup(): Promise<void> {
	setupEditor();

	// Setup serial communication
	py2JsBuffer = new RingBuffer(10*1024); // 10k buffer

	// Setup THREE.js
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

	liquidTemplate = new THREE.Mesh(
		new THREE.BoxGeometry(0.0095, 0.01, 0.0095),
		new THREE.MeshStandardMaterial({
			color: new THREE.Color("#49b7ff").getHex(),
			transparent: true,
			opacity: 0.72,
			roughness: 0.35,
			metalness: 0
		})
	);
	liquidTemplate.receiveShadow = true;

	clock = new THREE.Timer();
	clock.connect(document);

	scene = new THREE.Scene();
	scene.background = new THREE.Color("#2b2b2b");

	camera = new THREE.PerspectiveCamera(55, 1, 0.1, 500);
	camera.position.set(12, 25, 15);

	renderer = new THREE.WebGLRenderer({ antialias: true });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = THREE.PCFSoftShadowMap;
	simulationElement.appendChild(renderer.domElement);

	controls = new OrbitControls(camera, renderer.domElement);
	controls.target.set(12, 0, -8);

	window.addEventListener('resize', resize);
	resize();

	setupWorld();
}

function setupWorld(): void {
	scene.clear();

	const ambient = new THREE.AmbientLight("white", 0.1);
	scene.add(ambient);

	const keyLight = new THREE.PointLight(0xffffff, 10000);
	keyLight.position.copy(worldToScene(60, -20, 40));
	scene.add(keyLight);

	const fillLight = new THREE.PointLight(0xffffff, 2000);
	fillLight.position.copy(worldToScene(-30, 10, 40));
	scene.add(fillLight);

	const floorGrid = new THREE.GridHelper(400, 400, new THREE.Color("#8a8a8a").getHex(), new THREE.Color("#424242").getHex());
	floorGrid.position.copy(worldToScene(0, 0, 0));
	scene.add(floorGrid);

	// Setup world model
	pipetteHead = new PipetteHead(0, 0);
	plates = [];

	for (let row = 0; row < 2; row += 1) {
		for (let column = 0; column < 2; column += 1) {
			const plate = new Plate(column * 13, row * 9);
			for (let col = 0; col < plate.wells.length; ++col) {
				const wellsInCol = plate.wells[col];
				for (let row = 0; row < wellsInCol.length; ++row) {
					plate.wells[col][row].volumeUl = Math.round(Math.random() * WELL_MAX_VOL);
				}
			}
			plates.push(plate);
		}
	}

	// Create scene objects for all world objects
	for (const plate of plates) {
		const t3 = plateTemplate.clone();
		plate.t3 = t3;

		for (let col = 0; col < plate.wells.length; col += 1) {
			const wellsInCol = plate.wells[col];

			for (let row = 0; row < wellsInCol.length; row += 1) {
				const well = wellsInCol[row];
				const wellT3 = liquidTemplate.clone();
				wellT3.position.copy(worldToScene(col, row, 0.1).multiplyScalar(1 / MODEL_IMPORT_SCALE));
				well.t3 = wellT3;
				t3.add(wellT3);
			}
		}

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

	resetWorldButton.disabled = false;
}

function setupEditor(): void {
	const nextSimulationElement = document.querySelector<HTMLDivElement>('#simulation-pane');
	const editorElement = document.querySelector<HTMLDivElement>('#script-editor');
	const nextRunScriptButton = document.querySelector<HTMLButtonElement>('#run-script-button');
	const nextResetWorldButton = document.querySelector<HTMLButtonElement>('#reset-world-button');
	const nextScriptStatusElement = document.querySelector<HTMLSpanElement>('#script-status');
	const nextScriptOutputElement = document.querySelector<HTMLPreElement>('#script-output');

	if (!nextSimulationElement || !editorElement || !nextRunScriptButton || !nextResetWorldButton || !nextScriptStatusElement || !nextScriptOutputElement) {
		throw new Error('Missing simulator or editor pane');
	}

	simulationElement = nextSimulationElement;
	runScriptButton = nextRunScriptButton;
	resetWorldButton = nextResetWorldButton;
	resetWorldButton.disabled = true;
	scriptStatusElement = nextScriptStatusElement;
	scriptOutputElement = nextScriptOutputElement;
	scriptEditor = monaco.editor.create(editorElement, {
		value: defaultScript,
		language: 'python',
		theme: 'vs-dark',
		automaticLayout: true,
		fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
		fontSize: 13,
		lineHeight: 21,
		minimap: { enabled: false },
		scrollBeyondLastLine: false,
		renderLineHighlight: 'all',
		tabSize: 4,
		insertSpaces: true
	});

	pythonWorker = new PythonRuntimeWorker();
	runScriptButton.disabled = true;
	scriptStatusElement.textContent = 'Starting Python worker...';
	pythonWorker.addEventListener('message', handlePythonWorkerMessage);
	pythonWorker.addEventListener('error', handlePythonWorkerError);
	pythonWorker.addEventListener('messageerror', handlePythonWorkerMessageError);

	try {
		js2PyPipe = SharedSerialPipe.create(10 * 1024);
	} catch (error: unknown) {
		runScriptButton.disabled = true;
		scriptStatusElement.textContent = 'Serial setup error';
		appendScriptOutput(error instanceof Error ? error.message : String(error), 'stderr');
	}

	runScriptButton.addEventListener('click', runPythonScript);
	resetWorldButton.addEventListener('click', resetWorld);
}

function resetWorld(): void {
	clearSerialBuffers();
	setupWorld();
}

function runPythonScript(): void {
	runScriptButton.disabled = true;
	resetWorldButton.disabled = true;
	scriptStatusElement.textContent = 'Starting...';
	scriptOutputElement.textContent = '';
	clearSerialBuffers();

	const request: PythonWorkerRequest = {
		type: 'run',
		code: scriptEditor.getValue()
	};

	pythonWorker.postMessage(request);
}

function handlePythonWorkerMessage(event: MessageEvent<PythonWorkerResponse>): void {
	const response = event.data;

	switch (response.type) {
		case 'status':
			if (response.status === 'ready') {
				isPythonWorkerReady = true;
				configurePythonSerialInput();
				runScriptButton.disabled = false;
				resetWorldButton.disabled = false;
			}

			scriptStatusElement.textContent = response.message;
			break;
		case 'stdout':
		case 'stderr':
			appendScriptOutput(response.text, response.type);
			break;
		case 'done':
			runScriptButton.disabled = false;
			resetWorldButton.disabled = false;
			scriptStatusElement.textContent = 'Finished';
			clearSerialBuffers();
			break;
		case 'error':
			runScriptButton.disabled = false;
			resetWorldButton.disabled = false;
			scriptStatusElement.textContent = 'Error';
			clearSerialBuffers();
			appendScriptOutput(response.error, 'stderr');
			break;
		case 'py2js': {
			const binaryString = atob(response.dataBase64);
			const bytes = new Uint8Array(binaryString.length);

			for (let index = 0; index < binaryString.length; index += 1) {
				bytes[index] = binaryString.charCodeAt(index);
			}

			py2JsBuffer.write(bytes);
			
			break;
		}
	}
}

function configurePythonSerialInput(): void {
	if (!js2PyPipe || !isPythonWorkerReady) {
		return;
	}

	try {
		pythonWorker.postMessage({
			type: 'configureSerialInput',
			sharedBuffer: js2PyPipe.sharedBuffer
		} satisfies PythonWorkerRequest);
	} catch (error: unknown) {
		runScriptButton.disabled = true;
		resetWorldButton.disabled = true;
		scriptStatusElement.textContent = 'Serial setup error';
		appendScriptOutput(error instanceof Error ? error.message : String(error), 'stderr');
	}
}

function handlePythonWorkerError(event: ErrorEvent): void {
	runScriptButton.disabled = false;
	resetWorldButton.disabled = false;
	scriptStatusElement.textContent = 'Worker error';
	clearSerialBuffers();
	appendScriptOutput(`Worker error: ${formatWorkerError(event)}`, 'stderr');
}

function handlePythonWorkerMessageError(): void {
	runScriptButton.disabled = false;
	resetWorldButton.disabled = false;
	scriptStatusElement.textContent = 'Worker message error';
	clearSerialBuffers();
	appendScriptOutput('Worker message error: failed to deserialize a worker message.', 'stderr');
}

function formatWorkerError(event: ErrorEvent): string {
	if (event.message) {
		return event.message;
	}

	if (event.error instanceof Error && event.error.message) {
		return event.error.message;
	}

	if (event.filename) {
		const location = event.lineno ? `${event.filename}:${event.lineno}:${event.colno}` : event.filename;
		return `Python worker failed at ${location}.`;
	}

	return 'Python worker failed to start. Check the browser console for the original error.';
}

function appendScriptOutput(text: string, stream: 'stdout' | 'stderr'): void {
	const prefix = stream === 'stderr' ? 'stderr: ' : '';
	scriptOutputElement.textContent += `${prefix}${text}\n`;
	scriptOutputElement.scrollTop = scriptOutputElement.scrollHeight;
}

function update() {
	// Process commands
	if (py2JsBuffer.available() > 0) {
		commandsIn += readSerialStr();
	}

	let commandEnd = commandsIn.indexOf("\n");
	while (commandEnd >= 0) {
		const command = commandsIn.substring(0, commandEnd);
		commandsIn = commandsIn.substring(commandEnd + 1);

		if (command.length > 0) {
			const split = command.split(" ");
			processCommand(split);
		}

		commandEnd = commandsIn.indexOf("\n");
	}

	// Do movement
	const t = clock.getElapsed();

	if (pipetteHead.isMoving) {
		pipetteHead.x = accLerp(pipetteHead.fromX, pipetteHead.toX, pipetteHead.moveStart, t);
		pipetteHead.y = accLerp(pipetteHead.fromY, pipetteHead.toY, pipetteHead.moveStart, t);

		if (pipetteHead.x == pipetteHead.toX && pipetteHead.y == pipetteHead.toY) {
			pipetteHead.isMoving = false;
			writeSerialStr("move complete");
		}
	}

	for (let pipetteIndex = 0; pipetteIndex < pipetteHead.pipettes.length; ++pipetteIndex) {
		const pipette = pipetteHead.pipettes[pipetteIndex];

		if (pipette.state == "lowering" || pipette.state == "raising") {
			pipette.z = accLerp(pipette.fromZ, pipette.toZ, pipette.moveStart, t);
		}

		if (pipette.state == "lowering" && pipette.z == pipette.toZ) {
			const x = pipetteHead.x;
			const y = pipetteHead.y + pipetteIndex;

			const well = getWellAt(x, y);
			if (well) {
				const movedVolume = pipette.aspirationVol > 0
					? Math.min(well.volumeUl, pipette.aspirationVol, PIPETTE_MAX_VOL - pipette.volumeUl)
					: - Math.min(pipette.volumeUl, -pipette.aspirationVol, WELL_MAX_VOL - well.volumeUl)

				well.fromVol = well.volumeUl;
				well.toVol = well.volumeUl - movedVolume;
				well.aspirateStart = t;
				pipette.volumeUl += movedVolume;
				pipette.aspirationVol = movedVolume; // for success message later
			}

			pipette.state = "aspirating";
		} else if (pipette.state == "aspirating") {
			const x = pipetteHead.x;
			const y = pipetteHead.y + pipetteIndex;

			const well = getWellAt(x, y);
			if (well) {
				well.volumeUl = accLerp(well.fromVol, well.toVol, well.aspirateStart, t, DEFAULT_VOLUME_MAX_V, DEFAULT_VOLUME_MAX_ACC);
			}

			if (!well || well.volumeUl == well.toVol) {
				pipette.state = "raising";
				pipette.moveStart = t;
				pipette.fromZ = pipette.z;
				pipette.toZ = PIPETTE_NEUTRAL_Z;
			}
		} else if (pipette.state == "raising" && pipette.z == pipette.toZ) {
			pipette.state = "neutral";
			if (pipette.aspirationVol > 0) {
				writeSerialStr("aspirate " + pipetteIndex + " " + pipette.aspirationVol);
			} else {
				writeSerialStr("dispense " + pipetteIndex + " " + (-pipette.aspirationVol));
			}
		}
	}

	// Update world state to scene objects
	for (const plate of plates) {
		plate.t3?.position.copy(worldToScene(plate.x, plate.y, 0));
		for (const wellCol of plate.wells) {
			for (const well of wellCol) {
				if (well.t3) {
					well.t3.visible = well.volumeUl > 0;
					well.t3.scale.y = well.volumeUl / WELL_MAX_VOL;
					well.t3.position.y = 0.001 + (well.volumeUl / WELL_MAX_VOL) * LIQUID_MESH_HEIGHT / 2;
				}
			}
		}
	}

	for (let channel = 0; channel < pipetteHead.pipettes.length; channel += 1) {
		const pipette = pipetteHead.pipettes[channel];
		const y = pipetteHead.y + channel;

		pipette.t3Base?.position.copy(worldToScene(pipetteHead.x, y, pipette.z));
		pipette.t3Tip?.position.copy(worldToScene(pipetteHead.x, y, pipette.z - 2));
		pipette.t3Tip && (pipette.t3Tip.visible = pipette.tipAttached);
	}
}

function processCommand(split: string[]): void {
	const cmd = split[0];

	const t = clock.getElapsed();

	if (cmd == "move") {
		if (split.length != 3) {
			writeSerialStr("command error arguments");
			return;
		}

		const toX = Number(split[1]);
		const toY = Number(split[2]);

		if (Number.isNaN(toX) || Number.isNaN(toY)) {
			writeSerialStr("command error arguments");
			return;
		}

		if (pipetteHead.isMoving) {
			writeSerialStr("move error move_in_progress");
			return;
		}

		if (pipetteHead.pipettes.some((pipette) => pipette.state != "neutral")) {
			writeSerialStr("move error pipette_in_progress");
			return;
		}

		pipetteHead.isMoving = true;
		pipetteHead.moveStart = t;
		pipetteHead.fromX = pipetteHead.x;
		pipetteHead.fromY = pipetteHead.y;
		pipetteHead.toX = toX;
		pipetteHead.toY = toY;
	} else if (cmd == "aspirate" || cmd == "dispense") {
		if (split.length != 3) {
			writeSerialStr("command error arguments");
			return;
		}

		const pipetteIndex = Number(split[1]);
		const volume = Number(split[2]);

		if (
			!Number.isInteger(pipetteIndex) ||
			pipetteIndex < 0 ||
			pipetteIndex >= pipetteHead.pipettes.length ||
			!Number.isInteger(volume) ||
			volume < 0 ||
			volume > 200
		) {
			writeSerialStr("command error arguments");
			return;
		}

		if (pipetteHead.isMoving) {
			writeSerialStr(cmd + " error move_in_progress");
			return;
		}

		const pipette = pipetteHead.pipettes[pipetteIndex];
		if (pipette.state != "neutral") {
			writeSerialStr(cmd + " error pipette_in_progress");
			return;
		}

		const well = getWellAt(pipetteHead.x, pipetteHead.y + pipetteIndex);
		if (!well) {
			writeSerialStr(cmd + " error no_well");
			return;
		}

		pipette.state = "lowering";
		pipette.fromZ = pipette.z;
		pipette.toZ = PIPETTE_ASPIRATE_Z;
		pipette.moveStart = t;
		pipette.aspirationVol = cmd == "aspirate" ? volume : -volume;
	} else if (cmd == "get") {
		if (split.length != 2) {
			writeSerialStr("command error arguments");
			return;
		}

		if (split[1] == "position") {
			writeSerialStr("get " + pipetteHead.x + " " + pipetteHead.y);
		} else {
			writeSerialStr("command error arguments");
			return;
		}
	}
}

function readSerialStr(): string {
	const buf = py2JsBuffer.read(py2JsBuffer.available());
	return new TextDecoder().decode(buf);
}

function clearSerialBuffers(): void {
	py2JsBuffer.clear();
	js2PyPipe?.clear();
	commandsIn = "";
}

function writeSerialStr(str: string) {
	js2PyPipe?.write(new TextEncoder().encode(str + "\n"));
}

function worldToScene(x: number, y: number, z: number): THREE.Vector3 {
	return new THREE.Vector3(x, z, -y);
}

const DEFAULT_MOTION_MAX_V = 20;
const DEFAULT_MOTION_MAX_ACC = 60;
const DEFAULT_VOLUME_MAX_V = 160;
const DEFAULT_VOLUME_MAX_ACC = 480;

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
				object.scale.setScalar(MODEL_IMPORT_SCALE);
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
	const width = simulationElement.clientWidth;
	const height = simulationElement.clientHeight;

	renderer.setSize(width, height, false);
	camera.aspect = width / height;
	camera.updateProjectionMatrix();
	scriptEditor.layout();
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
