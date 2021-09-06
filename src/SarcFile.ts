import {guessFileExtension} from "./index";

class FileEntity {
    name: string;
    data: Buffer;
    hasFilename: boolean;

    constructor(name: string = "", data: Buffer = Buffer.alloc(0), hasFilename: boolean = true) {
        this.name = name;
        this.data = data;
        this.hasFilename = hasFilename;
    }
}

class FolderEntity {
    name: string;
    contents: Array<FileEntity | FolderEntity>;

    constructor(name: string = "", contents: Array<FileEntity | FolderEntity> = []) {
        this.name = name;
        this.contents = contents;
    }

    addFile(file: FileEntity) {
        this.contents.push(file);
    }

    removeFile(file: FileEntity) {
        this.contents.splice(this.contents.indexOf(file), 1);
    }

    addFolder(folder: FolderEntity) {
        this.contents.push(folder);
    }

    removeFolder(folder: FolderEntity) {
        this.contents.splice(this.contents.indexOf(folder), 1);
    }

}

class FileArchiveEntity {
    contents: Array<FileEntity | FolderEntity>;
    endianness: string;

    constructor() {
        this.contents = [];
        this.endianness = ">";
    }

    clear() {
        this.contents = [];
    }

    addFile(file: FileEntity) {
        this.contents.push(file);
    }

    removeFile(file: FileEntity) {
        this.contents.splice(this.contents.indexOf(file), 1);
    }

    addFolder(folder: FolderEntity) {
        this.contents.push(folder);
    }

    removeFolder(folder: FolderEntity) {
        this.contents.splice(this.contents.indexOf(folder), 1);
    }

}

function bytesToString(data: Buffer, offset: number): string {
    let end = data.indexOf(0, offset);
    if (end == -1) {
        return data.toString("utf8", offset);
    }
    return data.toString("utf8", offset, end);
}

function hex(input: string): string {
    let hex = "";
    for (let i = 0; i < input.length; i++) {
        hex += input.charCodeAt(i).toString(16);
    }
    return hex;
}

class SARCArchive {
    isLittleEndian: boolean;
    hashKey: number;
    contents: Array<FileEntity | FolderEntity>;

    constructor(data: Buffer) {
        this.isLittleEndian = false;
        this.hashKey = 0x65;
        this.contents = [];
        this.load(data);
    }

    /**
     * readUInt16.
     *
     * @param buffer
     * @param offset
     * @return {number}
     */
    private readUInt16(buffer: Buffer, offset: number) {
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
    private readUInt32(buffer: Buffer, offset: number) {
        return this.isLittleEndian ?
            buffer.readUInt32LE(offset) :
            buffer.readUInt32BE(offset);
    }

    /**
     * Number to UInt16 bytes.
     *
     * @param value
     * @return {ArrayBuffer} bytes
     */
    private toUInt16(value: number) {
        const bytes = new ArrayBuffer(2);
        const dv = new DataView(bytes).setUint16(0, value, this.isLittleEndian);
        dv;
        return bytes;
    }

    /**
     * Number to UInt32 bytes.
     *
     * @param value
     * @return {ArrayBuffer} bytes
     */
    private toUInt32(value: number) {
        const bytes = new ArrayBuffer(4);
        const dv = new DataView(bytes);
        dv.setUint32(0, value, this.isLittleEndian);
        return bytes;
    }

    private load(data: Buffer) {
        // SARC Header -----------------------------------------

        // File magic (0x00 - 0x03)
        if (data.slice(0, 4).toString() !== "SARC") {
            throw new Error("This is not a valid SARC file!");
        }

        // Come back to header length later, when we have endianness

        // Endianness/BOM (0x06 - 0x07)
        const bom = data.slice(6, 8);
        this.isLittleEndian = "\xFF\xFE" == bom.toString();

        // Header length (0x04 - 0x05)
        const headLen = this.readUInt16(data, 4);
        if (headLen !== 0x14) {
            throw new Error("This is not a valid SARC file!");
        }

        // File Length (0x08 - 0x0B)
        const filelen = this.readUInt32(data, 8);
        if (data.length !== filelen) {
            throw new Error("This is not a valid SARC file!");
        }

        // Beginning Of Data offset (0x0C - 0x0F)
        const dataStartOffset = this.readUInt32(data, 0x0C);

        // SFAT Header -----------------------------------------

        // Sanity check (0x14 - 0x17)
        if (data.slice(0x14, 0x18).toString() !== "SFAT") {
            throw new Error("This is not a valid SARC file!");
        }

        // Header length (0x18 - 0x19)
        const headLen2 = this.readUInt16(data, 0x18);
        if (headLen2 !== 0x0C) {
            throw new Error("This is not a valid SARC file!");
        }

        // Node count (0x1A - 0x1C)
        const nodeCount = this.readUInt16(data, 0x1A);

        // Hash key (0x1D - 0x1F)
        this.hashKey = this.readUInt32(data, 0x1C);

        // SFAT Nodes (0x20 - 0x20+(0x10*nodeCount))
        const SFATNodes = [];
        let SFATNodeOffset = 0x20;
        for (let nodeNum = 0; nodeNum < nodeCount; nodeNum++) {
            const fileNameHash = this.readUInt32(data, SFATNodeOffset);
            const fileNameTableEntryID = this.readUInt32(data, SFATNodeOffset + 4);
            const hasFilename = fileNameTableEntryID >> 24;
            const fileNameTableEntryOffset = fileNameTableEntryID & 0xFFFFFF;

            // Beginning of Node File Data
            const fileDataStart = this.readUInt32(data, SFATNodeOffset + 8);

            // End of Node File Data
            const fileDataEnd = this.readUInt32(data, SFATNodeOffset + 0x0C);

            // Calculate file data length
            const fileDataLength = fileDataEnd - fileDataStart;

            // Add an entry to the node list
            SFATNodes.push([fileNameHash, hasFilename, fileNameTableEntryOffset, fileDataStart, fileDataLength]);

            // Increment the offset counter
            SFATNodeOffset += 0x10;
        }

        // SFNT Header -----------------------------------------

        // From now on we need to keep track of an offset variable
        let offset = 0x20 + (0x10 * nodeCount);

        // Sanity check (offset - offset+0x03)
        if (data.slice(offset, offset + 0x04).toString() !== "SFNT") {
            throw new Error("This is not a valid SARC file!");
        }

        // Header length (offset+0x04 - offset+0x05)
        const headLen3 = this.readUInt16(data, offset + 0x04);
        if (headLen3 !== 0x08) {
            throw new Error("This is not a valid SARC file!");
        }

        // Increment the offset
        offset += 0x08;

        // Add the files to the self.contents set --------------
        this.contents.length = 0;
        for (let i = 0; i < nodeCount; i++) {
            const fileNameHash = SFATNodes[i][0];
            const hasFilename = SFATNodes[i][1];
            const fileNameTableEntryOffset = SFATNodes[i][2];
            const fileDataStart = SFATNodes[i][3];
            const fileDataLength = SFATNodes[i][4];

            // Get the file data
            const fileData = data.slice(dataStartOffset + fileDataStart,
                dataStartOffset + fileDataStart + fileDataLength);

            // Get the file name (search for the first null byte manually)
            const nameOffset = offset + (fileNameTableEntryOffset * 4);
            let name;
            if (hasFilename) {
                name = bytesToString(data, nameOffset);
            } else {
                name = "hash_" + hex(fileNameHash) + guessFileExtension(fileData);
            }

            // Split it into its folders
            const folderStructure = name.split("/");

            // Handle it differently if the file is not in a folder
            if (folderStructure.length === 1) {
                this.contents.push(new FileEntity(name, fileData, hasFilename));
            } else {
                // Get the first folder, or make one if needed
                const folderName = folderStructure[0];
                let foundFolder;
                for (let item of this.contents) {
                    if (!(item instanceof FolderEntity)) {
                        continue;
                    }

                    if (item.name === folderName) {
                        foundFolder = item;
                        break;
                    }
                }

                if (!foundFolder) {
                    foundFolder = new FolderEntity(folderName);
                    this.contents.push(foundFolder);
                }

                // Now find/make the rest of them
                let outerFolder = foundFolder;
                for (let j = 1; j < folderStructure.length - 1; j++) {
                    const folderName = folderStructure[j];
                    for (let item of this.contents) {
                        if (!(item instanceof FolderEntity)) {
                            continue;
                        }

                        if (item.name === folderName) {
                            foundFolder = item;
                            break;
                        }
                    }

                    if (!outerFolder) {
                        outerFolder = new FolderEntity(folderName);
                        this.contents.push(outerFolder);
                    }
                }

                // Now make a new file and add it to self.contents
                outerFolder.addFile(new FileEntity(folderStructure[folderStructure.length - 1], fileData, hasFilename));
            }
        }
    }

    private addToFlatList(flatList: Array<any>, folder: FolderEntity, path: string) {
        if (path.includes("\\")) {
            path = path.replace("\\", "/");
        }

        if (path[path.length - 1] !== "/") {
            path += "/";
        }

        for (let checkObj of folder.contents) {
            if (checkObj instanceof FileEntity) {
                flatList.push([path + checkObj.name, checkObj]);
            } else {
                this.addToFlatList(flatList, checkObj, path + checkObj.name);
            }
        }
    }


    /*
     #       uint32_t hash = 0;
     #       int i = 0;
     #       while (true) {
     #         char c = string[i++];
     #         if (!c)
     #           break;
     #         hash = hash * multiplier + c;
     #       }
     */
    private static filenameHash(filename: string, key: number) {
        let hash = 0;
        let i = 0;
        while (true) {
            const c = filename.charCodeAt(i++);
            if (c === 0) {
                break;
            }
            hash = hash * key + c;
        }
    }

    /*
     def sortByHash(filetuple):
     if filetuple[1].hasFilename:
     return struct.unpack(
     self.endianness + 'I',
     self.filenameHash(filetuple[0], self.endianness, self.hashKey),
     )

     else:
     return [int(filetuple[1].name[5:].split('.')[0].split()[0], 16)]
     */
    // private sortByHash(filetuple: Array<any>) {
    //     if (filetuple[1].hasFilename) {
    //         return this.readUInt32(this.filenameHash(filetuple[0], this.hashKey), 0);
    //     } else {
    //
    //     }
    // }

    /**
     # Add to flatlist
     for checkObj in self.contents:
     if isinstance(checkObj, File):
     flatList.append((checkObj.name, checkObj))

     else:
     addToFlatList(checkObj, checkObj.name)
     * @param dataStartOffset
     */
    save(dataStartOffset: number = 0) {
        const flatList = [];

        // Add the files to the flat list
        for (let checkObj of this.contents) {
            if (checkObj instanceof FileEntity) {
                flatList.push([checkObj.name, checkObj]);
            } else {
                this.addToFlatList(flatList, checkObj, checkObj.name);
            }
        }

    }

    private static getDataAlignment(data: Buffer): number {
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

        return 4;
    }


}
