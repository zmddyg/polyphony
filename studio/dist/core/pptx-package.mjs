const ZIP_LOCAL = 0x04034b50;
const ZIP_CENTRAL = 0x02014b50;
const ZIP_END = 0x06054b50;
const MAX_FILE_SIZE = 128 * 1024 * 1024;
const MAX_DIRECTORY_SIZE = 16 * 1024 * 1024;
const MAX_ENTRIES = 20_000;
const utf8 = new TextDecoder('utf-8', { fatal: true });

const crcTable = Uint32Array.from({ length: 256 }, (_, byte) => {
  for (let bit = 0; bit < 8; bit++) {
    byte = (byte >>> 1) ^ (byte & 1 ? 0xedb88320 : 0);
  }
  return byte;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ bytes[index]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function view(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function readName(bytes, flags) {
  try {
    return utf8.decode(bytes);
  } catch (error) {
    if (flags & 0x800) throw error;
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

function decodedSegment(segment) {
  let decoded;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    return null;
  }
  return !decoded || /[\\/:?#\u0000-\u001f\u007f]/u.test(decoded) ? null : decoded;
}

function partKey(path) {
  if (typeof path !== 'string') return null;
  const segments = path.split('/').map(decodedSegment);
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) return null;
  return segments.join('/').replace(/[A-Z]/g, character => character.toLowerCase());
}

export function resolvePackagePart(source, target) {
  if (!target || target.startsWith('//')) return null;
  const absolute = target.startsWith('/');
  const segments = absolute ? [] : source.split('/').slice(0, -1);
  for (const segment of (absolute ? target.slice(1) : target).split('/')) {
    const decoded = decodedSegment(segment);
    if (decoded === '.') continue;
    if (decoded === '..' && segments.length) segments.pop();
    else if (!decoded || decoded === '..') return null;
    else segments.push(segment);
  }
  return segments.length ? segments.join('/') : null;
}

export function packageRelationshipsPart(source) {
  const slash = source.lastIndexOf('/');
  return source.slice(0, slash + 1) + '_rels/' + source.slice(slash + 1) + '.rels';
}

function endRecord(tail) {
  const data = view(tail);
  for (let offset = data.byteLength - 22; offset >= 0; offset--) {
    if (data.getUint32(offset, true) !== ZIP_END) continue;
    if (offset + 22 + data.getUint16(offset + 20, true) !== data.byteLength) continue;
    const entries = data.getUint16(offset + 10, true);
    const size = data.getUint32(offset + 12, true);
    const start = data.getUint32(offset + 16, true);
    if (data.getUint16(offset + 4, true) || data.getUint16(offset + 6, true) ||
        data.getUint16(offset + 8, true) !== entries || entries === 0xffff ||
        size === 0xffffffff || start === 0xffffffff) {
      throw new Error('该课件使用了分卷或 ZIP64 封装。请将原课件另存为普通 .pptx 或导出 PDF。');
    }
    return { entries, size, start, endOffset: offset };
  }
  return null;
}

async function directory(file) {
  const tailStart = Math.max(0, file.size - 65_557);
  const tail = new Uint8Array(await file.slice(tailStart).arrayBuffer());
  const end = endRecord(tail);
  if (!end) {
    const signature = tailStart === 0 ? tail.subarray(0, 8) : new Uint8Array(await file.slice(0, 8).arrayBuffer());
    if ([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every((byte, index) => signature[index] === byte)) {
      throw new Error('这是旧版或受保护的 PowerPoint 文件。请另存为未加密的 .pptx 或导出 PDF。');
    }
    throw new Error('该文件无法识别为 .pptx 课件。请检查文件或另存为 .pptx 后重试。');
  }
  const { entries, size, start } = end;
  if (entries > MAX_ENTRIES || size > MAX_DIRECTORY_SIZE || start + size > tailStart + end.endOffset) {
    throw new Error('该课件的文件目录超出支持范围或已损坏。');
  }
  const bytes = start >= tailStart
    ? tail.subarray(start - tailStart, start - tailStart + size)
    : new Uint8Array(await file.slice(start, start + size).arrayBuffer());
  const data = view(bytes);
  const parts = new Map();
  let cursor = 0;
  for (let index = 0; index < entries; index++) {
    if (cursor + 46 > size || data.getUint32(cursor, true) !== ZIP_CENTRAL) {
      throw new Error('该课件的文件目录已损坏。');
    }
    const flags = data.getUint16(cursor + 8, true);
    const nameLength = data.getUint16(cursor + 28, true);
    const next = cursor + 46 + nameLength + data.getUint16(cursor + 30, true) + data.getUint16(cursor + 32, true);
    if (next > size) throw new Error('该课件的文件目录已损坏。');
    const path = readName(bytes.subarray(cursor + 46, cursor + 46 + nameLength), flags);
    const key = partKey(path);
    if (key) {
      if (parts.has(key)) throw new Error('该课件包含重复的内部部件名。');
      parts.set(key, {
        path, flags, nameLength,
        method: data.getUint16(cursor + 10, true),
        checksum: data.getUint32(cursor + 16, true),
        packedLength: data.getUint32(cursor + 20, true),
        length: data.getUint32(cursor + 24, true),
        disk: data.getUint16(cursor + 34, true),
        offset: data.getUint32(cursor + 42, true),
      });
    }
    cursor = next;
  }
  return { parts, directoryOffset: start };
}

async function inflate(part, expectedLength) {
  let stream;
  try {
    stream = new DecompressionStream('deflate-raw');
  } catch {
    throw new Error('此浏览器无法解压 .pptx。请使用新版浏览器或导入 PDF。');
  }
  const output = new Uint8Array(expectedLength);
  const reader = part.stream().pipeThrough(stream).getReader();
  let offset = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (offset + value.length > expectedLength) {
        await reader.cancel();
        throw new Error('课件内的部件解压长度与文件目录不符。');
      }
      output.set(value, offset);
      offset += value.length;
    }
  } finally {
    reader.releaseLock();
  }
  if (offset !== expectedLength) throw new Error('课件内的部件解压长度与文件目录不符。');
  return output;
}

export async function openPptxPackage(file) {
  if (!file || typeof file.slice !== 'function' || !Number.isSafeInteger(file.size)) {
    throw new Error('请选择一个 .pptx 文件。');
  }
  if (file.size > MAX_FILE_SIZE) throw new Error('课件超过 128 MB。请拆分课件后导入。');
  const { parts, directoryOffset } = await directory(file);
  return {
    names: () => [...parts.values()].map(part => part.path),
    part: path => parts.get(partKey(path)),
    async read(path, limit) {
      const part = parts.get(partKey(path));
      if (!part) throw new Error('在课件中找不到所需部件。');
      const { flags, method, offset, packedLength, length, checksum, disk, nameLength } = part;
      if (length > limit) throw new Error('课件中的部件超过支持大小。');
      if (disk || (flags & 0x41)) throw new Error('课件内的部件使用了分卷或加密封装。');
      if (offset + 30 > directoryOffset) throw new Error('课件内的部件位置无效。');
      const nameStart = offset + 30;
      const local = new Uint8Array(await file.slice(offset, Math.min(nameStart + nameLength, directoryOffset)).arrayBuffer());
      const header = view(local);
      if (header.getUint32(0, true) !== ZIP_LOCAL || header.getUint16(6, true) !== flags ||
          header.getUint16(8, true) !== method) {
        throw new Error('课件内的部件头已损坏。');
      }
      const localNameLength = header.getUint16(26, true);
      const start = nameStart + localNameLength + header.getUint16(28, true);
      if (start + packedLength > directoryOffset) throw new Error('课件内的部件长度无效。');
      const localName = localNameLength <= local.length - 30
        ? local.subarray(30, 30 + localNameLength)
        : new Uint8Array(await file.slice(nameStart, nameStart + localNameLength).arrayBuffer());
      if (readName(localName, flags) !== part.path) throw new Error('课件内的部件名与文件目录不符。');
      const packed = file.slice(start, start + packedLength);
      let bytes;
      if (method === 0 && length === packedLength) bytes = new Uint8Array(await packed.arrayBuffer());
      else if (method === 8) bytes = await inflate(packed, length);
      else throw new Error('课件内的部件使用了当前不支持的压缩格式。');
      if (crc32(bytes) !== checksum) throw new Error('课件内的部件校验失败。');
      return bytes;
    },
  };
}
