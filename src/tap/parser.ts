import { TAP_HEADER_SIZE, parseHeader, TapFrame, MAX_PAYLOAD_SIZE } from "./protocol.js";
const MAX_BUFFERED_BYTES = 2 * (MAX_PAYLOAD_SIZE + TAP_HEADER_SIZE);
export class StreamParser {
    private buffer: Buffer;
    private offset = 0;
    private length = 0;
    constructor(initialCapacity = 64 * 1024) {
        this.buffer = Buffer.allocUnsafe(initialCapacity);
    }
    public push(chunk: Buffer): void {
        if (this.length >= TAP_HEADER_SIZE) {
            parseHeader(this.buffer.subarray(this.offset, this.offset + this.length));
        }
        if (this.length + chunk.length > MAX_BUFFERED_BYTES) {
            throw new Error(`TAP frame buffer overflow: ${this.length + chunk.length} buffered bytes exceed limit (${MAX_BUFFERED_BYTES} bytes)`);
        }
        if (this.length + chunk.length > this.buffer.length) {
            this.ensureCapacity(this.length + chunk.length);
        }
        else if (this.offset > 0 && this.offset + this.length + chunk.length > this.buffer.length) {
            this.buffer.copy(this.buffer, 0, this.offset, this.offset + this.length);
            this.offset = 0;
        }
        chunk.copy(this.buffer, this.offset + this.length);
        this.length += chunk.length;
    }
    private ensureCapacity(needed: number): void {
        if (needed > MAX_BUFFERED_BYTES) {
            throw new Error(`TAP frame buffer overflow: requested capacity (${needed} bytes) exceeds limit`);
        }
        let newCap = Math.min(Math.max(this.buffer.length * 2, needed), MAX_BUFFERED_BYTES);
        const newBuf = Buffer.allocUnsafe(newCap);
        this.buffer.copy(newBuf, 0, this.offset, this.offset + this.length);
        this.buffer = newBuf;
        this.offset = 0;
    }
    public nextFrame(): TapFrame | null {
        if (this.length < TAP_HEADER_SIZE)
            return null;
        const slice = this.buffer.subarray(this.offset, this.offset + this.length);
        const header = parseHeader(slice);
        if (!header)
            return null;
        const fullFrameSize = TAP_HEADER_SIZE + header.length;
        if (this.length < fullFrameSize) {
            return null;
        }
        const payload = Buffer.from(this.buffer.subarray(this.offset + TAP_HEADER_SIZE, this.offset + fullFrameSize));
        this.offset += fullFrameSize;
        this.length -= fullFrameSize;
        if (this.length === 0) {
            this.offset = 0;
        }
        return {
            origin: header.origin,
            intent: header.intent,
            flags: header.flags,
            traceId: header.traceId,
            payload
        };
    }
}
