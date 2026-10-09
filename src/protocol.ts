export class ProtoWriter {
    private buffers: number[] = [];
    public length: number = 0;
    public writeTag(field: number, wire: number): void {
        this.writeVarint((field << 3) | wire);
    }
    public writeVarint(value: number): void {
        let v = value >>> 0;
        while (v >= 0x80) {
            this.buffers.push((v & 0x7f) | 0x80);
            v >>>= 7;
            this.length++;
        }
        this.buffers.push(v);
        this.length++;
    }
    public writeString(field: number, str?: string | null): void {
        if (!str)
            return;
        const utf8 = new TextEncoder().encode(str);
        this.writeTag(field, 2);
        this.writeVarint(utf8.length);
        for (let i = 0; i < utf8.length; i++)
            this.buffers.push(utf8[i]!);
        this.length += utf8.length;
    }
    public writeUint32(field: number, val?: number | null): void {
        if (val === undefined || val === null || val === 0)
            return;
        this.writeTag(field, 0);
        this.writeVarint(val);
    }
    public writeBool(field: number, val?: boolean | null): void {
        if (!val)
            return;
        this.writeTag(field, 0);
        this.writeVarint(1);
    }
    public writeDouble(field: number, val?: number | null): void {
        if (val === undefined || val === null || val === 0)
            return;
        this.writeTag(field, 1);
        const view = new DataView(new ArrayBuffer(8));
        view.setFloat64(0, val, true);
        for (let i = 0; i < 8; i++)
            this.buffers.push(view.getUint8(i));
        this.length += 8;
    }
    public writeMessage(field: number, writer: ProtoWriter): void {
        const bytes = writer.toUint8Array();
        if (bytes.length === 0)
            return;
        this.writeTag(field, 2);
        this.writeVarint(bytes.length);
        for (let i = 0; i < bytes.length; i++)
            this.buffers.push(bytes[i]!);
        this.length += bytes.length;
    }
    public toUint8Array(): Uint8Array {
        return new Uint8Array(this.buffers);
    }
}
export class ProtoReader {
    private buf: Uint8Array;
    private view: DataView;
    private pos: number = 0;
    constructor(buf: Uint8Array) {
        this.buf = buf;
        this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    }
    public get hasMore(): boolean {
        return this.pos < this.buf.length;
    }
    public readVarint(): number {
        let res = 0;
        let shift = 0;
        while (this.pos < this.buf.length) {
            const b = this.buf[this.pos++]!;
            res |= (b & 0x7f) << shift;
            if ((b & 0x80) === 0)
                return res >>> 0;
            shift += 7;
        }
        return res >>> 0;
    }
    public readTag(): {
        field: number;
        wire: number;
    } {
        const v = this.readVarint();
        return { field: v >>> 3, wire: v & 0x7 };
    }
    public readString(): string {
        const len = this.readVarint();
        const sub = this.buf.subarray(this.pos, this.pos + len);
        this.pos += len;
        return new TextDecoder().decode(sub);
    }
    public readDouble(): number {
        const val = this.view.getFloat64(this.pos, true);
        this.pos += 8;
        return val;
    }
    public readBytes(): Uint8Array {
        const len = this.readVarint();
        const sub = this.buf.subarray(this.pos, this.pos + len);
        this.pos += len;
        return sub;
    }
    public skip(wire: number): void {
        if (wire === 0)
            this.readVarint();
        else if (wire === 1)
            this.pos += 8;
        else if (wire === 2) {
            const len = this.readVarint();
            this.pos += len;
        }
        else if (wire === 5)
            this.pos += 4;
    }
}
function writeAudioStream(field: number, stream: any, writer: ProtoWriter): void {
    if (!stream)
        return;
    const w = new ProtoWriter();
    w.writeUint32(1, stream.itag);
    w.writeString(2, stream.quality);
    w.writeString(3, stream.mimeType);
    w.writeUint32(4, stream.bitrate);
    w.writeString(5, stream.url);
    w.writeBool(6, stream.isHiFi);
    if (stream.rawUrl)
        w.writeString(7, stream.rawUrl);
    writer.writeMessage(field, w);
}
function readAudioStream(buf: Uint8Array): any {
    const r = new ProtoReader(buf);
    const stream: any = { isHiFi: false };
    while (r.hasMore) {
        const { field, wire } = r.readTag();
        if (field === 1)
            stream.itag = r.readVarint();
        else if (field === 2)
            stream.quality = r.readString();
        else if (field === 3)
            stream.mimeType = r.readString();
        else if (field === 4)
            stream.bitrate = r.readVarint();
        else if (field === 5)
            stream.url = r.readString();
        else if (field === 6)
            stream.isHiFi = r.readVarint() === 1;
        else if (field === 7)
            stream.rawUrl = r.readString();
        else
            r.skip(wire);
    }
    return stream;
}
function writeVideoStream(field: number, stream: any, writer: ProtoWriter): void {
    if (!stream)
        return;
    const w = new ProtoWriter();
    w.writeUint32(1, stream.itag);
    w.writeString(2, stream.quality);
    w.writeString(3, stream.resolution);
    w.writeString(4, stream.mimeType);
    w.writeString(5, stream.url);
    writer.writeMessage(field, w);
}
function readVideoStream(buf: Uint8Array): any {
    const r = new ProtoReader(buf);
    const stream: any = {};
    while (r.hasMore) {
        const { field, wire } = r.readTag();
        if (field === 1)
            stream.itag = r.readVarint();
        else if (field === 2)
            stream.quality = r.readString();
        else if (field === 3)
            stream.resolution = r.readString();
        else if (field === 4)
            stream.mimeType = r.readString();
        else if (field === 5)
            stream.url = r.readString();
        else
            r.skip(wire);
    }
    return stream;
}
function writeThumbnail(field: number, thumb: any, writer: ProtoWriter): void {
    if (!thumb)
        return;
    const w = new ProtoWriter();
    w.writeString(1, thumb.url);
    w.writeUint32(2, thumb.width);
    w.writeUint32(3, thumb.height);
    writer.writeMessage(field, w);
}
function readThumbnail(buf: Uint8Array): any {
    const r = new ProtoReader(buf);
    const thumb: any = {};
    while (r.hasMore) {
        const { field, wire } = r.readTag();
        if (field === 1)
            thumb.url = r.readString();
        else if (field === 2)
            thumb.width = r.readVarint();
        else if (field === 3)
            thumb.height = r.readVarint();
        else
            r.skip(wire);
    }
    return thumb;
}
function writeMeta(field: number, meta: any, writer: ProtoWriter): void {
    if (!meta)
        return;
    const w = new ProtoWriter();
    if (meta.latencyMs !== undefined)
        w.writeDouble(1, +(meta.latencyMs).toFixed(2));
    if (meta.timestamp !== undefined)
        w.writeDouble(2, meta.timestamp);
    if (meta.total !== undefined)
        w.writeUint32(3, meta.total);
    if (meta.limit !== undefined)
        w.writeUint32(4, meta.limit);
    if (meta.sLatencyMS !== undefined)
        w.writeDouble(5, +(meta.sLatencyMS).toFixed(2));
    if (meta.eLatencyMS !== undefined)
        w.writeDouble(6, +(meta.eLatencyMS).toFixed(2));
    if (meta.tLatencyMS !== undefined)
        w.writeDouble(7, +(meta.tLatencyMS).toFixed(2));
    writer.writeMessage(field, w);
}
function readMeta(buf: Uint8Array): any {
    const r = new ProtoReader(buf);
    const meta: any = {};
    while (r.hasMore) {
        const { field, wire } = r.readTag();
        if (field === 1)
            meta.latencyMs = wire === 0 ? r.readVarint() : +r.readDouble().toFixed(2);
        else if (field === 2)
            meta.timestamp = r.readDouble();
        else if (field === 3)
            meta.total = r.readVarint();
        else if (field === 4)
            meta.limit = r.readVarint();
        else if (field === 5)
            meta.sLatencyMS = wire === 0 ? r.readVarint() : +r.readDouble().toFixed(2);
        else if (field === 6)
            meta.eLatencyMS = wire === 0 ? r.readVarint() : +r.readDouble().toFixed(2);
        else if (field === 7)
            meta.tLatencyMS = wire === 0 ? r.readVarint() : +r.readDouble().toFixed(2);
        else
            r.skip(wire);
    }
    return meta;
}
function writeError(field: number, err: any, writer: ProtoWriter): void {
    if (!err)
        return;
    const w = new ProtoWriter();
    w.writeString(1, err.code || "");
    w.writeString(2, err.message || "");
    w.writeUint32(3, err.statusCode || 500);
    writer.writeMessage(field, w);
}
function readError(buf: Uint8Array): any {
    const r = new ProtoReader(buf);
    const err: any = {};
    while (r.hasMore) {
        const { field, wire } = r.readTag();
        if (field === 1)
            err.code = r.readString();
        else if (field === 2)
            err.message = r.readString();
        else if (field === 3)
            err.statusCode = r.readVarint();
        else
            r.skip(wire);
    }
    return err;
}
function writeTrackData(field: number, track: any, writer: ProtoWriter): void {
    const w = new ProtoWriter();
    w.writeString(1, track.id || track.query);
    w.writeString(2, track.title);
    w.writeString(3, track.author);
    w.writeString(4, track.uploader || track.author);
    w.writeString(5, track.artistAvatar);
    w.writeUint32(6, track.durationSeconds);
    w.writeString(7, track.thumbnail);
    if (Array.isArray(track.thumbnails)) {
        for (const thumb of track.thumbnails) {
            writeThumbnail(8, thumb, w);
        }
    }
    if (track.bestAudio) {
        writeAudioStream(9, track.bestAudio, w);
    }
    if (track.bestVideo) {
        writeVideoStream(10, track.bestVideo, w);
    }
    if (Array.isArray(track.audioStreams)) {
        for (const a of track.audioStreams) {
            writeAudioStream(11, a, w);
        }
    }
    if (Array.isArray(track.videoStreams)) {
        for (const v of track.videoStreams) {
            writeVideoStream(12, v, w);
        }
    }
    writer.writeMessage(field, w);
}
function readTrackData(buf: Uint8Array): any {
    const r = new ProtoReader(buf);
    const track: any = {
        thumbnails: [],
        audioStreams: [],
        videoStreams: []
    };
    while (r.hasMore) {
        const { field, wire } = r.readTag();
        if (field === 1) {
            track.id = r.readString();
            track.query = track.id;
        }
        else if (field === 2)
            track.title = r.readString();
        else if (field === 3)
            track.author = r.readString();
        else if (field === 4)
            track.uploader = r.readString();
        else if (field === 5)
            track.artistAvatar = r.readString();
        else if (field === 6)
            track.durationSeconds = r.readVarint();
        else if (field === 7)
            track.thumbnail = r.readString();
        else if (field === 8)
            track.thumbnails.push(readThumbnail(r.readBytes()));
        else if (field === 9)
            track.bestAudio = readAudioStream(r.readBytes());
        else if (field === 10)
            track.bestVideo = readVideoStream(r.readBytes());
        else if (field === 11)
            track.audioStreams.push(readAudioStream(r.readBytes()));
        else if (field === 12)
            track.videoStreams.push(readVideoStream(r.readBytes()));
        else
            r.skip(wire);
    }
    return track;
}
export function encodeTrackResult(input: any): Uint8Array {
    const w = new ProtoWriter();
    if (input.success === false) {
        w.writeBool(1, false);
        if (input.error) {
            writeError(4, input.error, w);
        }
        return w.toUint8Array();
    }
    w.writeBool(1, true);
    const dataPayload = input.data || input;
    const meta = input.meta || {
        latencyMs: +(input.latencyMs ?? 0).toFixed(2),
        sLatencyMS: +(input.sLatencyMS ?? 0).toFixed(2),
        eLatencyMS: +(input.eLatencyMS ?? 0).toFixed(2),
        tLatencyMS: +(input.tLatencyMS ?? input.latencyMs ?? 0).toFixed(2),
        timestamp: Date.now()
    };
    writeTrackData(2, dataPayload, w);
    writeMeta(3, meta, w);
    return w.toUint8Array();
}
export function decodeTrackResult(buf: Uint8Array): any {
    const r = new ProtoReader(buf);
    const envelope: any = {
        success: false
    };
    while (r.hasMore) {
        const { field, wire } = r.readTag();
        if (field === 1)
            envelope.success = r.readVarint() === 1;
        else if (field === 2)
            envelope.data = readTrackData(r.readBytes());
        else if (field === 3)
            envelope.meta = readMeta(r.readBytes());
        else if (field === 4)
            envelope.error = readError(r.readBytes());
        else
            r.skip(wire);
    }
    return envelope;
}
export function encodeSearchResults(input: any): Uint8Array {
    const w = new ProtoWriter();
    if (input.success === false) {
        w.writeBool(1, false);
        if (input.error) {
            writeError(4, input.error, w);
        }
        return w.toUint8Array();
    }
    w.writeBool(1, true);
    const items = Array.isArray(input) ? input : (input.data || []);
    const meta = input.meta || { total: items.length, timestamp: Date.now() };
    for (const item of items) {
        const itemWriter = new ProtoWriter();
        itemWriter.writeString(1, item.id || item.videoId);
        itemWriter.writeString(2, item.title);
        itemWriter.writeString(3, item.url);
        if (item.durationSeconds || item.duration) {
            itemWriter.writeUint32(4, item.durationSeconds || item.duration);
        }
        if (item.uploader || item.author) {
            itemWriter.writeString(5, item.uploader || item.author);
        }
        w.writeMessage(2, itemWriter);
    }
    writeMeta(3, meta, w);
    return w.toUint8Array();
}
export function decodeSearchResults(buf: Uint8Array): any {
    const r = new ProtoReader(buf);
    const envelope: any = {
        success: false,
        data: []
    };
    while (r.hasMore) {
        const { field, wire } = r.readTag();
        if (field === 1) {
            envelope.success = r.readVarint() === 1;
        }
        else if (field === 2) {
            const itemBuf = r.readBytes();
            const ir = new ProtoReader(itemBuf);
            const item: any = { duration: null, uploader: null };
            while (ir.hasMore) {
                const { field: ifield, wire: iwire } = ir.readTag();
                if (ifield === 1)
                    item.id = ir.readString();
                else if (ifield === 2)
                    item.title = ir.readString();
                else if (ifield === 3)
                    item.url = ir.readString();
                else if (ifield === 4)
                    item.duration = ir.readVarint();
                else if (ifield === 5)
                    item.uploader = ir.readString();
                else
                    ir.skip(iwire);
            }
            envelope.data.push(item);
        }
        else if (field === 3) {
            envelope.meta = readMeta(r.readBytes());
        }
        else if (field === 4) {
            envelope.error = readError(r.readBytes());
        }
        else {
            r.skip(wire);
        }
    }
    return envelope;
}
