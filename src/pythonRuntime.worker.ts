import type { PyodideAPI } from 'pyodide';
import type { PythonWorkerRequest, PythonWorkerResponse } from './pythonWorkerMessages';
import { SharedSerialPipe } from './sharedSerialPipe';

let pyodidePromise: Promise<PyodideAPI> | undefined;
let isRunning = false;
let js2PyPipe: SharedSerialPipe | undefined;

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

		pyodidePromise = import('pyodide').then(({ loadPyodide }) => loadPyodide({
			indexURL: new URL(`${import.meta.env.BASE_URL}pyodide/`, self.location.origin).href,
			stdout: (text) => {
				postResponse({ type: 'stdout', text });
			},
			stderr: (text) => {
				postResponse({ type: 'stderr', text });
			}
		})).then((pyodide) => {
			installSerialInterface(pyodide);
			return pyodide;
		});
	}

	return pyodidePromise;
}

function installSerialInterface(pyodide: PyodideAPI): void {
	pyodide.globals.set('_serial_write_base64', (dataBase64: string) => {
		postResponse({ type: 'py2js', dataBase64 });
	});
	pyodide.globals.set('_serial_read_blocking_base64', (maxLength: number) => {
		if (!js2PyPipe) {
			throw new Error('Serial input pipe is not configured.');
		}

		const data = js2PyPipe.readBlocking(maxLength);

		if (data === null) {
			return '';
		}

		return bytesToBase64(data);
	});

pyodide.runPython(`
import base64
import builtins
import io

class SerialStream(io.RawIOBase):
    def readable(self):
        return True

    def writable(self):
        return True

    def readinto(self, buffer):
        if self.closed:
            raise ValueError("I/O operation on closed file.")

        if len(buffer) == 0:
            return 0

        data = base64.b64decode(_serial_read_blocking_base64(len(buffer)))

        if len(data) == 0:
            return 0

        buffer[:len(data)] = data
        return len(data)

    def write(self, data):
        if self.closed:
            raise ValueError("I/O operation on closed file.")

        try:
            data_bytes = bytes(data)
        except TypeError as error:
            raise TypeError("SerialStream.write(data) expects a bytes-like object") from error

        _serial_write_base64(base64.b64encode(data_bytes).decode("ascii"))
        return len(data_bytes)

builtins.SerialStream = SerialStream
	`);
}

function bytesToBase64(bytes: Uint8Array): string {
	let binary = '';
	const chunkLength = 0x8000;

	for (let offset = 0; offset < bytes.length; offset += chunkLength) {
		const chunk = bytes.subarray(offset, offset + chunkLength);
		binary += String.fromCharCode(...chunk);
	}

	return btoa(binary);
}

async function runPython(request: Extract<PythonWorkerRequest, { type: 'run' }>): Promise<void> {
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
	const request = event.data as PythonWorkerRequest;

	if (request.type === 'configureSerialInput') {
		js2PyPipe = SharedSerialPipe.wrap(request.sharedBuffer);
	} else if (request.type === 'run') {
		void runPython(request);
	}
};

postResponse({
	type: 'status',
	status: 'ready',
	message: 'Python worker ready'
});
