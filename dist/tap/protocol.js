export const TAP_HEADER_SIZE = 12;
export const MAX_PAYLOAD_SIZE = 1 * 1024 * 1024;
export const TapOrigin = {
    TYPETUBE_TS: 0x54545301
};
export var TapIntent;
(function (TapIntent) {
    TapIntent[TapIntent["PING"] = 0] = "PING";
    TapIntent[TapIntent["NEGOTIATE"] = 1] = "NEGOTIATE";
    TapIntent[TapIntent["AUTH"] = 2] = "AUTH";
    TapIntent[TapIntent["GOAWAY"] = 7] = "GOAWAY";
    TapIntent[TapIntent["RPC_CALL"] = 16] = "RPC_CALL";
    TapIntent[TapIntent["DISCONNECT"] = 126] = "DISCONNECT";
    TapIntent[TapIntent["ERROR"] = 127] = "ERROR";
})(TapIntent || (TapIntent = {}));
export var TapFlags;
(function (TapFlags) {
    TapFlags[TapFlags["REQUEST"] = 0] = "REQUEST";
    TapFlags[TapFlags["RESPONSE"] = 1] = "RESPONSE";
    TapFlags[TapFlags["ERROR"] = 2] = "ERROR";
    TapFlags[TapFlags["COMPRESSED"] = 4] = "COMPRESSED";
    TapFlags[TapFlags["ENCRYPTED"] = 8] = "ENCRYPTED";
    TapFlags[TapFlags["ACCEPT_COMPRESSED"] = 16] = "ACCEPT_COMPRESSED";
})(TapFlags || (TapFlags = {}));
export function encodeFrame(intent, traceId, flags, payload = Buffer.alloc(0), origin = TapOrigin.TYPETUBE_TS) {
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
export function parseHeader(buf, offset = 0) {
    if (buf.length - offset < TAP_HEADER_SIZE)
        return null;
    const origin = buf.readUInt32BE(offset);
    const intent = buf.readUInt8(offset + 4);
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
export function getFrameHeaderAad(origin, intent, flags, traceId, length) {
    const aad = Buffer.allocUnsafe(TAP_HEADER_SIZE);
    aad.writeUInt32BE(origin, 0);
    aad.writeUInt8(intent, 4);
    aad.writeUInt8(flags, 5);
    aad.writeUInt16BE(traceId & 0xffff, 6);
    aad.writeUInt32BE(length, 8);
    return aad;
}
//# sourceMappingURL=protocol.js.map