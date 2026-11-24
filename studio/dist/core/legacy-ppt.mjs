// Read only the CFB streams and MS-PPT records that describe slide order and text.
// https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-cfb/
// https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/
const FREE_SECTOR = 0xffffffff;
const END_OF_CHAIN = 0xfffffffe;
const MINI_SECTOR_SIZE = 64;
const MINI_STREAM_CUTOFF = 4096;
const RECORD_BUDGET = 180_000;
const utf16le = new TextDecoder('utf-16le', { ignoreBOM: true });
const viewOf = bytes => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const uint16 = (view, offset) => view.getUint16(offset, true);
const uint32 = (view, offset) => view.getUint32(offset, true);
const region = (view, start, end) => new Uint8Array(view.buffer, view.byteOffset + start, end - start);

const recordType = {
  document: 1000,
  slide: 1006,
  slidePersist: 1011,
  slideShowInfo: 1017,
  drawing: 1036,
  outlineRef: 3998,
  textHeader: 3999,
  textChars: 4000,
  textBytes: 4008,
  slideList: 4080,
  userEdit: 4085,
  currentUser: 4086,
  persistDirectory: 6002,
  drawingGroup: 0xf002,
  shapeGroup: 0xf003,
  shape: 0xf004,
  textBox: 0xf00d,
};

const drawingContainers = new Set([
  recordType.drawing, recordType.drawingGroup, recordType.shapeGroup, recordType.shape,
]);

export const MAX_LEGACY_PPT_BYTES = 32 * 1024 * 1024;
export const MAX_LEGACY_PPT_PAGES = 100;
const MAX_PAGE_TEXT = 12_000;
const pptSignature = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

export function isLegacyPpt(bytes) {
  return bytes instanceof Uint8Array && pptSignature.every((value, index) => bytes[index] === value);
}

function invalid(message = '无法读取这份旧版 PPT，文件可能不完整或格式不受支持。') {
  return Object.assign(new Error(message), { status: 422 });
}

function check(condition) {
  if (!condition) throw invalid();
}

function readChain(first, blockSize, blockLimit, next, block, byteLength) {
  const expected = byteLength === undefined ? undefined : Math.ceil(byteLength / blockSize);
  if (expected === 0) return new Uint8Array(0);
  check(expected === undefined || expected <= blockLimit);
  const visited = new Set();
  const pieces = [];
  for (let id = first; id !== END_OF_CHAIN; id = next(id)) {
    check(id < blockLimit && !visited.has(id) && (expected === undefined || pieces.length < expected));
    visited.add(id);
    pieces.push(block(id));
  }
  check(expected === undefined ? pieces.length > 0 : pieces.length === expected);
  const result = new Uint8Array(byteLength ?? pieces.length * blockSize);
  for (const [index, piece] of pieces.entries()) {
    const offset = index * blockSize;
    result.set(piece.subarray(0, result.length - offset), offset);
  }
  return result;
}

function compoundStreams(bytes) {
  check(isLegacyPpt(bytes) && bytes.length >= 512);
  const header = viewOf(bytes);
  const major = uint16(header, 26);
  const sectorShift = uint16(header, 30);
  check((major === 3 && sectorShift === 9) || (major === 4 && sectorShift === 12));
  check(uint16(header, 28) === 0xfffe && uint16(header, 32) === 6);
  check(uint32(header, 56) === MINI_STREAM_CUTOFF);
  const sectorSize = 2 ** sectorShift;
  const sectorCount = Math.floor(bytes.length / sectorSize) - 1;
  const sector = id => bytes.subarray((id + 1) * sectorSize, (id + 2) * sectorSize);
  const fatCount = uint32(header, 44);
  const difatCount = uint32(header, 72);
  check(fatCount > 0 && fatCount <= sectorCount && difatCount <= sectorCount);

  const fatSectors = new Set();
  function addFat(id) {
    if (id === FREE_SECTOR) return;
    check(id < sectorCount && !fatSectors.has(id) && fatSectors.size < fatCount);
    fatSectors.add(id);
  }
  for (let offset = 76; offset < 512; offset += 4) addFat(uint32(header, offset));

  const visitedDifat = new Set();
  let difatId = uint32(header, 68);
  for (let i = 0; i < difatCount; i += 1) {
    check(difatId < sectorCount && !visitedDifat.has(difatId));
    visitedDifat.add(difatId);
    const difat = viewOf(sector(difatId));
    for (let offset = 0; offset < sectorSize - 4; offset += 4) addFat(uint32(difat, offset));
    difatId = uint32(difat, sectorSize - 4);
  }
  check(fatSectors.size === fatCount && (!difatCount || difatId === END_OF_CHAIN));
  const fat = [...fatSectors].map(id => viewOf(sector(id)));
  const fatEntriesPerSector = sectorSize / 4;
  check(fat.length * fatEntriesPerSector >= sectorCount);
  const regularStream = (first, length) => readChain(first, sectorSize, sectorCount,
    id => uint32(fat[Math.floor(id / fatEntriesPerSector)], (id % fatEntriesPerSector) * 4), sector, length);

  const directorySize = major === 4 ? uint32(header, 40) * sectorSize : undefined;
  const directory = viewOf(regularStream(uint32(header, 48), directorySize));
  check(directory.byteLength >= 128 && directory.getUint8(66) === 5);

  function streamSize(offset) {
    if (major === 4) check(uint32(directory, offset + 124) === 0);
    return uint32(directory, offset + 120);
  }

  let miniFat;
  let miniStream;
  function readStream(offset) {
    const first = uint32(directory, offset + 116);
    const size = streamSize(offset);
    if (size >= MINI_STREAM_CUTOFF) return regularStream(first, size);
    if (!size) return new Uint8Array(0);
    miniFat ??= viewOf(regularStream(uint32(header, 60), uint32(header, 64) * sectorSize));
    miniStream ??= regularStream(uint32(directory, 116), streamSize(0));
    const miniCount = Math.min(miniFat.byteLength / 4, Math.floor(miniStream.length / MINI_SECTOR_SIZE));
    return readChain(first, MINI_SECTOR_SIZE, miniCount, id => uint32(miniFat, id * 4),
      id => miniStream.subarray(id * MINI_SECTOR_SIZE, (id + 1) * MINI_SECTOR_SIZE), size);
  }

  const streams = new Map();
  const pending = [uint32(directory, 76)];
  const visited = new Set();
  while (pending.length) {
    const id = pending.pop();
    if (id === FREE_SECTOR) continue;
    const offset = id * 128;
    check(id > 0 && offset + 128 <= directory.byteLength && !visited.has(id));
    visited.add(id);
    pending.push(uint32(directory, offset + 68), uint32(directory, offset + 72));
    if (directory.getUint8(offset + 66) !== 2) continue;
    const nameSize = uint16(directory, offset + 64);
    check(nameSize >= 2 && nameSize <= 64 && nameSize % 2 === 0);
    const name = utf16le.decode(region(directory, offset, offset + nameSize - 2)).toLowerCase();
    if (name === 'current user' || name === 'powerpoint document') {
      check(!streams.has(name));
      streams.set(name, viewOf(readStream(offset)));
    }
  }
  check(streams.size === 2);
  return streams;
}

function recordReader() {
  let remaining = RECORD_BUDGET;
  function recordAt(bytes, offset, limit = bytes.byteLength) {
    check(remaining > 0 && Number.isInteger(offset) && offset >= 0 && offset + 8 <= limit);
    remaining -= 1;
    const start = offset + 8;
    const end = start + uint32(bytes, offset + 4);
    check(end <= limit);
    return { type: uint16(bytes, offset + 2), instance: uint16(bytes, offset) >>> 4, start, end };
  }
  function* children(bytes, container) {
    for (let offset = container.start; offset < container.end;) {
      const record = recordAt(bytes, offset, container.end);
      yield record;
      offset = record.end;
    }
  }
  return { recordAt, children };
}

function persistObjects(document, currentUser, recordAt) {
  const current = recordAt(currentUser, 0);
  check(current.type === recordType.currentUser && current.end - current.start >= 20);
  const token = uint32(currentUser, current.start + 4);
  if (token === 0xf3d1c4df) throw invalid('旧版 PPT 已加密。请另存为无需密码的文件后再导入。');
  check(token === 0xe391c05f);

  const objects = new Map();
  let editOffset = uint32(currentUser, current.start + 8);
  let documentId;
  do {
    const edit = recordAt(document, editOffset);
    check(edit.type === recordType.userEdit && edit.end - edit.start >= 28);
    documentId ??= uint32(document, edit.start + 16);
    const previous = uint32(document, edit.start + 8);
    const directoryOffset = uint32(document, edit.start + 12);
    check(previous <= directoryOffset && directoryOffset < editOffset);
    const directory = recordAt(document, directoryOffset);
    check(directory.type === recordType.persistDirectory && directory.end <= editOffset);
    for (let position = directory.start; position < directory.end;) {
      check(position + 4 <= directory.end);
      const group = uint32(document, position);
      const firstId = group & 0xfffff;
      const count = group >>> 20;
      position += 4;
      check(count > 0 && firstId > 0 && firstId + count <= 0x100000 && position + count * 4 <= directory.end);
      for (let i = 0; i < count; i += 1, position += 4) {
        const offset = uint32(document, position);
        check(offset < directoryOffset);
        if (!objects.has(firstId + i)) objects.set(firstId + i, offset);
      }
    }
    editOffset = previous;
  } while (editOffset !== 0);
  return { objects, documentId };
}

function textRun(document, item, run, textLimit) {
  if (item.type === recordType.textHeader) {
    check(item.end - item.start === 4);
    return { type: uint32(document, item.start), text: '' };
  }
  if (!run || (item.type !== recordType.textChars && item.type !== recordType.textBytes)) return run;
  const unicode = item.type === recordType.textChars;
  const width = unicode ? 2 : 1;
  check((item.end - item.start) % width === 0);
  const characters = region(document, item.start, Math.min(item.end, item.start + (textLimit + 1) * width));
  run.text = unicode ? utf16le.decode(characters) : String.fromCharCode(...characters);
  return run;
}

function slideOutline(document, slideList, children, pageLimit, textLimit) {
  const slides = [];
  let active;
  let run;
  for (const item of children(document, slideList)) {
    if (item.type === recordType.slidePersist) {
      check(item.end - item.start === 20);
      if (slides.length >= pageLimit) {
        throw Object.assign(new Error(`一次最多导入 ${pageLimit} 页。请拆分文件后再导入。`), { status: 413 });
      }
      active = { persistId: uint32(document, item.start), outline: [] };
      slides.push(active);
      run = undefined;
    } else if (active) {
      run = textRun(document, item, run, textLimit);
      if (item.type === recordType.textHeader) active.outline.push(run);
    }
  }
  return slides;
}

function slideContent(document, slide, outline, children, textLimit) {
  const runs = [];
  let hidden = false;
  function visit(container, depth) {
    check(depth <= 32);
    for (const item of children(document, container)) {
      if (depth === 0 && item.type === recordType.slideShowInfo) {
        check(item.end - item.start >= 12);
        // MS-PPT 2.6.6: fHidden is bit 2 in the transition flags.
        hidden ||= Boolean(uint16(document, item.start + 10) & 0x0004);
      } else if (drawingContainers.has(item.type)) {
        visit(item, depth + 1);
      } else if (item.type === recordType.textBox) {
        let run;
        for (const textItem of children(document, item)) {
          if (textItem.type === recordType.outlineRef) {
            check(textItem.end - textItem.start === 4);
            const index = uint32(document, textItem.start);
            if (outline[index]) runs.push(outline[index]);
            continue;
          }
          run = textRun(document, textItem, run, textLimit);
          if (textItem.type === recordType.textHeader) runs.push(run);
        }
      }
    }
  }
  visit(slide, 0);
  return { runs, hidden };
}

function cleanText(text) {
  return text.replace(/\r\n?|\u000b|\u000c/g, '\n')
    .replace(/[\u0000-\u0008\u000e-\u001f\u007f]/g, '').trim();
}

export function readLegacySlides(bytes, { pageLimit = MAX_LEGACY_PPT_PAGES, textLimit = MAX_PAGE_TEXT } = {}) {
  if (bytes?.byteLength > MAX_LEGACY_PPT_BYTES) {
    throw Object.assign(new Error('一次最多导入 32 MB。请拆分文件后再导入。'), { status: 413 });
  }
  const streams = compoundStreams(bytes);
  const document = streams.get('powerpoint document');
  const { recordAt, children } = recordReader();
  const { objects, documentId } = persistObjects(document, streams.get('current user'), recordAt);
  const root = recordAt(document, objects.get(documentId));
  check(root.type === recordType.document);
  let slides = [];
  for (const item of children(document, root)) {
    if (item.type === recordType.slideList && item.instance === 0) {
      slides = slideOutline(document, item, children, pageLimit, textLimit);
      break;
    }
  }
  if (!slides.length) throw invalid('这份旧版 PPT 没有可导入的幻灯片。');

  let truncated = false;
  const slideOffsets = new Set();
  const pages = slides.map(({ persistId, outline }, index) => {
    const offset = objects.get(persistId);
    check(!slideOffsets.has(offset));
    slideOffsets.add(offset);
    const slide = recordAt(document, offset);
    check(slide.type === recordType.slide);
    const content = slideContent(document, slide, outline, children, textLimit);
    const runs = [...new Set([...content.runs, ...outline])];
    const title = runs.find(run => (run.type === 0 || run.type === 6) && run.text.trim());
    const parts = [];
    let length = 0;
    for (const run of runs) {
      const part = cleanText(run.text);
      if (!part) continue;
      length += part.length + (parts.length ? 1 : 0);
      parts.push(part);
      if (length > textLimit) {
        truncated = true;
        break;
      }
    }
    const text = parts.join('\n').slice(0, textLimit);
    const number = index + 1;
    return {
      number, hidden: content.hidden, text,
      title: (title ? cleanText(title.text) : text).split('\n', 1)[0].slice(0, 120) || `第 ${number} 页`,
    };
  });
  return { pages, truncated };
}
