/*
 https://github.com/kinnay/Nintendo-File-Formats/wiki/SARC-File-Format
 Based on SarcLib by MasterVermilli0n/AboodXD and sarc by zeldamods/leoetlino
 */

import * as fs from "fs";
import * as path from "path";
import {FileEntry} from "./FileEntry";
import {alignUp, FileDataSection, hashFileName, SARCSection, SFATSection, SFNTSection} from "./Sections";
import {compressYaz0, decompressYaz0} from "@themezernx/yaz0lib/dist";

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

export class SarcFile {

    private hashMultiplier: number = 0x65;
    private isLittleEndian: boolean;
    private defaultAlignment = 0x04;

    private entries: Array<FileEntry> = [];

    /**
     * Construct a new SARC archive.
     * This library
     * - does not support files with duplicate names
     * - does not support files without name
     *
     * @param isLittleEndian if `true`, endian is set to little, if `false` endian is set to big
     */
    constructor(isLittleEndian: boolean = false) {
        this.isLittleEndian = isLittleEndian;
    }

    /**
     * Add a file to this SARC archive.
     *
     * @param file a FileEntry instance
     */
    addFile(file: FileEntry) {
        this.entries.push(file);
    }

    /**
     * Add a file to this SARC archive.
     * In order to 'put' it in a folder, use a custom `destinationFilePath`
     *
     * @param data raw file `Buffer`
     * @param destinationFilePath e.g. `image.jpg`, or `extra/image.jpg`
     */
    addRawFile(data: Buffer, destinationFilePath: string) {
        this.entries.push(new FileEntry(data, destinationFilePath));
    }

    /**
     * Add a file to the SARC archive.
     * In order to 'put' it in a folder, use a custom `destinationFilePath`
     *
     * @param filePath the path to the file you want to add
     * @param destinationFilePath e.g. `image.jpg`, or `extra/image.jpg`
     */
    addFileFromPath(filePath: string, destinationFilePath: string = "") {
        const data = fs.readFileSync(filePath);
        this.entries.push(new FileEntry(data, destinationFilePath || path.basename(filePath)));
    }

    /**
     * Add all files inside a folder to the SARC archive (recursively).
     * Notes:
     * - the contents of this folder are stored in the root of the SARC: the folder itself is not included.
     * - empty directories are skipped
     * In order to 'put' the contents in a folder, use a custom `destinationFolderPath`
     *
     * @param folderPath the path to the folder you want to add
     * @param destinationFolderName e.g. `images`, or `extra/images`
     */
    async addFolderContentsFromPath(folderPath: string, destinationFolderName: string = "") {
        for await (const f of getFiles(folderPath)) {
            const fileName = f.path
                .replace(folderPath, "") // remove common base paths
                .replace(/^[\\\/]+|[\\\/]+$/g, ""); // trim slashes
            this.entries.push(new FileEntry(f.data, path.join(destinationFolderName, fileName)));
        }
    }

    /**
     * Remove a specific FileEntry from the contents.
     * Use `getFiles()` to know which objects are available.
     *
     * @param file the FileEntry object to remove.
     */
    removeFile(file: FileEntry) {
        this.entries.splice(this.entries.indexOf(file), 1);
    }

    /**
     * Get all FileEntries in this SARC archive.
     */
    getFiles() {
        return this.entries;
    }

    /**
     * Instead of using the default-default alignment of `0x04`, use a different value.
     *
     * @param value the new default alignment
     * @throws Error if alignment is not non-zero and a power of 2
     */
    setDefaultAlignment(value: number) {
        if (value === 0 || (value & Number((value - 1) !== 0)) >>> 0) {
            throw new Error("Alignment must be a non-zero power of 2");
        }
        this.defaultAlignment = value;
    }

    /**
     * Set the hash multiplier used for filename hashing.
     *
     * @param value the new hash multiplier
     */
    setHashMultiplier(value: number) {
        this.hashMultiplier = value;
    }

    /**
     * Return whether the SARC archive is little endian.
     *
     * @returns {boolean} `true` if little, `false` if big
     */
    getIsLittleEndian(): boolean {
        return this.isLittleEndian;
    }

    /**
     * Set endian of the SARC archive to little.
     *
     * @param isLittleEndian if `true`, endian is set to little, if `false` endian is set to big
     */
    setLittleEndian(isLittleEndian: boolean) {
        this.isLittleEndian = isLittleEndian;
    }

    private readUInt16(buffer: Buffer, offset?: number) {
        return this.isLittleEndian ?
            buffer.readUInt16LE(offset) :
            buffer.readUInt16BE(offset);
    }

    private readUInt32(buffer: Buffer, offset?: number) {
        return this.isLittleEndian ?
            buffer.readUInt32LE(offset) :
            buffer.readUInt32BE(offset);
    }

    private static readName(data: Buffer, offset: number) {
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

            const name = SarcFile.readName(data, absNameOffset);
            nodes.push(new FileEntry(data.subarray(fileDataBegin, fileDataEnd), name));
            offset += 0x10;
        }

        return nodes;
    }

    /**
     * Load and parse a SARC archive.
     * File may be compressed with Yaz0.
     *
     * @param data the raw sarc file data `Buffer`
     * @throws Error if the SARC archive is invalid or unsupported
     */
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

    /**
     * Load and parse a SARC archive.
     * File may be compressed with Yaz0.
     *
     * @param filePath the sarc file path.
     * @throws Error if the SARC archive is invalid or unsupported
     */
    loadFrom(filePath: string) {
        this.load(fs.readFileSync(filePath));
    }

    /**
     * Save current SARC archive to file.
     *
     * @param compression what Yaz0 compression level to use. `0`: no compression (fastest), `9`: best compression (slowest)
     * @returns {} the output file `Buffer`
     */
    save(compression: number = 0): Buffer {
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

        let outputBuffer = Buffer.concat([
            sarc.getBuffer(),
            sfatBuffer,
            sfntBuffer,
            fileDataBuffer,
        ]);

        if (compression != 0) {
            outputBuffer = compressYaz0(outputBuffer, sfat.getDataOffsetAlignment(), compression);
        }

        return outputBuffer;
    }

    /**
     * Save current SARC archive to file.
     *
     * @param filePath the save destination. Will use default file extensions: `.szs` (compressed) or `.sarc` (uncompressed)
     * @param compression what Yaz0 compression level to use. `0`: no compression (fastest), `9`: best compression (slowest)
     * @returns {string} full output file path
     */
    saveTo(filePath: string, compression: number = 0) {
        const finalPath = path.resolve(filePath + (compression != 0 ? ".szs" : ".sarc"));

        fs.writeFileSync(finalPath, this.save(compression));

        return finalPath;
    }

    /**
     * Extract all SARC archive contents to a directory.
     *
     * @param destDir the destination directory path
     */
    extractTo(destDir: string) {
        for (const file of this.entries) {
            const filePath = destDir.replace(/[\\\/]$/, "") + "/" + file.name;
            try {
                fs.mkdirSync(path.dirname(filePath), {recursive: true});
            } catch (e) {
                // do nothing
            }
            fs.writeFileSync(filePath, file.data);
        }
    }

}


