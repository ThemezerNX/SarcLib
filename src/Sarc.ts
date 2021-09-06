/*
 https://github.com/kinnay/Nintendo-File-Formats/wiki/SARC-File-Format
 A combination of SarcLib by abood and sarc lib by zeldamods/leoetlino
 */

import * as fs from "fs";
import * as path from "path";
import {decompressYaz0} from "@themezernx/yaz0lib/dist";

const _NUL_CHAR = "\x00";
const _SFAT_NODE_SIZE = 0x10;

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
        const sfntHeaderOffset = nodeOffset + _SFAT_NODE_SIZE * nodeCount;
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
            offset += _SFAT_NODE_SIZE;
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
        let ext = "";
        const lastIndex = name.lastIndexOf(".");
        if (lastIndex != -1) {
            name = name.substring(0, lastIndex);
            ext = name.substring(lastIndex);
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

// class PlaceholderOffsetWriter {
//     private buffer: Buffer;
//     private offset: number;
//     private parent: SarcWriter;
//
//
//     constructor(buffer: Buffer, parent: SarcWriter) {
//         this.buffer = buffer;
//         this.offset = buffer.length;
//         this.parent = parent;
//     }
//
//     writePlaceholder() {
//         this.parent.writeUInt32(this.buffer, 0xffffffff);
//     }
//
//     writeOffset(offset: number, base: number = 0) {
//         this.parent.writeUInt32(this.buffer, offset - base, offset);
//     }
//
//     writeCurrentOffset(base: number = 0) {
//         this.writeOffset(this.offset, base);
//     }
// }

export class SarcWriter {
    defaultAlignment = 4;
    hashMultiplier: number = 0x65;
    hasProperResourceSystem: boolean = true;
    files: { [name: string]: FileEntry | FolderEntry } = {};
    isLittleEndian: boolean;

    private getDataAlignment(data: Buffer): number {
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

        return Math.max(this.defaultAlignment, this.getFileAlignmentForNewBinaryFile(data));
    }

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

    // private getFileAlignmentForSarc(file: FileEntry): number {
    //     if (this.hasProperResourceSystem) {
    //         return 0;
    //     }
    //     if (file.data.length <= 0x4) {
    //         return 0;
    //     }
    //     return this.getDataAlignment(file.data);
    // }

    private getFileAlignmentForSarc(file: FileEntry): number {
        let data = file.data;
        if (this.hasProperResourceSystem) {
            return 0;
        }
        if (data.length <= 0x4) {
            return 0;
        }
        if (data.slice(0, 4).toString() == "Yaz0" && data.slice(0x11, 0x15).toString() == "SARC") {
            data = decompressYaz0(data);
        }
        if (data.slice(0, 4).toString() != "SARC") {
            return 0;
        }
        // In some archives (SMO for example), Nintendo seems to use a somewhat arbitrary
        // alignment requirement (0x2000) for nested SARCs.
        return 0x2000;
    }

    private static alignUp(n: number, alignment: number): number {
        return ((n + alignment - 1) & -alignment) >>> 0;
    }

    /**
     * readUInt16.
     *
     * @param buffer
     * @param offset
     * @param isLittleEndian
     * @return {number}
     */
    private readUInt16(buffer: Buffer, offset?: number, isLittleEndian?: boolean) {
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
    private readUInt32(buffer: Buffer, offset?: number, isLittleEndian?: boolean) {
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
    writeUInt16(buffer: Buffer, value: number, offset?: number, isLittleEndian?: boolean) {
        const little = isLittleEndian != undefined ? isLittleEndian : this.isLittleEndian;
        return little ?
            buffer.writeUInt16LE(value, offset) :
            buffer.writeUInt16BE(value, offset);
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
    writeUInt32(buffer: Buffer, value: number, offset?: number, isLittleEndian?: boolean) {
        const little = isLittleEndian != undefined ? isLittleEndian : this.isLittleEndian;
        return little ?
            buffer.writeUInt32LE(value, offset) :
            buffer.writeUInt32BE(value, offset);
    }

    private getFileAlignmentForNewBinaryFile(data: Buffer): number {
        if (data.length <= 0x20) {
            return 0;
        }
        let bom = data.slice(0xc, 0xc + 2).toString();
        if (bom != "\xff\xfe" && bom != "\xfe\xff") {
            return 0;
        }

        let le = bom == "\xff\xfe";
        let fileSize: number = this.readUInt32(data, 0x1c, le);
        if (data.length != fileSize) {
            return 0;
        }
        return 1 << data[0xe];
    }

    private hashFileName(name: string): number {
        let result = 0;
        new TextEncoder().encode(name).forEach((byte) => {
            result = ((result * this.hashMultiplier + byte) & 0xFFFFFFFF) >>> 0;
        });
        return result;
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
            flatList[this.hashFileName(item.name)] = item;
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
        const flatList: { [name: number]: FileEntry } = {};

        for (const fileName of Object.keys(this.files)) {
            const item = this.files[fileName];

            if (item instanceof FileEntry) {
                // File object
                flatList[this.hashFileName(item.name)] = item;
            } else {
                // Folder object
                this.flattenFolder(flatList, item, item.name);
            }
        }

        // SARC header
        const sarcHeader = Buffer.alloc(4 + 2 + 2 + 4 + 4 + 2 + 2);
        sarcHeader.write("SARC", 0x0, 4); // magic
        this.writeUInt16(sarcHeader, 0x14, 0x4); // header size
        this.writeUInt16(sarcHeader, 0xFEFF, 0x6); // endian
        const fileSizeOffset = 0x8;
        const dataOffsetOffset = 0xC;
        this.writeUInt16(sarcHeader, 0x100, 0x10); // sarc version
        this.writeUInt16(sarcHeader, 0, 0x12); // padding

        // SFAT header
        let sfat = Buffer.alloc(4 + 2 + 2 + 4);
        sfat.write("SFAT", 0x0, 4);
        this.writeUInt16(sfat, 0xc, 0x4);
        this.writeUInt16(sfat, Object.keys(this.files).length, 0x6);
        this.writeUInt32(sfat, this.hashMultiplier, 0x8);

        // SFAT entries information
        const orderedFlatList = Object.keys(flatList).sort().reduce(
            (obj, key) => {
                obj[key] = flatList[key];
                return obj;
            },
            {},
        );

        let sortedHashes = Object.keys(orderedFlatList).sort();
        let fileAlignments: number[] = [];
        let nameOffset = 0;
        let dataOffset = 0;
        // Some files have specific alignment requirements. These must be satisfied by
        // aligning file offsets *and* the data offset to the maximum alignment value
        // since file offsets are always relative to the data offset.
        let dataOffsetAlignment = 1;
        for (let hash of sortedHashes) {
            const entry = Buffer.alloc(4 + 4 + 4 + 4);

            const file = flatList[hash];
            this.writeUInt32(entry, Number(hash), 0x0);
            this.writeUInt32(entry, 0x01000000 | (nameOffset >>> 2), 0x4); // todo: no name at all
            let alignment = this.getDataAlignment(file.data);
            dataOffsetAlignment = Math.max(dataOffsetAlignment, alignment);
            fileAlignments.push(alignment);
            dataOffset = SarcWriter.alignUp(dataOffset, alignment);
            this.writeUInt32(entry, dataOffset, 0x8);
            dataOffset += file.data.length;
            this.writeUInt32(entry, dataOffset, 0xc);
            nameOffset += SarcWriter.alignUp(new TextEncoder().encode(file.name).length + 1, 4);

            sfat = Buffer.concat([sfat, entry]);
        }

        // File name table
        let fileNameTable = Buffer.alloc(4 + 2 + 2);
        fileNameTable.write("SFNT", 0x0, 4); // magic
        this.writeUInt16(fileNameTable, 0x8, 0x4); // header size
        this.writeUInt16(fileNameTable, 0, 0x6); // padding
        for (let hash of sortedHashes) {
            const file = flatList[hash];
            const nameBuffer = Buffer.from(file.name);

            const roundedUpLength = SarcWriter.alignUp(
                fileNameTable.length + nameBuffer.length + 1,
                4,
            );
            fileNameTable = Buffer.concat([
                fileNameTable,
                Buffer.from(file.name),
            ], roundedUpLength);
        }

        const sfatNodesTableLength = 0x10 * sortedHashes.length;
        console.log(sfatNodesTableLength, fileNameTable.length, "TOTAL:", 0x20 + sfatNodesTableLength + 0x08 + fileNameTable.length)
        let dataStartOffset = Math.max(
            SarcWriter.alignUp(0x20 + dataOffset + 0x08 + fileNameTable.length, 0x04),
            SarcWriter.alignUp(0, 0x04),
        );

        // File Data
        let maxAlignment = 0;
        let fileDataTable = Buffer.alloc(0);
        for (let i = 0; i < sortedHashes.length; i++) {
            const hash = sortedHashes[i];
            const data = flatList[hash].data;
            const alignment = this.getDataAlignment(data);
            const totalFileLength = SarcWriter.alignUp(fileDataTable.length, alignment);
            maxAlignment = Math.max(maxAlignment, alignment);

            const padding = totalFileLength - fileDataTable.length;

            fileDataTable = Buffer.concat([
                fileDataTable,
                Buffer.alloc(padding),
                data,
            ]);
        }

        dataStartOffset = SarcWriter.alignUp(dataStartOffset, maxAlignment);
        const totalFileLength = dataStartOffset + fileDataTable.length;
        console.log(totalFileLength, dataStartOffset, fileDataTable.length)

        this.writeUInt32(sarcHeader, totalFileLength, fileSizeOffset); // filesize
        this.writeUInt32(sarcHeader, dataStartOffset, dataOffsetOffset); // data offset

        // File Data table padding
        const headerSize = sarcHeader.length + sfat.length + fileNameTable.length;

        let fileDataTablePadding = 0;
        console.log(dataStartOffset, headerSize);
        if (dataStartOffset > headerSize) {
            fileDataTablePadding = dataStartOffset - headerSize;
        }
        console.log(fileDataTablePadding);

        return Buffer.concat([
            sarcHeader,
            sfat,
            fileNameTable,
            Buffer.alloc(fileDataTablePadding),
            fileDataTable,
        ]);
    }

    // private wr() {
    //     // SARC header
    //     let stream = new BinaryStream();
    //     stream.write("SARC");
    //     stream.write(this._u16(0x14));
    //     stream.write(this._u16(0xfeff));
    //     let file_size_writer = this._write_placeholder_offset(stream);
    //     let data_offset_writer = this._write_placeholder_offset(stream);
    //     stream.write(this._u16(0x100));
    //     stream.write(this._u16(0)); // Unused.
    //
    //     // SFAT header
    //     stream.write("SFAT");
    //     stream.write(this._u16(0xc));
    //     stream.write(this._u16(Object.keys(this._files).length));
    //     stream.write(this._u32(this._hash_multiplier));
    //
    //     // Node information
    //     let sorted_hashes = Object.keys(this._files).sort();
    //     let file_alignments: number[] = [];
    //     let string_offset = 0;
    //     let data_offset = 0;
    //     // Some files have specific alignment requirements. These must be satisfied by
    //     // aligning file offsets *and* the data offset to the maximum alignment value
    //     // since file offsets are always relative to the data offset.
    //     let data_offset_alignment = 1;
    //     for (let h of sorted_hashes) {
    //         stream.write(this._u32(parseInt(h)));
    //         stream.write(this._u32(0x01000000 | (string_offset >>> 2)));
    //         let alignment = this._get_alignment_for_file_data(this._files[h]);
    //         data_offset_alignment = Math.max(data_offset_alignment, alignment);
    //         file_alignments.push(alignment);
    //         data_offset = _align_up(data_offset, alignment);
    //         stream.write(this._u32(data_offset));
    //         data_offset += this._files[h].data.length;
    //         stream.write(this._u32(data_offset));
    //         string_offset += _align_up(this._files[h].name.length + 1, 4);
    //     }
    //
    //     // File name table
    //     stream.write("SFNT");
    //     stream.write(this._u16(8));
    //     stream.write(this._u16(0));
    //     for (let h of sorted_hashes) {
    //         stream.write(this._files[h].name);
    //         stream.write(_NUL_CHAR);
    //         stream.seek(_align_up(stream.tell(), 4));
    //     }
    //
    //     // File data
    //     stream.seek(_align_up(stream.tell(), data_offset_alignment));
    //     for (let i = 0; i < sorted_hashes.length; i++) {
    //         let h = sorted_hashes[i];
    //         stream.seek(_align_up(stream.tell(), file_alignments[i]));
    //         if (i == 0) {
    //             data_offset_writer.write_current_offset();
    //         }
    //         stream.write(this._files[h].data); // type: ignore
    //     }
    //
    //     // Write the final file size.
    //     file_size_writer.write_current_offset();
    //     return data_offset_alignment;
    // }

}