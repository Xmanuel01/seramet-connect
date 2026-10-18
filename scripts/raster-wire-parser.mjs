// Independent disposable-test decoder. No dependency on the document layout,
// font or production renderer; screenshots use only captured GS v 0 bitmap bits.
export function parseRasterWire(bytes) {
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.length > 1048576 ||
    !bytes.subarray(0, 5).equals(Buffer.from([27, 64, 27, 97, 0]))
  )
    throw new Error("INVALID_CAPTURE");
  let pos = 5,
    width = 0,
    height = 0,
    feed = 0,
    cut = false;
  const bands = [];
  while (pos < bytes.length) {
    if (
      bytes[pos] === 29 &&
      bytes[pos + 1] === 118 &&
      bytes[pos + 2] === 48 &&
      bytes[pos + 3] === 0
    ) {
      if (feed || cut || pos + 8 > bytes.length) throw new Error("INVALID_RASTER_SEQUENCE");
      const stride = bytes.readUInt16LE(pos + 4),
        rows = bytes.readUInt16LE(pos + 6);
      const length = stride * rows;
      if (
        !stride ||
        stride > 104 ||
        !rows ||
        rows > 256 ||
        pos + 8 + length > bytes.length ||
        (width && width !== stride * 8) ||
        height + rows > 32768
      )
        throw new Error("INVALID_RASTER_DIMENSIONS");
      width = stride * 8;
      height += rows;
      bands.push({ width, height: rows, data: bytes.subarray(pos + 8, pos + 8 + length) });
      pos += 8 + length;
    } else if (
      bytes[pos] === 27 &&
      bytes[pos + 1] === 100 &&
      bytes[pos + 2] === 3 &&
      !feed &&
      !cut
    ) {
      feed = 3;
      pos += 3;
    } else if (
      bytes[pos] === 29 &&
      bytes[pos + 1] === 86 &&
      [0, 1].includes(bytes[pos + 2]) &&
      feed &&
      !cut
    ) {
      cut = true;
      pos += 3;
    } else throw new Error("UNKNOWN_CAPTURE_COMMAND");
  }
  if (!bands.length || feed !== 3) throw new Error("INCOMPLETE_RASTER_CAPTURE");
  return { width, height, bands, feed, cut, data: Buffer.concat(bands.map((b) => b.data)) };
}
