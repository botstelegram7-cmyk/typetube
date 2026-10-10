import zlib from "node:zlib";
import { promisify } from "node:util";
import { MAX_PAYLOAD_SIZE } from "./protocol.js";
export const COMPRESSION_MIN_BYTES = 1024;
export const MAX_DECOMPRESSED_SIZE = 16 * MAX_PAYLOAD_SIZE;
const zstdCompressAsync = promisify(zlib.zstdCompress);
const brotliCompressAsync = promisify(zlib.brotliCompress);
export async function compressPayload(payload) {
    if (payload.length < COMPRESSION_MIN_BYTES)
        return null;
    try {
        const out = await zstdCompressAsync(payload, {
            params: {
                [zlib.constants.ZSTD_c_compressionLevel]: 1
            }
        });
        if (out.length < payload.length) {
            return out;
        }
    }
    catch {
        const out = await brotliCompressAsync(payload, {
            params: {
                [zlib.constants.BROTLI_PARAM_QUALITY]: 5,
                [zlib.constants.BROTLI_PARAM_SIZE_HINT]: payload.length
            }
        });
        if (out.length < payload.length) {
            return out;
        }
    }
    return null;
}
export function decompressPayload(payload) {
    try {
        return zlib.zstdDecompressSync(payload, { maxOutputLength: MAX_DECOMPRESSED_SIZE });
    }
    catch {
        return zlib.brotliDecompressSync(payload, { maxOutputLength: MAX_DECOMPRESSED_SIZE });
    }
}
//# sourceMappingURL=compression.js.map