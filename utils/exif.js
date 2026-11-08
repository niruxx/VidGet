const fs = require('fs');

// Reads the EXIF Orientation (1-8) from a JPEG, or returns 1. ffmpeg already
// rotates images by this tag when decoding; we only need it to report the
// dimensions the visitor will actually see (orientations 5-8 swap width/height).
async function readJpegOrientation(filePath) {
  let handle;
  try {
    handle = await fs.promises.open(filePath, 'r');
    const buf = Buffer.alloc(256 * 1024);
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
    return parseOrientation(buf.subarray(0, bytesRead));
  } catch {
    return 1;
  } finally {
    await handle?.close();
  }
}

function parseOrientation(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return 1;
  let offset = 2;
  while (offset + 4 <= buf.length) {
    if (buf[offset] !== 0xff) return 1;
    const marker = buf[offset + 1];
    const length = buf.readUInt16BE(offset + 2);
    if (marker === 0xda || marker === 0xd9) return 1; // image data starts; no EXIF before it
    if (marker === 0xe1 && buf.toString('binary', offset + 4, offset + 10) === 'Exif\0\0') {
      return parseTiffOrientation(buf, offset + 10, Math.min(buf.length, offset + 2 + length));
    }
    offset += 2 + length;
  }
  return 1;
}

function parseTiffOrientation(buf, start, end) {
  if (start + 8 > end) return 1;
  const order = buf.toString('binary', start, start + 2);
  const little = order === 'II';
  if (!little && order !== 'MM') return 1;
  const u16 = (o) => (little ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
  const u32 = (o) => (little ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
  if (u16(start + 2) !== 42) return 1;
  const ifd = start + u32(start + 4);
  if (ifd + 2 > end) return 1;
  const entries = u16(ifd);
  for (let i = 0; i < entries; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > end) return 1;
    if (u16(entry) === 0x0112) {
      const value = u16(entry + 8);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
}

module.exports = { readJpegOrientation, parseOrientation };
