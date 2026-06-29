import { FileEntry } from "./FileEntry.js"
import { asU8, type Bytes, u8Concat } from "./utils.js"
import { alignUp, FileDataSection, hashFileName, SARCSection, SFATSection, SFNTSection } from "./Sections.js"
import { compressYaz0, decompressYaz } from "./yaz0.js"

/**
 * Class representing a Nintendo SARC (Simple Archive) file.
 * Allows parsing existing archives, adding/removing files, and compiling new SARC archives.
 */
export class SarcFile {
    private hashMultiplier = 0x65
    private isLittleEndian: boolean
    private defaultAlignment = 0x04
    private entries: FileEntry[] = []

    /**
     * Creates a new empty SarcFile.
     * 
     * @param isLittleEndian - Specifies if the SARC file should be compiled/written in Little Endian. Defaults to false (Big Endian, standard for Wii U/Switch).
     */
    constructor(isLittleEndian = false) {
        this.isLittleEndian = isLittleEndian
    }

    /**
     * Adds an existing FileEntry object to the SARC.
     * 
     * @param file - The FileEntry to add.
     */
    addFile(file: FileEntry) {
        this.entries.push(file)
    }

    /**
     * Helper to add a raw file directly by specifying its data and destination path.
     * 
     * @param data - The file data (ArrayBuffer or Uint8Array).
     * @param destinationFilePath - The relative path/filename inside the archive.
     */
    addRawFile(data: Bytes, destinationFilePath: string) {
        this.entries.push(new FileEntry(asU8(data), destinationFilePath))
    }

    /**
     * Removes a FileEntry from the SARC list.
     * 
     * @param file - The FileEntry reference to remove.
     */
    removeFile(file: FileEntry) {
        const i = this.entries.indexOf(file)
        if (i >= 0) this.entries.splice(i, 1)
    }

    /**
     * Retrieves the array of all file entries currently in this SARC.
     * 
     * @returns An array of FileEntry references.
     */
    getFiles() {
        return this.entries
    }

    /**
     * Sets the default byte alignment for files inside the SARC archive data section.
     * Alignment must be a non-zero power of 2 (e.g. 4, 8, 0x2000).
     * 
     * @param value - The byte alignment value.
     */
    setDefaultAlignment(value: number) {
        if (value === 0 || (value & (value - 1)) !== 0) {
            throw new Error("Alignment must be a non-zero power of 2")
        }
        this.defaultAlignment = value >>> 0
    }

    /**
     * Sets the multiplier value used during filename string hash calculation.
     * Defaults to 0x65.
     * 
     * @param value - The hash multiplier value.
     */
    setHashMultiplier(value: number) {
        this.hashMultiplier = value >>> 0
    }

    /**
     * Returns true if the archive is read/written in Little Endian byte order.
     * 
     * @returns True if Little Endian, false if Big Endian.
     */
    getIsLittleEndian() {
        return this.isLittleEndian
    }

    /**
     * Sets the byte order format (Endianness) for the archive.
     * 
     * @param isLittleEndian - True for Little Endian, false for Big Endian.
     */
    setLittleEndian(isLittleEndian: boolean) {
        this.isLittleEndian = isLittleEndian
    }

    private readU16(buf: Uint8Array, off: number) {
        const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
        return this.isLittleEndian ? dv.getUint16(off, true) : dv.getUint16(off, false)
    }

    private readU32(buf: Uint8Array, off: number) {
        const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
        return this.isLittleEndian ? dv.getUint32(off, true) : dv.getUint32(off, false)
    }

    private static readName(data: Uint8Array, offset: number) {
        let end = offset
        while (end < data.length && data[end] !== 0) end++
        return new TextDecoder("utf-8").decode(data.subarray(offset, end))
    }

    private parseFileNodes(
        data: Uint8Array,
        nodeOffset: number,
        nodeCount: number,
        nameTableOffset: number,
        dataOffset: number,
    ) {
        const out: FileEntry[] = []
        let offset = nodeOffset
        for (let i = 0; i < nodeCount; i++) {
            const nameHash = this.readU32(data, offset)
            const nameId = this.readU32(data, offset + 4)
            const nameOffset = (nameId & 0xffffff) >>> 0
            const fileBegin = this.readU32(data, offset + 8) + dataOffset
            const fileEnd = this.readU32(data, offset + 0xc) + dataOffset

            if (nameId === 0) throw new Error("Unnamed files are not supported")
            const absNameOffset = nameTableOffset + 4 * nameOffset
            if (absNameOffset > dataOffset) throw new Error(`Invalid name offset for 0x${nameHash.toString(16)}`)

            const name = SarcFile.readName(data, absNameOffset)
            out.push(new FileEntry(data.subarray(fileBegin, fileEnd), name))
            offset += 0x10
        }
        return out
    }

    /**
     * Parses and loads a SARC archive from binary data.
     * Supports both uncompressed SARC files and Yaz0-compressed archives.
     * 
     * @param input - The binary source data (ArrayBuffer or Uint8Array).
     */
    load(input: Bytes) {
        let decompressed = asU8(input)
        try {
            decompressed = asU8(decompressYaz(decompressed))
        } catch {
            // not Yaz0
        }

        if (new TextDecoder("ascii").decode(decompressed.subarray(0x00, 0x04)) !== SARCSection.magic) {
            throw new Error("Unknown SARC magic")
        }

        const bom0 = decompressed[0x06]
        const bom1 = decompressed[0x07]
        this.isLittleEndian = bom0 === 0xff && bom1 === 0xfe
        if (!this.isLittleEndian && !(bom0 === 0xfe && bom1 === 0xff)) throw new Error("Invalid BOM")

        const version = this.readU16(decompressed, 0x10)
        if (version !== SARCSection.version) throw new Error("Unknown SARC version")

        const sarcHeaderSize = this.readU16(decompressed, 0x04)
        if (sarcHeaderSize !== SARCSection.headerSize) throw new Error("Unexpected SARC header size")

        const sfatHeaderOffset = sarcHeaderSize
        if (new TextDecoder("ascii").decode(decompressed.subarray(sfatHeaderOffset, sfatHeaderOffset + 4)) !== "SFAT") {
            throw new Error("Unknown SFAT magic")
        }
        const sfatHeaderSize = this.readU16(decompressed, sfatHeaderOffset + 4)
        if (sfatHeaderSize !== 0x0c) throw new Error("Unexpected SFAT header size")
        const nodeCount = this.readU16(decompressed, sfatHeaderOffset + 6)
        const nodeOffset = sarcHeaderSize + sfatHeaderSize
        if (nodeCount >>> 0xe !== 0) throw new Error("Too many entries")

        const sfntHeaderOffset = nodeOffset + 0x10 * nodeCount
        if (new TextDecoder("ascii").decode(decompressed.subarray(sfntHeaderOffset, sfntHeaderOffset + 4)) !== "SFNT") {
            throw new Error("Unknown SFNT magic")
        }
        const sfntHeaderSize = this.readU16(decompressed, sfntHeaderOffset + 4)
        if (sfntHeaderSize !== 0x08) throw new Error("Unexpected SFNT header size")
        const nameTableOffset = sfntHeaderOffset + sfntHeaderSize

        const dataOffset = this.readU32(decompressed, 0x0c)
        if (dataOffset < nameTableOffset) {
            throw new Error("File data should not be stored before the name table")
        }

        this.entries = this.parseFileNodes(decompressed, nodeOffset, nodeCount, nameTableOffset, dataOffset)
    }

    /**
     * Compiles and builds the SARC archive into a single Uint8Array.
     * 
     * @param compression - The Yaz0 compression level to apply to the output file (0 = no compression, 9 = maximum search depth compression). Defaults to 0.
     * @returns The built SARC archive as a Uint8Array.
     */
    save(compression = 0): Uint8Array {
        const hashed: Record<number, FileEntry> = {}
        for (const file of this.entries) {
            file.name = file.name.replace(/[\\/]+/g, "/")
            hashed[hashFileName(file.name, this.hashMultiplier)] = file
        }
        const sortedHashes = Object.keys(hashed)
            .map(Number)
            .sort((a, b) => a - b)

        const sarc = new SARCSection(this.isLittleEndian)
        const sfat = new SFATSection(this.isLittleEndian)
        sfat.setHashMultiplier(this.hashMultiplier)
        sfat.setDefaultAlignment(this.defaultAlignment)

        const sfnt = new SFNTSection(this.isLittleEndian)
        const fileData = new FileDataSection(this.isLittleEndian)

        for (const h of sortedHashes) {
            const file = hashed[h]
            const alignment = sfat.addFile(h >>> 0, file)
            sfnt.addFile(file)
            fileData.addFile(file, alignment)
        }

        const sfatBuf = sfat.getBuffer()
        const sfntBuf = sfnt.getBuffer()

        fileData.setDataOffsetAlignment(sfat.getDataOffsetAlignment())
        fileData.setCursorPosition(SARCSection.headerSize + sfatBuf.length + sfntBuf.length)
        const fileDataBuf = fileData.getBuffer()

        const dataStartOffset = alignUp(
            alignUp(SARCSection.headerSize + sfatBuf.length + sfntBuf.length, 0x04),
            sfat.getDataOffsetAlignment(),
        )

        const totalLen = SARCSection.headerSize + sfatBuf.length + sfntBuf.length + fileDataBuf.length
        sarc.setFileSize(totalLen)
        sarc.setDataOffset(dataStartOffset)

        let out = u8Concat([sarc.getBuffer(), sfatBuf, sfntBuf, fileDataBuf])

        if (compression !== 0) {
            out = asU8(compressYaz0(out, sfat.getDataOffsetAlignment(), compression))
        }
        return out
    }
}
