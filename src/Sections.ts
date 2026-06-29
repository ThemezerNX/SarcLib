import { FileEntry } from "./FileEntry.js"
import { readAsciiEquals, sliceAscii, u8Concat } from "./utils.js"

abstract class Section {
    protected little: boolean
    protected buf: Uint8Array = new Uint8Array(0)

    constructor(isLittleEndian = false) {
        this.little = isLittleEndian
    }

    abstract getBuffer(): Uint8Array

    protected writeU16(value: number, offset: number, target?: Uint8Array, little = this.little) {
        const dest = target ?? this.buf
        new DataView(dest.buffer, dest.byteOffset, dest.byteLength).setUint16(offset, value >>> 0, little)
    }

    protected writeU32(value: number, offset: number, target?: Uint8Array, little = this.little) {
        const dest = target ?? this.buf
        new DataView(dest.buffer, dest.byteOffset, dest.byteLength).setUint32(offset, value >>> 0, little)
    }
}

export class SARCSection extends Section {
    static readonly magic = "SARC"
    static readonly headerSize = 0x14
    private static readonly endianConst = 0xfeff
    static readonly version = 0x100

    private fileSize = 0
    private dataOffset = 0

    getBuffer(): Uint8Array {
        this.buf = new Uint8Array(SARCSection.headerSize)
        this.buf.set(new TextEncoder().encode(SARCSection.magic), 0x00)
        this.writeU16(SARCSection.headerSize, 0x04)
        this.writeU16(SARCSection.endianConst, 0x06)
        this.writeU32(this.fileSize, 0x08)
        this.writeU32(this.dataOffset, 0x0c)
        this.writeU16(SARCSection.version, 0x10)
        this.writeU16(0, 0x12)
        return this.buf
    }

    setFileSize(n: number) {
        this.fileSize = n >>> 0
    }
    setDataOffset(n: number) {
        this.dataOffset = n >>> 0
    }
}

export class SFATSection extends Section {
    static readonly magic = "SFAT"
    static readonly headerSize = 0x0c
    static readonly entrySize = 0x10

    private hashMultiplier = 0x65
    private defaultAlignment = 0x04
    private entries: Uint8Array[] = []
    private nameOffset = 0
    private dataOffset = 0
    private dataOffsetAlignment = 1

    addFile(hash: number, file: FileEntry): number {
        const entry = new Uint8Array(SFATSection.entrySize)
        this.writeU32(hash >>> 0, 0x0, entry)
        this.writeU32(0x01000000 | ((this.nameOffset >>> 2) >>> 0), 0x4, entry)

        const align = getDataAlignment(file.data, this.defaultAlignment)
        this.dataOffsetAlignment = Math.max(this.dataOffsetAlignment, align)
        this.dataOffset = alignUp(this.dataOffset, align)

        this.writeU32(this.dataOffset, 0x8, entry)
        this.dataOffset += file.data.length
        this.writeU32(this.dataOffset, 0xc, entry)

        this.nameOffset += alignUp(new TextEncoder().encode(file.name).length + 1, 4)
        this.entries.push(entry)
        return align
    }

    getBuffer(): Uint8Array {
        this.buf = new Uint8Array(SFATSection.headerSize)
        this.buf.set(new TextEncoder().encode(SFATSection.magic), 0x00)
        this.writeU16(SFATSection.headerSize, 0x04)
        this.writeU16(this.entries.length, 0x06)
        this.writeU32(this.hashMultiplier >>> 0, 0x08)
        return u8Concat([this.buf, ...this.entries])
    }

    setHashMultiplier(n: number) {
        this.hashMultiplier = n >>> 0
    }
    setDefaultAlignment(n: number) {
        this.defaultAlignment = n >>> 0
    }
    getDataOffsetAlignment() {
        return this.dataOffsetAlignment >>> 0
    }
}

export class SFNTSection extends Section {
    static readonly magic = "SFNT"
    static readonly headerSize = 0x08

    private nameChunks: Uint8Array[] = []

    addFile(file: FileEntry) {
        const nameBytes = new TextEncoder().encode(file.name)
        const size = alignUp(nameBytes.length + 1, 4)
        const chunk = new Uint8Array(size)
        chunk.set(nameBytes, 0)
        this.nameChunks.push(chunk)
    }

    getBuffer(): Uint8Array {
        this.buf = new Uint8Array(SFNTSection.headerSize)
        this.buf.set(new TextEncoder().encode(SFNTSection.magic), 0x00)
        this.writeU16(SFNTSection.headerSize, 0x04)
        this.writeU16(0, 0x06)
        return u8Concat([this.buf, ...this.nameChunks])
    }
}

export class FileDataSection extends Section {
    private chunks: Uint8Array[] = []
    private sectionSize = 0
    private dataOffsetAlignment = 1
    private cursorPosition = 0

    addFile(file: FileEntry, alignment: number) {
        const start = alignUp(this.sectionSize, alignment)
        const pad = start - this.sectionSize
        const padding = pad ? new Uint8Array(pad) : new Uint8Array(0)
        const entry = u8Concat([padding, file.data])
        this.sectionSize += entry.length
        this.chunks.push(entry)
    }

    getBuffer(): Uint8Array {
        const dataPad = alignUpAsPadding(this.cursorPosition, this.dataOffsetAlignment)
        const headerPad = dataPad ? new Uint8Array(dataPad) : new Uint8Array(0)
        return u8Concat([headerPad, ...this.chunks])
    }

    setDataOffsetAlignment(n: number) {
        this.dataOffsetAlignment = n >>> 0
    }
    setCursorPosition(n: number) {
        this.cursorPosition = n >>> 0
    }
}

export function hashFileName(name: string, multiplier: number): number {
    let result = 0 >>> 0
    new TextEncoder().encode(name).forEach((b) => {
        result = (Math.imul(result, multiplier >>> 0) + b) >>> 0
    })
    return result >>> 0
}

export function alignUp(n: number, alignment: number): number {
    if (alignment <= 0) return n >>> 0
    return ((n + alignment - 1) & -alignment) >>> 0
}

function alignUpAsPadding(n: number, alignment: number): number {
    if (alignment <= 0) return 0
    return (alignment - (n % alignment)) % alignment
}

function getDataAlignment(data: Uint8Array, defAlign: number): number {
    if (readAsciiEquals(data, 0, "SARC")) return 0x2000
    if (readAsciiEquals(data, 0, "Yaz0")) return 0x80
    if (readAsciiEquals(data, 0, "FFNT")) return 0x2000
    if (readAsciiEquals(data, 0, "CFNT")) return 0x80
    if (
        readAsciiEquals(data, 0, "CSTM") ||
        readAsciiEquals(data, 0, "FSTM") ||
        readAsciiEquals(data, 0, "FSTP") ||
        readAsciiEquals(data, 0, "CWAV") ||
        readAsciiEquals(data, 0, "FWAV")
    )
        return 0x20
    if (readAsciiEquals(data, 0, "BNTX") || readAsciiEquals(data, 0, "BNSH") || sliceAscii(data, 0, 8) === "FSHA    ")
        return 0x1000
    if (
        readAsciiEquals(data, 0, "Gfx2") ||
        readAsciiEquals(data, 0, "FRES") ||
        readAsciiEquals(data, 0, "AAHS") ||
        readAsciiEquals(data, 0, "BAHS") ||
        readAsciiEquals(data, -0x28, "FLIM")
    )
        return 0x2000
    if (readAsciiEquals(data, 0, "CTPK")) return 0x10
    if (readAsciiEquals(data, 0, "CGFX") || readAsciiEquals(data, -0x28, "CLIM")) return 0x80
    if (readAsciiEquals(data, 0, "AAMP")) return 8
    if (
        sliceAscii(data, 0, 2) === "YB" ||
        sliceAscii(data, 0, 2) === "BY" ||
        sliceAscii(data, 0, 8) === "MsgStdBn" ||
        sliceAscii(data, 0, 8) === "MsgPrjBn"
    )
        return 0x80
    if (sliceAscii(data, 0xc, 0x10) === "SCDL") return 0x100

    return Math.max(defAlign, getFileAlignmentForNewBinaryFile(data))
}

function getFileAlignmentForNewBinaryFile(data: Uint8Array): number {
    if (data.length <= 0x20) return 0
    const bom = sliceAscii(data, 0xc, 0xe)
    if (bom !== "\xff\xfe" && bom !== "\xfe\xff") return 0
    const little = bom === "\xff\xfe"
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength)
    const fileSize = little ? dv.getUint32(0x1c, true) : dv.getUint32(0x1c, false)
    if (data.length !== fileSize) return 0
    return 1 << data[0xe]
}
