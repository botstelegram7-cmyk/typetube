import crypto from "node:crypto";
export const ECDH_CURVE = "prime256v1";
export const GCM_TAG_LENGTH = 16;
export const GCM_IV_LENGTH = 12;
export class TapCryptoSession {
    sendKey;
    recvKey;
    sendNonceCounter = 0;
    recvNonceCounter = 0;
    baseIv;
    constructor(sharedSecret, isServer, psk) {
        const salt = psk && psk.length > 0 ? psk : "TAP_CRYPTO_SALT_v1";
        const prk = crypto.createHmac("sha256", salt).update(sharedSecret).digest();
        const c2sKey = crypto.createHmac("sha256", prk).update("TAP_C2S_KEY").digest();
        const s2cKey = crypto.createHmac("sha256", prk).update("TAP_S2C_KEY").digest();
        this.baseIv = crypto.createHmac("sha256", prk).update("TAP_BASE_IV").digest().subarray(0, 8);
        if (isServer) {
            this.sendKey = s2cKey;
            this.recvKey = c2sKey;
        }
        else {
            this.sendKey = c2sKey;
            this.recvKey = s2cKey;
        }
    }
    makeIv(counter) {
        const iv = Buffer.allocUnsafe(GCM_IV_LENGTH);
        this.baseIv.copy(iv, 0, 0, 8);
        iv.writeUInt32BE(counter, 8);
        return iv;
    }
    encrypt(plaintext, aad) {
        const iv = this.makeIv(++this.sendNonceCounter);
        const cipher = crypto.createCipheriv("aes-256-gcm", this.sendKey, iv);
        if (aad && aad.length > 0) {
            cipher.setAAD(aad);
        }
        const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
        const tag = cipher.getAuthTag();
        return Buffer.concat([tag, encrypted]);
    }
    async encryptAsync(plaintext, aad) {
        if (plaintext.length >= 64 * 1024 && crypto.webcrypto?.subtle) {
            try {
                const iv = this.makeIv(++this.sendNonceCounter);
                const key = await crypto.webcrypto.subtle.importKey("raw", this.sendKey, { name: "AES-GCM" }, false, ["encrypt"]);
                const algorithm = { name: "AES-GCM", iv, tagLength: 128 };
                if (aad && aad.length > 0) {
                    algorithm.additionalData = aad;
                }
                const encryptedBuf = await crypto.webcrypto.subtle.encrypt(algorithm, key, plaintext);
                const full = Buffer.from(encryptedBuf);
                const ciphertext = full.subarray(0, full.length - GCM_TAG_LENGTH);
                const tag = full.subarray(full.length - GCM_TAG_LENGTH);
                return Buffer.concat([tag, ciphertext]);
            }
            catch {
            }
        }
        return this.encrypt(plaintext, aad);
    }
    decrypt(payload, aad) {
        if (payload.length < GCM_TAG_LENGTH) {
            throw new Error("Payload too short to contain AES-GCM authentication tag");
        }
        const tag = payload.subarray(0, GCM_TAG_LENGTH);
        const ciphertext = payload.subarray(GCM_TAG_LENGTH);
        const iv = this.makeIv(++this.recvNonceCounter);
        const decipher = crypto.createDecipheriv("aes-256-gcm", this.recvKey, iv);
        if (aad && aad.length > 0) {
            decipher.setAAD(aad);
        }
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    }
    async decryptAsync(payload, aad) {
        if (payload.length < GCM_TAG_LENGTH) {
            throw new Error("Payload too short to contain AES-GCM authentication tag");
        }
        if (payload.length >= 64 * 1024 && crypto.webcrypto?.subtle) {
            try {
                const tag = payload.subarray(0, GCM_TAG_LENGTH);
                const ciphertext = payload.subarray(GCM_TAG_LENGTH);
                const iv = this.makeIv(++this.recvNonceCounter);
                const key = await crypto.webcrypto.subtle.importKey("raw", this.recvKey, { name: "AES-GCM" }, false, ["decrypt"]);
                const algorithm = { name: "AES-GCM", iv, tagLength: 128 };
                if (aad && aad.length > 0) {
                    algorithm.additionalData = aad;
                }
                const webCryptoPayload = Buffer.concat([ciphertext, tag]);
                const decryptedBuf = await crypto.webcrypto.subtle.decrypt(algorithm, key, webCryptoPayload);
                return Buffer.from(decryptedBuf);
            }
            catch {
            }
        }
        return this.decrypt(payload, aad);
    }
}
export function generateEcdhKeyPair() {
    const ecdh = crypto.createECDH(ECDH_CURVE);
    const publicKey = ecdh.generateKeys();
    return { ecdh, publicKey };
}
export function computeSharedSecret(ecdh, remotePublicKey) {
    return ecdh.computeSecret(remotePublicKey);
}
export function generateIdentityKeyPair() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
    const rawPublicKey = publicKey.export({ type: "spki", format: "der" });
    const rawPrivateKey = privateKey.export({ type: "pkcs8", format: "der" });
    return {
        publicKey: rawPublicKey,
        privateKey: rawPrivateKey,
        publicKeyHex: rawPublicKey.toString("hex")
    };
}
export function signPayload(privateKeyDer, data) {
    const key = crypto.createPrivateKey({ key: privateKeyDer, format: "der", type: "pkcs8" });
    return crypto.sign(null, data, key);
}
export function verifySignature(publicKeyDer, data, signature) {
    try {
        const key = crypto.createPublicKey({ key: publicKeyDer, format: "der", type: "spki" });
        return crypto.verify(null, data, key, signature);
    }
    catch {
        return false;
    }
}
export function computeHandshakeProof(key, data) {
    return crypto.createHmac("sha256", key).update(data).digest();
}
export function verifyHandshakeProof(key, data, expectedProof) {
    try {
        const actual = computeHandshakeProof(key, data);
        if (actual.length !== expectedProof.length)
            return false;
        return crypto.timingSafeEqual(actual, expectedProof);
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=crypto.js.map