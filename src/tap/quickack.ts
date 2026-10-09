import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
let nativeSetQuickAck: ((fd: number) => boolean) | null = null;
const candidatePaths = [
    path.resolve(__dirname, "../native/quickack.node"),
    path.resolve(__dirname, "../../native/quickack.node"),
    path.resolve(__dirname, "./native/quickack.node")
];
for (const p of candidatePaths) {
    try {
        if (fs.existsSync(p)) {
            const addon = require(p);
            if (typeof addon.setQuickAck === "function") {
                nativeSetQuickAck = addon.setQuickAck;
                break;
            }
        }
    }
    catch {
    }
}
export function enableQuickAck(socket: any): boolean {
    if (!nativeSetQuickAck)
        return false;
    try {
        const fd = socket?._handle?.fd;
        if (typeof fd === "number" && fd > 0) {
            return nativeSetQuickAck(fd);
        }
    }
    catch {
    }
    return false;
}
