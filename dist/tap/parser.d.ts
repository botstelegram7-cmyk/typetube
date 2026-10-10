import { TapFrame } from "./protocol.js";
export declare class StreamParser {
    private buffer;
    private offset;
    private length;
    constructor(initialCapacity?: number);
    push(chunk: Buffer): void;
    private ensureCapacity;
    nextFrame(): TapFrame | null;
}
//# sourceMappingURL=parser.d.ts.map