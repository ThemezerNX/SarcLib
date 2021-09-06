/*
 A library for packing and unpacking SARC/SZS archives.
 Ported from Python's libyaz0, by MasterVermilli0n / AboodXD
 */

/**
 * Guess the file extension of a buffer.
 * Don't compare every byte individually, but compare strings.
 */
export function guessFileExtension(data: Buffer) {
    if (data.toString("ascii", 0, 8) == "BNTX\0\0\0\0") {
        return ".bntx";
    } else if (data.toString("ascii", 0, 8) == "BNSH\0\0\0\0") {
        return ".bnsh";
    } else if (data.toString("ascii", 0, 8) == "MsgStdBn") {
        return ".msbt";
    } else if (data.toString("ascii", 0, 8) == "MsgPrjBn") {
        return ".msbp";
    } else if (data.toString("ascii", 0, 4) == "SARC") {
        return ".sarc";
    } else if (data.toString("ascii", 0, 4) == "Yaz0" || data.toString("ascii", 0, 4) == "Yaz1") {
        return ".szs";
    } else if (data.toString("ascii", 0, 4) == "FFNT") {
        return ".bffnt";
    } else if (data.toString("ascii", 0, 4) == "CFNT") {
        return ".bcfnt";
    } else if (data.toString("ascii", 0, 4) == "CSTM") {
        return ".bcstm";
    } else if (data.toString("ascii", 0, 4) == "FSTM") {
        return ".bfstm";
    } else if (data.toString("ascii", 0, 4) == "FSTP") {
        return ".bfstp";
    } else if (data.toString("ascii", 0, 4) == "CWAV") {
        return ".bcwav";
    } else if (data.toString("ascii", 0, 4) == "FWAV") {
        return ".bfwav";
    } else if (data.toString("ascii", 0, 4) == "Gfx2") {
        return ".gtx";
    } else if (data.toString("ascii", 0, 4) == "FRES") {
        return ".bfres";
    } else if (data.toString("ascii", 0, 4) == "AAHS") {
        return ".sharc";
    } else if (data.toString("ascii", 0, 4) == "BAHS") {
        return ".sharcfb";
    } else if (data.toString("ascii", 0, 4) == "FSHA") {
        return ".bfsha";
    } else if (data.toString("ascii", 0, 4) == "FLAN") {
        return ".bflan";
    } else if (data.toString("ascii", 0, 4) == "FLYT") {
        return ".bflyt";
    } else if (data.toString("ascii", 0, 4) == "CLAN") {
        return ".bclan";
    } else if (data.toString("ascii", 0, 4) == "CLYT") {
        return ".bclyt";
    } else if (data.toString("ascii", 0, 4) == "CTPK") {
        return ".ctpk";
    } else if (data.toString("ascii", 0, 4) == "CGFX") {
        return ".bcres";
    } else if (data.toString("ascii", 0, 4) == "AAMP") {
        return ".aamp";
    } else if (data.toString("ascii", 0xC, 4) == "SCDL") {
        return ".bcd";
    } else if (data.toString("ascii", 0xC, 4) == "FLIM") {
        return ".bflim";
    } else if (data.toString("ascii", 0xC, 4) == "CLIM") {
        return ".bclim";
    } else if (data.toString("ascii", 0xC, 2) == "YB" || data.toString("ascii", 0xC, 2) == "BY") {
        return ".byml";
    } else {
        return ".bin";
    }
}

// /**
//  * Compress a buffer with Yaz0.
//  *
//  * @param data The buffer to compress
//  * @param alignment=0 The alignment
//  * @param level=0 The compression level
//  * @returns {buffer} The compressed buffer
//  **/
// export function packSarc(data: Buffer): Buffer {
//     return compressBuffer(data, level);
// }
//
// /**
//  * Decompress a Yaz0 buffer.
//  *
//  * @throws error Will throw an error if the data is not compressed with Yaz0
//  * @param data The compressed buffer
//  * @returns {buffer} The decompressed buffer
//  */
// export function unpackSarc(data: Buffer): Buffer {
//     return decompressBuffer(data);
// }
//
// /**
//  * Read a folder from a path and pack all its contents.
//  *
//  * @param path The filepath
//  * @param alignment=0 The alignment
//  * @param level=0 The compression level
//  * @returns {string} The output path. Filename: filename + '.compressed' + original file extension
//  */
// export function packSarcFile(path: string): string {
//     const data = fs.readFileSync(path);
//     const compressed = packSarc(data);
//     const output = path.replace(/\.[^/.]+$/, "") + ".compressed" + path.toString("ascii", path.lastIndexOf("."));
//     fs.writeFileSync(output, compressed);
//
//     return output;
// }
//
// /**
//  * Read a file from a path and unpack it.
//  *
//  * @param path The filepath
//  * @returns {string} The output path. Filename: filename + '.decompressed' + original file extension
//  */
// export function unpackSarcFile(path: string): string {
//     const data = fs.readFileSync(path);
//     const decompressed = unpackSarc(data);
//     const output = path.replace(/\.[^/.]+$/, "") + ".decompressed" + path.toString("ascii", path.lastIndexOf("."));
//     fs.writeFileSync(output, decompressed);
//
//     return output;
// }