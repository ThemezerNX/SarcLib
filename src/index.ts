/*
 https://github.com/kinnay/Nintendo-File-Formats/wiki/SARC-File-Format
 A combination of SarcLib by abood and sarc lib by zeldamods/leoetlino
 */

import * as fs from "fs";
import * as path from "path";
import {FileEntry} from "./FileEntry";
import {alignUp, FileDataSection, hashFileName, SARCSection, SFATSection, SFNTSection} from "./Sections";
import {decompressYaz0} from "@themezernx/yaz0lib/dist";

const {join} = require("path");
const {readdir} = require("fs").promises;

async function* getFiles(dir) {
    const dirents = await readdir(dir, {withFileTypes: true});
    for (const dirent of dirents) {
        const res = join(dir, dirent.name);
        if (dirent.isDirectory()) {
            yield* getFiles(res);
        } else {
            yield {path: res, data: fs.readFileSync(res)};
        }
    }
}

/**
 *
 * - Does not support files with duplicate names
 * - Does not support files without name
 */
export class SarcFile {

    hashMultiplier: number = 0x65;
    isLittleEndian: boolean = false;
    defaultAlignment = 0x04;

    entries: Array<FileEntry> = [];

    constructor(isLittleEndian?: boolean) {
        this.isLittleEndian = isLittleEndian;
    }

    addFile(file: FileEntry) {
        this.entries.push(file);
    }

    /**
     * Add a file to this SARC archive.
     * Note that if your fileName includes slashes, it will
     *
     * @param data
     * @param filePath
     */
    addRawFile(data: Buffer, filePath?: string) {
        this.entries.push(new FileEntry(data, filePath));
    }

    addFileFromPath(filePath: string, destinationFilePath?: string) {
        const data = fs.readFileSync(filePath);
        this.entries.push(new FileEntry(data, destinationFilePath || path.basename(filePath)));
    }

    removeFile(file: FileEntry) {
        this.entries.splice(this.entries.indexOf(file), 1);
    }

    /**
     * Add all files inside a folder to the SARC archive (recursively).
     * Note that contents of this folder are stored in the root of the SARC: the folder itself is not included.
     *
     * @param folderPath
     * @param folderName
     */
    async addFolderContentsFromPath(folderPath: string, folderName?: string) {
        for await (const f of getFiles(folderPath)) {
            const fileName = f.path
                .replace(folderPath, "") // remove common base paths
                .replace(/^[\\\/]+|[\\\/]+$/g, ""); // trim slashes
            this.entries.push(new FileEntry(f.data, fileName));
        }
    }

    getFiles() {
        return this.entries;
    }

    setDefaultAlignment(value: number) {
        if (value === 0 || (value & Number((value - 1) !== 0)) >>> 0) {
            throw new Error("Alignment must be a non-zero power of 2");
        }
        this.defaultAlignment = value;
    }

    /**
     * Set the hash multiplier used for filename hashing.
     *
     * @param value
     */
    setHashMultiplier(value: number) {
        this.hashMultiplier = value;
    }

    getIsLittleEndian(): boolean {
        return this.isLittleEndian;
    }

    setLittleEndian(isLittleEndian: boolean) {
        this.isLittleEndian = isLittleEndian;
    }

    /**
     * readUInt16.
     *
     * @param buffer
     * @param offset
     * @return {number}
     */
    private readUInt16(buffer: Buffer, offset?: number) {
        return this.isLittleEndian ?
            buffer.readUInt16LE(offset) :
            buffer.readUInt16BE(offset);
    }

    /**
     * readUInt32.
     *
     * @param buffer
     * @param offset
     * @return {number}
     */
    private readUInt32(buffer: Buffer, offset?: number) {
        return this.isLittleEndian ?
            buffer.readUInt32LE(offset) :
            buffer.readUInt32BE(offset);
    }

    private readName(data: Buffer, offset: number) {
        const end = data.indexOf(0, offset);
        return data.slice(offset, end).toString();
    }

    private parseFileNodes(data: Buffer, nodeOffset: number, nodeCount: number, nameTableOffset: number, dataOffset: number) {
        let nodes: Array<FileEntry> = [];

        let offset = nodeOffset;
        for (let i = 0; i < nodeCount; i++) {
            const nameHash = this.readUInt32(data, offset);
            const nameId = this.readUInt32(data, offset + 4);
            const _hasFilename = nameId >>> 24;
            const nameOffset = (nameId & 0xffffff) >>> 0;
            const fileDataBegin = this.readUInt32(data, offset + 8) + dataOffset;
            const fileDataEnd = this.readUInt32(data, offset + 0xc) + dataOffset;

            if (nameId == 0) {
                throw new Error("Unnamed files are not supported");
            }
            const absNameOffset = nameTableOffset + 4 * nameOffset;
            if (absNameOffset > dataOffset) {
                throw new Error("Invalid name offset for 0x" + nameHash.toString(16));
            }

            const name = this.readName(data, absNameOffset);
            nodes.push(new FileEntry(data.subarray(fileDataBegin, fileDataEnd), name));
            offset += 0x10;
        }

        return nodes;
    }

    load(data: Buffer) {
        let decompressed = data;
        try {
            decompressed = decompressYaz0(decompressed);
        } catch (e) {
        }

        // This mirrors what the official library does when reading an archive
        // (sead::SharcArchiveRes::prepareArchive_)

        // Parse the SARC header.
        if (decompressed.subarray(0x00, 0x04).toString() != SARCSection.magic) {
            throw new Error("Unknown SARC magic");
        }
        const bom = decompressed.subarray(0x06, 0x08);
        this.isLittleEndian = bom[0] == 0xFF && bom[1] == 0xFE;
        if (!this.isLittleEndian && !(bom[0] == 0xFE && bom[1] == 0xFF)) {
            throw new Error("Invalid BOM");
        }
        const version = this.readUInt16(decompressed, 0x10);
        if (version != SARCSection.version) {
            throw new Error("Unknown SARC version");
        }
        const sarcHeaderSize = this.readUInt16(decompressed, 0x4);
        if (sarcHeaderSize != SARCSection.headerSize) {
            throw new Error("Unexpected SARC header size");
        }

        // Parse the SFAT header.
        const sfatHeaderOffset = sarcHeaderSize;
        if (decompressed.subarray(sfatHeaderOffset, sfatHeaderOffset + 4).toString() != SFATSection.magic) {
            throw new Error("Unknown SFAT magic");
        }
        const sfatHeaderSize = this.readUInt16(decompressed, sfatHeaderOffset + 4);
        if (sfatHeaderSize != SFATSection.headerSize) {
            throw new Error("Unexpected SFAT header size");
        }
        const nodeCount = this.readUInt16(decompressed, sfatHeaderOffset + 6);
        const nodeOffset = sarcHeaderSize + sfatHeaderSize;
        if ((nodeCount >>> 0xe) != 0) {
            throw new Error("Too many entries");
        }

        // Parse the SFNT header.
        const sfntHeaderOffset = nodeOffset + 0x10 * nodeCount;
        if (decompressed.subarray(sfntHeaderOffset, sfntHeaderOffset + 4).toString() != SFNTSection.magic) {
            throw new Error("Unknown SFNT magic");
        }
        const sfntHeaderSize = this.readUInt16(decompressed, sfntHeaderOffset + 4);
        if (sfntHeaderSize != SFNTSection.headerSize) {
            throw new Error("Unexpected SFNT header size");
        }
        const nameTableOffset = sfntHeaderOffset + sfntHeaderSize;

        // Check the data offset.
        const dataOffset = this.readUInt32(decompressed, 0xc);
        if (dataOffset < nameTableOffset) {
            throw new Error("File data should not be stored before the name table");
        }

        this.entries = this.parseFileNodes(decompressed, nodeOffset, nodeCount, nameTableOffset, dataOffset);
    }

    loadFrom(filePath: string) {
        this.load(fs.readFileSync(filePath));
    }

    save(): Buffer {
        // File preparations ------------------------------------------
        const hashedList: { [name: number]: FileEntry } = {};

        for (const file of this.entries) {
            file.name = file.name.replace(/[\\\/]+/gm, "/");
            hashedList[hashFileName(file.name, this.hashMultiplier)] = file;
        }

        const sortedFlatList = Object.keys(hashedList).sort().reduce(
            (obj, key) => {
                obj[key] = hashedList[key];
                return obj;
            },
            {},
        );
        const sortedHashes = Object.keys(sortedFlatList);

        // Sections ----------------------------------------------------

        // SARC
        const sarc = new SARCSection(this.isLittleEndian);

        // SFAT, SFNT & File Data
        const sfat = new SFATSection(this.isLittleEndian);
        sfat.setHashMultiplier(this.hashMultiplier);
        sfat.setDefaultAlignment(this.defaultAlignment);

        const sfnt = new SFNTSection(this.isLittleEndian);
        const fileData = new FileDataSection(this.isLittleEndian);

        for (const hash of sortedHashes) {
            const file = hashedList[hash];
            const alignment = sfat.addFile(Number(hash), file);
            sfnt.addFile(file);
            fileData.addFile(file, alignment);
        }

        const sfatBuffer = sfat.getBuffer();
        const sfntBuffer = sfnt.getBuffer();

        fileData.setDataOffsetAlignment(sfat.getDataOffsetAlignment());
        fileData.setCursorPosition(SARCSection.headerSize + sfatBuffer.length + sfntBuffer.length);
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

    saveTo(filePath: string) {
        return fs.writeFileSync(filePath, this.save());
    }

    extractTo(destDir: string) {
        for (const file of this.entries) {
            const filePath = destDir.replace(/[\\\/]$/, '') + "/" + file.name;
            try {
                fs.mkdirSync(path.dirname(filePath), {recursive: true});
            } catch (e) {
                // do nothing
            }
            fs.writeFileSync(filePath, file.data);
        }
    }

}


