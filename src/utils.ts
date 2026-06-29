export type Bytes = ArrayBuffer | Uint8Array;

/**
 * Ensures the input data is returned as a Uint8Array.
 * If the input is already a Uint8Array, it is returned directly;
 * if it is an ArrayBuffer, it is wrapped in a new Uint8Array.
 * 
 * @param src - The input data to convert.
 * @returns The data as a Uint8Array.
 */
export function asU8(src: Bytes): Uint8Array {
    return src instanceof Uint8Array ? src : new Uint8Array(src);
}

/**
 * Concatenates multiple Uint8Array chunks into a single Uint8Array.
 * 
 * @param chunks - Array of Uint8Array chunks to concatenate.
 * @returns A single concatenated Uint8Array.
 */
export function u8Concat(chunks: Uint8Array[]): Uint8Array {
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
        out.set(c, off);
        off += c.length;
    }
    return out;
}

/**
 * Reads an ASCII string from a Uint8Array starting at a specific offset
 * and compares it to a given string value for equality.
 * 
 * @param u8 - The Uint8Array containing ASCII data.
 * @param start - The starting index in the Uint8Array. Negative index counts back from the end.
 * @param value - The ASCII string value to compare against.
 * @returns True if the bytes match the value, otherwise false.
 */
export function readAsciiEquals(u8: Uint8Array, start: number, value: string): boolean {
    if (start < 0) start = u8.length + start;
    if (start < 0 || start + value.length > u8.length) return false;
    for (let i = 0; i < value.length; i++) {
        if (u8[start + i] !== value.charCodeAt(i)) return false;
    }
    return true;
}

/**
 * Slices a portion of a Uint8Array and decodes it as an ASCII string.
 * 
 * @param u8 - The Uint8Array to slice and decode.
 * @param start - The starting index of the slice. Negative index counts back from the end.
 * @param end - The ending index of the slice (exclusive). Negative index counts back from the end.
 * @returns The decoded ASCII string.
 */
export function sliceAscii(u8: Uint8Array, start: number, end?: number): string {
    if (start < 0) start = u8.length + start;
    if (end !== undefined && end < 0) end = u8.length + end;
    return new TextDecoder("ascii").decode(u8.subarray(start, end));
}
