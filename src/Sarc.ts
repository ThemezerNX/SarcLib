/*
 https://github.com/kinnay/Nintendo-File-Formats/wiki/SARC-File-Format
 A combination of SarcLib by abood and sarc lib by zeldamods/leoetlino
 */

import * as fs from "fs";
import * as path from "path";

function gcd(a: number, b: number): number {
    if (!b) {
        return a;
    }

    return gcd(b, a % b);
}

class FileEntry {
    name: string;
    data: Buffer;
    hasFilename: boolean;

    constructor(name: string = "", data: Buffer = Buffer.alloc(0), hasFilename: boolean = true) {
        this.name = name;
        this.data = data;
        this.hasFilename = hasFilename;
    }
}

class FolderEntry {
    name: string;
    entries: Array<FileEntry | FolderEntry>;

    constructor(name: string = "", contents: Array<FileEntry | FolderEntry> = []) {
        this.name = name;
        this.entries = contents;
    }

    addFile(file: FileEntry) {
        this.entries.push(file);
    }

    removeFile(file: FileEntry) {
        this.entries.splice(this.entries.indexOf(file), 1);
    }

    addFolder(folder: FolderEntry) {
        this.entries.push(folder);
    }

    removeFolder(folder: FolderEntry) {
        this.entries.splice(this.entries.indexOf(folder), 1);
    }

}

export class SarcReader {
    private data: Buffer;
    private files: { [name: string]: [number, number] } = {};
    private dataOffset: number = 0;
    private isLittleEndian: boolean = false;

    constructor(data: Buffer) {
        this.data = data;

        // This mirrors what the official library does when reading an archive
        // (sead::SharcArchiveRes::prepareArchive_)

        // Parse the SARC header.
        if (this.data[0] != 0x53 || this.data[1] != 0x41 || this.data[2] != 0x52 || this.data[3] != 0x43) {
            throw new Error("Unknown SARC magic");
        }
        const bom = this.data.subarray(6, 8);
        this.isLittleEndian = bom[0] == 0xFF && bom[1] == 0xFE;
        if (!this.isLittleEndian && !(bom[0] == 0xFE && bom[1] == 0xFF)) {
            throw new Error("Invalid BOM");
        }
        const version = this.readU16(0x10);
        if (version != 0x100) {
            throw new Error("Unknown SARC version");
        }
        const sarcHeaderSize = this.readU16(0x4);
        if (sarcHeaderSize != 0x14) {
            throw new Error("Unexpected SARC header size");
        }

        // Parse the SFAT header.
        const sfatHeaderOffset = sarcHeaderSize;
        if (this.data.subarray(sfatHeaderOffset, sfatHeaderOffset + 4).toString() != "SFAT") {
            throw new Error("Unknown SFAT magic");
        }
        const sfatHeaderSize = this.readU16(sfatHeaderOffset + 4);
        if (sfatHeaderSize != 0xc) {
            throw new Error("Unexpected SFAT header size");
        }
        const nodeCount = this.readU16(sfatHeaderOffset + 6);
        const nodeOffset = sarcHeaderSize + sfatHeaderSize;
        if ((nodeCount >>> 0xe) != 0) {
            throw new Error("Too many entries");
        }

        // Parse the SFNT header.
        const sfntHeaderOffset = nodeOffset + 0x10 * nodeCount;
        if (this.data.subarray(sfntHeaderOffset, sfntHeaderOffset + 4).toString() != "SFNT") {
            throw new Error("Unknown SNFT magic");
        }
        const sfntHeaderSize = this.readU16(sfntHeaderOffset + 4);
        if (sfntHeaderSize != 8) {
            throw new Error("Unexpected SFNT header size");
        }
        const nameTableOffset = sfntHeaderOffset + sfntHeaderSize;

        // Check the data offset.
        this.dataOffset = this.readU32(0xc);
        if (this.dataOffset < nameTableOffset) {
            throw new Error("File data should not be stored before the name table");
        }

        this.files = this.parseFileNodes(nodeOffset, nodeCount, nameTableOffset);
    }

    private parseFileNodes(nodeOffset: number, nodeCount: number, nameTableOffset: number) {
        let nodes: { [name: string]: [number, number] } = {};

        let offset = nodeOffset;
        for (let i = 0; i < nodeCount; i++) {
            const nameHash = this.readU32(offset);
            const nameId = this.readU32(offset + 4);
            const hasFilename = nameId >>> 24;
            const nameOffset = (nameId & 0xffffff) >>> 0;
            const fileDataBegin = this.readU32(offset + 8);
            const fileDataEnd = this.readU32(offset + 0xc);

            if (nameId == 0) {
                throw new Error("Unnamed files are not supported");
            }
            const absNameOffset = nameTableOffset + 4 * nameOffset;
            if (absNameOffset > this.dataOffset) {
                throw new Error("Invalid name offset for 0x" + nameHash.toString(16));
            }

            const name = this.readString(absNameOffset);
            nodes[name] = [fileDataBegin, fileDataEnd];
            offset += 0x10;
        }

        return nodes;
    }

    guessDefaultAlignment() {
        if (Object.keys(this.files).length <= 2) {
            return 4;
        }
        let divider = this.files[Object.keys(this.files)[0]][0] + this.dataOffset;
        for (let i = 0; i < Object.keys(this.files).length; i++) {
            divider = gcd(divider, this.files[Object.keys(this.files)[i]][0] + this.dataOffset);
        }

        if (divider == 0 || (divider & Number((divider - 1) != 0)) >>> 0) {
            // If the GCD is not a power of 2, the files are mostly likely NOT aligned.
            return 4;
        }

        return divider;
    }

    getDataOffset() {
        return this.dataOffset;
    }

    getFileOffsets() {
        const offsets: Array<[string, number]> = [];
        for (let name in this.files) {
            const node = this.files[name];
            offsets.push([name, node[0]]);
        }
        return offsets.sort((a, b) => a[1] - b[1]);
    }

    listFiles() {
        return Object.keys(this.files);
    }

    isArchive(name: string) {
        const node = this.files[name];
        const size = node[1] - node[0];
        if (size < 4) {
            return false;
        }

        const magic = this.data.subarray(this.dataOffset + node[0], this.dataOffset + node[0] + 4);
        if (magic.toString() == "SARC") {
            return true;
        } else if (magic.toString() == "Yaz0" || magic.toString() == "Yaz1") {
            if (size < 0x15) {
                return false;
            }
            const fourcc = this.data.subarray(this.dataOffset + node[0] + 0x11, this.dataOffset + node[0] + 0x15);
            if (fourcc.toString() == "SARC") {
                return true;
            }
        }
        return false;
    }

    getFileData(name: string) {
        const node = this.files[name];
        return this.data.subarray(this.dataOffset + node[0], this.dataOffset + node[1]);
    }

    getFileSize(name: string) {
        const node = this.files[name];
        return node[1] - node[0];
    }

    getFileDataOffset(name: string) {
        return this.files[name][0];
    }

    extract(archiveName: string, printNames: boolean = false) {
        let name = archiveName;
        let _ext = "";
        const lastIndex = name.lastIndexOf(".");
        if (lastIndex != -1) {
            name = name.substring(0, lastIndex);
            _ext = name.substring(lastIndex);
        }
        try {
            fs.mkdirSync(name);
        } catch (e) {
            // do nothing
        }
        this.extractToDir(name, printNames);
    }

    private extractToDir(destDir: string, printNames: boolean = false) {
        for (let fileName in this.files) {
            const node = this.files[fileName];
            const filePath = destDir + "/" + fileName;
            try {
                fs.mkdirSync(path.dirname(filePath), {recursive: true});
            } catch (e) {
                // do nothing
            }
            const fileData = this.data.subarray(this.dataOffset + node[0], this.dataOffset + node[1]);
            if (printNames) {
                console.log(filePath);
            }
            fs.writeFileSync(filePath, fileData);
        }
    }

    private readU16(offset: number) {
        return new DataView(this.data.buffer).getUint16(offset, this.isLittleEndian);
    }

    private readU32(offset: number) {
        return new DataView(this.data.buffer).getUint32(offset, this.isLittleEndian);
    }

    private readString(offset: number) {
        const end = this.data.indexOf(0, offset);
        return this.data.slice(offset, end).toString();
    }

}

abstract class Section {

    private isLittleEndian = false;
    protected buffer: Buffer;

    constructor(isLittleEndian: boolean) {
        this.isLittleEndian = isLittleEndian;
    }

    setIsLittleEndian(isLittleEndian: boolean) {
        this.isLittleEndian = isLittleEndian;
    }

    abstract getBuffer(): Buffer;

    /**
     * readUInt16.
     *
     * @param buffer
     * @param offset
     * @param isLittleEndian
     * @return {number}
     */
    protected readUInt16(buffer: Buffer, offset?: number, isLittleEndian?: boolean) {
        const little = isLittleEndian != undefined ? isLittleEndian : this.isLittleEndian;
        return little ?
            buffer.readUInt16LE(offset) :
            buffer.readUInt16BE(offset);
    }

    /**
     * readUInt32.
     *
     * @param buffer
     * @param offset
     * @param isLittleEndian
     * @return {number}
     */
    protected readUInt32(buffer: Buffer, offset?: number, isLittleEndian?: boolean) {
        const little = isLittleEndian != undefined ? isLittleEndian : this.isLittleEndian;
        return little ?
            buffer.readUInt32LE(offset) :
            buffer.readUInt32BE(offset);
    }

    /**
     * writeUInt16.
     *
     * @param buffer
     * @param value
     * @param offset
     * @param isLittleEndian
     * @return {number}
     */
    writeUInt16(value: number, offset?: number, buffer?: Buffer, isLittleEndian?: boolean) {
        const little = isLittleEndian != undefined ? isLittleEndian : this.isLittleEndian;
        const dest = buffer ? buffer : this.buffer;
        return little ?
            dest.writeUInt16LE(value, offset) :
            dest.writeUInt16BE(value, offset);
    }


    /**
     * writeUInt32.
     *
     * @param buffer
     * @param value
     * @param offset
     * @param isLittleEndian
     * @return {number}
     */
    writeUInt32(value: number, offset?: number, buffer?: Buffer, isLittleEndian?: boolean) {
        const little = isLittleEndian != undefined ? isLittleEndian : this.isLittleEndian;
        const dest = buffer ? buffer : this.buffer;
        return little ?
            dest.writeUInt32LE(value, offset) :
            dest.writeUInt32BE(value, offset);
    }

}

class SARCSection extends Section {

    private static readonly magic = "SARC";
    public static readonly headerSize = 0x14;
    private static readonly endianConst = 0xFEFF;
    private static readonly version = 0x100;
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

class SFATSection extends Section {

    private static readonly magic = "SFAT";
    public static readonly headerSize = 0xC;
    public static readonly entrySize = 0xF;
    private readonly alignments = [];
    private hashMultiplier = 0x65;
    private fileBuffers: Buffer[] = [];

    private defaultAlignment = 0x04;
    private nameOffset = 0;
    private dataOffset = 0;
    private dataOffsetAlignment = 1;

    addFile(hash: number, file: FileEntry) {
        const entry = Buffer.alloc(SFATSection.entrySize);

        this.writeUInt32(hash, 0x0, entry);
        this.writeUInt32(0x01000000 | (this.nameOffset >>> 2), 0x4, entry);

        let alignment = getDataAlignment(file.data, this.defaultAlignment);
        this.alignments.push(alignment);
        this.dataOffsetAlignment = Math.max(this.dataOffsetAlignment, alignment);
        this.dataOffset = alignUp(this.dataOffset, alignment);

        this.writeUInt32(this.dataOffset, 0x8, entry);
        this.dataOffset += file.data.length;
        this.writeUInt32(this.dataOffset, 0xc, entry);
        this.nameOffset += alignUp(Buffer.from(file.name).length + 1, 4);

        this.fileBuffers.push(entry);
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

    getAlignments() {
        return this.alignments;
    }

}

class SFNTSection extends Section {

    private static readonly magic = "SFNT";
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

class FileDataSection extends Section {

    private fileBuffers: Buffer[] = [];
    private sectionSize = 0;

    private dataOffsetAlignment;
    private cursorPosition;

    addFile(file: FileEntry, alignment: number) {
        const totalFileLength = alignUp(this.sectionSize, alignment);
        const padding = totalFileLength - this.sectionSize;

        console.log(`Padding for file ${this.fileBuffers.length + 1}:`, padding);

        const entry = Buffer.concat([
            Buffer.alloc(padding),
            file.data,
        ]);

        this.sectionSize += entry.length;
        this.fileBuffers.push(entry);
    }

    getBuffer(): Buffer {
        const dataPadding = alignUpAsPadding(this.cursorPosition, this.dataOffsetAlignment);
        console.log("Extra padding to data from",
            this.cursorPosition,
            "with",
            dataPadding,
            ", because of",
            this.dataOffsetAlignment);
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

function hashFileName(name: string, multiplier: number): number {
    let result = 0;
    new TextEncoder().encode(name).forEach((byte) => {
        result = ((result * multiplier + byte) & 0xFFFFFFFF) >>> 0;
    });
    return result;
}

function alignUp(n: number, alignment: number): number {
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

export class SarcWriter {
    hashMultiplier: number = 0x65;
    hasProperResourceSystem: boolean = true;
    files: { [name: string]: FileEntry | FolderEntry } = {};
    isLittleEndian: boolean;
    defaultAlignment = 0x04;

    constructor(isLittleEndian: boolean) {
        this.isLittleEndian = isLittleEndian;
    }

    setAlignForNestedSarc(enable: boolean) {
        this.hasProperResourceSystem = !enable;
    }

    setHasProperResourceSystem(has_proper_res_system: boolean) {
        this.hasProperResourceSystem = has_proper_res_system;
    }

    setDefaultAlignment(value: number) {
        if (value === 0 || (value & Number((value - 1) !== 0)) >>> 0) {
            throw new Error("Alignment must be a non-zero power of 2");
        }
        this.defaultAlignment = value;
    }

    setLittleEndian(isLittleEndian: boolean) {
        this.isLittleEndian = isLittleEndian;
    }

    public addFile(name: string, data: Buffer): void {
        this.files[name] = new FileEntry(name, data);
    }

    public deleteFile(name: string): void {
        delete this.files[name];
    }

    private flattenFolder(flatList: { [name: number]: FileEntry }, item: FileEntry | FolderEntry, path: string = "") {
        path = path.replace(/(\/{2,}|\\+)/gm, "/");

        if (item instanceof FileEntry) {
            // File object
            flatList[hashFileName(item.name, this.hashMultiplier)] = item;
        } else {
            // Folder object
            for (const folderEntry of item.entries) {
                if (path.charAt(path.length - 1) != "/") {
                    path += "/";
                }
                this.flattenFolder(flatList, folderEntry, path);
            }
        }

        return flatList;
    }

    getBuffer(): Buffer {
        // File preparations ------------------------------------------
        const flatList: { [name: number]: FileEntry } = {};

        for (const fileName of Object.keys(this.files)) {
            const item = this.files[fileName];

            if (item instanceof FileEntry) {
                // File object
                flatList[hashFileName(item.name, this.hashMultiplier)] = item;
            } else {
                // Folder object
                this.flattenFolder(flatList, item, item.name);
            }
        }

        const sortedFlatList = Object.keys(flatList).sort().reduce(
            (obj, key) => {
                obj[key] = flatList[key];
                return obj;
            },
            {},
        );
        const sortedHashes = Object.keys(sortedFlatList);

        // Sections ----------------------------------------------------

        // SARC
        const sarc = new SARCSection(this.isLittleEndian);

        // SFAT & SFNT
        const sfat = new SFATSection(this.isLittleEndian);
        sfat.setHashMultiplier(this.hashMultiplier);
        sfat.setDefaultAlignment(this.defaultAlignment);

        const sfnt = new SFNTSection(this.isLittleEndian);

        for (const hash of sortedHashes) {
            sfat.addFile(Number(hash), flatList[hash]);
            sfnt.addFile(flatList[hash]);
        }

        const sfatBuffer = sfat.getBuffer();
        const sfntBuffer = sfnt.getBuffer();

        // File Data
        const fileData = new FileDataSection(this.isLittleEndian);
        fileData.setDataOffsetAlignment(sfat.getDataOffsetAlignment());
        fileData.setCursorPosition(SARCSection.headerSize + sfatBuffer.length + sfntBuffer.length);
        const alignments = sfat.getAlignments();
        for (let i = 0; i < sortedHashes.length; i++) {
            const hash = sortedHashes[i];
            const alignment = alignments[i];
            fileData.addFile(flatList[hash], alignment);
        }
        const fileDataBuffer = fileData.getBuffer();

        const dataStartOffset = alignUp(
            alignUp(SARCSection.headerSize + sfatBuffer.length + sfntBuffer.length, 0x04),
            sfat.getDataOffsetAlignment(),
        );

        // Write file size and data offset
        const totalFileLength = SARCSection.headerSize + sfatBuffer.length + sfntBuffer.length + fileDataBuffer.length;
        sarc.setFileSize(totalFileLength);
        sarc.setDataOffset(dataStartOffset);

        return Buffer.concat([
            sarc.getBuffer(),
            sfatBuffer,
            sfntBuffer,
            fileDataBuffer,
        ]);
    }

}