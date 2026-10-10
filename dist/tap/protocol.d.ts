export declare const TAP_HEADER_SIZE = 12;
export declare const MAX_PAYLOAD_SIZE: number;
export declare const TapOrigin: {
    readonly TYPETUBE_TS: 1414812417;
};
export type TapOriginType = typeof TapOrigin.TYPETUBE_TS | number;
export declare enum TapIntent {
    PING = 0,
    NEGOTIATE = 1,
    AUTH = 2,
    GOAWAY = 7,
    RPC_CALL = 16,
    DISCONNECT = 126,
    ERROR = 127
}
export declare enum TapFlags {
    REQUEST = 0,
    RESPONSE = 1,
    ERROR = 2,
    COMPRESSED = 4,
    ENCRYPTED = 8,
    ACCEPT_COMPRESSED = 16
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
export declare function encodeFrame(intent: TapIntent, traceId: number, flags: number, payload?: Buffer | Uint8Array, origin?: number): Buffer;
export declare function parseHeader(buf: Buffer, offset?: number): TapHeader | null;
export declare function getFrameHeaderAad(origin: number, intent: number, flags: number, traceId: number, length: number): Buffer;
//# sourceMappingURL=protocol.d.ts.map