import { asU8, type Bytes } from "./utils.js"

/**
 * Represents a single file entry within a SARC archive.
 */
export class FileEntry {
    /**
     * The relative destination path of the file inside the archive.
     */
    name: string
    
    /**
     * The raw file data as a Uint8Array.
     */
    data: Uint8Array

    /**
     * Creates a new SARC file entry.
     * 
     * @param data - The file data (ArrayBuffer or Uint8Array). Defaults to empty array.
     * @param name - The path/filename of the entry inside the SARC.
     */
    constructor(data: Bytes = new Uint8Array(0), name: string) {
        this.name = name
        this.data = asU8(data)
    }
}

