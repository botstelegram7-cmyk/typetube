import { TapConnection, TapConnectionOptions, parseTapHost } from "./connection.js";
import { TapOrigin } from "./protocol.js";
const KEEPALIVE_IDLE_MS = 15000;
export interface TapClientOptions extends TapConnectionOptions {
    autoRetry?: boolean;
}
export class TapClient {
    private connection: TapConnection | null = null;
    private options: Required<Omit<TapClientOptions, "serverIdentityKey" | "url" | "host" | "port" | "socketPath" | "psk" | "authKey">> & {
        host: string;
        port: number;
        url?: string;
        socketPath?: string;
        psk?: string;
        authKey?: string;
        serverIdentityKey?: Buffer | string;
    };
    private maintenanceTimer: NodeJS.Timeout | null = null;
    private isClosed = false;
    constructor(options: TapClientOptions | string) {
        const opts: TapClientOptions = typeof options === "string" ? { host: options } : options;
        const rawTarget = opts.url || opts.host || "";
        let parsedHost = "localhost";
        let parsedPort = 8443;
        let socketPath = opts.socketPath;
        if (!socketPath && (rawTarget.startsWith("tap:///") || rawTarget.startsWith("unix://") || rawTarget.startsWith("/"))) {
            socketPath = rawTarget.startsWith("tap:///")
                ? rawTarget.slice(6)
                : rawTarget.startsWith("unix://")
                    ? rawTarget.slice(7)
                    : rawTarget;
        }
        else if (!socketPath) {
            const parsed = parseTapHost(rawTarget || "sg.clusters.typetube.xyz", opts.port ?? 8443);
            parsedHost = parsed.host;
            parsedPort = opts.port ?? parsed.port;
        }
        const isLocalhost = socketPath != null ||
            parsedHost === "localhost" ||
            parsedHost === "127.0.0.1" ||
            parsedHost === "::1";
        const isEncrypted = opts.encrypted ?? (isLocalhost ? false : true);
        const isCompressed = opts.compression ?? (isLocalhost ? false : true);
        this.options = {
            host: parsedHost,
            port: parsedPort,
            url: opts.url,
            socketPath,
            authKey: opts.authKey || undefined,
            psk: opts.psk,
            origin: opts.origin ?? TapOrigin.TYPETUBE_TS,
            encrypted: isEncrypted,
            serverIdentityKey: opts.serverIdentityKey,
            timeoutMs: opts.timeoutMs ?? 15000,
            compression: isCompressed,
            autoRetry: opts.autoRetry ?? true
        };
        this.startMaintenanceTimer();
    }
    private async acquireConnection(): Promise<TapConnection> {
        if (this.isClosed) {
            throw new Error("TapClient is closed");
        }
        if (this.connection && this.connection.socket && !this.connection.socket.destroyed && this.connection.authenticated && !this.connection.isDraining) {
            return this.connection;
        }
        if (this.connection) {
            this.connection.close();
            this.connection = null;
        }
        const conn = new TapConnection(this.options);
        this.connection = conn;
        await conn.connect();
        return conn;
    }
    public async invoke(method: string, payload: Buffer | Uint8Array | string | object = Buffer.alloc(0)): Promise<Buffer> {
        try {
            const conn = await this.acquireConnection();
            return await conn.invoke(method, payload);
        }
        catch (err: any) {
            if (this.options.autoRetry && !this.isClosed && this.isTransientError(err)) {
                if (this.connection) {
                    this.connection.close();
                    this.connection = null;
                }
                const retryConn = await this.acquireConnection();
                return await retryConn.invoke(method, payload);
            }
            throw err;
        }
    }
    public async ping(): Promise<number> {
        try {
            const conn = await this.acquireConnection();
            return await conn.ping();
        }
        catch (err: any) {
            if (this.options.autoRetry && !this.isClosed && this.isTransientError(err)) {
                if (this.connection) {
                    this.connection.close();
                    this.connection = null;
                }
                const retryConn = await this.acquireConnection();
                return await retryConn.ping();
            }
            throw err;
        }
    }
    private isTransientError(err: any): boolean {
        if (!err)
            return false;
        const msg = String(err.message || "");
        const code = String(err.code || "");
        if (msg.includes("CONNECTION_TERMINATED") || msg.includes("UNAUTHORIZED") || msg.includes("AUTH_REJECTED")) {
            return false;
        }
        return (msg.includes("TAP Connection closed") ||
            msg.includes("ECONNRESET") ||
            msg.includes("EPIPE") ||
            msg.includes("ECONNREFUSED") ||
            code === "ECONNRESET" ||
            code === "EPIPE" ||
            code === "ECONNREFUSED");
    }
    public async connect(): Promise<void> {
        await this.acquireConnection();
    }
    public close(): void {
        this.isClosed = true;
        if (this.maintenanceTimer) {
            clearInterval(this.maintenanceTimer);
            this.maintenanceTimer = null;
        }
        if (this.connection) {
            this.connection.close();
            this.connection = null;
        }
    }
    private startMaintenanceTimer(): void {
        this.maintenanceTimer = setInterval(async () => {
            if (this.isClosed || !this.connection)
                return;
            const now = Date.now();
            if (this.connection.authenticated && this.connection.activeRequests === 0 && now - this.connection.lastActiveAt > KEEPALIVE_IDLE_MS) {
                this.connection.ping().catch(() => { });
            }
        }, 5000);
        this.maintenanceTimer.unref();
    }
}
export function createTapClient(options: TapClientOptions | string): TapClient {
    return new TapClient(options);
}
