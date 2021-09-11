export class FileEntry {

    /**
     * Name may include slashes. This will be treated as folder structure.
     */
    name: string;
    data: Buffer;

    /**
     * @param data raw file `Buffer`
     * @param name e.g. `image.jpg`, or `extra/image.jpg`
     */
    constructor(data: Buffer = Buffer.alloc(0), name) {
        this.name = name;
        this.data = data;
    }

}