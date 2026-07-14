export type PythonWorkerRequest = {
	type: 'run';
	code: string;
};

export type PythonWorkerResponse =
	| {
		type: 'status';
		status: 'loading' | 'running';
		message: string;
	}
	| {
		type: 'stdout' | 'stderr';
		text: string;
	}
	| {
		type: 'done';
	}
	| {
		type: 'error';
		error: string;
	}
	| {
		type: 'py2js';
		dataBase64: string;
	};
