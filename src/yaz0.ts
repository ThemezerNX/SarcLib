function toUint8(buf: ArrayBuffer | Uint8Array): Uint8Array {
    if (buf instanceof Uint8Array) return buf
    if (buf instanceof ArrayBuffer) return new Uint8Array(buf)
    throw new TypeError("Data must be ArrayBuffer or Uint8Array")
}

function readUInt32BE(buf: Uint8Array, offset: number): number {
    return (buf[offset] << 24) | (buf[offset + 1] << 16) | (buf[offset + 2] << 8) | buf[offset + 3]
}

/**
 * Determines whether the given data buffer is compressed in Yaz0 or Yaz1 format
 * by inspecting the first 4 bytes for the "Yaz0" or "Yaz1" magic sequence.
 * 
 * @param data - The data buffer (ArrayBuffer or Uint8Array) to inspect.
 * @returns True if the magic sequence matches, otherwise false.
 */
export function isYazCompressed(data: ArrayBuffer | Uint8Array): boolean {
    const u8 = toUint8(data)
    const magic = String.fromCharCode(u8[0], u8[1], u8[2], u8[3])
    return magic === "Yaz0" || magic === "Yaz1"
}

/**
 * Decompresses a Yaz0-compressed data buffer.
 * Throws an error if the buffer is not in Yaz format.
 * 
 * @param srcBuf - The Yaz-compressed source buffer.
 * @returns The decompressed Uint8Array bytes.
 */
export function decompressYaz(srcBuf: ArrayBuffer | Uint8Array): Uint8Array {
    const src = toUint8(srcBuf)
    if (!isYazCompressed(src)) throw new Error("Not Yaz compressed!")

    const srcEnd = src.length
    const destSize = readUInt32BE(src, 4)
    const dest = new Uint8Array(destSize)

    let code = src[16]
    let srcPos = 17
    let destPos = 0

    while (srcPos < srcEnd && destPos < destSize) {
        for (let i = 0; i < 8; i++) {
            if (srcPos >= srcEnd || destPos >= destSize) break

            if (code & 0x80) {
                dest[destPos++] = src[srcPos++]
            } else {
                const b1 = src[srcPos++]
                const b2 = src[srcPos++]
                let copySrc = destPos - (((b1 & 0x0f) << 8) | b2) - 1
                let count = b1 >> 4
                if (count === 0) {
                    count = src[srcPos++] + 0x12
                } else {
                    count += 2
                }
                while (count-- > 0) {
                    dest[destPos++] = dest[copySrc++]
                }
            }

            code <<= 1
        }
        if (srcPos < srcEnd) {
            code = src[srcPos++]
        }
    }

    return dest
}

function compressionSearch(
    src: Uint8Array,
    pos: number,
    maxLen: number,
    searchRange: number,
): { foundOffset: number; foundLen: number } {
    let bestLen = 1
    let bestOffset = 0
    const srcLen = src.length
    if (searchRange <= 0 || pos + 2 >= srcLen) return { foundOffset: bestOffset, foundLen: bestLen }

    const start = Math.max(0, pos - searchRange)
    const firstByte = src[pos]
    for (let i = start; i < pos; i++) {
        if (src[i] !== firstByte) continue
        let length = 1
        while (length < maxLen && pos + length < srcLen && src[i + length] === src[pos + length]) {
            length++
        }
        if (length > bestLen) {
            bestLen = length
            bestOffset = pos - i - 1
            if (bestLen >= maxLen) break
        }
    }

    return { foundOffset: bestOffset, foundLen: bestLen }
}

function compressYazBody(srcBuf: ArrayBuffer | Uint8Array, level: number): Uint8Array {
    const src = toUint8(srcBuf)
    const srcLen = src.length
    const searchRange = level > 0 ? Math.min(0x1000, (0x10e0 * level) / 9 - 0x0e0) : 0
    let pos = 0
    const out: number[] = []
    const maxLen = 0x111

    while (pos < srcLen) {
        const codePos = out.length
        out.push(0)
        let code = 0
        for (let bit = 0; bit < 8 && pos < srcLen; bit++) {
            const { foundOffset, foundLen } = compressionSearch(src, pos, maxLen, searchRange)
            if (foundLen > 2) {
                const offset = foundOffset
                const length = foundLen
                if (length < 0x12) {
                    out.push(((length - 2) << 4) | ((offset >> 8) & 0x0f))
                    out.push(offset & 0xff)
                } else {
                    out.push((offset >> 8) & 0x0f)
                    out.push(offset & 0xff)
                    out.push(length - 0x12)
                }
                pos += length
            } else {
                code |= 1 << (7 - bit)
                out.push(src[pos++])
            }
        }
        out[codePos] = code
    }

    return Uint8Array.from(out)
}

/**
 * Compresses a data buffer using the Yaz0 algorithm.
 * 
 * @param data - The uncompressed source buffer.
 * @param alignment - The data start offset alignment inside the Yaz0 header. Defaults to 0.
 * @param level - Compression search depth (0 = fast/no compression search, 9 = maximum search depth). Defaults to 0.
 * @returns The compressed Yaz0 Uint8Array bytes.
 */
export function compressYaz0(data: ArrayBuffer | Uint8Array, alignment = 0, level = 0): Uint8Array {
    const body = compressYazBody(data, level)
    const dataArr = toUint8(data)
    const output = new Uint8Array(16 + body.length)
    const dv = new DataView(output.buffer)
    output.set([0x59, 0x61, 0x7a, 0x30], 0)
    dv.setUint32(4, dataArr.length, false)
    dv.setUint32(8, alignment, false)
    dv.setUint32(12, 0, false)
    output.set(body, 16)
    return output
}
