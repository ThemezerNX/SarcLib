const path = require("path");
const {SarcReader, SarcWriter} = require("../dist/Sarc.js");
const fs = require("fs");

const sarcBig = new SarcWriter(false);

const dirname = "test3"
const dir = path.resolve(__dirname, "sarctool", dirname);
const files = fs.readdirSync(dir);
for (const filename of files) {
    console.log("Adding:", filename);
    sarcBig.addFile(filename, fs.readFileSync(path.join(dir, filename)));
}


fs.writeFileSync(path.resolve(__dirname, `${dirname}.decompressed.szs`), sarcBig.getBuffer());

console.log("Done!");