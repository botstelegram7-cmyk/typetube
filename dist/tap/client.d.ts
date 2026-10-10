import { TapConnectionOptions } from "./connection.js";
export interface TapClientOptions extends TapConnectionOptions {
    autoRetry?: boolean;
}
export declare class TapClient {
    private connection;
    private options;
    private maintenanceTimer;
    private isClosed;
    constructor(options: TapClientOptions | string);
    private acquireConnection;
    invoke(method: string, payload?: Buffer | Uint8Array | string | object): Promise<Buffer>;
    ping(): Promise<number>;
    private isTransientError;
    connect(): Promise<void>;
    close(): void;
    private startMaintenanceTimer;
}
export declare function createTapClient(options: TapClientOptions | string): TapClient;
//# sourceMappingURL=client.d.ts.map