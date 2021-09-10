const path = require("path");
const {SarcFile} = require("../dist");

const sarcBig = new SarcFile(false);

sarcBig.addFolderContentsFromPath(path.resolve("Psl-8.0.0")).then(()=> {
    sarcBig.saveTo(path.join(__dirname, "Psl-8.0.0.decompressed.szs"));

    const readSarc = new SarcFile();
        readSarc.loadFrom(path.join(__dirname, "Psl-8.0.0.decompressed.szs"))
        readSarc.extractTo(path.join(__dirname, "Psl-8.0.0.decompressed"))
})

console.log("Done!");