import { test } from 'node:test';
import assert from 'node:assert';
import { SarcFile, compressYaz0, decompressYaz, isYazCompressed } from '../src/index.js';

test('SarcFile basic pack and unpack', () => {
  const sarc = new SarcFile();
  
  const file1Content = new TextEncoder().encode('Hello Sarc 1');
  const file2Content = new TextEncoder().encode('Another file content here');
  
  sarc.addRawFile(file1Content, 'file1.txt');
  sarc.addRawFile(file2Content, 'subfolder/file2.txt');
  
  // Save SARC archive (raw bytes)
  const builtBuffer = sarc.save(0); // compression = 0
  
  // Reload built SARC
  const parsedSarc = new SarcFile();
  parsedSarc.load(builtBuffer);
  
  const filesList = parsedSarc.getFiles();
  
  // Verify files list size
  assert.strictEqual(filesList.length, 2);
  
  // Verify file 1
  const entry1 = filesList.find(f => f.name === 'file1.txt');
  assert.ok(entry1);
  assert.strictEqual(new TextDecoder().decode(entry1.data), 'Hello Sarc 1');
  
  // Verify file 2
  const entry2 = filesList.find(f => f.name === 'subfolder/file2.txt');
  assert.ok(entry2);
  assert.strictEqual(new TextDecoder().decode(entry2.data), 'Another file content here');
});

test('Yaz0 Compression/Decompression Roundtrip', () => {
  const originalText = 'A'.repeat(500) + 'B'.repeat(500) + 'A'.repeat(500); // highly compressible
  const rawData = new TextEncoder().encode(originalText);
  
  // Compress
  const compressed = compressYaz0(rawData, 0, 9);
  
  // Verify magic header and compression detection
  assert.ok(isYazCompressed(compressed));
  assert.ok(!isYazCompressed(rawData));
  
  // Decompress
  const decompressed = decompressYaz(compressed);
  
  // Verify identical content
  const decompressedText = new TextDecoder().decode(decompressed);
  assert.strictEqual(decompressedText, originalText);
});
