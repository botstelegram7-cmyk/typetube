import net from "node:net";
import { TapCryptoSession } from "./crypto.js";
export interface PendingRequest {
    traceId: number;
    resolve: (value: Buffer) => void;
    reject: (err: Error) => void;
    timer: NodeJS.Timeout;
    startTime: number;
}
export declare function parseTapHost(input: string, defaultPort?: number): {
    host: string;
    port: number;
};
export interface TapConnectionOptions {
    host?: string;
    url?: string;
    port?: number;
    socketPath?: string;
    authKey?: string;
    psk?: string;
    origin?: number;
    encrypted?: boolean;
    serverIdentityKey?: Buffer | string;
    timeoutMs?: number;
    compression?: boolean;
}
export declare class TapConnection {
    readonly options: TapConnectionOptions;
    socket: net.Socket | null;
    authenticated: boolean;
    activeRequests: number;
    lastActiveAt: number;
    cryptoSession: TapCryptoSession | null;
    isPermanentlyRevoked: boolean;
    isDraining: boolean;
    private drainPromise;
    readonly targetHost: string;
    readonly targetPort: number;
    readonly targetSocketPath: string | null;
    private parser;
    private pending;
    private traceCounter;
    private connectingPromise;
    constructor(options: TapConnectionOptions);
    connect(): Promise<void>;
    private handleIncomingFrame;
    private executeNegotiation;
    private executeAuthHandshake;
    invoke(method: string, payload: Buffer | Uint8Array | string | object): Promise<Buffer>;
    ping(): Promise<number>;
    private writeFrame;
    close(): void;
    private nextTraceId;
    private failConnection;
    private cleanupPending;
}
//# sourceMappingURL=connection.d.ts.map