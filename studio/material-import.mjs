import { execFile, spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, delimiter, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { isLegacyPpt, readLegacySlides } from './dist/core/legacy-ppt.mjs';

export const MAX_MATERIAL_BYTES = 32 * 1024 * 1024;
export const MAX_MATERIAL_PAGES = 100;
const MAX_PAGE_TEXT = 12_000;
const MAX_PREVIEW_BYTES = 12 * 1024 * 1024;
const MAX_RENDERED_PDF_BYTES = 64 * 1024 * 1024;
const TEMP_PREFIX = 'polyphony-material-';
const pdfScript = fileURLToPath(new URL('./tools/material-import-pdf.py', import.meta.url));
const officeScript = fileURLToPath(new URL('./tools/material-import-libreoffice.py', import.meta.url));
const powerpointScript = fileURLToPath(new URL('./tools/material-import-powerpoint.ps1', import.meta.url));
const execute = promisify(execFile);
const windows = process.platform === 'win32';
let activeConversions = 0;
let renderingProbe;

function failure(status, message) {
  return Object.assign(new Error(message), { status });
}

function subprocessEnvironment(directory) {
  const env = { TEMP: directory, TMP: directory, TMPDIR: directory, HOME: directory };
  for (const key of ['PATH', 'SystemRoot', 'SystemDrive', 'WINDIR']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return env;
}

async function withMaterialDirectory(operation) {
  if (activeConversions >= 2) {
    throw failure(503, '有其他课件正在读取，请稍后重试。');
  }
  activeConversions += 1;
  const tempRoot = resolve(tmpdir());
  let directory;
  try {
    directory = await mkdtemp(join(tempRoot, TEMP_PREFIX));
    return await operation(directory);
  } finally {
    try {
      if (directory && dirname(resolve(directory)) === tempRoot && basename(directory).startsWith(TEMP_PREFIX)) {
        await rm(directory, { recursive: true, force: true, maxRetries: 2 });
      }
    } finally {
      activeConversions -= 1;
    }
  }
}

function pythonCandidates(configured) {
  return configured ? [configured] : windows ? ['python'] : ['python3', 'python'];
}

function pageLimitError() {
  return failure(413, `一次最多导入 ${MAX_MATERIAL_PAGES} 页。请拆分文件后再导入。`);
}

async function readPdf(inputPath, directory, programs = pythonCandidates(process.env.POLYPHONY_PDF_PYTHON)) {
  const unreadable = () => failure(422, '无法读取这份 PDF。请确认文件完整，或重新导出后再导入。');
  const args = ['-I', pdfScript, inputPath, String(MAX_MATERIAL_PAGES), String(MAX_PAGE_TEXT), String(MAX_PREVIEW_BYTES)];
  for (const program of programs) {
    let output;
    try {
      const { stdout } = await execute(program, args, {
        cwd: directory,
        env: subprocessEnvironment(directory),
        windowsHide: true,
        timeout: 25_000,
        maxBuffer: Math.ceil(MAX_PREVIEW_BYTES * 4 / 3) + 8 * 1024 * 1024,
      });
      output = JSON.parse(stdout);
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      if (error.killed) throw failure(504, '读取 PDF 超时。请拆分文件或重新导出后再导入。');
      throw unreadable();
    }
    if (output.error === 'unavailable') continue;
    if (output.error === 'page-limit') throw pageLimitError();
    if (output.error === 'password') throw failure(422, 'PDF 已加密。请另存为无需密码的文件后再导入。');
    if (output.error || !Array.isArray(output.pages) || !output.pages.length) throw unreadable();
    return output;
  }
  throw failure(503, '当前主机缺少 PDF 读取组件。请安装 Python 和 PyMuPDF，或导入 PPTX。');
}

async function installedSoffice(configured) {
  const commandNames = configured ? [configured] : windows ? ['soffice.com', 'soffice.exe'] : ['soffice'];
  const searchPaths = (process.env.PATH ?? '').split(delimiter).filter(isAbsolute);
  const paths = commandNames.flatMap(command => isAbsolute(command)
    ? [command] : searchPaths.map(directory => join(directory, command)));
  if (!configured && windows) {
    for (const base of new Set([process.env.ProgramFiles, process.env['ProgramFiles(x86)']])) {
      if (base) paths.push(join(base, 'LibreOffice', 'program', 'soffice.com'));
    }
  }
  if (!configured && process.platform === 'darwin') {
    paths.push('/Applications/LibreOffice.app/Contents/MacOS/soffice');
  }
  for (const path of paths) {
    try {
      await access(path, constants.X_OK);
      if ((await stat(path)).isFile()) return path;
    } catch {
      // Continue through the host's configured executable locations.
    }
  }
  return null;
}

async function checkPython(candidates, statement) {
  for (const python of candidates) {
    try {
      await execute(python, ['-I', '-c', statement], {
        env: subprocessEnvironment(tmpdir()), timeout: 10_000, maxBuffer: 4_096, windowsHide: true,
      });
      return python;
    } catch {
      // An installation may have Python without the corresponding system module.
    }
  }
  return null;
}

function powerpointWorkerArgs(...args) {
  return ['-NoProfile', '-NonInteractive', '-File', powerpointScript, ...args];
}

function powerpointWorkerEnvironment() {
  const allowed = new Set(['PATH', 'SYSTEMROOT', 'SYSTEMDRIVE', 'WINDIR', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'COMMONPROGRAMFILES', 'COMMONPROGRAMFILES(X86)', 'TEMP', 'TMP', 'HOMEDRIVE', 'HOMEPATH', 'USERNAME', 'USERDOMAIN', 'COMPUTERNAME', 'PSMODULEPATH']);
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.has(key.toUpperCase())));
}

async function checkPowerpointWorker() {
  const shell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  try {
    await execute(shell, powerpointWorkerArgs('-Probe'), {
      env: powerpointWorkerEnvironment(), timeout: 10_000, maxBuffer: 4_096, windowsHide: true,
    });
  } catch (error) {
    if (['ENOENT', 'EACCES', 'EPERM'].includes(error.code) ||
        /FullyQualifiedErrorId\s*:\s*UnauthorizedAccess\b|\bPSSecurityException\b/.test(error.stderr ?? '')) return null;
    // Preserve conversion errors on the import route without disabling classroom status.
  }
  return shell;
}

async function detectRenderingTools(soffice, unoPython, pdfPython) {
  const office = await installedSoffice(soffice);
  if (!office) {
    if(windows && !soffice) {
      for (const base of [process.env.ProgramFiles,process.env['ProgramFiles(x86)']].filter(Boolean)) {
        const executable = join(base, 'Microsoft Office', 'root', 'Office16', 'POWERPNT.EXE');
        try { await access(executable); } catch { continue; }
        const pdf=await checkPython(pythonCandidates(pdfPython),'try:\n import pymupdf\nexcept ImportError:\n import fitz');
        const powerpoint = pdf && await checkPowerpointWorker();
        return powerpoint ? { powerpoint, pdf } : null;
      }
    }
    return null;
  }
  const unoCandidates = pythonCandidates(unoPython);
  if (!unoPython && windows) unoCandidates.unshift(join(dirname(office), 'python.exe'));
  const [uno, pdf] = await Promise.all([
    checkPython(unoCandidates, 'import uno'),
    checkPython(pythonCandidates(pdfPython), 'try:\n import pymupdf\nexcept ImportError:\n import fitz'),
  ]);
  return uno && pdf ? { office, uno, pdf } : null;
}

function renderingTools() {
  const configuration = [
    process.env.POLYPHONY_SOFFICE, process.env.POLYPHONY_LIBREOFFICE_PYTHON, process.env.POLYPHONY_PDF_PYTHON,
  ];
  const key = JSON.stringify(configuration);
  if (renderingProbe?.key !== key || renderingProbe?.expiresAt <= Date.now()) {
    renderingProbe = { key, expiresAt: Date.now() + 30_000, result: detectRenderingTools(...configuration) };
  }
  return renderingProbe.result;
}

export async function materialRenderingAvailable() {
  return Boolean(await renderingTools());
}

function stopRenderProcess(child) {
  if (!child.pid) return;
  if (windows) {
    const taskkill = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe');
    const killer = spawn(taskkill, ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    killer.on('error', () => child.kill());
    killer.on('exit', code => { if (code) child.kill(); });
    return;
  }
  try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Process group has already exited. */ }
}

function runOfficeWorker(tools, directory, args) {
  return new Promise((resolve, reject) => {
    const program = tools.powerpoint ?? tools.uno;
    const workerArgs = tools.powerpoint ? powerpointWorkerArgs(...args) : ['-I', officeScript, tools.office, ...args];
    const child = spawn(program, workerArgs, {
      cwd: directory,
      detached: !windows,
      env: tools.powerpoint ? powerpointWorkerEnvironment() : subprocessEnvironment(directory),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let diagnostic='';
    child.stderr.on('data',chunk=>{if(diagnostic.length<4096)diagnostic+=chunk;});
    let processError;
    const abort = error => {
      if (processError) return;
      processError = error;
      stopRenderProcess(child);
    };
    const timer = setTimeout(() => abort(failure(504, '生成原页预览超时。')), tools.powerpoint?45_000:22_000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      if (stdout.length + chunk.length > 4_096) abort(failure(422, '无法生成原页预览。'));
      else stdout += chunk;
    });
    child.on('error', error => { processError ??= error; });
    child.on('close', code => {
      if(process.env.POLYPHONY_DEBUG_IMPORT==='1'&&diagnostic)console.error(diagnostic);
      clearTimeout(timer);
      if (!windows) stopRenderProcess(child);
      if (processError) return reject(processError);
      if (code) return reject(failure(422, '无法生成原页预览。'));
      try { resolve(JSON.parse(stdout.replace(/^\uFEFF/,''))); } catch { reject(failure(422, '无法生成原页预览。')); }
    });
  });
}

async function renderPresentation(bytes, extension, legacy) {
  const tools = await renderingTools();
  if (!tools) throw failure(503, '当前主机未配置 PPT 原页渲染。');
  return withMaterialDirectory(async directory => {
    const input = join(directory, `source${extension}`);
    const pdf = join(directory, 'slides.pdf');
    await writeFile(input, bytes, { mode: 0o600 });
    const hidden = legacy ? legacy.pages.filter(page => page.hidden).map(page => page.number) : null;
    const conversion = await runOfficeWorker(tools, directory, [
      input, pdf, String(MAX_MATERIAL_PAGES), String(legacy?.pages.length ?? 0), String(MAX_RENDERED_PDF_BYTES),
      JSON.stringify(hidden),
    ]);
    if (conversion.error === 'page-limit') throw pageLimitError();
    if (conversion.error === 'powerpoint-busy') throw failure(409,'PowerPoint 正在使用中。请关闭后重试，或导入同一课件的 PDF 以保留原页视觉。');
    if (conversion.error || !Array.isArray(conversion.hidden)) {
      throw failure(422, '无法生成与原课件逐页对应的预览。');
    }
    if ((await stat(pdf)).size > MAX_RENDERED_PDF_BYTES) throw failure(413, '原页预览过大。请拆分课件后再导入。');
    const rendered = await readPdf(pdf, directory, [tools.pdf]);
    if (rendered.pages.length !== conversion.pageCount || !rendered.pages.some(page => page.preview)) {
      throw failure(422, '无法生成与原课件逐页对应的预览。');
    }
    const pages = rendered.pages.map((page, index) => {
      const original = legacy?.pages[index];
      return {
        ...page, sourcePageNumber: page.number,
        hidden: conversion.hidden.includes(page.number),
        title: original?.text ? original.title : page.title,
        text: page.text || original?.text || '',
      };
    });
    return { ...rendered, pages, missingText: pages.some(page => !page.text) };
  });
}

export async function importMaterialFile({ name, bytes }) {
  const fileName = typeof name === 'string' ? name.split(/[\\/]/).at(-1).trim() : '';
  const extension = extname(fileName).toLowerCase();
  if (!['.pdf', '.ppt', '.pptx'].includes(extension)) throw failure(415, '请选择 PDF、PPT 或 PPTX 文件。');
  if (!(bytes instanceof Uint8Array) || !bytes.byteLength) throw failure(400, '请选择包含内容的课件文件。');
  if (bytes.byteLength > MAX_MATERIAL_BYTES) throw failure(413, '一次最多导入 32 MB。请拆分文件后再导入。');
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let result;
  const warnings = [];
  if (extension === '.pdf') {
    if (!data.subarray(0, 1024).includes('%PDF-')) throw failure(415, '文件内容和 .pdf 格式不符。请选择原始课件。');
    result = await withMaterialDirectory(async directory => {
      const input = join(directory, 'source.pdf');
      await writeFile(input, data, { mode: 0o600 });
      return readPdf(input, directory);
    });
  } else if (extension === '.pptx') {
    if (data.length < 4 || data.readUInt32LE(0) !== 0x04034b50) {
      throw failure(415, '文件内容和 .pptx 格式不符。请选择原始课件。');
    }
    result = await renderPresentation(data, extension);
  } else {
    if (!isLegacyPpt(data)) throw failure(415, '文件内容和 .ppt 格式不符。请选择原始课件。');
    let legacy;
    let legacyError;
    try {
      legacy = readLegacySlides(data, { pageLimit: MAX_MATERIAL_PAGES, textLimit: MAX_PAGE_TEXT });
    } catch (error) {
      if (error.status !== 422) throw error;
      legacyError = error;
    }
    try {
      result = await renderPresentation(data, extension, legacy);
    } catch (error) {
      if (!legacy) throw legacyError ?? error;
      result = legacy;
      warnings.push('旧版 PPT 已按原页序提取文字与标题。需要原版图表或版式时，可导入同一课件的 PDF。');
      if (result.pages.some(page => !page.text)) warnings.push('这份旧版 PPT 有些页面没有可提取的文字。');
    }
  }
  if (result.missingPreviews) warnings.push('部分页面无法生成预览，仍可查看已读取的文字。');
  if (result.missingText) warnings.push('部分页面没有可提取的文字，可使用原页预览。');
  if (result.truncated) warnings.push('文字过长的页面只保留部分文字。');
  return { name: fileName.slice(0, 200), pages: result.pages, warnings };
}
