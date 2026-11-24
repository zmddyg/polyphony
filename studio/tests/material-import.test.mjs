import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { isLegacyPpt, readLegacySlides } from '../dist/core/legacy-ppt.mjs';
import { importMaterialFile, materialRenderingAvailable } from '../material-import.mjs';

const legacyFixture = await readFile(new URL('./fixtures/material-import-basic.ppt', import.meta.url));
const hiddenFixture = await readFile(new URL('./fixtures/material-import-hidden.pptx', import.meta.url));

test('reads a real binary PowerPoint in slide-list order and includes drawing text without Office', async context => {
  const previous = process.env.POLYPHONY_SOFFICE;
  process.env.POLYPHONY_SOFFICE = fileURLToPath(new URL('./absent-soffice', import.meta.url));
  context.after(() => {
    if (previous === undefined) delete process.env.POLYPHONY_SOFFICE;
    else process.env.POLYPHONY_SOFFICE = previous;
  });
  assert.equal(await materialRenderingAvailable(), false);
  const bytes = new Uint8Array(legacyFixture);
  assert.equal(isLegacyPpt(bytes), true);
  const local = readLegacySlides(bytes);
  const { name, pages, warnings } = await importMaterialFile({ name: '教学课件.PPT', bytes });
  assert.equal(name, '教学课件.PPT');
  assert.deepEqual(pages, local.pages);
  assert.deepEqual(pages.map(({ number, title }) => [number, title]), [
    [1, 'This is a test title'],
    [2, 'This is the title on page 2'],
  ]);
  assert.match(pages[0].text, /This is a test subtitle\nThis is on page 1/);
  assert.match(pages[1].text, /It has several blocks of text\nNone of them have formatting/);
  assert.equal(local.truncated, false);
  assert.match(warnings.join(' '), /旧版 PPT/);
  await assert.rejects(importMaterialFile({ name: 'lesson.pptx', bytes: hiddenFixture }), { status: 503 });
});

test('keeps a binary PowerPoint slide hidden in its original position', () => {
  const bytes = Buffer.from(legacyFixture);
  // Replace the optional color-scheme record of the live second slide with a transition record.
  const offset = 15_042;
  assert.equal(bytes.readUInt16LE(offset + 2), 2032);
  bytes.fill(0, offset, offset + 40);
  bytes.writeUInt16LE(0x03f9, offset + 2);
  bytes.writeUInt32LE(16, offset + 4);
  bytes[offset + 18] = 0x04;
  bytes.writeUInt16LE(0x9001, offset + 26);
  bytes.writeUInt32LE(8, offset + 28);
  const { pages } = readLegacySlides(bytes);
  assert.deepEqual(pages.map(({ number, hidden }) => [number, hidden]), [[1, false], [2, true]]);
  assert.equal(pages[1].title, 'This is the title on page 2');
});

test('checks the file signature, page limit and corrupt CFB sector chains', async () => {
  await assert.rejects(importMaterialFile({ name: 'renamed.ppt', bytes: Buffer.from('PK\u0003\u0004') }), { status: 415 });
  await assert.rejects(importMaterialFile({ name: 'renamed.pdf', bytes: legacyFixture }), { status: 415 });
  assert.throws(() => readLegacySlides(new Uint8Array(legacyFixture), { pageLimit: 1 }), { status: 413 });

  const damaged = new Uint8Array(legacyFixture);
  const compound = new DataView(damaged.buffer);
  const sectorSize = 2 ** compound.getUint16(30, true);
  const firstDirectory = compound.getUint32(48, true);
  const firstFat = compound.getUint32(76, true);
  compound.setUint32((firstFat + 1) * sectorSize + firstDirectory * 4, firstDirectory, true);
  assert.throws(() => readLegacySlides(damaged), { status: 422 });
});

function pdfFixture(contents) {
  const pageRefs = contents.map((_, index) => `${4 + index * 2} 0 R`);
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pageRefs.join(' ')}] /Count ${contents.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  contents.forEach((content, index) => {
    const contentId = 5 + index * 2;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 240] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`);
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });
  let result = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((object, index) => {
    offsets.push(result.length);
    result += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = result.length;
  result += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach(offset => { result += `${String(offset).padStart(10, '0')} 00000 n \n`; });
  result += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(result, 'ascii');
}

test('extracts text and an original page preview from a real PDF, including pages without text', async context => {
  const bytes = pdfFixture([
    'BT /F1 15 Tf 24 170 Td (Measure the normal force.) Tj ET',
    '0.2 0.4 0.7 rg 40 40 180 120 re f',
  ]);
  let result;
  try {
    result = await importMaterialFile({ name: 'lesson.pdf', bytes });
  } catch (error) {
    if (error.status === 503) {
      context.skip('Python with PyMuPDF is unavailable');
      return;
    }
    throw error;
  }
  assert.deepEqual(result.pages.map(({ number, text }) => [number, text]), [
    [1, 'Measure the normal force.'],
    [2, ''],
  ]);
  assert.notEqual(result.pages[0].preview, result.pages[1].preview);
  for (const { preview } of result.pages) {
    assert.match(preview, /^data:image\/png;base64,/);
    assert.equal(Buffer.from(preview.split(',')[1], 'base64').subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  }
  assert.match(result.warnings.join(' '), /没有可提取的文字/);
});

test('renders original .ppt and .pptx pages and retains hidden-slide positions', { timeout: 110_000 }, async context => {
  if (!await materialRenderingAvailable()) {
    context.skip('LibreOffice, Python UNO and PyMuPDF are required');
    return;
  }
  const [ppt, pptx] = await Promise.all([
    importMaterialFile({ name: 'real-binary.ppt', bytes: legacyFixture }),
    importMaterialFile({ name: 'one-hidden-slide.pptx', bytes: hiddenFixture }),
  ]);
  assert.deepEqual(ppt.pages.map(({ number, sourcePageNumber }) => [number, sourcePageNumber]), [[1, 1], [2, 2]]);
  assert.match(ppt.pages[0].text, /This is a test title/);
  assert.deepEqual(pptx.pages.map(({ number, sourcePageNumber, hidden }) => [number, sourcePageNumber, hidden]), [
    [1, 1, false],
    [2, 2, true],
    [3, 3, false],
  ]);
  assert.match(pptx.pages[1].text, /Teacher reference/);
  assert.match(pptx.pages[2].text, /Compare results/);
  for (const page of [...ppt.pages, ...pptx.pages]) assert.match(page.preview, /^data:image\/png;base64,/);
});
