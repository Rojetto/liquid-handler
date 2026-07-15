const READ_INDEX = 0;
const WRITE_INDEX = 1;
const AVAILABLE = 2;
const CLOSED = 3;

const HEADER_INT_COUNT = 4;
const HEADER_BYTE_LENGTH = HEADER_INT_COUNT * Int32Array.BYTES_PER_ELEMENT;

export class SharedSerialPipe {
	readonly sharedBuffer: SharedArrayBuffer;
	readonly capacity: number;

	private readonly header: Int32Array;
	private readonly bytes: Uint8Array;

	static create(capacity: number): SharedSerialPipe {
		if (typeof SharedArrayBuffer === 'undefined') {
			throw new Error('SharedArrayBuffer is unavailable. Serve the app with COOP/COEP headers for cross-origin isolation.');
		}

		const sharedBuffer = new SharedArrayBuffer(HEADER_BYTE_LENGTH + capacity);
		const pipe = new SharedSerialPipe(sharedBuffer);

		pipe.reset();

		return pipe;
	}

	static wrap(sharedBuffer: SharedArrayBuffer): SharedSerialPipe {
		return new SharedSerialPipe(sharedBuffer);
	}

	private constructor(sharedBuffer: SharedArrayBuffer) {
		const capacity = sharedBuffer.byteLength - HEADER_BYTE_LENGTH;

		if (capacity <= 0) {
			throw new Error('Shared serial pipe buffer is too small.');
		}

		this.sharedBuffer = sharedBuffer;
		this.capacity = capacity;
		this.header = new Int32Array(sharedBuffer, 0, HEADER_INT_COUNT);
		this.bytes = new Uint8Array(sharedBuffer, HEADER_BYTE_LENGTH, capacity);
	}

	write(data: Uint8Array): number {
		if (Atomics.load(this.header, CLOSED) !== 0) {
			return 0;
		}

		const available = Atomics.load(this.header, AVAILABLE);
		const writeLength = Math.min(data.length, this.capacity - available);

		if (writeLength <= 0) {
			return 0;
		}

		const writeIndex = Atomics.load(this.header, WRITE_INDEX);
		const firstChunkLength = Math.min(writeLength, this.capacity - writeIndex);
		const secondChunkLength = writeLength - firstChunkLength;

		this.bytes.set(data.subarray(0, firstChunkLength), writeIndex);

		if (secondChunkLength > 0) {
			this.bytes.set(data.subarray(firstChunkLength, writeLength), 0);
		}

		Atomics.store(this.header, WRITE_INDEX, (writeIndex + writeLength) % this.capacity);
		Atomics.add(this.header, AVAILABLE, writeLength);
		Atomics.notify(this.header, AVAILABLE, 1);

		return writeLength;
	}

	readBlocking(maxLength: number): Uint8Array | null {
		const readLimit = Math.max(0, Math.floor(maxLength));

		if (readLimit === 0) {
			return new Uint8Array(0);
		}

		let available = Atomics.load(this.header, AVAILABLE);

		while (available <= 0) {
			if (Atomics.load(this.header, CLOSED) !== 0) {
				return null;
			}

			Atomics.wait(this.header, AVAILABLE, 0);
			available = Atomics.load(this.header, AVAILABLE);
		}

		const readLength = Math.min(readLimit, available);
		const readIndex = Atomics.load(this.header, READ_INDEX);
		const firstChunkLength = Math.min(readLength, this.capacity - readIndex);
		const secondChunkLength = readLength - firstChunkLength;
		const data = new Uint8Array(readLength);

		data.set(this.bytes.subarray(readIndex, readIndex + firstChunkLength), 0);

		if (secondChunkLength > 0) {
			data.set(this.bytes.subarray(0, secondChunkLength), firstChunkLength);
		}

		Atomics.store(this.header, READ_INDEX, (readIndex + readLength) % this.capacity);
		Atomics.sub(this.header, AVAILABLE, readLength);

		return data;
	}

	clear(): void {
		Atomics.store(this.header, READ_INDEX, 0);
		Atomics.store(this.header, WRITE_INDEX, 0);
		Atomics.store(this.header, AVAILABLE, 0);
	}

	close(): void {
		Atomics.store(this.header, CLOSED, 1);
		Atomics.notify(this.header, AVAILABLE, 1);
	}

	private reset(): void {
		Atomics.store(this.header, READ_INDEX, 0);
		Atomics.store(this.header, WRITE_INDEX, 0);
		Atomics.store(this.header, AVAILABLE, 0);
		Atomics.store(this.header, CLOSED, 0);
	}
}
