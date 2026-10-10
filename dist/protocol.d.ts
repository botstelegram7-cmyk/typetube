export declare class ProtoWriter {
    private buffers;
    length: number;
    writeTag(field: number, wire: number): void;
    writeVarint(value: number): void;
    writeString(field: number, str?: string | null): void;
    writeUint32(field: number, val?: number | null): void;
    writeBool(field: number, val?: boolean | null): void;
    writeDouble(field: number, val?: number | null): void;
    writeMessage(field: number, writer: ProtoWriter): void;
    toUint8Array(): Uint8Array;
}
export declare class ProtoReader {
    private buf;
    private view;
    private pos;
    constructor(buf: Uint8Array);
    get hasMore(): boolean;
    readVarint(): number;
    readTag(): {
        field: number;
        wire: number;
    };
    readString(): string;
    readDouble(): number;
    readBytes(): Uint8Array;
    skip(wire: number): void;
}
export declare function encodeTrackResult(input: any): Uint8Array;
export declare function decodeTrackResult(buf: Uint8Array): any;
export declare function encodeSearchResults(input: any): Uint8Array;
export declare function decodeSearchResults(buf: Uint8Array): any;
//# sourceMappingURL=protocol.d.ts.map