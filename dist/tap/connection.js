import net from "node:net";
import fs from "node:fs";
import { TapIntent, TapFlags, encodeFrame, TapOrigin, getFrameHeaderAad } from "./protocol.js";
import { StreamParser } from "./parser.js";
import { decompressPayload } from "./compression.js";
import { TapCryptoSession, generateEcdhKeyPair, computeSharedSecret, verifySignature, computeHandshakeProof, verifyHandshakeProof } from "./crypto.js";
import { enableQuickAck } from "./quickack.js";
export function parseTapHost(input, defaultPort = 8443) {
    let cleaned = input.trim();
    if (cleaned.startsWith("tap://")) {
        cleaned = cleaned.slice(6);
    }
    const slashIdx = cleaned.indexOf("/");
    if (slashIdx !== -1) {
        cleaned = cleaned.slice(0, slashIdx);
    }
    if (cleaned.startsWith("[") && cleaned.includes("]")) {
        const endBracket = cleaned.indexOf("]");
        const host = cleaned.slice(1, endBracket);
        const rest = cleaned.slice(endBracket + 1);
        if (rest.startsWith(":")) {
            const port = parseInt(rest.slice(1), 10);
            return { host, port: isNaN(port) ? defaultPort : port };
        }
        return { host, port: defaultPort };
    }
    const parts = cleaned.split(":");
    if (parts.length === 2) {
        const port = parseInt(parts[1], 10);
        return { host: parts[0], port: isNaN(port) ? defaultPort : port };
    }
    return { host: cleaned, port: defaultPort };
}
export class TapConnection {
    options;
    socket = null;
    authenticated = false;
    activeRequests = 0;
    lastActiveAt = Date.now();
    cryptoSession = null;
    isPermanentlyRevoked = false;
    isDraining = false;
    drainPromise = null;
    targetHost;
    targetPort;
    targetSocketPath;
    parser = new StreamParser();
    pending = new Map();
    traceCounter = 1;
    connectingPromise = null;
    constructor(options) {
        this.options = options;
        const rawTarget = options.url || options.host || "";
        const defaultSock = process.env["TYPETUBE_TAP_SOCKET"] || "/tmp/typetube-tap.sock";
        if (options.socketPath) {
            this.targetSocketPath = options.socketPath;
            this.targetHost = "unix";
            this.targetPort = 0;
        }
        else if (rawTarget.startsWith("tap:///") || rawTarget.startsWith("unix://") || (rawTarget.startsWith("/") && !rawTarget.startsWith("//"))) {
            this.targetSocketPath = rawTarget.startsWith("tap:///")
                ? rawTarget.slice(6)
                : rawTarget.startsWith("unix://")
                    ? rawTarget.slice(7)
                    : rawTarget;
            this.targetHost = "unix";
            this.targetPort = 0;
        }
        else {
            const parsed = parseTapHost(rawTarget || "localhost", options.port ?? 8443);
            const isLocal = parsed.host === "127.0.0.1" || parsed.host === "localhost" || parsed.host === "::1";
            if (isLocal && (fs.existsSync(defaultSock) || process.env["TYPETUBE_TAP_FORCE_SOCKET"] === "true")) {
                this.targetSocketPath = defaultSock;
                this.targetHost = "unix";
                this.targetPort = 0;
            }
            else {
                this.targetSocketPath = null;
                this.targetHost = parsed.host;
                this.targetPort = options.port ?? parsed.port;
            }
        }
    }
    async connect() {
        if (this.socket && !this.socket.destroyed && this.authenticated) {
            return;
        }
        if (this.connectingPromise) {
            return this.connectingPromise;
        }
        this.connectingPromise = new Promise((resolve, reject) => {
            let settled = false;
            const fail = (err) => {
                if (settled)
                    return;
                settled = true;
                clearTimeout(handshakeTimer);
                this.connectingPromise = null;
                socket.destroy();
                reject(err);
            };
            const handshakeTimer = setTimeout(() => fail(new Error(`TAP connect/handshake timed out after ${this.options.timeoutMs ?? 15000}ms`)), this.options.timeoutMs ?? 15000);
            const connOpts = this.targetSocketPath
                ? { path: this.targetSocketPath }
                : { host: this.targetHost, port: this.targetPort };
            const socket = net.createConnection(connOpts, async () => {
                socket.setNoDelay(true);
                socket.setKeepAlive(true, 15000);
                enableQuickAck(socket);
                try {
                    if (this.options.encrypted) {
                        await this.executeNegotiation();
                    }
                    if (this.options.authKey) {
                        await this.executeAuthHandshake(this.options.authKey);
                    }
                    if (settled)
                        return;
                    settled = true;
                    clearTimeout(handshakeTimer);
                    this.authenticated = true;
                    this.connectingPromise = null;
                    resolve();
                }
                catch (handshakeErr) {
                    fail(handshakeErr);
                }
            });
            this.socket = socket;
            socket.unref();
            socket.on("data", (chunk) => {
                this.lastActiveAt = Date.now();
                enableQuickAck(socket);
                try {
                    this.parser.push(chunk);
                    let frame;
                    while ((frame = this.parser.nextFrame()) !== null) {
                        this.handleIncomingFrame(frame);
                    }
                }
                catch (err) {
                    this.cleanupPending(new Error(`Protocol parsing error: ${err.message}`));
                    socket.destroy();
                }
            });
            socket.on("error", (err) => {
                this.cleanupPending(err);
                fail(err);
            });
            socket.on("close", () => {
                this.authenticated = false;
                this.cryptoSession = null;
                this.cleanupPending(new Error("TAP Connection closed"));
                fail(new Error("TAP Connection closed"));
            });
        });
        return this.connectingPromise;
    }
    handleIncomingFrame(frame) {
        let { intent, traceId, flags, payload } = frame;
        if ((flags & TapFlags.ENCRYPTED) !== 0) {
            if (!this.cryptoSession) {
                this.failConnection(new Error("Received encrypted frame without a negotiated session"));
                return;
            }
            try {
                const aad = getFrameHeaderAad(frame.origin, intent, flags, traceId, payload.length);
                payload = this.cryptoSession.decrypt(payload, aad);
            }
            catch (err) {
                this.failConnection(new Error(`Decryption / AAD verification failed: ${err.message}`));
                return;
            }
        }
        if (intent === TapIntent.GOAWAY) {
            this.isDraining = true;
            if (this.pending.size === 0) {
                this.socket?.end();
            }
            return;
        }
        if (intent === TapIntent.DISCONNECT) {
            this.isPermanentlyRevoked = true;
            const reason = payload.toString("utf8");
            this.cleanupPending(new Error(`CONNECTION_TERMINATED: ${reason}`));
            this.socket?.destroy();
            return;
        }
        const req = this.pending.get(traceId);
        if (!req)
            return;
        this.pending.delete(traceId);
        this.activeRequests = Math.max(0, this.activeRequests - 1);
        clearTimeout(req.timer);
        if ((flags & TapFlags.COMPRESSED) !== 0) {
            try {
                payload = decompressPayload(payload);
            }
            catch (err) {
                req.reject(new Error(`Decompression failed: ${err.message}`));
                return;
            }
        }
        if ((flags & TapFlags.ERROR) !== 0) {
            req.reject(new Error(payload.toString("utf8")));
        }
        else {
            req.resolve(payload);
        }
    }
    executeNegotiation() {
        return new Promise((resolve, reject) => {
            const { ecdh, publicKey: clientPublicKey } = generateEcdhKeyPair();
            const traceId = this.nextTraceId();
            const timer = setTimeout(() => {
                this.pending.delete(traceId);
                reject(new Error("TAP Negotiation timed out"));
            }, this.options.timeoutMs ?? 5000);
            this.pending.set(traceId, {
                traceId,
                resolve: (responsePayload) => {
                    try {
                        let serverPublicKey;
                        let serverProof = null;
                        if (this.options.serverIdentityKey) {
                            const expectedKeyDer = Buffer.isBuffer(this.options.serverIdentityKey)
                                ? this.options.serverIdentityKey
                                : Buffer.from(this.options.serverIdentityKey, "hex");
                            if (responsePayload.length < 4) {
                                throw new Error("Server response too short for signed negotiation");
                            }
                            let offset = 0;
                            const pubKeyLen = responsePayload.readUInt16BE(offset);
                            offset += 2;
                            serverPublicKey = responsePayload.subarray(offset, offset + pubKeyLen);
                            offset += pubKeyLen;
                            const sigLen = responsePayload.readUInt16BE(offset);
                            offset += 2;
                            const signature = responsePayload.subarray(offset, offset + sigLen);
                            offset += sigLen;
                            if (responsePayload.length >= offset + 32) {
                                serverProof = responsePayload.subarray(offset, offset + 32);
                            }
                            const dataToVerify = Buffer.concat([serverPublicKey, clientPublicKey]);
                            const isValid = verifySignature(expectedKeyDer, dataToVerify, signature);
                            if (!isValid) {
                                throw new Error("SECURITY_ALERT: Man-in-the-Middle detected! Server identity signature verification failed.");
                            }
                        }
                        else {
                            if (responsePayload.length > 70 && responsePayload.readUInt16BE(0) === 65) {
                                const pubKeyLen = responsePayload.readUInt16BE(0);
                                serverPublicKey = responsePayload.subarray(2, 2 + pubKeyLen);
                                let offset = 2 + pubKeyLen;
                                if (responsePayload.length >= offset + 2) {
                                    const sigLen = responsePayload.readUInt16BE(offset);
                                    offset += 2 + sigLen;
                                    if (responsePayload.length >= offset + 32) {
                                        serverProof = responsePayload.subarray(offset, offset + 32);
                                    }
                                }
                                else if (responsePayload.length >= 2 + pubKeyLen + 32) {
                                    serverProof = responsePayload.subarray(2 + pubKeyLen, 2 + pubKeyLen + 32);
                                }
                            }
                            else if (responsePayload.length === 65 + 32) {
                                serverPublicKey = responsePayload.subarray(0, 65);
                                serverProof = responsePayload.subarray(65, 65 + 32);
                            }
                            else {
                                serverPublicKey = responsePayload;
                            }
                        }
                        const psk = this.options.psk;
                        if (psk) {
                            const expectedProofData = Buffer.concat([serverPublicKey, clientPublicKey]);
                            if (!serverProof || !verifyHandshakeProof(psk, expectedProofData, serverProof)) {
                                throw new Error("SECURITY_ALERT: Man-in-the-Middle detected! Server handshake PSK proof verification failed.");
                            }
                        }
                        else if (serverProof && this.options.authKey) {
                            const expectedProofData = Buffer.concat([serverPublicKey, clientPublicKey]);
                            if (!verifyHandshakeProof(this.options.authKey, expectedProofData, serverProof)) {
                                throw new Error("SECURITY_ALERT: Man-in-the-Middle detected! Server handshake PSK proof verification failed.");
                            }
                        }
                        const sharedSecret = computeSharedSecret(ecdh, serverPublicKey);
                        const bindingKey = psk || (serverProof ? this.options.authKey : undefined);
                        this.cryptoSession = new TapCryptoSession(sharedSecret, false, bindingKey);
                        resolve();
                    }
                    catch (err) {
                        reject(new Error(`Failed to derive shared secret: ${err.message}`));
                    }
                },
                reject,
                timer,
                startTime: performance.now()
            });
            let requestPayload;
            const clientPsk = this.options.psk || this.options.authKey;
            if (clientPsk) {
                const clientProof = computeHandshakeProof(clientPsk, clientPublicKey);
                const buf = Buffer.alloc(2 + clientPublicKey.length + clientProof.length);
                buf.writeUInt16BE(clientPublicKey.length, 0);
                clientPublicKey.copy(buf, 2);
                clientProof.copy(buf, 2 + clientPublicKey.length);
                requestPayload = buf;
            }
            else {
                requestPayload = clientPublicKey;
            }
            const origin = this.options.origin ?? TapOrigin.TYPETUBE_TS;
            const frame = encodeFrame(TapIntent.NEGOTIATE, traceId, TapFlags.REQUEST, requestPayload, origin);
            this.socket.write(frame);
        });
    }
    executeAuthHandshake(token) {
        return new Promise((resolve, reject) => {
            const traceId = this.nextTraceId();
            const timer = setTimeout(() => {
                this.pending.delete(traceId);
                reject(new Error("TAP Authentication handshake timed out"));
            }, this.options.timeoutMs ?? 5000);
            this.pending.set(traceId, {
                traceId,
                resolve: () => resolve(),
                reject,
                timer,
                startTime: performance.now()
            });
            const rawPayload = Buffer.from(token, "utf8");
            this.writeFrame(TapIntent.AUTH, traceId, TapFlags.REQUEST, rawPayload);
        });
    }
    async invoke(method, payload) {
        if (this.isPermanentlyRevoked) {
            throw new Error("TAP Connection has been permanently revoked by the server");
        }
        if (!this.authenticated || !this.socket || this.socket.destroyed) {
            await this.connect();
        }
        const methodBuf = Buffer.from(method, "utf8");
        if (methodBuf.length > 255) {
            throw new Error("TAP method name cannot exceed 255 bytes");
        }
        let payloadBuf;
        if (Buffer.isBuffer(payload)) {
            payloadBuf = payload;
        }
        else if (payload instanceof Uint8Array) {
            payloadBuf = Buffer.from(payload);
        }
        else if (typeof payload === "string") {
            payloadBuf = Buffer.from(payload, "utf8");
        }
        else {
            payloadBuf = Buffer.from(JSON.stringify(payload), "utf8");
        }
        const packetPayload = Buffer.allocUnsafe(1 + methodBuf.length + payloadBuf.length);
        packetPayload.writeUInt8(methodBuf.length, 0);
        methodBuf.copy(packetPayload, 1);
        payloadBuf.copy(packetPayload, 1 + methodBuf.length);
        return new Promise((resolve, reject) => {
            const traceId = this.nextTraceId();
            const timeoutMs = this.options.timeoutMs ?? 15000;
            const timer = setTimeout(() => {
                this.pending.delete(traceId);
                this.activeRequests = Math.max(0, this.activeRequests - 1);
                reject(new Error(`TAP RPC invoke '${method}' timed out after ${timeoutMs}ms`));
            }, timeoutMs);
            this.pending.set(traceId, {
                traceId,
                resolve,
                reject,
                timer,
                startTime: performance.now()
            });
            this.activeRequests++;
            this.lastActiveAt = Date.now();
            try {
                const flags = this.options.compression === false ? TapFlags.REQUEST : TapFlags.REQUEST | TapFlags.ACCEPT_COMPRESSED;
                this.writeFrame(TapIntent.RPC_CALL, traceId, flags, packetPayload);
            }
            catch (err) {
                clearTimeout(timer);
                this.pending.delete(traceId);
                this.activeRequests = Math.max(0, this.activeRequests - 1);
                reject(err);
            }
        });
    }
    async ping() {
        if (!this.authenticated || !this.socket || this.socket.destroyed) {
            await this.connect();
        }
        return new Promise((resolve, reject) => {
            const traceId = this.nextTraceId();
            const t0 = performance.now();
            const timer = setTimeout(() => {
                this.pending.delete(traceId);
                reject(new Error("TAP Ping timed out"));
            }, 5000);
            this.pending.set(traceId, {
                traceId,
                resolve: () => resolve(performance.now() - t0),
                reject,
                timer,
                startTime: t0
            });
            try {
                this.writeFrame(TapIntent.PING, traceId, TapFlags.REQUEST, Buffer.alloc(0));
            }
            catch (err) {
                clearTimeout(timer);
                this.pending.delete(traceId);
                reject(err);
            }
        });
    }
    writeFrame(intent, traceId, flags, payload) {
        if (!this.socket || this.socket.destroyed || !this.socket.writable)
            return false;
        const origin = this.options.origin ?? TapOrigin.TYPETUBE_TS;
        let data;
        if (this.cryptoSession) {
            flags |= TapFlags.ENCRYPTED;
            const encryptedLength = payload.length + 16;
            const aad = getFrameHeaderAad(origin, intent, flags, traceId, encryptedLength);
            const encryptedPayload = this.cryptoSession.encrypt(payload, aad);
            data = encodeFrame(intent, traceId, flags, encryptedPayload, origin);
        }
        else {
            data = encodeFrame(intent, traceId, flags, payload, origin);
        }
        const accepted = this.socket.write(data);
        if (!accepted) {
            this.isDraining = true;
            if (!this.drainPromise) {
                this.drainPromise = new Promise((resolve) => {
                    this.socket?.once("drain", () => {
                        this.isDraining = false;
                        this.drainPromise = null;
                        resolve();
                    });
                });
            }
        }
        return accepted;
    }
    close() {
        this.cleanupPending(new Error("TAP Connection closed by client"));
        if (this.socket) {
            this.socket.destroy();
            this.socket = null;
        }
    }
    nextTraceId() {
        const id = this.traceCounter++;
        if (this.traceCounter > 65535)
            this.traceCounter = 1;
        return id;
    }
    failConnection(err) {
        this.cleanupPending(err);
        this.socket?.destroy();
    }
    cleanupPending(err) {
        for (const [traceId, p] of this.pending.entries()) {
            clearTimeout(p.timer);
            p.reject(err);
        }
        this.pending.clear();
        this.activeRequests = 0;
    }
}
//# sourceMappingURL=connection.js.map