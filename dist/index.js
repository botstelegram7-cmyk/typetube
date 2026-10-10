import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import http from "node:http";
import { spawn } from "node:child_process";
import { TapClient } from "./tap/client.js";
import { TapOrigin } from "./tap/protocol.js";
import { decodeTrackResult, decodeSearchResults } from "./protocol.js";
export class TypeTubeError extends Error {
    statusCode;
    constructor(message, statusCode) {
        super(message);
        this.name = "TypeTubeError";
        this.statusCode = statusCode;
    }
}
export class TypeTube {
    tapClient;
    apiCallsCount = 0;
    constructor(optionsOrApiKey) {
        let opts = {};
        if (typeof optionsOrApiKey === "string") {
            opts = { apiKey: optionsOrApiKey };
        }
        else if (typeof optionsOrApiKey === "object" && optionsOrApiKey !== null) {
            opts = optionsOrApiKey;
        }
        let target = opts.host || opts.server || opts.url || "sg.clusters.typetube.xyz";
        const authKey = opts.apiKey || opts.token || undefined;
        this.tapClient = new TapClient({
            url: target,
            port: opts.port,
            authKey,
            origin: TapOrigin.TYPETUBE_TS,
            encrypted: opts.encrypted,
            serverIdentityKey: opts.serverIdentityKey,
            timeoutMs: opts.timeoutMs ?? 15000,
            autoRetry: true
        });
    }
    async resolve(queryOrUrl, options = {}) {
        this.apiCallsCount++;
        const rawPayload = Buffer.from(queryOrUrl.trim(), "utf8");
        const resBuffer = await this.tapClient.invoke("resolve", rawPayload);
        const envelope = decodeTrackResult(new Uint8Array(resBuffer));
        if (!envelope.success) {
            const err = envelope.error || { message: "Failed to resolve track", code: "UNKNOWN_ERROR" };
            throw new TypeTubeError(`[TypeTube Error ${err.code || 500}]: ${err.message}`, 500);
        }
        const data = envelope.data || {};
        const result = {
            success: true,
            query: data.query || data.id,
            id: data.id,
            title: data.title,
            author: data.author,
            uploader: data.uploader || data.author,
            artistAvatar: data.artistAvatar,
            durationSeconds: data.durationSeconds || 0,
            thumbnail: data.thumbnail,
            thumbnails: data.thumbnails || [],
            latencyMs: envelope.meta?.latencyMs ?? 0,
            meta: envelope.meta,
            bestAudio: data.bestAudio,
            bestVideo: data.bestVideo,
            audioStreams: data.audioStreams || [],
            videoStreams: data.videoStreams || []
        };
        if (options.maxVideoHeight && result.bestVideo) {
            result.bestVideo = this.filterVideoByHeight(result.videoStreams, options.maxVideoHeight) || result.bestVideo;
        }
        return result;
    }
    async search(query, options = {}) {
        this.apiCallsCount++;
        const payload = Buffer.from(JSON.stringify({
            q: query.trim(),
            limit: options.limit ?? 10
        }), "utf8");
        const resBuffer = await this.tapClient.invoke("search", payload);
        const envelope = decodeSearchResults(new Uint8Array(resBuffer));
        if (!envelope.success) {
            const err = envelope.error || { message: "Search failed", code: "SEARCH_ERROR" };
            throw new TypeTubeError(`[TypeTube Error ${err.code || 500}]: ${err.message}`, 500);
        }
        return envelope.data || [];
    }
    async ping() {
        return await this.tapClient.ping();
    }
    coerceTrack(input) {
        if (!input || typeof input === "string")
            return null;
        if ("rawTrack" in input && input.rawTrack && typeof input.rawTrack === "object") {
            return input.rawTrack;
        }
        if ("track" in input && input.track && typeof input.track === "object") {
            return input.track;
        }
        if ("audioStreams" in input && Array.isArray(input.audioStreams)) {
            return input;
        }
        return null;
    }
    isStreamExpired(url, marginSeconds = 30) {
        if (!url)
            return true;
        try {
            const parsed = new URL(url);
            const expireParam = parsed.searchParams.get("expire");
            if (!expireParam)
                return false;
            const expireTimestamp = parseInt(expireParam, 10);
            if (isNaN(expireTimestamp))
                return false;
            const now = Math.floor(Date.now() / 1000);
            return now >= expireTimestamp - marginSeconds;
        }
        catch {
            return false;
        }
    }
    async ensureFreshTrack(target, options = {}) {
        const coerced = this.coerceTrack(target);
        if (!coerced) {
            return await this.resolve(target, options);
        }
        const sampleUrl = coerced.bestAudio?.url || coerced.audioStreams?.[0]?.url || coerced.bestVideo?.url || coerced.videoStreams?.[0]?.url;
        if (this.isStreamExpired(sampleUrl)) {
            const query = coerced.id ? `https://www.youtube.com/watch?v=${coerced.id}` : (coerced.title || coerced.query);
            if (query) {
                return await this.resolve(query, options);
            }
        }
        return coerced;
    }
    async getAudioStreamUrl(target) {
        const track = await this.ensureFreshTrack(target);
        const selected = this.selectAudioStream(track.audioStreams, track.bestAudio);
        if (!selected?.url) {
            throw new TypeTubeError(`No audio stream found for "${typeof target === "string" ? target : track.title}"`);
        }
        return selected.url;
    }
    async getVideoStreamUrl(target, maxHeight) {
        const track = await this.ensureFreshTrack(target, { maxVideoHeight: maxHeight });
        const selected = maxHeight ? (this.filterVideoByHeight(track.videoStreams, maxHeight) || track.bestVideo) : track.bestVideo;
        if (!selected?.url) {
            throw new TypeTubeError(`No video stream found for "${typeof target === "string" ? target : track.title}"`);
        }
        return selected.url;
    }
    async getPlayback(target, options = {}) {
        const track = await this.ensureFreshTrack(target, { timeoutMs: options.timeoutMs, maxVideoHeight: options.maxVideoHeight });
        const audioStream = this.selectAudioStream(track.audioStreams, track.bestAudio, options.audioQuality);
        const videoStream = this.selectVideoStream(track.videoStreams, track.bestVideo, options.quality, options.preferCodec);
        return {
            id: track.id,
            title: track.title,
            artist: track.author,
            author: track.author,
            duration: track.durationSeconds,
            durationSeconds: track.durationSeconds,
            thumbnail: track.thumbnail,
            thumbnails: track.thumbnails,
            audioUrl: audioStream?.url,
            videoUrl: videoStream?.url,
            audioStream,
            videoStream,
            track
        };
    }
    async getMediaUrls(target, options = {}) {
        return this.getPlayback(target, options);
    }
    async downloadAudio(target, destPathOrOptions, options) {
        const destPath = typeof destPathOrOptions === "string" ? destPathOrOptions : "./downloads";
        const opts = typeof destPathOrOptions === "object" ? destPathOrOptions : (options || {});
        let track = await this.ensureFreshTrack(target, { timeoutMs: opts.timeoutMs });
        let stream = this.selectAudioStream(track.audioStreams, track.bestAudio, opts.audioQuality);
        if (!stream?.url) {
            throw new TypeTubeError("No playable audio stream found for download");
        }
        const finalDest = this.resolveDestination(destPath, track, "m4a");
        this.ensureDirectory(finalDest);
        const t0 = performance.now();
        const doDownload = async (url) => {
            return await this.downloadStreamToFile(url, finalDest, (p) => {
                if (opts.onProgress) {
                    opts.onProgress({
                        ...p,
                        phase: "downloading"
                    });
                }
            }, 5, opts.chunkSizeBytes, opts.workers);
        };
        let dl;
        try {
            dl = await doDownload(stream.url);
        }
        catch (err) {
            if (err instanceof TypeTubeError && (err.statusCode === 403 || err.statusCode === 410)) {
                const query = track.id ? `https://www.youtube.com/watch?v=${track.id}` : (track.title || track.query);
                track = await this.resolve(query, { timeoutMs: opts.timeoutMs });
                stream = this.selectAudioStream(track.audioStreams, track.bestAudio, opts.audioQuality);
                if (!stream?.url) {
                    throw new TypeTubeError("No playable audio stream found on refreshed track");
                }
                dl = await doDownload(stream.url);
            }
            else {
                throw err;
            }
        }
        const durationSec = +((performance.now() - t0) / 1000).toFixed(2);
        const speedMBps = durationSec > 0 ? +((dl.bytes / (1024 * 1024)) / durationSec).toFixed(2) : 0;
        const stat = fs.statSync(finalDest);
        const fileSizeMB = +((stat.size / (1024 * 1024)).toFixed(2));
        const fileName = path.basename(finalDest);
        return {
            success: true,
            filePath: finalDest,
            fileName,
            sizeBytes: stat.size,
            fileSizeMB,
            durationSec,
            speedMBps,
            id: track.id,
            title: track.title,
            artist: track.author,
            author: track.author,
            duration: track.durationSeconds,
            durationSeconds: track.durationSeconds,
            thumbnail: track.thumbnail,
            thumbnails: track.thumbnails,
            track,
            stream,
            audioStream: stream
        };
    }
    async downloadVideo(target, destPathOrOptions, options) {
        const destPath = typeof destPathOrOptions === "string" ? destPathOrOptions : "./downloads";
        const opts = typeof destPathOrOptions === "object" ? destPathOrOptions : (options || {});
        let track = await this.ensureFreshTrack(target, { timeoutMs: opts.timeoutMs });
        let stream = this.selectVideoStream(track.videoStreams, track.bestVideo, opts.quality, opts.preferCodec);
        if (!stream?.url) {
            throw new TypeTubeError("No playable video stream found for download");
        }
        const finalDest = this.resolveDestination(destPath, track, "mp4");
        this.ensureDirectory(finalDest);
        const t0 = performance.now();
        const doDownload = async (url) => {
            return await this.downloadStreamToFile(url, finalDest, (p) => {
                if (opts.onProgress) {
                    opts.onProgress({
                        ...p,
                        phase: "downloading"
                    });
                }
            }, 5, opts.chunkSizeBytes, opts.workers);
        };
        let dl;
        try {
            dl = await doDownload(stream.url);
        }
        catch (err) {
            if (err instanceof TypeTubeError && (err.statusCode === 403 || err.statusCode === 410)) {
                const query = track.id ? `https://www.youtube.com/watch?v=${track.id}` : (track.title || track.query);
                track = await this.resolve(query, { timeoutMs: opts.timeoutMs });
                stream = this.selectVideoStream(track.videoStreams, track.bestVideo, opts.quality, opts.preferCodec);
                if (!stream?.url) {
                    throw new TypeTubeError("No playable video stream found on refreshed track");
                }
                dl = await doDownload(stream.url);
            }
            else {
                throw err;
            }
        }
        const durationSec = +((performance.now() - t0) / 1000).toFixed(2);
        const speedMBps = durationSec > 0 ? +((dl.bytes / (1024 * 1024)) / durationSec).toFixed(2) : 0;
        const stat = fs.statSync(finalDest);
        const fileSizeMB = +((stat.size / (1024 * 1024)).toFixed(2));
        const fileName = path.basename(finalDest);
        const dims = stream.resolution ? stream.resolution.split("x").map((x) => parseInt(x, 10)) : [];
        return {
            success: true,
            filePath: finalDest,
            fileName,
            sizeBytes: stat.size,
            fileSizeMB,
            durationSec,
            speedMBps,
            id: track.id,
            title: track.title,
            artist: track.author,
            author: track.author,
            duration: track.durationSeconds,
            durationSeconds: track.durationSeconds,
            thumbnail: track.thumbnail,
            thumbnails: track.thumbnails,
            track,
            stream,
            videoStream: stream,
            width: dims[0],
            height: dims[1]
        };
    }
    async downloadMedia(target, destPathOrOptions, options) {
        const destPath = typeof destPathOrOptions === "string" ? destPathOrOptions : "./downloads";
        const opts = typeof destPathOrOptions === "object" ? destPathOrOptions : (options || {});
        let track = await this.ensureFreshTrack(target, { timeoutMs: opts.timeoutMs });
        let vStream = this.selectVideoStream(track.videoStreams, track.bestVideo, opts.quality, opts.preferCodec);
        let aStream = this.selectAudioStream(track.audioStreams, track.bestAudio, opts.audioQuality);
        if (!vStream?.url) {
            throw new TypeTubeError("No playable video stream found for media download");
        }
        if (!aStream?.url) {
            throw new TypeTubeError("No playable audio stream found for media download");
        }
        const ext = opts.outputFormat || "mp4";
        const finalDest = this.resolveDestination(destPath, track, ext);
        this.ensureDirectory(finalDest);
        const tempV = `${finalDest}.tmp.${Date.now()}.v`;
        const tempA = `${finalDest}.tmp.${Date.now()}.a`;
        let vBytes = 0;
        let vTotal = 0;
        let aBytes = 0;
        let aTotal = 0;
        const notifyCombinedProgress = () => {
            if (!opts.onProgress)
                return;
            const totalDownloaded = vBytes + aBytes;
            const totalBytes = (vTotal > 0 && aTotal > 0) ? (vTotal + aTotal) : 0;
            const pct = totalBytes > 0 ? +((totalDownloaded / totalBytes) * 100).toFixed(1) : 0;
            opts.onProgress({
                percent: pct,
                downloadedBytes: totalDownloaded,
                totalBytes,
                speedMBps: 0,
                phase: "downloading"
            });
        };
        const doDownloadParallel = async (videoUrl, audioUrl) => {
            const vWorkers = opts.videoWorkers ?? opts.workers;
            const vChunk = opts.videoChunkSizeBytes ?? opts.chunkSizeBytes;
            const aWorkers = opts.audioWorkers ?? opts.workers;
            const aChunk = opts.audioChunkSizeBytes ?? opts.chunkSizeBytes;
            await Promise.all([
                this.downloadStreamToFile(videoUrl, tempV, (p) => {
                    vBytes = p.downloadedBytes;
                    vTotal = p.totalBytes;
                    notifyCombinedProgress();
                }, 5, vChunk, vWorkers),
                this.downloadStreamToFile(audioUrl, tempA, (p) => {
                    aBytes = p.downloadedBytes;
                    aTotal = p.totalBytes;
                    notifyCombinedProgress();
                }, 5, aChunk, aWorkers)
            ]);
        };
        const t0 = performance.now();
        try {
            try {
                await doDownloadParallel(vStream.url, aStream.url);
            }
            catch (err) {
                if (err instanceof TypeTubeError && (err.statusCode === 403 || err.statusCode === 410)) {
                    if (fs.existsSync(tempV))
                        fs.unlinkSync(tempV);
                    if (fs.existsSync(tempA))
                        fs.unlinkSync(tempA);
                    vBytes = 0;
                    aBytes = 0;
                    const query = track.id ? `https://www.youtube.com/watch?v=${track.id}` : (track.title || track.query);
                    track = await this.resolve(query, { timeoutMs: opts.timeoutMs });
                    vStream = this.selectVideoStream(track.videoStreams, track.bestVideo, opts.quality, opts.preferCodec);
                    aStream = this.selectAudioStream(track.audioStreams, track.bestAudio, opts.audioQuality);
                    if (!vStream?.url || !aStream?.url) {
                        throw new TypeTubeError("Missing playable streams on refreshed track");
                    }
                    await doDownloadParallel(vStream.url, aStream.url);
                }
                else {
                    throw err;
                }
            }
            if (opts.onProgress) {
                opts.onProgress({
                    percent: 100,
                    downloadedBytes: vBytes + aBytes,
                    totalBytes: vTotal + aTotal,
                    speedMBps: 0,
                    phase: "muxing"
                });
            }
            const tMuxStart = performance.now();
            await this.muxStreamsWithFfmpeg(tempV, tempA, finalDest, opts.ffmpegPath);
            const muxTimeSec = +((performance.now() - tMuxStart) / 1000).toFixed(2);
            const totalDurationSec = +((performance.now() - t0) / 1000).toFixed(2);
            const stat = fs.statSync(finalDest);
            const fileSizeMB = +((stat.size / (1024 * 1024)).toFixed(2));
            const fileName = path.basename(finalDest);
            const speedMBps = totalDurationSec > 0 ? +((stat.size / (1024 * 1024)) / totalDurationSec).toFixed(2) : 0;
            const dims = vStream.resolution ? vStream.resolution.split("x").map((x) => parseInt(x, 10)) : [];
            if (opts.onProgress) {
                opts.onProgress({
                    percent: 100,
                    downloadedBytes: stat.size,
                    totalBytes: stat.size,
                    speedMBps,
                    phase: "complete"
                });
            }
            return {
                success: true,
                filePath: finalDest,
                fileName,
                sizeBytes: stat.size,
                fileSizeMB,
                durationSec: totalDurationSec,
                speedMBps,
                id: track.id,
                title: track.title,
                artist: track.author,
                author: track.author,
                duration: track.durationSeconds,
                durationSeconds: track.durationSeconds,
                thumbnail: track.thumbnail,
                thumbnails: track.thumbnails,
                track,
                videoStream: vStream,
                audioStream: aStream,
                muxTimeSec,
                width: dims[0],
                height: dims[1]
            };
        }
        finally {
            if (fs.existsSync(tempV))
                fs.unlinkSync(tempV);
            if (fs.existsSync(tempA))
                fs.unlinkSync(tempA);
        }
    }
    resolveDestination(destPath, track, ext) {
        const target = destPath.trim();
        const hasExt = !!path.extname(target);
        const isDir = !hasExt || (fs.existsSync(target) && fs.statSync(target).isDirectory()) || target.endsWith("/") || target.endsWith("\\");
        if (isDir) {
            const author = (track.author || "").trim();
            const title = (track.title || track.id).trim();
            const name = author && !title.toLowerCase().startsWith(author.toLowerCase()) ? `${author} - ${title}` : title;
            const safeName = name.replace(/[\\/:*?"<>|]/g, "_").slice(0, 120);
            return path.join(target, `${safeName}.${ext}`);
        }
        return target;
    }
    selectAudioStream(streams, best, preference) {
        if (!Array.isArray(streams) || streams.length === 0)
            return best;
        const nonGcr = streams.filter((s) => !s.url.includes("gcr="));
        const pool = nonGcr.length > 0 ? nonGcr : streams;
        if (preference === "hifi" || preference === "256kbps") {
            const hifi = pool.find((s) => s.itag === 141 || s.itag === 774);
            if (hifi)
                return hifi;
        }
        if (preference === "128kbps") {
            const std = pool.find((s) => s.itag === 140 || s.itag === 251);
            if (std)
                return std;
        }
        if (preference === "lowest") {
            return [...pool].sort((a, b) => (a.bitrate || 0) - (b.bitrate || 0))[0];
        }
        return pool[0] || best;
    }
    selectVideoStream(streams, best, qualityPreference, codecPreference) {
        if (!Array.isArray(streams) || streams.length === 0)
            return best;
        let pool = [...streams];
        if (codecPreference && codecPreference !== "any") {
            const filtered = pool.filter((s) => s.mimeType.toLowerCase().includes(codecPreference.toLowerCase()));
            if (filtered.length > 0)
                pool = filtered;
        }
        const parseHeight = (q) => {
            const m = (q || "").match(/^(\d+)p/);
            return m ? parseInt(m[1], 10) : (parseInt(q, 10) || 0);
        };
        if (qualityPreference && qualityPreference !== "highest" && qualityPreference !== "lowest") {
            const targetHeight = parseHeight(qualityPreference);
            if (targetHeight > 0) {
                const exact = pool.find((s) => parseHeight(s.quality) === targetHeight);
                if (exact)
                    return exact;
                const lowerOrEqual = pool.filter((s) => parseHeight(s.quality) <= targetHeight);
                if (lowerOrEqual.length > 0)
                    return lowerOrEqual[0];
            }
        }
        if (qualityPreference === "lowest") {
            return [...pool].sort((a, b) => parseHeight(a.quality) - parseHeight(b.quality))[0];
        }
        return pool[0] || best;
    }
    filterVideoByHeight(streams, maxHeight) {
        if (!Array.isArray(streams) || streams.length === 0)
            return null;
        const parseHeight = (q) => {
            const m = (q || "").match(/^(\d+)p/);
            return m ? parseInt(m[1], 10) : (parseInt(q, 10) || 0);
        };
        const candidates = streams.filter((v) => {
            const h = parseHeight(v.quality);
            return isNaN(h) || h <= maxHeight;
        });
        return candidates[0] || streams[0] || null;
    }
    ensureDirectory(targetFile) {
        const dir = path.dirname(targetFile);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }
    getIpFamily(url) {
        try {
            const parsed = new URL(url);
            const ipParam = parsed.searchParams.get("ip") || "";
            if (ipParam.includes(":"))
                return 6;
            return 4;
        }
        catch {
            return 4;
        }
    }
    async downloadStreamToFile(url, destPath, onProgress, maxRedirects = 5, chunkSizeBytes, workersCount) {
        const family = this.getIpFamily(url);
        try {
            const probeTotal = await new Promise((resolve, reject) => {
                const parsed = new URL(url);
                const transport = parsed.protocol === "http:" ? http : https;
                const req = transport.request(url, {
                    method: "GET",
                    family,
                    headers: {
                        "Range": "bytes=0-0",
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
                    }
                }, (res) => {
                    res.resume();
                    if (res.statusCode === 403) {
                        return reject(new TypeTubeError("Stream download forbidden (HTTP 403). This track may be restricted to the cluster's region, blocking foreign requests. Try connecting to a different cluster (e.g. tap://nl.clusters.typetube.xyz or tap://sg.clusters.typetube.xyz).", 403));
                    }
                    const cr = res.headers["content-range"];
                    if (res.statusCode === 206 && cr) {
                        const total = parseInt(String(cr).split("/")[1] || "0", 10);
                        if (total > 0)
                            return resolve(total);
                    }
                    resolve(null);
                });
                req.on("error", () => resolve(null));
                req.setTimeout(5000, () => { req.destroy(); resolve(null); });
                req.end();
            });
            if (probeTotal && probeTotal > 0) {
                return await this.downloadChunkedRange(url, destPath, probeTotal, onProgress, chunkSizeBytes, workersCount);
            }
        }
        catch (err) {
            if (err instanceof TypeTubeError && err.statusCode === 403) {
                throw err;
            }
        }
        return this.downloadLinearStream(url, destPath, onProgress, maxRedirects);
    }
    async downloadChunkedRange(url, destPath, totalBytes, onProgress, chunkSizeBytes, workersCount) {
        const CHUNK_SIZE = Math.max(512 * 1024, chunkSizeBytes || (10 * 1024 * 1024));
        const NUM_WORKERS = Math.max(1, Math.min(32, workersCount || 4));
        const family = this.getIpFamily(url);
        const chunks = [];
        for (let start = 0; start < totalBytes; start += CHUNK_SIZE) {
            const end = Math.min(start + CHUNK_SIZE - 1, totalBytes - 1);
            chunks.push({ start, end });
        }
        const fd = fs.openSync(destPath, "w");
        const t0 = performance.now();
        let downloaded = 0;
        const queue = [...chunks];
        const fetchChunk = (start, end) => {
            return new Promise((resolve, reject) => {
                const parsed = new URL(url);
                const transport = parsed.protocol === "http:" ? http : https;
                const req = transport.get(url, {
                    family,
                    headers: {
                        "Range": `bytes=${start}-${end}`,
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
                    }
                }, (res) => {
                    if (res.statusCode === 403) {
                        res.resume();
                        return reject(new TypeTubeError("Stream download forbidden (HTTP 403). This track may be restricted to the cluster's region, blocking foreign requests. Try connecting to a different cluster (e.g. tap://nl.clusters.typetube.xyz or tap://sg.clusters.typetube.xyz).", 403));
                    }
                    if (res.statusCode !== 200 && res.statusCode !== 206) {
                        res.resume();
                        return reject(new TypeTubeError(`Range chunk download failed with status ${res.statusCode}`, res.statusCode));
                    }
                    const data = [];
                    res.on("data", (c) => data.push(c));
                    res.on("end", () => resolve(Buffer.concat(data)));
                });
                req.on("error", reject);
                req.setTimeout(60000, () => {
                    req.destroy();
                    reject(new TypeTubeError("Chunk download timed out", 408));
                });
            });
        };
        const worker = async () => {
            while (queue.length > 0) {
                const item = queue.shift();
                if (!item)
                    break;
                const buf = await fetchChunk(item.start, item.end);
                fs.writeSync(fd, buf, 0, buf.length, item.start);
                downloaded += buf.length;
                if (onProgress) {
                    const sec = (performance.now() - t0) / 1000;
                    const speedMBps = sec > 0 ? +((downloaded / (1024 * 1024)) / sec).toFixed(2) : 0;
                    const pct = +((downloaded / totalBytes) * 100).toFixed(1);
                    onProgress({
                        downloadedBytes: downloaded,
                        totalBytes,
                        speedMBps,
                        percent: pct
                    });
                }
            }
        };
        try {
            const workers = Array.from({ length: NUM_WORKERS }, () => worker());
            await Promise.all(workers);
            return { bytes: downloaded };
        }
        finally {
            fs.closeSync(fd);
        }
    }
    downloadLinearStream(url, destPath, onProgress, maxRedirects = 5) {
        return new Promise((resolve, reject) => {
            const file = fs.createWriteStream(destPath);
            const t0 = performance.now();
            const fetchUrl = (currentUrl, redirectsLeft) => {
                const family = this.getIpFamily(currentUrl);
                const transport = currentUrl.startsWith("https:") ? https : http;
                const req = transport.get(currentUrl, {
                    family,
                    headers: {
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
                        "Range": "bytes=0-"
                    }
                }, (res) => {
                    if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                        if (redirectsLeft <= 0) {
                            file.close();
                            fs.unlink(destPath, () => { });
                            return reject(new TypeTubeError("Too many redirects during stream download"));
                        }
                        const nextUrl = new URL(res.headers.location, currentUrl).toString();
                        return fetchUrl(nextUrl, redirectsLeft - 1);
                    }
                    if (res.statusCode === 403) {
                        file.close();
                        fs.unlink(destPath, () => { });
                        return reject(new TypeTubeError("Stream download forbidden (HTTP 403). This track may be restricted to the cluster's region, blocking foreign requests. Try connecting to a different cluster (e.g. tap://nl.clusters.typetube.xyz or tap://sg.clusters.typetube.xyz).", 403));
                    }
                    if (res.statusCode !== 200 && res.statusCode !== 206) {
                        file.close();
                        fs.unlink(destPath, () => { });
                        return reject(new TypeTubeError(`Download stream failed with status ${res.statusCode}`, res.statusCode));
                    }
                    const totalBytes = parseInt(res.headers["content-length"] || "0", 10) || 0;
                    let downloaded = 0;
                    res.on("data", (chunk) => {
                        downloaded += chunk.length;
                        if (onProgress) {
                            const sec = (performance.now() - t0) / 1000;
                            const speedMBps = sec > 0 ? +((downloaded / (1024 * 1024)) / sec).toFixed(2) : 0;
                            const pct = totalBytes > 0 ? +((downloaded / totalBytes) * 100).toFixed(1) : 0;
                            onProgress({
                                downloadedBytes: downloaded,
                                totalBytes,
                                speedMBps,
                                percent: pct
                            });
                        }
                    });
                    res.pipe(file);
                    file.on("finish", () => {
                        file.close(() => resolve({ bytes: downloaded }));
                    });
                });
                req.on("error", (err) => {
                    file.close();
                    fs.unlink(destPath, () => { });
                    reject(new TypeTubeError(err.message || "Network error while downloading stream"));
                });
                req.setTimeout(60000, () => {
                    req.destroy();
                    file.close();
                    fs.unlink(destPath, () => { });
                    reject(new TypeTubeError("Stream download timed out after 60s", 408));
                });
            };
            fetchUrl(url, maxRedirects);
        });
    }
    muxStreamsWithFfmpeg(videoPath, audioPath, outputPath, ffmpegBin = "ffmpeg") {
        return new Promise((resolve, reject) => {
            const args = [
                "-y",
                "-i", videoPath,
                "-i", audioPath,
                "-c:v", "copy",
                "-c:a", "copy",
                "-movflags", "+faststart",
                outputPath
            ];
            const proc = spawn(ffmpegBin, args, { stdio: ["ignore", "ignore", "pipe"] });
            let stderr = "";
            proc.stderr.on("data", (d) => {
                stderr += d.toString();
            });
            proc.on("error", (err) => {
                reject(new TypeTubeError(`Failed to spawn ffmpeg: ${err.message}. Ensure ffmpeg is installed.`));
            });
            proc.on("close", (code) => {
                if (code === 0) {
                    resolve();
                }
                else {
                    reject(new TypeTubeError(`ffmpeg muxing failed with code ${code}: ${stderr.slice(-300)}`));
                }
            });
        });
    }
    close() {
        this.tapClient.close();
    }
}
export function createClient(optionsOrApiKey, options) {
    if (typeof optionsOrApiKey === "string") {
        return new TypeTube({ apiKey: optionsOrApiKey, ...options });
    }
    return new TypeTube(optionsOrApiKey || options);
}
export const TypeTubeClient = TypeTube;
export * from "./types.js";
export * from "./protocol.js";
export * from "./tap/index.js";
export default TypeTube;
//# sourceMappingURL=index.js.map