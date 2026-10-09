export const TAP_HEADER_SIZE = 12;
export const MAX_PAYLOAD_SIZE = 1 * 1024 * 1024;
export const TapOrigin = {
    TYPETUBE_TS: 0x54545301
} as const;
export type TapOriginType = typeof TapOrigin.TYPETUBE_TS | number;
export enum TapIntent {
    PING = 0x00,
    NEGOTIATE = 0x01,
    AUTH = 0x02,
    GOAWAY = 0x07,
    RPC_CALL = 0x10,
    DISCONNECT = 0x7e,
    ERROR = 0x7f
}
export enum TapFlags {
    REQUEST = 0x00,
    RESPONSE = 0x01,
    ERROR = 0x02,
    COMPRESSED = 0x04,
    ENCRYPTED = 0x08,
    ACCEPT_COMPRESSED = 0x10
}
export interface TapHeader {
    origin: number;
    intent: TapIntent;
    flags: number;
    traceId: number;
    length: number;
}
export interface TapFrame {
    origin: number;
    intent: TapIntent;
    flags: number;
    traceId: number;
    payload: Buffer;
}
export function encodeFrame(intent: TapIntent, traceId: number, flags: number, payload: Buffer | Uint8Array = Buffer.alloc(0), origin: number = TapOrigin.TYPETUBE_TS): Buffer {
    const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
    if (buf.length > MAX_PAYLOAD_SIZE) {
        throw new Error(`TAP frame payload exceeds maximum size (${buf.length} > ${MAX_PAYLOAD_SIZE})`);
    }
    const frame = Buffer.allocUnsafe(TAP_HEADER_SIZE + buf.length);
    frame.writeUInt32BE(origin, 0);
    frame.writeUInt8(intent, 4);
    frame.writeUInt8(flags, 5);
    frame.writeUInt16BE(traceId & 0xffff, 6);
    frame.writeUInt32BE(buf.length, 8);
    if (buf.length > 0) {
        buf.copy(frame, TAP_HEADER_SIZE);
    }
    return frame;
}
export function parseHeader(buf: Buffer, offset = 0): TapHeader | null {
    if (buf.length - offset < TAP_HEADER_SIZE)
        return null;
    const origin = buf.readUInt32BE(offset);
    const intent = buf.readUInt8(offset + 4) as TapIntent;
    const flags = buf.readUInt8(offset + 5);
    const traceId = buf.readUInt16BE(offset + 6);
    const length = buf.readUInt32BE(offset + 8);
    if (length > MAX_PAYLOAD_SIZE) {
        throw new Error(`TAP payload size ${length} exceeds safety cap of ${MAX_PAYLOAD_SIZE} bytes`);
    }
    if ((intent === TapIntent.PING || intent === TapIntent.NEGOTIATE || intent === TapIntent.AUTH) && length > 2048) {
        throw new Error(`TAP handshake frame ${intent} exceeds pre-allocation limit (${length} > 2048 bytes)`);
    }
    return { origin, intent, flags, traceId, length };
}
export function getFrameHeaderAad(origin: number, intent: number, flags: number, traceId: number, length: number): Buffer {
    const aad = Buffer.allocUnsafe(TAP_HEADER_SIZE);
    aad.writeUInt32BE(origin, 0);
    aad.writeUInt8(intent, 4);
    aad.writeUInt8(flags, 5);
    aad.writeUInt16BE(traceId & 0xffff, 6);
    aad.writeUInt32BE(length, 8);
    return aad;
}
