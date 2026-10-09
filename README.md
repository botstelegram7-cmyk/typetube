# TypeTube

High-performance YouTube stream resolver and unthrottled downloader for Node.js powered by TAP (Tagged Asynchronous Protocol).

Features:
- Sub-second full stream resolution for search queries and direct video URLs
- Tagged Asynchronous Protocol (TAP) with binary RPC multiplexing over persistent sockets
- Direct Google Video CDN URLs with automatic stream selection
- Multi-worker range downloads (up to 32 parallel workers) to avoid speed throttling
- Automatic recovery when stream URLs expire mid-flight
- Optional video and audio muxing to MP4 via FFmpeg
- Zero external runtime dependencies (requires only an active connection to a TypeTube cluster)

## Public Access & Limits

The client connects to the official public cluster by default. Public access is granted automatically per IP address:

- **60 resolves / minute** per IP
- **1,500 resolves / day** per IP
- *Public limits are subject to change at any time without notice*

### Hi-Fi 256kbps Audio & Private API Keys

- **Public access** provides standard audio streams (up to 128kbps / 160kbps)
- **Private API keys** unlock unthrottled 256kbps Hi-Fi AAC (`itag 141`) and 272kbps Opus (`itag 774`) streams, higher throughput quotas, and priority cluster routing

### Performance & Latency Comparison

| Operation | Public Tier | Private Tier | Improvement |
| :--- | :--- | :--- | :--- |
| **Search Latency** | ~750 ms | ~530 ms | ~30% faster |
| **Extraction / Resolve Latency** | ~620 ms | ~145 ms | ~75% faster |
| **Audio Bitrate** | Up to 128 / 160 kbps | **256 kbps Hi-Fi** | Unthrottled |

> **Regional Notice**: The cluster is currently located in Singapore only. Due to YouTube regional restrictions, some original VEVO tracks may not be downloadable or playable when accessed from outside Singapore. An India cluster will be added soon.

To request a private API key, join our Telegram channel: **[@PlayeonX](https://t.me/PlayeonX)**

## Installation

```bash
npm install typetube
```

Requires Node.js 18 or higher. If you plan to mux video and audio into a single MP4 file, make sure `ffmpeg` is installed on your system.

## Interactive CLI Shell

TypeTube provides a persistent interactive shell that keeps a TAP connection open across commands:

```bash
# Launch interactive shell
npx typetube
```

Inside the interactive shell:
```text
typetube> "ReoNa ないない"
typetube> "ReoNa ないない" -v -f 1080p -o ./videos
typetube> "queen bohemian rhapsody" -a hifi -o ./music -N 8
typetube> https://www.youtube.com/watch?v=dQw4w9WgXcQ -g
typetube> -j "daft punk get lucky"
typetube> search "coldplay" 5
typetube> resolve "shape of you"
typetube> ping
typetube> clear
typetube> exit
```

### CLI Command Flags

- `-v`, `--video`: Download video muxed with audio to MP4
- `--video-only`: Download raw adaptive video stream without audio
- `-x`, `--audio-only`: Download audio stream only (default behavior)
- `-f`, `--format <quality>`: Video resolution: `2160p`, `1440p`, `1080p`, `720p`, `480p`, `360p`, `highest`, `lowest` (default: `1080p`)
- `-a`, `--audio-quality <q>`: Audio quality: `highest`, `hifi`, `256kbps`, `128kbps`, `lowest` (default: `highest`)
- `-c`, `--codec <name>`: Preferred video codec: `avc1` (H.264), `vp9`, `av01` (AV1), `any` (default: `avc1`)
- `--ext <mp4|mkv|webm>`: Output container format (default: `mp4`)
- `-o`, `--output <path>`: Destination file path or directory (default: `./downloads`)
- `-N`, `--workers <count>`: Number of parallel download workers: 1 to 32 (default: 4 for audio, 6 for video)
- `--chunk-size <mb>`: Range chunk size in MB (default: 10)
- `-s`, `--simulate`: Inspect stream metadata without downloading
- `-j`, `--json`: Output raw JSON track manifest
- `-g`, `--get-url`: Print direct CDN stream URL to stdout
- `-e`, `--get-title`: Print track title
- `--get-id`: Print video ID
- `--get-thumbnail`: Print high-resolution thumbnail URL

## Quick Start (SDK)

```typescript
import { createClient, TypeTube } from "typetube";

// Initializes client (connects to default public cluster)
const client = createClient();

// 1. Resolve metadata and stream manifests
const track = await client.resolve("ReoNa 『ないない』-Music Video-");
console.log(track.title, `(${track.durationSeconds}s)`);
console.log("Audio Stream URL:", track.bestAudio.url);

// 2. Download audio with 4 parallel range workers
const audio = await client.downloadAudio(track, "./music", {
  audioQuality: "highest",
  workers: 4,
  onProgress: (p) => console.log(`${p.percent}% - ${p.speedMBps} MB/s`)
});
console.log("Audio saved to:", audio.filePath);

// 3. Download 1080p video muxed with audio
const video = await client.downloadMedia(track, "./videos", {
  quality: "1080p",
  outputFormat: "mp4",
  onProgress: (p) => console.log(`${p.phase}: ${p.percent}%`)
});
console.log("Video saved to:", video.filePath);
```

## Client Configuration

```typescript
import { createClient, TypeTube } from "typetube";

// 1. Default public cluster
const client = createClient();

// 2. Private access with an API key
const privateClient = new TypeTube({
  apiKey: "YOUR_PRIVATE_KEY"
});

// 3. Custom cluster endpoint
const customClient = new TypeTube({
  apiKey: "YOUR_PRIVATE_KEY",
  host: "tap://sg.clusters.typetube.xyz",
  port: 8443,
  timeoutMs: 15000
});
```

### Connection URL Schemes

- `tap://hostname[:port]`: Connects over TAP socket (default port `8443`)

## Methods

### `client.resolve(query, options?)`

Resolves a video URL, video ID, or search query into a complete track object with sub-second latency.

```typescript
const track = await client.resolve("https://www.youtube.com/watch?v=dQw4w9WgXcQ", {
  maxVideoHeight: 1080
});
```

Returns:
- `id`: YouTube video ID
- `title`: Video title
- `author`: Channel name
- `durationSeconds`: Track duration in seconds
- `bestAudio`: Best available audio stream (prefers 256kbps AAC or Opus on private keys)
- `bestVideo`: Best available video stream matching `maxVideoHeight`
- `audioStreams`: List of audio streams
- `videoStreams`: List of video streams
- `thumbnails`: Array of thumbnail objects with dimensions
- `latencyMs`: Resolution latency in milliseconds

### `client.search(query, options?)`

Searches YouTube and returns a ranked list of items.

```typescript
const results = await client.search("daft punk", { limit: 5 });
for (const item of results) {
  console.log(item.title, item.url);
}
```

### `client.getPlayback(trackOrQuery, options?)`

Returns direct playback URLs. Accepts either a search query string or an existing `TrackResult` object. If you pass a `TrackResult`, no network call is made to re-resolve the track.

```typescript
const playback = await client.getPlayback(track, {
  audioQuality: "highest",
  quality: "1080p"
});

console.log("Audio URL:", playback.audioUrl);
console.log("Video URL:", playback.videoUrl);
```

### `client.downloadAudio(trackOrQuery, destPath?, options?)`

Downloads the audio stream to disk using multi-worker HTTP range requests.

```typescript
const result = await client.downloadAudio(track, "./music", {
  audioQuality: "highest", // "highest" | "hifi" | "256kbps" | "128kbps" | "lowest"
  workers: 4,
  chunkSizeBytes: 10 * 1024 * 1024,
  onProgress: (p) => console.log(`${p.percent}% - ${p.speedMBps} MB/s`)
});
```

> **Performance Tip**: Pass the already resolved `track` object directly to eliminate redundant upstream resolution calls.

### `client.downloadVideo(trackOrQuery, destPath?, options?)`

Downloads the standalone adaptive video stream to disk using multi-worker range requests.

```typescript
const result = await client.downloadVideo(track, "./videos", {
  quality: "1080p",
  preferCodec: "avc1",
  workers: 6,
  onProgress: (p) => console.log(`${p.percent}%`)
});
```

### `client.downloadMedia(trackOrQuery, destPath?, options?)`

Downloads both audio and video streams in parallel, then muxes them into a single container using FFmpeg.

```typescript
const result = await client.downloadMedia(track, "./media", {
  quality: "1080p",
  outputFormat: "mp4",
  workers: 6,
  onProgress: (p) => console.log(`${p.phase}: ${p.percent}%`)
});

console.log("Output file:", result.filePath);
```

### `client.getVideoStreamUrl(trackOrQuery, maxHeight?)`

Extracts a direct, playable video stream URL.

```typescript
const url = await client.getVideoStreamUrl(track, 1080);
```

### `client.getAudioStreamUrl(trackOrQuery)`

Extracts a direct, playable audio stream URL.

```typescript
const url = await client.getAudioStreamUrl(track);
```

### `client.isStreamExpired(url, marginSeconds?)`

Checks whether a Google Video CDN URL is expired or expiring within `marginSeconds` (default: 30 seconds).

```typescript
if (client.isStreamExpired(track.bestAudio.url)) {
  console.log("Stream token has expired");
}
```

### `client.ping()`

Pings the active socket connection and returns live round-trip latency in milliseconds.

```typescript
const latency = await client.ping();
console.log(`Socket RTT: ${latency.toFixed(2)} ms`);
```

### `client.close()`

Closes the active connection.

```typescript
client.close();
```

## Error Handling

Errors throw `TypeTubeError` instances:

```typescript
import { TypeTubeError } from "typetube";

try {
  await client.resolve("...");
} catch (err) {
  if (err instanceof TypeTubeError) {
    console.error(`Status ${err.statusCode}: ${err.message}`);
  }
}
```

## License

MIT
