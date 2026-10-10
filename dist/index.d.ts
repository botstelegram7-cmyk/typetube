import { TypeTubeClientOptions, TrackResult, SearchItem, ResolveOptions, SearchOptions, Resolvable, DownloadAudioOptions, DownloadVideoOptions, DownloadMediaOptions, DownloadResult, PlaybackOptions, PlaybackInfo } from "./types.js";
export declare class TypeTubeError extends Error {
    statusCode?: number;
    constructor(message: string, statusCode?: number);
}
export declare class TypeTube {
    private tapClient;
    apiCallsCount: number;
    constructor(optionsOrApiKey?: string | TypeTubeClientOptions);
    resolve(queryOrUrl: string, options?: ResolveOptions): Promise<TrackResult>;
    search(query: string, options?: SearchOptions): Promise<SearchItem[]>;
    ping(): Promise<number>;
    coerceTrack(input: Resolvable): TrackResult | null;
    isStreamExpired(url?: string | null, marginSeconds?: number): boolean;
    private ensureFreshTrack;
    getAudioStreamUrl(target: Resolvable): Promise<string>;
    getVideoStreamUrl(target: Resolvable, maxHeight?: number): Promise<string>;
    getPlayback(target: Resolvable, options?: PlaybackOptions): Promise<PlaybackInfo>;
    getMediaUrls(target: Resolvable, options?: PlaybackOptions): Promise<PlaybackInfo>;
    downloadAudio(target: Resolvable, destPathOrOptions?: string | DownloadAudioOptions, options?: DownloadAudioOptions): Promise<DownloadResult>;
    downloadVideo(target: Resolvable, destPathOrOptions?: string | DownloadVideoOptions, options?: DownloadVideoOptions): Promise<DownloadResult>;
    downloadMedia(target: Resolvable, destPathOrOptions?: string | DownloadMediaOptions, options?: DownloadMediaOptions): Promise<DownloadResult>;
    private resolveDestination;
    private selectAudioStream;
    private selectVideoStream;
    private filterVideoByHeight;
    private ensureDirectory;
    private getIpFamily;
    private downloadStreamToFile;
    private downloadChunkedRange;
    private downloadLinearStream;
    private muxStreamsWithFfmpeg;
    close(): void;
}
export declare function createClient(optionsOrApiKey?: string | TypeTubeClientOptions, options?: Omit<TypeTubeClientOptions, "apiKey">): TypeTube;
export declare const TypeTubeClient: typeof TypeTube;
export * from "./types.js";
export * from "./protocol.js";
export * from "./tap/index.js";
export default TypeTube;
//# sourceMappingURL=index.d.ts.map