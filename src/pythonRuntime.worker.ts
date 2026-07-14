import { loadPyodide, type PyodideAPI } from 'pyodide';
import type { PythonWorkerRequest, PythonWorkerResponse } from './pythonWorkerMessages';

let pyodidePromise: Promise<PyodideAPI> | undefined;
let isRunning = false;

function postResponse(response: PythonWorkerResponse): void {
	self.postMessage(response);
}

function getPyodide(): Promise<PyodideAPI> {
	if (!pyodidePromise) {
		postResponse({
			type: 'status',
			status: 'loading',
			message: 'Loading Python...'
		});

		pyodidePromise = loadPyodide({
			indexURL: new URL(`${import.meta.env.BASE_URL}pyodide/`, self.location.origin).href,
			stdout: (text) => {
				postResponse({ type: 'stdout', text });
			},
			stderr: (text) => {
				postResponse({ type: 'stderr', text });
			}
		}).then((pyodide) => {
			installSerialWrite(pyodide);
			return pyodide;
		});
	}

	return pyodidePromise;
}

function installSerialWrite(pyodide: PyodideAPI): void {
	pyodide.globals.set('__serial_write_base64', (dataBase64: string) => {
		postResponse({ type: 'py2js', dataBase64 });
	});

pyodide.runPython(`
import base64
import builtins

def serial_write(data):
    if not isinstance(data, bytes):
        raise TypeError("serial_write(data) expects data to be bytes")

    __serial_write_base64(base64.b64encode(data).decode("ascii"))

builtins.serial_write = serial_write
`);
}

async function runPython(request: PythonWorkerRequest): Promise<void> {
	if (isRunning) {
		postResponse({
			type: 'error',
			error: 'Python is already running.'
		});
		return;
	}

	isRunning = true;

	try {
		const pyodide = await getPyodide();

		postResponse({
			type: 'status',
			status: 'running',
			message: 'Running...'
		});

		const result = await pyodide.runPythonAsync(request.code);

		if (result !== undefined && result !== null) {
			// Print return value as last message
			postResponse({
				type: 'stdout',
				text: String(result)
			});
		}

		if (typeof result === 'object' && result !== null && 'destroy' in result) {
			(result as { destroy: () => void }).destroy();
		}

		postResponse({ type: 'done' });
	} catch (error: unknown) {
		postResponse({
			type: 'error',
			error: error instanceof Error ? error.message : String(error)
		});
	} finally {
		isRunning = false;
	}
}

self.onmessage = event => {
	if (event.data.type === 'run') {
		void runPython(event.data);
	}
};
