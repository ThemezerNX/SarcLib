# @themezernx/sarclib

A lightweight, zero-dependency library for parsing, manipulating, and building Nintendo SARC (Simple Archive) files in TypeScript and JavaScript.

## Features
- Fully parse SARC archive headers, file tables, and data blocks.
- Add, update, and extract files from SARC archives.
- Support for Yaz0 compression/decompression utilities.
- Clean ESM, CommonJS, and TypeScript types bundle.

## Installation
```bash
pnpm add @themezernx/sarclib
# or
npm install @themezernx/sarclib
```

## Usage

### Reading a SARC file
```typescript
import { SarcFile } from '@themezernx/sarclib';
import * as fs from 'fs';

const data = fs.readFileSync('archive.sarc');
const sarc = new SarcFile();
sarc.load(data);

// List files inside SARC
for (const entry of sarc.getFiles()) {
  console.log(entry.name, entry.data.length);
}

// Extract a specific file
const filesList = sarc.getFiles();
const fileEntry = filesList.find(f => f.name === 'test.txt');
if (fileEntry) {
  const content = new TextDecoder().decode(fileEntry.data);
  console.log(content);
}
```

### Creating/Building a SARC file
```typescript
import { SarcFile } from '@themezernx/sarclib';
import * as fs from 'fs';

const sarc = new SarcFile();
sarc.addRawFile(new TextEncoder().encode('Hello World!'), 'hello.txt');

const buffer = sarc.save(); // returns Uint8Array
fs.writeFileSync('output.sarc', buffer);
```

### Yaz0 Compression & Decompression
The library exports helper utilities to compress and decompress data using the Yaz0 algorithm.

```typescript
import { compressYaz0, decompressYaz, isYazCompressed } from '@themezernx/sarclib';
import * as fs from 'fs';

const rawData = fs.readFileSync('uncompressed.bin');

// Compress data to Yaz0 format
// Arguments: data, alignment (default 0), level (0 = fast, 9 = maximum)
const compressedData = compressYaz0(rawData, 0, 9);
fs.writeFileSync('compressed.yaz0', compressedData);

// Check if data is Yaz compressed (checks magic header 'Yaz0' / 'Yaz1')
if (isYazCompressed(compressedData)) {
  // Decompress Yaz0 data
  const originalData = decompressYaz(compressedData);
  console.log('Decompressed size:', originalData.length);
}
```

## License
MIT
