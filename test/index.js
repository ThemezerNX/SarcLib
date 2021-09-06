const path = require("path");
const {SarcReader, SarcWriter} = require("../dist/Sarc.js");
const fs = require("fs");

const data = fs.readFileSync(path.resolve(__dirname, "file/file.txt"));
const sarcLittle = new SarcWriter(true);
const sarcBig = new SarcWriter(false);

sarcLittle.addFile("file.txt", data);
sarcBig.addFile("file.txt", data);

fs.writeFileSync(path.resolve(__dirname, "file.little.szs"), sarcLittle.getBuffer());
fs.writeFileSync(path.resolve(__dirname, "file.big.szs"), sarcBig.getBuffer());

console.log("Done!");