import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { deflateRawSync, deflateSync } from 'node:zlib';
import test from 'node:test';
import { openPptxPackage, resolvePackagePart } from '../dist/core/pptx-package.mjs';
import { readPptx } from '../dist/core/pptx-reader.mjs';

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function zip(entries, comment = '') {
  const files = [];
  const directory = [];
  let offset = 0;
  for (const [path, source, options = {}] of entries) {
    const name = Buffer.from(path);
    const localName = options.localName ? Buffer.from(options.localName) : name;
    const contents = Buffer.from(source);
    const packed = options.stored ? contents : deflateRawSync(contents);
    const checksum = crc32(contents);
    const flags = 0x800 | (options.descriptor ? 8 : 0);
    const method = options.stored ? 0 : 8;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(flags, 6);
    header.writeUInt16LE(method, 8);
    if (!options.descriptor) {
      header.writeUInt32LE(checksum, 14);
      header.writeUInt32LE(packed.length, 18);
      header.writeUInt32LE(contents.length, 22);
    }
    header.writeUInt16LE(localName.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(flags, 8);
    entry.writeUInt16LE(method, 10);
    entry.writeUInt32LE(options.badCrc ? (checksum ^ 1) >>> 0 : checksum, 16);
    entry.writeUInt32LE(packed.length, 20);
    entry.writeUInt32LE(contents.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    const descriptor = Buffer.alloc(options.descriptor ? 16 : 0);
    if (options.descriptor) {
      descriptor.writeUInt32LE(0x08074b50);
      descriptor.writeUInt32LE(checksum, 4);
      descriptor.writeUInt32LE(packed.length, 8);
      descriptor.writeUInt32LE(contents.length, 12);
    }
    files.push(header, localName, packed, descriptor);
    directory.push(entry, name);
    offset += header.length + localName.length + packed.length + descriptor.length;
  }
  const directoryBytes = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directoryBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  const commentBytes = Buffer.from(comment);
  end.writeUInt16LE(commentBytes.length, 20);
  return Buffer.concat([...files, directoryBytes, end, commentBytes]);
}

function png(pixels) {
  const size = Buffer.alloc(13);
  size.writeUInt32BE(pixels.length, 0);
  size.writeUInt32BE(1, 4);
  size[8] = 8;
  size[9] = 2;
  const chunk = (name, payload) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(payload.length);
    const body = Buffer.concat([Buffer.from(name), payload]);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, checksum]);
  };
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', size),
    chunk('IDAT', deflateSync(Buffer.from([0, ...pixels.flat()]))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const office = 'http://schemas.openxmlformats.org/';
const links = office + 'officeDocument/2006/relationships';
const drawing = office + 'drawingml/2006/main';
const chart = office + 'drawingml/2006/chart';
const diagram = office + 'drawingml/2006/diagram';
const baseNs = ' xmlns:p="' + office + 'presentationml/2006/main" xmlns:a="' + drawing +
  '" xmlns:r="' + links + '" xmlns:m="' + office + 'officeDocument/2006/math' +
  '" xmlns:mc="' + office + 'markup-compatibility/2006" xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main"';
const rels = (...rows) => '<Relationships xmlns="' + office + 'package/2006/relationships">' +
  rows.map(([id, kind, target, external]) => '<Relationship Id="' + id + '" Type="' + links + '/' + kind +
    '" Target="' + target + '"' + (external ? ' TargetMode="External"' : '') + '/>').join('') + '</Relationships>';
const paragraph = contents => '<a:p>' + contents + '</a:p>';
const run = text => '<a:r><a:t>' + text + '</a:t></a:r>';
const shape = (id, name, paragraphs, { ph = '', hidden = false } = {}) =>
  '<p:sp><p:nvSpPr><p:cNvPr id="' + id + '" name="' + name + '"' + (hidden ? ' hidden="1"' : '') +
  '/><p:cNvSpPr/><p:nvPr>' + ph + '</p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>' +
  paragraphs + '</p:txBody></p:sp>';
const size = 9_144_000;
const picture = (id, reference, width, { crop = '', geometry = 'rect', external = false } = {}) =>
  '<p:pic><p:nvPicPr><p:cNvPr id="' + id + '" name="Picture ' + id + '" descr="原附图 ' + id +
  '"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:' + (external ? 'link' : 'embed') +
  '="' + reference + '"/>' + crop + '<a:stretch><a:fillRect/></a:stretch></p:blipFill>' +
  '<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + width + '" cy="' + size + '"/></a:xfrm>' +
  '<a:prstGeom prst="' + geometry + '"><a:avLst/></a:prstGeom></p:spPr></p:pic>';
const graphic = (id, uri, inner) =>
  '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="' + id + '" name="Graphic ' + id +
  '"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="10000" cy="10000"/>' +
  '</p:xfrm><a:graphic><a:graphicData uri="' + uri + '">' + inner + '</a:graphicData></a:graphic></p:graphicFrame>';
const page = (kind, contents, attributes = '') =>
  '<p:' + kind + baseNs + attributes + '><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/>' +
  '<p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>' + contents + '</p:spTree></p:cSld></p:' + kind + '>';

function fixtureEntries() {
  const math = '<a14:m><m:oMathPara><m:oMath><m:f><m:num><m:r><m:t>λ</m:t></m:r></m:num>' +
    '<m:den><m:sSup><m:e><m:r><m:t>n</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup>' +
    '</m:sSup></m:den></m:f></m:oMath></m:oMathPara></a14:m>';
  const group = '<p:grpSp><p:nvGrpSpPr><p:cNvPr id="2" name="Group 1"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
    '<p:grpSpPr/>' + shape(3, 'Group Text', paragraph(run('角度 A &amp; B') + '<a:br/>' +
      '<a:fld id="{53F0D46C-93B1-4C1C-8D40-E8903F5B0DD3}" type="slidenum"><a:t>第八节</a:t></a:fld>')) + '</p:grpSp>';
  const equation = '<mc:AlternateContent><mc:Choice Requires="a14">' + shape(5, 'Formula', paragraph(run('关系 ') + math)) +
    '</mc:Choice><mc:Fallback>' + picture(6, 'rEquation', 3_000) + '</mc:Fallback></mc:AlternateContent>';
  const cell = text => '<a:tc><a:txBody><a:bodyPr/><a:lstStyle/>' + paragraph(run(text)) + '</a:txBody><a:tcPr/></a:tc>';
  const table = graphic(7, office + 'drawingml/2006/table',
    '<a:tbl><a:tblPr/><a:tblGrid><a:gridCol w="10000"/><a:gridCol w="10000"/></a:tblGrid><a:tr h="10000">' +
    cell('单元格甲') + cell('单元格乙') + '</a:tr></a:tbl>');
  const first = page('sld', group + shape(4, 'Placeholder 23', paragraph(run('从波峰到谷底')), { ph: '<p:ph idx="08"/>' }) +
    equation + table + graphic(8, chart, '<c:chart xmlns:c="' + chart + '" r:id="rChart"/>') +
    graphic(9, diagram, '<dgm:relIds xmlns:dgm="' + diagram + '" r:dm="rDiagram"/>') +
    shape(10, 'Hidden Teacher Text', paragraph(run('教师私下说明')), { hidden: true }) +
    picture(11, 'rExternal', 200, { external: true }) + picture(12, 'rVector', 300));
  const second = page('sld', picture(2, 'rWhole', size), ' show="0"');
  const last = page('sld', shape(2, 'Title 2', paragraph(run('裁切的课件原图'))) +
    picture(3, 'rMixed', size, { crop: '<a:srcRect l="50000"/>' }) +
    picture(4, 'rMasked', size, { geometry: 'ellipse', crop: '<a:srcRect r="50%"/>' }), ' showMasterSp="0"');
  const layout = page('sldLayout',
    shape(2, 'Title Placeholder', paragraph(run('Click to edit Master title style')), { ph: '<p:ph type="ctrTitle" idx="8"/>' }) +
    shape(3, 'Legacy Stamp', paragraph(run('公开版实验资料'))), ' type="title"');
  const master = page('sldMaster', shape(2, 'Master Text', paragraph(run('实验室原始标注'))));
  const plot = '<c:chartSpace xmlns:c="' + chart + '" xmlns:a="' + drawing + '"><c:chart>' +
    '<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/>' + paragraph(run('温度变化')) + '</c:rich></c:tx></c:title>' +
    '<c:plotArea><c:barChart><c:ser><c:tx><c:v>水温</c:v></c:tx>' +
    '<c:cat><c:strLit><c:ptCount val="2"/><c:pt idx="1"><c:v>乙</c:v></c:pt><c:pt idx="0"><c:v>甲</c:v></c:pt></c:strLit></c:cat>' +
    '<c:val><c:numLit><c:ptCount val="2"/><c:pt idx="1"><c:v>32.5</c:v></c:pt><c:pt idx="0"><c:v>28</c:v></c:pt>' +
    '</c:numLit></c:val></c:ser></c:barChart></c:plotArea></c:chart></c:chartSpace>';
  const slideIds = ['rFirst', 'rSecond', 'rMissing', 'rDamage', 'rLast'];
  const presentation = '<p:presentation' + baseNs + '><p:sldIdLst>' +
    slideIds.map((id, index) => '<p:sldId id="' + (256 + index) + '" r:id="' + id + '"/>').join('') +
    '</p:sldIdLst><p:sldSz cx="' + size + '" cy="' + size + '"/></p:presentation>';
  const pathTypes = [
    ['poly/pres.xml', 'presentationml.presentation.main'],
    ...['one', 'two', 'before', 'invalid'].map(name => ['poly/slides/' + name + '.xml', 'presentationml.slide']),
    ['poly/layouts/l1.xml', 'presentationml.slideLayout'],
    ['poly/masters/m1.xml', 'presentationml.slideMaster'],
    ['poly/charts/chart1.xml', 'drawingml.chart'],
    ['poly/diagrams/data1.xml', 'drawingml.diagramData'],
    ['poly/notes/notes1.xml', 'presentationml.notesSlide'],
  ];
  const contentTypes = '<Types xmlns="' + office + 'package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="png" ContentType="image/png"/><Default Extension="svg" ContentType="image/svg+xml"/>' +
    pathTypes.map(([path, type]) => '<Override PartName="/' + path + '" ContentType="application/vnd.openxmlformats-officedocument.' +
      type + '+xml"/>').join('') + '</Types>';
  return [
    ['[Content_Types].xml', contentTypes],
    ['_rels/.rels', rels(['rPackage', 'officeDocument', 'poly/pres.xml'])],
    ['poly/pres.xml', presentation],
    ['poly/_rels/pres.xml.rels', rels(
      ['rLast', 'slide', 'slides/before.xml'], ['rSecond', 'slide', '/poly/slides/two.xml'],
      ['rFirst', 'slide', 'slides/one.xml'], ['rMissing', 'slide', 'slides/missing.xml'],
      ['rDamage', 'slide', 'slides/invalid.xml'])],
    ['poly/slides/before.xml', last],
    ['poly/slides/_rels/before.xml.rels', rels(['rMixed', 'image', '../media/mixed.png'], ['rMasked', 'image', '../media/masked.png'],
      ['rLayout', 'slideLayout', '../layouts/l1.xml'])],
    ['poly/slides/two.xml', second, { descriptor: true }],
    ['poly/slides/_rels/two.xml.rels', rels(['rWhole', 'image', '/poly/media/whole.png'])],
    ['poly/slides/one.xml', first],
    ['poly/slides/_rels/one.xml.rels', rels(
      ['rLayout', 'slideLayout', '../layouts/l1.xml'], ['rEquation', 'image', '../media/eq%20pic.png'],
      ['rVector', 'image', '../media/unsafe.svg'], ['rExternal', 'image', 'https://invalid.test/logo.png', true],
      ['rChart', 'chart', '../charts/chart1.xml'], ['rDiagram', 'diagramData', '../diagrams/data1.xml'],
      ['rNotes', 'notesSlide', '../notes/notes1.xml'])],
    ['poly/slides/invalid.xml', '<!DOCTYPE p:sld SYSTEM "file:///missing.dtd">' + page('sld', '')],
    ['poly/layouts/l1.xml', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(layout, 'utf16le')])],
    ['poly/layouts/_rels/l1.xml.rels', rels(['rMaster', 'slideMaster', '../masters/m1.xml'])],
    ['poly/masters/m1.xml', master],
    ['poly/masters/_rels/m1.xml.rels', '<unreadable'],
    ['poly/charts/chart1.xml', plot],
    ['poly/diagrams/data1.xml', '<dgm:dataModel xmlns:dgm="' + diagram + '" xmlns:a="' + drawing +
      '"><dgm:ptLst><dgm:pt modelId="1"><dgm:t><a:bodyPr/><a:lstStyle/>' + paragraph(run('先做对照再记录')) +
      '</dgm:t></dgm:pt></dgm:ptLst></dgm:dataModel>'],
    ['poly/notes/notes1.xml', page('notes', shape(2, 'Notes', paragraph(run('教师备注应留在原件'))))],
    ['poly/media/whole.png', png([[0, 0, 200]]), { stored: true }],
    ['poly/media/eq pic.png', png([[20, 20, 20]]), { stored: true }],
    ['poly/media/mixed.png', png([[255, 0, 0], [0, 255, 0]]), { stored: true }],
    ['poly/media/masked.png', png([[0, 0, 0], [255, 255, 255]]), { stored: true }],
    ['poly/media/unsafe.svg', '<svg xmlns="http://www.w3.org/2000/svg"><script>throw 1</script></svg>'],
  ];
}

test('PPTX packaging handles stored and descriptor-based deflated parts, integrity, and bounds', async () => {
  const archive = await openPptxPackage(new Blob([zip([
    ['ppt/slides/页.xml', '原始文字', { descriptor: true }],
    ['ppt/media/original.png', [1, 2, 3], { stored: true }],
    ['ppt/slides/bad.xml', '无损文本', { badCrc: true }],
    ['ppt/slides/bom.xml', '带字节序标记的本地文件名', { localName: '\ufeffppt/slides/bom.xml' }],
    ['ppt/slides/wrong.xml', '错名', { localName: 'other.xml' }],
  ], 'an archive comment')]));
  assert.equal(new TextDecoder().decode(await archive.read('ppt/slides/%E9%A1%B5.xml', 50)), '原始文字');
  assert.deepEqual([...await archive.read('ppt/media/ORIGINAL.PNG', 3)], [1, 2, 3]);
  await assert.rejects(() => archive.read('ppt/media/original.png', 2), /超过支持大小/);
  await assert.rejects(() => archive.read('ppt/slides/bad.xml', 50), /校验失败/);
  assert.equal(new TextDecoder().decode(await archive.read('ppt/slides/bom.xml', 100)), '带字节序标记的本地文件名');
  await assert.rejects(() => archive.read('ppt/slides/wrong.xml', 50), /部件名与文件目录不符/);
  assert.equal(resolvePackagePart('ppt/slides/slide.xml', '../media/eq%20pic.png'), 'ppt/media/eq%20pic.png');
  assert.equal(resolvePackagePart('ppt/pres.xml', '../../etc/test'), null);
  assert.equal(resolvePackagePart('ppt/pres.xml', '%2e%2e/%2e%2e/test'), null);
  assert.equal(resolvePackagePart('ppt/pres.xml', 'https://example.org/test'), null);
  assert.equal(resolvePackagePart('ppt/pres.xml', 'sub%2Fdir/file'), null);
  await assert.rejects(() => readPptx(new File(['wrong format'], 'bad.pptx')), /无法识别/);
  await assert.rejects(() => readPptx(new File([Buffer.from('d0cf11e0a1b11ae1', 'hex')], 'legacy.ppt')), /旧版或受保护/);
});

function chromiumPath() {
  if (process.env.POLYPHONY_TEST_CHROMIUM) return process.env.POLYPHONY_TEST_CHROMIUM;
  const windows = process.env.ProgramFiles ?? 'C:\\Program Files';
  const x86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
  return [
    join(windows, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(x86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
  ].find(path => existsSync(path));
}

async function runInChromium(chromium, expression) {
  const temp = await realpath(tmpdir());
  const profile = await mkdtemp(join(temp, 'polyphony-pptx-chrome-'));
  const browser = spawn(chromium, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-background-networking', '--disable-extensions',
    '--no-first-run', '--no-default-browser-check', '--remote-debugging-pipe', '--user-data-dir=' + profile, 'about:blank',
  ], { windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  const input = browser.stdio[3];
  const output = browser.stdio[4].setEncoding('utf8');
  const commands = new Map();
  const closed = new Promise(resolve => browser.once('close', resolve));
  const disconnect = error => {
    for (const command of commands.values()) command.reject(error);
  };
  browser.on('error', disconnect);
  input.on('error', disconnect);
  output.on('error', disconnect);
  output.on('close', () => disconnect(new Error('Chromium debugging pipe closed.')));
  let sequence = 0;
  let buffered = '';
  output.on('data', data => {
    buffered += data;
    let boundary;
    while ((boundary = buffered.indexOf('\0')) !== -1) {
      const message = JSON.parse(buffered.slice(0, boundary));
      buffered = buffered.slice(boundary + 1);
      const command = commands.get(message.id);
      if (message.error) command?.reject(new Error(message.error.message));
      else command?.resolve(message.result);
    }
  });
  async function cdp(method, params = {}, sessionId) {
    const id = ++sequence;
    try {
      return await Promise.race([
        new Promise((resolve, reject) => {
          commands.set(id, { resolve, reject });
          input.write(JSON.stringify({ id, method, params, sessionId }) + '\0');
        }),
        wait(12_000, undefined, { ref: false }).then(() => { throw new Error('Chromium timed out during ' + method); }),
      ]);
    } finally {
      commands.delete(id);
    }
  }
  try {
    const { targetId } = await cdp('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
    const { result, exceptionDetails } = await cdp('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true,
    }, sessionId);
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
  } finally {
    if (input.writable) await Promise.race([cdp('Browser.close').catch(() => {}), wait(500, undefined, { ref: false })]);
    browser.kill();
    await closed;
    if (dirname(profile) === temp) await rm(profile, { recursive: true, force: true, maxRetries: 4 });
  }
}

function moduleDataUrl(source) {
  return 'data:text/javascript;charset=utf-8;base64,' + Buffer.from(source).toString('base64');
}

const chromium = chromiumPath();
test('browser imports real PowerPoint ZIP bytes offline and preserves page lineage and visible content', {
  skip: !chromium && 'Install Chromium or set POLYPHONY_TEST_CHROMIUM to run the offline PPTX import regression.',
}, async () => {
  const [reader, archive, mathml] = await Promise.all([
    readFile(new URL('../dist/core/pptx-reader.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../dist/core/pptx-package.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../dist/core/mathml.mjs', import.meta.url), 'utf8'),
  ]);
  const module = moduleDataUrl(reader
    .replace('./pptx-package.mjs', moduleDataUrl(archive))
    .replace('./mathml.mjs', moduleDataUrl(mathml)));
  const bytes = zip(fixtureEntries()).toString('base64');
  const result = await runInChromium(chromium,
    '(async () => {' +
    'const { readPptx } = await import(' + JSON.stringify(module) + ');' +
    'const bytes = Uint8Array.from(atob(' + JSON.stringify(bytes) + '), character => character.charCodeAt(0));' +
    'const result = await readPptx(new File([bytes], "课堂课件.pptx"));' +
    'const crop = new Image(); crop.src = result.pages[4].images[0].visibleSrc; await crop.decode();' +
    'const canvas = document.createElement("canvas"); canvas.width = crop.naturalWidth; canvas.height = crop.naturalHeight;' +
    'const context = canvas.getContext("2d"); context.drawImage(crop, 0, 0);' +
    'return { ...result, crop: [...context.getImageData(0, 0, 1, 1).data], cropWidth: crop.naturalWidth };' +
    '})()');
  assert.equal(result.name, '课堂课件.pptx');
  assert.deepEqual(result.pages.map(({ number, sourcePath }) => [number, sourcePath]), [
    [1, 'poly/slides/one.xml'], [2, 'poly/slides/two.xml'], [3, 'poly/slides/missing.xml'],
    [4, 'poly/slides/invalid.xml'], [5, 'poly/slides/before.xml'],
  ]);
  const [first, second, absent, damaged, last] = result.pages;
  assert.equal(first.title, '从波峰到谷底');
  assert.match(first.text, /角度 A & B\n第八节/u);
  assert.match(first.text, /从波峰到谷底/u);
  assert.match(first.text, /关系 \(λ\)\/\(n\^\(2\)\)/u);
  assert.match(first.text, /单元格甲 ｜ 单元格乙/u);
  assert.match(first.text, /温度变化\n水温\n甲 = 28 ｜ 乙 = 32\.5/u);
  assert.match(first.text, /SmartArt\n先做对照再记录/u);
  assert.match(first.text, /公开版实验资料/u);
  assert.match(first.text, /实验室原始标注/u);
  assert.doesNotMatch(first.text, /Click to edit|教师私下说明|教师备注/u);
  assert.equal(first.speakerNotes, '教师备注应留在原件');
  assert.ok(Array.isArray(first.formulas) && first.formulas.length === 1);
  assert.match(first.formulas[0], /<math[^>]*>.*<mfrac>.*<msup>.*<\/math>/u);
  assert.deepEqual(first.images.map(({ sourcePath }) => sourcePath), ['poly/media/eq pic.png']);
  assert.equal(first.preview, undefined);
  assert.ok(first.warnings.some(message => message.includes('外链图片')));
  assert.ok(first.warnings.some(message => message.includes('图表')));
  assert.equal(second.hidden, true);
  assert.equal(second.preview, second.images[0].src);
  assert.match(second.preview, /^data:image\/png;base64,/u);
  assert.equal(absent.text, '');
  assert.match(absent.warnings[0], /缺少对应/u);
  assert.equal(damaged.text, '');
  assert.match(damaged.warnings[0], /无法读取/u);
  assert.equal(last.title, '裁切的课件原图');
  assert.match(last.text, /裁切的课件原图/u);
  assert.match(last.text, /公开版实验资料/u);
  assert.doesNotMatch(last.text, /实验室原始标注/u);
  assert.ok([first, last].every(item => item.warnings.some(message => message.includes('引用关系无法读取'))));
  assert.equal(last.preview, undefined);
  assert.equal(last.images[0].cropped, true);
  assert.match(last.images[0].visibleSrc, /^data:image\/png;base64,/u);
  assert.equal(last.images[1].cropped, true);
  assert.equal(last.images[1].visibleSrc, undefined);
  assert.deepEqual(result.crop, [0, 255, 0, 255]);
  assert.equal(result.cropWidth, 1);
});
