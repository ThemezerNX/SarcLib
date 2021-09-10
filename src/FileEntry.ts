export class FileEntry {
    name: string;
    data: Buffer;

    constructor(data: Buffer = Buffer.alloc(0), name) {
        this.name = name;
        this.data = data;
    }
}