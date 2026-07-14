export type PythonWorkerRequest = {
	type: 'run';
	requestId: number;
	code: string;
};

export type PythonWorkerResponse =
	| {
		type: 'status';
		requestId: number;
		status: 'loading' | 'running';
		message: string;
	}
	| {
		type: 'stdout' | 'stderr';
		requestId: number;
		text: string;
	}
	| {
		type: 'done';
		requestId: number;
	}
	| {
		type: 'error';
		requestId: number;
		error: string;
	};
