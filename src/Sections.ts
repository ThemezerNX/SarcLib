import {FileEntry} from "./FileEntry";

abstract class Section {

    private isLittleEndian;
    protected buffer: Buffer;

    constructor(isLittleEndian: boolean = false) {
        this.isLittleEndian = isLittleEndian;
    }

    setIsLittleEndian(isLittleEndian: boolean) {
        this.isLittleEndian = isLittleEndian;
    }

    abstract getBuffer(): Buffer;

    writeUInt16(value: number, offset?: number, buffer?: Buffer, isLittleEndian?: boolean) {
        const little = isLittleEndian != undefined ? isLittleEndian : this.isLittleEndian;
        const dest = buffer ? buffer : this.buffer;
        return little ?
            dest.writeUInt16LE(value, offset) :
            dest.writeUInt16BE(value, offset);
    }


    writeUInt32(value: number, offset?: number, buffer?: Buffer, isLittleEndian?: boolean) {
        const little = isLittleEndian != undefined ? isLittleEndian : this.isLittleEndian;
        const dest = buffer ? buffer : this.buffer;
        return little ?
            dest.writeUInt32LE(value, offset) :
            dest.writeUInt32BE(value, offset);
    }

}

export class SARCSection extends Section {

    static readonly magic = "SARC";
    public static readonly headerSize = 0x14;
    private static readonly endianConst = 0xFEFF;
    static readonly version = 0x100;
    private fileSize: number;
    private dataOffset: number;

    getBuffer(): Buffer {
        this.buffer = Buffer.alloc(SARCSection.headerSize);

        this.buffer.write(SARCSection.magic);
        this.writeUInt16(SARCSection.headerSize, 0x4);
        this.writeUInt16(SARCSection.endianConst, 0x6);
        this.writeUInt32(this.fileSize, 0x8);
        this.writeUInt32(this.dataOffset, 0xC);
        this.writeUInt16(SARCSection.version, 0x10);
        this.writeUInt16(0, 0x12);

        return this.buffer;
    }

    setFileSize(size: number) {
        this.fileSize = size;
    }

    setDataOffset(offset: number) {
        this.dataOffset = offset;
    }

}

export class SFATSection extends Section {

    static readonly magic = "SFAT";
    public static readonly headerSize = 0xC;
    public static readonly entrySize = 0x10;
    private hashMultiplier = 0x65;
    private fileBuffers: Buffer[] = [];

    private defaultAlignment = 0x04;
    private nameOffset = 0;
    private dataOffset = 0;
    private dataOffsetAlignment = 1;

    addFile(hash: number, file: FileEntry): number {
        const entry = Buffer.alloc(SFATSection.entrySize);

        this.writeUInt32(hash, 0x0, entry);
        this.writeUInt32(0x01000000 | (this.nameOffset >>> 2), 0x4, entry);

        let alignment = getDataAlignment(file.data, this.defaultAlignment);
        this.dataOffsetAlignment = Math.max(this.dataOffsetAlignment, alignment);
        this.dataOffset = alignUp(this.dataOffset, alignment);

        this.writeUInt32(this.dataOffset, 0x8, entry);
        this.dataOffset += file.data.length;
        this.writeUInt32(this.dataOffset, 0xc, entry);
        this.nameOffset += alignUp(Buffer.from(file.name).length + 1, 4);

        this.fileBuffers.push(entry);

        return alignment;
    }

    getBuffer(): Buffer {
        this.buffer = Buffer.alloc(SFATSection.headerSize);

        this.buffer.write(SFATSection.magic);
        this.writeUInt16(SFATSection.headerSize, 0x4);
        this.writeUInt16(this.fileBuffers.length, 0x6);
        this.writeUInt32(this.hashMultiplier, 0x8);

        return Buffer.concat([this.buffer, ...this.fileBuffers]);
    }

    setHashMultiplier(multiplier: number) {
        this.hashMultiplier = multiplier;
    }

    setDefaultAlignment(alignment: number) {
        this.defaultAlignment = alignment;
    }

    getDataOffsetAlignment() {
        return this.dataOffsetAlignment;
    }

}

export class SFNTSection extends Section {

    static readonly magic = "SFNT";
    public static readonly headerSize = 0x8;

    private fileBuffers: Buffer[] = [];

    addFile(file: FileEntry) {
        const roundedUpLength = alignUp(Buffer.from(file.name).length + 1, 4);
        const entry = Buffer.alloc(roundedUpLength);

        entry.write(file.name);

        this.fileBuffers.push(entry);
    }

    getBuffer(): Buffer {
        this.buffer = Buffer.alloc(SFNTSection.headerSize);

        this.buffer.write(SFNTSection.magic);
        this.writeUInt16(SFNTSection.headerSize, 0x4);
        this.writeUInt16(0, 0x6);

        return Buffer.concat([this.buffer, ...this.fileBuffers]);
    }

}

export class FileDataSection extends Section {

    private fileBuffers: Buffer[] = [];
    private sectionSize = 0;

    private dataOffsetAlignment;
    private cursorPosition;

    addFile(file: FileEntry, alignment: number) {
        const totalFileLength = alignUp(this.sectionSize, alignment);
        const padding = totalFileLength - this.sectionSize;

        const entry = Buffer.concat([
            Buffer.alloc(padding),
            file.data,
        ]);

        this.sectionSize += entry.length;
        this.fileBuffers.push(entry);
    }

    getBuffer(): Buffer {
        const dataPadding = alignUpAsPadding(this.cursorPosition, this.dataOffsetAlignment);
        return Buffer.concat([
            Buffer.alloc(dataPadding),
            ...this.fileBuffers,
        ]);
    }

    setDataOffsetAlignment(dataOffsetAlignment: number) {
        this.dataOffsetAlignment = dataOffsetAlignment;
    }

    setCursorPosition(position: number) {
        this.cursorPosition = position;
    }

}

export function hashFileName(name: string, multiplier: number): number {
    let result = 0;
    new TextEncoder().encode(name).forEach((byte) => {
        result = ((result * multiplier + byte) & 0xFFFFFFFF) >>> 0;
    });
    return result;
}

export function alignUp(n: number, alignment: number): number {
    return ((n + alignment - 1) & -alignment) >>> 0;
}

function alignUpAsPadding(n: number, alignment: number): number {
    return (alignment - (n % alignment)) % alignment;
}

function getDataAlignment(data: Buffer, defaultAlignment: number): number {
    if (data.toString("ascii", 0, 4) === "SARC") {
        return 0x2000; // SARC archive
    } else if (data.toString("ascii", 0, 4) === "Yaz0") {
        return 0x80; // Yaz0 compressed archive
    } else if (data.toString("ascii", 0, 4) === "FFNT") {
        return 0x2000; // Wii U/Switch Binary font
    } else if (data.toString("ascii", 0, 4) === "CFNT") {
        return 0x80; // 3DS Binary font
    } else if (
        data.toString("ascii", 0, 4) === "CSTM" ||
        data.toString("ascii", 0, 4) === "FSTM" ||
        data.toString("ascii", 0, 4) === "FSTP" ||
        data.toString("ascii", 0, 4) === "CWAV" ||
        data.toString("ascii", 0, 4) === "FWAV"
    ) {
        return 0x20; // Audio data
    } else if (
        data.toString("ascii", 0, 4) === "BNTX" ||
        data.toString("ascii", 0, 4) === "BNSH" ||
        data.toString("ascii", 0, 8) === "FSHA    "
    ) {
        return 0x1000; // Switch GPU data
    } else if (data.toString("ascii", 0, 4) === "Gfx2" || data.toString("ascii", -0x28, -0x24) === "FLIM") {
        return 0x2000; // Wii U GPU data and Wii U/Switch Binary Resources
    } else if (data.toString("ascii", 0, 4) === "CTPK") {
        return 0x10; // 3DS Texture package
    } else if (data.toString("ascii", 0, 4) === "CGFX" || data.toString("ascii", -0x28, -0x24) === "CLIM") {
        return 0x80; // 3DS Layout image and Binary Resources
    } else if (data.toString("ascii", 0, 4) === "AAMP") {
        return 8; // Environment settings
    } else if (
        data.toString("ascii", 0, 2) === "YB" ||
        data.toString("ascii", 0, 2) === "BY" ||
        data.toString("ascii", 0, 8) === "MsgStdBn" ||
        data.toString("ascii", 0, 8) === "MsgPrjBn"
    ) {
        return 0x80;  // Binary text
    } else if (data.toString("ascii", 0xC, 0x10) === "SCDL") {
        return 0x100; // SMM2 Course data
    }

    return Math.max(defaultAlignment, getFileAlignmentForNewBinaryFile(data));
}

function getFileAlignmentForNewBinaryFile(data: Buffer): number {
    if (data.length <= 0x20) {
        return 0;
    }
    const bom = data.slice(0xc, 0xc + 2).toString();
    if (bom != "\xff\xfe" && bom != "\xfe\xff") {
        return 0;
    }

    const isLittleEndian = bom == "\xff\xfe";
    const fileSize = isLittleEndian ? data.readUInt32LE(0x1c) : data.readUInt32BE(0x1c);
    if (data.length != fileSize) {
        return 0;
    }
    return 1 << data[0xe];
}