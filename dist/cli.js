#!/usr/bin/env node
import readline from "node:readline";
import { TypeTube } from "./index.js";
function formatDuration(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? "0" : ""}${s}`;
}
function parseInputArgs(line) {
    const match = line.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g);
    if (!match)
        return [];
    return match.map((s) => s.replace(/^["']|["']$/g, ""));
}
function parseCommandOptions(tokens) {
    const opts = {
        isVideo: false,
        videoOnly: false,
        audioOnly: false,
        dumpJson: false,
        getUrl: false,
        getTitle: false,
        getId: false,
        getThumb: false,
        simulate: false
    };
    const positional = [];
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (t === "-v" || t === "--video") {
            opts.isVideo = true;
        }
        else if (t === "--video-only") {
            opts.videoOnly = true;
        }
        else if (t === "-x" || t === "--audio-only" || t === "--extract-audio") {
            opts.audioOnly = true;
        }
        else if (t === "-j" || t === "--json" || t === "--dump-json") {
            opts.dumpJson = true;
        }
        else if (t === "-s" || t === "--simulate") {
            opts.simulate = true;
        }
        else if (t === "-g" || t === "--get-url") {
            opts.getUrl = true;
        }
        else if (t === "-e" || t === "--get-title") {
            opts.getTitle = true;
        }
        else if (t === "--get-id") {
            opts.getId = true;
        }
        else if (t === "--get-thumbnail") {
            opts.getThumb = true;
        }
        else if ((t === "-f" || t === "--format" || t === "--quality") && i + 1 < tokens.length) {
            opts.format = tokens[++i];
        }
        else if ((t === "-a" || t === "--audio-quality" || t === "--aq") && i + 1 < tokens.length) {
            opts.audioQuality = tokens[++i];
        }
        else if ((t === "-c" || t === "--codec") && i + 1 < tokens.length) {
            opts.codec = tokens[++i];
        }
        else if ((t === "-o" || t === "--output") && i + 1 < tokens.length) {
            opts.output = tokens[++i];
        }
        else if ((t === "--ext" || t === "--output-format") && i + 1 < tokens.length) {
            opts.outputFormat = tokens[++i];
        }
        else if ((t === "-N" || t === "--workers") && i + 1 < tokens.length) {
            opts.workers = parseInt(tokens[++i], 10);
        }
        else if ((t === "--chunk-size") && i + 1 < tokens.length) {
            opts.chunkSizeMB = parseInt(tokens[++i], 10);
        }
        else if (t.startsWith("-")) {
        }
        else {
            positional.push(t);
        }
    }
    opts.query = positional[0];
    if (!opts.output && positional.length > 1) {
        opts.output = positional[1];
    }
    return opts;
}
async function runCli() {
    const apiKey = process.env.TYPETUBE_API_KEY;
    const host = process.env.TYPETUBE_HOST || process.env.TYPETUBE_SERVER || "tap://sg.clusters.typetube.xyz";
    const client = new TypeTube({ apiKey, host });
    async function executeTokens(tokens) {
        const cmd = (tokens[0] || "").toLowerCase();
        if (cmd === "exit" || cmd === "quit" || cmd === "q") {
            console.log("Closing TAP session. Goodbye!");
            client.close();
            process.exit(0);
        }
        if (cmd === "clear" || cmd === "cls") {
            console.clear();
            return;
        }
        if (cmd === "help" || cmd === "?" || tokens.length === 0) {
            console.log(`
Commands:
  <query|url> [options]              Resolve & download stream with custom flags
  resolve <query|url> [options]      Resolve and inspect stream metadata without downloading
  search <query> [limit] [-j]        Search YouTube tracks (default: 5 items)
  ping                               Measure live socket round-trip latency
  clear                              Clear terminal screen
  exit / quit                        Exit shell session

Download & Format Options:
  -v, --video                        Download muxed video (video + audio muxed to MP4)
  --video-only                       Download raw adaptive video stream without audio
  -x, --audio-only                   Download audio stream only (default behavior)
  -f, --format <quality>             Video resolution: 2160p, 1440p, 1080p, 720p, 480p, 360p, highest, lowest (default: 1080p)
  -a, --audio-quality <q>            Audio quality: highest, hifi, 256kbps, 128kbps, lowest (default: highest)
  -c, --codec <name>                 Preferred video codec: avc1 (H.264), vp9, av01 (AV1), any (default: avc1)
  --ext <mp4|mkv|webm>               Output muxing container format (default: mp4)
  -o, --output <path>                Output destination path or directory (default: ./downloads)
  -N, --workers <count>              Parallel range chunk workers (1-32, default: 4 for audio, 6 for video)
  --chunk-size <mb>                  Chunk size in MB for range streaming (default: 10)

Inspection & Query Flags:
  -s, --simulate                     Inspect track & print manifest without downloading
  -j, --json                         Output complete track data as clean JSON
  -g, --get-url                      Print direct Google CDN stream URL to stdout and exit
  -e, --get-title                    Print video title to stdout and exit
  --get-id                           Print video ID to stdout and exit
  --get-thumbnail                    Print thumbnail URL to stdout and exit

Examples:
  "coldplay yellow"
  "coldplay yellow" -v
  "despacito" -v -f 2160p -o ./4k-videos -N 8
  "shape of you" -a hifi -o ./lossless
  "bohemian rhapsody" -j
  https://www.youtube.com/watch?v=dQw4w9WgXcQ -g
  search "coldplay" 10
`);
            return;
        }
        if (cmd === "ping") {
            try {
                const rtt = await client.ping();
                console.log(`[TAP] Live Socket Round-Trip: ${rtt.toFixed(2)} ms`);
            }
            catch (err) {
                console.error(`[Error] Ping failed: ${err.message || err}`);
            }
            return;
        }
        if (cmd === "search") {
            const isJson = tokens.includes("-j") || tokens.includes("--json");
            const cleanArgs = tokens.filter(a => a !== "-j" && a !== "--json");
            const q = cleanArgs[1];
            const limit = parseInt(cleanArgs[2] || "5", 10) || 5;
            if (!q) {
                console.log("Usage: search <query> [limit] [-j]");
                return;
            }
            const t0 = performance.now();
            try {
                const results = await client.search(q, { limit });
                const wallclock = (performance.now() - t0).toFixed(1);
                if (isJson) {
                    console.log(JSON.stringify(results, null, 2));
                }
                else {
                    console.log(`\nSearch results for "${q}" (${results.length} items in ${wallclock}ms):\n`);
                    results.forEach((item, idx) => {
                        const num = String(idx + 1).padStart(2, " ");
                        const dur = item.durationSeconds ? ` [${formatDuration(item.durationSeconds)}]` : "";
                        const uploader = item.uploader ? ` - ${item.uploader}` : "";
                        console.log(`${num}. ${item.title}${uploader}${dur}`);
                        console.log(`    https://www.youtube.com/watch?v=${item.id}`);
                    });
                    console.log("");
                }
            }
            catch (err) {
                console.error(`[Search Error] ${err.message || err}`);
            }
            return;
        }
        const commandTokens = cmd === "resolve" || cmd === "download" || cmd === "dl" ? tokens.slice(1) : [...tokens];
        const opts = parseCommandOptions(commandTokens);
        const isExplicitResolve = cmd === "resolve";
        if (!opts.query) {
            return;
        }
        const t0 = performance.now();
        try {
            const track = await client.resolve(opts.query);
            const wallclock = (performance.now() - t0).toFixed(1);
            const delta = ((performance.now() - t0) - (track.meta?.tLatencyMS || 0)).toFixed(1);
            if (opts.getTitle) {
                console.log(track.title);
                return;
            }
            if (opts.getId) {
                console.log(track.id);
                return;
            }
            if (opts.getThumb) {
                console.log(track.thumbnail || "");
                return;
            }
            if (opts.getUrl) {
                const targetUrl = opts.isVideo ? (track.bestVideo?.url || track.videoStreams?.[0]?.url) : (track.bestAudio?.url || track.audioStreams?.[0]?.url);
                console.log(targetUrl || track.bestAudio?.url);
                return;
            }
            if (opts.dumpJson) {
                console.log(JSON.stringify(track, null, 2));
                return;
            }
            if (opts.simulate || isExplicitResolve) {
                console.log(`\n======================================================================`);
                console.log(`[RESOLVED] ${track.title}`);
                console.log(`======================================================================`);
                console.log(`ID:           ${track.id}`);
                console.log(`Duration:     ${formatDuration(track.durationSeconds)} (${track.durationSeconds}s)`);
                console.log(`Latency:      ${track.meta?.tLatencyMS || track.latencyMs}ms (network: +${delta}ms | total: ${wallclock}ms)`);
                console.log(`Audio Format: ${track.bestAudio?.mimeType || "audio/webm"} @ ${track.bestAudio?.bitrate ? Math.round(track.bestAudio.bitrate / 1000) : 160}kbps`);
                console.log(`Audio Stream: ${track.bestAudio?.url}`);
                if (track.bestVideo) {
                    console.log(`Video Top:    ${track.bestVideo.quality} (${track.bestVideo.mimeType})`);
                    console.log(`Video Stream: ${track.bestVideo.url}`);
                }
                console.log(`Thumb:        ${track.thumbnail}\n`);
                return;
            }
            const dest = opts.output || "./downloads";
            const workers = opts.workers || (opts.isVideo ? 6 : 4);
            const chunkSize = opts.chunkSizeMB ? opts.chunkSizeMB * 1024 * 1024 : 10 * 1024 * 1024;
            const videoQuality = opts.format || "1080p";
            const audioQuality = opts.audioQuality || "highest";
            const codec = opts.codec || "avc1";
            const outputFormat = opts.outputFormat || "mp4";
            const progressCallback = (p) => {
                const totalMb = p.totalBytes ? (p.totalBytes / (1024 * 1024)).toFixed(1) : "?";
                const speed = p.speedMBps ? `${p.speedMBps.toFixed(2)} MB/s` : "";
                const phase = p.phase ? `[${p.phase}] ` : "";
                process.stdout.write(`\r[download] ${phase}${p.percent}% of ~${totalMb}MB at ${speed}`.padEnd(65));
            };
            if (opts.videoOnly) {
                console.log(`Downloading raw video stream (${videoQuality}) for "${track.title}"...`);
                const res = await client.downloadVideo(track, dest, {
                    quality: videoQuality,
                    preferCodec: codec,
                    workers,
                    chunkSizeBytes: chunkSize,
                    onProgress: progressCallback
                });
                process.stdout.write("\n");
                console.log(`Completed: ${res.filePath} (${res.fileSizeMB} MB in ${res.durationSec}s)\n`);
            }
            else if (opts.isVideo) {
                console.log(`Downloading muxed video (${videoQuality} + ${audioQuality} audio) for "${track.title}"...`);
                const res = await client.downloadMedia(track, dest, {
                    quality: videoQuality,
                    audioQuality: audioQuality,
                    preferCodec: codec,
                    outputFormat,
                    workers,
                    chunkSizeBytes: chunkSize,
                    onProgress: progressCallback
                });
                process.stdout.write("\n");
                console.log(`Completed: ${res.filePath} (${res.fileSizeMB} MB in ${res.durationSec}s)`);
                if (res.muxTimeSec)
                    console.log(`  Muxed to ${outputFormat.toUpperCase()} in ${res.muxTimeSec}s\n`);
            }
            else {
                console.log(`Downloading audio (${audioQuality}) for "${track.title}"...`);
                const res = await client.downloadAudio(track, dest, {
                    audioQuality: audioQuality,
                    workers,
                    chunkSizeBytes: chunkSize,
                    onProgress: progressCallback
                });
                process.stdout.write("\n");
                console.log(`Completed: ${res.filePath} (${res.fileSizeMB} MB in ${res.durationSec}s)\n`);
            }
        }
        catch (err) {
            process.stdout.write("\n");
            console.error(`[Error] ${err.message || err}\n`);
        }
    }
    const cliArgs = process.argv.slice(2);
    if (cliArgs.length > 0) {
        await executeTokens(cliArgs);
        client.close();
        process.exit(0);
    }
    console.log(`\n======================================================================`);
    console.log(`                     TypeTube Interactive Shell                      `);
    console.log(`======================================================================`);
    console.log(` Type "help" for full flag list & commands, or "exit" to quit.\n`);
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: process.stdin.isTTY ?? false
    });
    if (process.stdin.isTTY)
        process.stdout.write("typetube> ");
    for await (const answer of rl) {
        const line = answer.trim();
        if (!line) {
            if (process.stdin.isTTY)
                process.stdout.write("typetube> ");
            continue;
        }
        const tokens = parseInputArgs(line);
        await executeTokens(tokens);
        if (process.stdin.isTTY)
            process.stdout.write("typetube> ");
    }
    client.close();
}
runCli();
//# sourceMappingURL=cli.js.map