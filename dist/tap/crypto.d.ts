import crypto from "node:crypto";
export declare const ECDH_CURVE = "prime256v1";
export declare const GCM_TAG_LENGTH = 16;
export declare const GCM_IV_LENGTH = 12;
export interface SessionCipher {
    encrypt(plaintext: Buffer): Buffer;
    decrypt(ciphertextWithTag: Buffer): Buffer;
}
export declare class TapCryptoSession {
    private sendKey;
    private recvKey;
    private sendNonceCounter;
    private recvNonceCounter;
    private baseIv;
    constructor(sharedSecret: Buffer, isServer: boolean, psk?: string);
    private makeIv;
    encrypt(plaintext: Buffer, aad?: Buffer): Buffer;
    encryptAsync(plaintext: Buffer, aad?: Buffer): Promise<Buffer>;
    decrypt(payload: Buffer, aad?: Buffer): Buffer;
    decryptAsync(payload: Buffer, aad?: Buffer): Promise<Buffer>;
}
export declare function generateEcdhKeyPair(): {
    ecdh: crypto.ECDH;
    publicKey: NonSharedBuffer;
};
export declare function computeSharedSecret(ecdh: crypto.ECDH, remotePublicKey: Buffer): Buffer;
export declare function generateIdentityKeyPair(): {
    publicKey: NonSharedBuffer;
    privateKey: NonSharedBuffer;
    publicKeyHex: string;
};
export declare function signPayload(privateKeyDer: Buffer, data: Buffer): Buffer;
export declare function verifySignature(publicKeyDer: Buffer, data: Buffer, signature: Buffer): boolean;
export declare function computeHandshakeProof(key: string, data: Buffer): Buffer;
export declare function verifyHandshakeProof(key: string, data: Buffer, expectedProof: Buffer): boolean;
//# sourceMappingURL=crypto.d.ts.map