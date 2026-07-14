import { loadPyodide, type PyodideAPI } from 'pyodide';
import type { PythonWorkerRequest, PythonWorkerResponse } from './pythonWorkerMessages';

let pyodidePromise: Promise<PyodideAPI> | undefined;
let activeRequestId = 0;
let isRunning = false;

function postResponse(response: PythonWorkerResponse): void {
	self.postMessage(response);
}

function getPyodide(requestId: number): Promise<PyodideAPI> {
	if (!pyodidePromise) {
		postResponse({
			type: 'status',
			requestId,
			status: 'loading',
			message: 'Loading Python...'
		});

		pyodidePromise = loadPyodide({
			indexURL: new URL(`${import.meta.env.BASE_URL}pyodide/`, self.location.origin).href,
			stdout: (text) => {
				postResponse({ type: 'stdout', requestId: activeRequestId, text });
			},
			stderr: (text) => {
				postResponse({ type: 'stderr', requestId: activeRequestId, text });
			}
		});
	}

	return pyodidePromise;
}

async function runPython(request: PythonWorkerRequest): Promise<void> {
	if (isRunning) {
		postResponse({
			type: 'error',
			requestId: request.requestId,
			error: 'Python is already running.'
		});
		return;
	}

	isRunning = true;
	activeRequestId = request.requestId;

	try {
		const pyodide = await getPyodide(request.requestId);

		postResponse({
			type: 'status',
			requestId: request.requestId,
			status: 'running',
			message: 'Running...'
		});

		const result = await pyodide.runPythonAsync(request.code);

		if (result !== undefined && result !== null) {
			// Print return value as last message
			postResponse({
				type: 'stdout',
				requestId: request.requestId,
				text: String(result)
			});
		}

		if (typeof result === 'object' && result !== null && 'destroy' in result) {
			(result as { destroy: () => void }).destroy();
		}

		postResponse({ type: 'done', requestId: request.requestId });
	} catch (error: unknown) {
		postResponse({
			type: 'error',
			requestId: request.requestId,
			error: error instanceof Error ? error.message : String(error)
		});
	} finally {
		isRunning = false;
		activeRequestId = 0;
	}
}

self.onmessage = event => {
	if (event.data.type === 'run') {
		void runPython(event.data);
	}
};
