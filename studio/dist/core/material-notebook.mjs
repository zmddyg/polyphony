const defaultDatabase = 'polyphony-material-notebook';
const publicKinds = new Set(['handout', 'science', 'classroom', 'experiment']);
const noteKinds = new Set([...publicKinds, 'annotation']);
const lessonStartTypes = new Set(['room', 'loadLesson', 'switchLesson']);

const sha256Constants = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotate = (value, bits) => (value >>> bits) | (value << (32 - bits));

// Web Crypto is unavailable when the classroom server is opened over HTTP on a LAN.
function sha256WithoutWebCrypto(bytes) {
  const hash = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const tailStart = bytes.length - (bytes.length % 64);
  const remaining = bytes.length - tailStart;
  const tail = new Uint8Array(remaining < 56 ? 64 : 128);
  tail.set(bytes.subarray(tailStart));
  tail[remaining] = 0x80;
  const end = new DataView(tail.buffer);
  end.setUint32(tail.length - 8, Math.floor((bytes.length * 8) / 2 ** 32));
  end.setUint32(tail.length - 4, bytes.length * 8);
  const body = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const words = new Uint32Array(64);

  for (let offset = 0; offset < tailStart + tail.length; offset += 64) {
    const block = offset < tailStart ? body : end;
    const start = offset < tailStart ? offset : offset - tailStart;
    for (let i = 0; i < 16; i++) words[i] = block.getUint32(start + i * 4);
    for (let i = 16; i < words.length; i++) {
      const x = words[i - 15];
      const y = words[i - 2];
      const first = rotate(x, 7) ^ rotate(x, 18) ^ (x >>> 3);
      const second = rotate(y, 17) ^ rotate(y, 19) ^ (y >>> 10);
      words[i] = words[i - 16] + first + words[i - 7] + second;
    }
    let a = hash[0];
    let b = hash[1];
    let c = hash[2];
    let d = hash[3];
    let e = hash[4];
    let f = hash[5];
    let g = hash[6];
    let h = hash[7];
    for (let i = 0; i < words.length; i++) {
      const upper = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
      const choose = (e & f) ^ (~e & g);
      const first = h + upper + choose + sha256Constants[i] + words[i];
      const lower = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      h = g;
      g = f;
      f = e;
      e = (d + first) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (first + lower + majority) >>> 0;
    }
    hash[0] += a;
    hash[1] += b;
    hash[2] += c;
    hash[3] += d;
    hash[4] += e;
    hash[5] += f;
    hash[6] += g;
    hash[7] += h;
  }
  return Array.from(hash, word => word.toString(16).padStart(8, '0')).join('');
}

export async function makeMaterialVersionId({ bytes }, { subtle = globalThis.crypto?.subtle } = {}) {
  let data;
  if (typeof bytes === 'string') data = new TextEncoder().encode(bytes);
  else if (ArrayBuffer.isView(bytes)) data = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  else if (bytes instanceof ArrayBuffer) data = new Uint8Array(bytes);
  else if (typeof bytes?.arrayBuffer === 'function') data = new Uint8Array(await bytes.arrayBuffer());
  else throw new Error('无法读取原课件内容。');

  if (!subtle) return 'sha256-' + sha256WithoutWebCrypto(data);
  const digest = new Uint8Array(await subtle.digest('SHA-256', data));
  return 'sha256-' + Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}

function storageError(error) {
  if (error?.name === 'QuotaExceededError') return new Error('浏览器存储空间不足，保存失败。', { cause: error });
  if (['SecurityError', 'InvalidStateError', 'NotSupportedError', 'UnknownError'].includes(error?.name)) {
    return new Error('当前浏览器暂时无法保存课件记录。', { cause: error });
  }
  return error ?? new Error('课件记录读写失败，请重试。');
}

function readRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(storageError(request.error));
  });
}

function checkVersionId(versionId) {
  if (!/^sha256-[0-9a-f]{64}$/u.test(versionId ?? '')) throw new Error('原课件版本无效。');
}

function checkPageNumber(pageNumber) {
  if (!Number.isSafeInteger(pageNumber) || pageNumber < 1) throw new Error('原课件页码无效。');
}

function checkNoteId(id) {
  if (typeof id !== 'string' || !id.trim() || id.length > 240) throw new Error('备课记录编号无效。');
}

const compareNotes = (a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id);

function classroomEpisode(state) {
  const events = state?.events;
  const lessonId = state?.lessonId ?? state?.lesson?.id;
  if (!lessonId || typeof state?.code !== 'string' || !Array.isArray(events)) return null;
  const roomStart = events.find(event => event.type === 'room');
  const lessonStartIndex = events.findLastIndex(event => lessonStartTypes.has(event.type));
  const lessonStart = events[lessonStartIndex];
  if (!roomStart || !lessonStart?.id || lessonStart.detail?.lessonId !== lessonId ||
    roomStart.at == null || lessonStart.at == null) return null;
  return {
    lessonStartIndex,
    reference: {
      room: state.code,
      roomStartedAt: roomStart.at,
      lessonId,
      lessonTitle: state.lesson?.title ?? lessonId,
      lessonStartEventId: lessonStart.id,
      lessonStartedAt: lessonStart.at,
    },
  };
}

function replaySource(state, versionId, pageNumber) {
  const lecture = state?.lecture;
  if (!lecture) {
    if (state?.phase !== 'closed') return null;
    const episode = classroomEpisode(state);
    return episode && { ...episode, snapshot: state };
  }
  if (lecture.sourceVersion !== versionId || !Array.isArray(state.events)) return null;
  const snapshot = lecture.mode === 'activity' && lecture.pageNumber === pageNumber
    ? state
    : state.lectureArchive?.find(item => item.versionId === versionId && item.pageNumber === pageNumber);
  if (!snapshot || (lecture.mode !== 'ended' && !['reveal', 'branch', 'closed'].includes(snapshot.phase))) return null;
  const roomStart = state.events.find(event => event.type === 'room');
  const lessonStartIndex = state.events.findIndex(event => event.type === 'lectureInteract' &&
    event.detail?.pageNumber === pageNumber && event.detail?.lessonId === snapshot.lessonId);
  const lessonStart = state.events[lessonStartIndex];
  if (!roomStart || !lessonStart?.id || roomStart.at == null || lessonStart.at == null) return null;
  return {
    snapshot,
    lessonStartIndex,
    fromLecture: true,
    reference: {
      room: state.code,
      roomStartedAt: roomStart.at,
      lessonId: snapshot.lessonId,
      lessonTitle: snapshot.lesson?.title ?? snapshot.lessonId,
      lessonStartEventId: lessonStart.id,
      lessonStartedAt: lessonStart.at,
    },
  };
}

export function materialClassroomReference(state, versionId, pageNumber) {
  return replaySource(state, versionId, pageNumber)?.reference ?? null;
}

export function materialClassroomReasons(state, binding) {
  if (!binding) return [];
  const episode = replaySource(state, binding.versionId, binding.pageNumber);
  if (!episode || ['room', 'roomStartedAt', 'lessonId', 'lessonStartEventId', 'lessonStartedAt']
    .some(key => episode.reference[key] !== binding[key])) return [];
  const { fromLecture, reference, snapshot } = episode;
  const responseEvents = new Map();
  for (const event of state.events.slice(episode.lessonStartIndex + 1)) {
    if (event.type !== 'respond' || !event.id || !event.detail?.responseId) continue;
    if (fromLecture && (event.detail.lecturePageNumber !== binding.pageNumber ||
      event.detail.lectureVersionId !== binding.versionId)) continue;
    responseEvents.set(event.detail.responseId, event);
  }
  const options = new Map((snapshot.lesson?.options ?? []).map(item => [item.id, item.label]));
  return (snapshot.responses ?? []).flatMap(response => {
    const event = responseEvents.get(response.id);
    const reason = typeof response.reason === 'string' ? response.reason.trim() : '';
    if (!event || event.detail.round !== response.round || response.simulated !== false || !reason ||
      (fromLecture && (response.lecturePageNumber !== binding.pageNumber ||
        response.lectureVersionId !== binding.versionId))) return [];
    return [{
      reason,
      optionLabel: response.optionLabel ?? options.get(response.optionId) ?? response.optionId,
      source: {
        type: 'classroom-response',
        ...reference,
        eventId: event.id,
        eventAt: event.at,
        responseId: response.id,
        round: response.round,
        optionId: response.optionId,
      },
    }];
  }).reverse();
}

export function createMaterialNotebook({ indexedDB, databaseName = defaultDatabase, now = Date.now } = {}) {
  let connection;

  function openDatabase() {
    if (connection) return connection;
    connection = new Promise((resolve, reject) => {
      const provider = indexedDB === undefined ? globalThis.indexedDB : indexedDB;
      if (!provider) throw new Error('当前浏览器无法保存课件记录。');
      const request = provider.open(databaseName, 1);
      let blocked = false;
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore('versions', { keyPath: 'versionId' });
        db.createObjectStore('documents', { keyPath: 'versionId' });
        const notes = db.createObjectStore('notes', { keyPath: ['versionId', 'pageNumber', 'id'] });
        notes.createIndex('version', 'versionId');
        notes.createIndex('page', ['versionId', 'pageNumber']);
        db.createObjectStore('classrooms', { keyPath: ['versionId', 'pageNumber'] });
      };
      request.onblocked = () => {
        blocked = true;
        reject(new Error('请关闭其他共演窗口，再试一次。'));
      };
      request.onerror = () => reject(storageError(request.error));
      request.onsuccess = () => {
        const db = request.result;
        if (blocked) return db.close();
        db.onversionchange = () => {
          db.close();
          connection = null;
        };
        db.onclose = () => { connection = null; };
        resolve(db);
      };
    }).catch(error => {
      connection = null;
      throw storageError(error);
    });
    return connection;
  }

  async function run(storeNames, mode, operation) {
    const db = await openDatabase();
    const transaction = db.transaction(storeNames, mode);
    const completed = new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onabort = () => reject(storageError(transaction.error));
    });
    const stores = Object.fromEntries(storeNames.map(name => [name, transaction.objectStore(name)]));
    try {
      const [result] = await Promise.all([operation(stores), completed]);
      return result;
    } catch (error) {
      try { transaction.abort(); } catch { /* An aborted or committed transaction is already finished. */ }
      throw storageError(error);
    }
  }

  async function requirePage(versions, versionId, pageNumber) {
    const version = await readRequest(versions.get(versionId));
    if (!version?.pageNumbers.includes(pageNumber)) {
      throw new Error('此页未保存在该版本中。请先保存这个版本的原课件。');
    }
    return version;
  }

  function changeAdoption(versionId, pageNumber, id, withdraw) {
    checkVersionId(versionId);
    checkPageNumber(pageNumber);
    checkNoteId(id);
    return run(['notes'], 'readwrite', async ({ notes }) => {
      const existing = await readRequest(notes.get([versionId, pageNumber, id]));
      if (!existing || !publicKinds.has(existing.kind)) throw new Error('没有可采用的备课稿。');
      if (withdraw && (!existing.adoption || existing.adoption.withdrawnAt != null)) return existing;
      const time = now();
      const adoption = withdraw
        ? { ...existing.adoption, withdrawnAt: time }
        : { packet: existing.packet, source: existing.source, adoptedAt: time };
      const next = { ...existing, adoption };
      await readRequest(notes.put(next));
      return next;
    });
  }

  function listNotes(versionId) {
    checkVersionId(versionId);
    return run(['notes'], 'readonly', async ({ notes }) =>
      (await readRequest(notes.index('version').getAll(versionId))).sort(compareNotes));
  }

  return {
    async saveVersion(input) {
      const { versionId, pages, name = input.title, title = name, type = input.kind, file = null, warnings = [] } = input;
      checkVersionId(versionId);
      if (!Array.isArray(pages) || !pages.length || typeof name !== 'string' || !name.trim()) {
        throw new Error('请先导入有可定位页码的课件。');
      }
      const pageNumbers = pages.map(page => page.number);
      pageNumbers.forEach(checkPageNumber);
      if (new Set(pageNumbers).size !== pageNumbers.length) throw new Error('原课件页码重复。');
      return run(['versions', 'documents'], 'readwrite', async ({ versions, documents }) => {
        const openedAt = now();
        const existing = await readRequest(versions.get(versionId));
        if (existing) {
          const document = await readRequest(documents.get(versionId));
          if (!document) throw new Error('已保存的课件无法打开。');
          const version = { ...existing, openedAt };
          await readRequest(versions.put(version));
          return { ...document, ...version };
        }
        const version = {
          versionId, name, title, type, pageNumbers, pageCount: pages.length,
          lastPage: pageNumbers[0], createdAt: openedAt, openedAt,
        };
        const document = { ...input, versionId, pages, file, warnings };
        await readRequest(documents.add(document));
        await readRequest(versions.add(version));
        return { ...document, ...version };
      });
    },
    listVersions() {
      return run(['versions'], 'readonly', async ({ versions }) => (await readRequest(versions.getAll()))
        .sort((a, b) => b.openedAt - a.openedAt || b.createdAt - a.createdAt || a.versionId.localeCompare(b.versionId)));
    },
    async getVersion(versionId) {
      checkVersionId(versionId);
      return run(['versions', 'documents'], 'readonly', async ({ versions, documents }) => {
        const [version, document] = await Promise.all([
          readRequest(versions.get(versionId)), readRequest(documents.get(versionId)),
        ]);
        return version && document ? { ...document, ...version } : null;
      });
    },
    async setLastPage(versionId, pageNumber) {
      checkVersionId(versionId);
      checkPageNumber(pageNumber);
      return run(['versions'], 'readwrite', async ({ versions }) => {
        const version = await requirePage(versions, versionId, pageNumber);
        await readRequest(versions.put({ ...version, lastPage: pageNumber, openedAt: now() }));
      });
    },
    async getPageNotes(versionId, pageNumber) {
      checkVersionId(versionId);
      checkPageNumber(pageNumber);
      return run(['notes'], 'readonly', async ({ notes }) =>
        (await readRequest(notes.index('page').getAll([versionId, pageNumber]))).sort(compareNotes));
    },
    listNotes,
    async listAdopted(versionId) {
      const notes = await listNotes(versionId);
      return notes.flatMap(({ id, pageNumber, kind, adoption }) => {
        if (!publicKinds.has(kind) || !adoption || adoption.withdrawnAt != null) return [];
        const packet = kind === 'classroom' ? adoption.packet?.lesson ?? adoption.packet : adoption.packet;
        return [{ id, versionId, pageNumber, kind, packet, adoptedAt: adoption.adoptedAt }];
      }).sort((a, b) => a.pageNumber - b.pageNumber || a.adoptedAt - b.adoptedAt);
    },
    async savePageNote(versionId, pageNumber, { id, kind, packet, source }, { adopt = false } = {}) {
      checkVersionId(versionId);
      checkPageNumber(pageNumber);
      checkNoteId(id);
      if (!noteKinds.has(kind) || packet == null || (adopt && !publicKinds.has(kind))) {
        throw new Error('备课记录格式无效。');
      }
      return run(['versions', 'notes'], 'readwrite', async ({ versions, notes }) => {
        const [, existing] = await Promise.all([
          requirePage(versions, versionId, pageNumber), readRequest(notes.get([versionId, pageNumber, id])),
        ]);
        if (existing && existing.kind !== kind) throw new Error('备课记录编号已用于其他内容。');
        const updatedAt = now();
        const origin = source === undefined ? existing?.source ?? null : source;
        const adoption = adopt ? { packet, source: origin, adoptedAt: updatedAt } : existing?.adoption ?? null;
        const note = { id, versionId, pageNumber, kind, packet, source: origin, updatedAt, adoption };
        await readRequest(notes.put(note));
        return note;
      });
    },
    adoptPageNote(versionId, pageNumber, id) {
      return changeAdoption(versionId, pageNumber, id, false);
    },
    withdrawPageNote(versionId, pageNumber, id) {
      return changeAdoption(versionId, pageNumber, id, true);
    },
    async getPageClassroom(versionId, pageNumber) {
      checkVersionId(versionId);
      checkPageNumber(pageNumber);
      return run(['classrooms'], 'readonly', async ({ classrooms }) =>
        (await readRequest(classrooms.get([versionId, pageNumber]))) ?? null);
    },
    async bindPageClassroom(versionId, pageNumber, state) {
      checkVersionId(versionId);
      checkPageNumber(pageNumber);
      const reference = materialClassroomReference(state, versionId, pageNumber);
      if (!reference) throw new Error('请打开与这页对应且已结束的课堂。');
      return run(['versions', 'classrooms'], 'readwrite', async ({ versions, classrooms }) => {
        await requirePage(versions, versionId, pageNumber);
        const binding = { versionId, pageNumber, ...reference, boundAt: now() };
        await readRequest(classrooms.put(binding));
        return binding;
      });
    },
    async saveClassroomReason(versionId, pageNumber, state, responseId) {
      checkVersionId(versionId);
      checkPageNumber(pageNumber);
      return run(['classrooms', 'notes'], 'readwrite', async ({ classrooms, notes }) => {
        const binding = await readRequest(classrooms.get([versionId, pageNumber]));
        const evidence = materialClassroomReasons(state, binding).find(item => item.source.responseId === responseId);
        if (!evidence) throw new Error('这条理由不在此页已关联的课堂记录中。');
        const { reason, optionLabel, source } = evidence;
        const id = ['reason', source.room, source.roomStartedAt, source.lessonStartEventId, source.responseId].join(':');
        checkNoteId(id);
        await readRequest(notes.put({
          id, versionId, pageNumber, kind: 'classroom-reason',
          packet: { reason, optionLabel }, source, updatedAt: now(), adoption: null,
        }));
        return evidence;
      });
    },
    async updateDocumentPages(versionId, pages, warnings) {
      checkVersionId(versionId);
      if (!Array.isArray(pages) || !pages.length) throw new Error('原课件页数据无效。');
      const incoming = new Map();
      for (const page of pages) {
        checkPageNumber(page?.number);
        incoming.set(page.number, page);
      }
      return run(['versions', 'documents'], 'readwrite', async ({ versions, documents }) => {
        const [version, document] = await Promise.all([
          readRequest(versions.get(versionId)), readRequest(documents.get(versionId)),
        ]);
        if (!version || !document) throw new Error('已保存的课件无法打开。');
        const mergedPages = (document.pages ?? []).map(existing => {
          const updated = incoming.get(existing.number);
          if (!updated) return existing;
          return {
            ...existing,
            ...(updated.preview ? { preview: updated.preview } : {}),
            ...(updated.text && !existing.text ? { text: updated.text } : {}),
            ...(updated.speakerNotes && !existing.speakerNotes ? { speakerNotes: updated.speakerNotes } : {}),
            ...(updated.formulas?.length && !existing.formulas?.length ? { formulas: updated.formulas } : {}),
            ...(updated.images?.length && !existing.images?.length ? { images: updated.images } : {}),
          };
        });
        const nextDocument = {
          ...document,
          pages: mergedPages,
          ...(Array.isArray(warnings) ? { warnings } : {}),
        };
        const nextVersion = { ...version, openedAt: now() };
        await Promise.all([readRequest(documents.put(nextDocument)), readRequest(versions.put(nextVersion))]);
        return { ...nextDocument, ...nextVersion };
      });
    },
    async deleteVersion(versionId) {
      checkVersionId(versionId);
      return run(['versions', 'documents', 'notes', 'classrooms'], 'readwrite', async ({ versions, documents, notes, classrooms }) => {
        const [savedNotes, savedClassrooms] = await Promise.all([
          readRequest(notes.index('version').getAll(versionId)),
          readRequest(classrooms.getAll()),
        ]);
        await Promise.all([
          readRequest(versions.delete(versionId)),
          readRequest(documents.delete(versionId)),
          ...savedNotes.map(note => readRequest(notes.delete([note.versionId, note.pageNumber, note.id]))),
          ...savedClassrooms
            .filter(item => item?.versionId === versionId)
            .map(item => readRequest(classrooms.delete([item.versionId, item.pageNumber]))),
        ]);
        return { versionId, deletedNotes: savedNotes.length };
      });
    },
    async exportNotebook(versionId) {
      checkVersionId(versionId);
      return run(['versions', 'documents', 'notes', 'classrooms'], 'readonly', async ({ versions, documents, notes, classrooms }) => {
        const [version, document, savedNotes, savedClassrooms] = await Promise.all([
          readRequest(versions.get(versionId)),
          readRequest(documents.get(versionId)),
          readRequest(notes.index('version').getAll(versionId)),
          readRequest(classrooms.getAll()),
        ]);
        if (!version || !document) throw new Error('找不到要导出的备课本。');
        const { file: _omitFile, ...portableDocument } = document;
        return {
          format: 'polyphony.notebook',
          version: 1,
          exportedAt: now(),
          versionMeta: version,
          document: { ...portableDocument, file: null },
          notes: savedNotes.sort(compareNotes),
          classrooms: savedClassrooms.filter(item => item?.versionId === versionId),
        };
      });
    },
    async importNotebook(bundle) {
      if (!bundle || typeof bundle !== 'object' || bundle.format !== 'polyphony.notebook' || bundle.version !== 1) {
        throw new Error('备课包格式不受支持。请选择由共演导出的 .polyphony-notebook.json 文件。');
      }
      const meta = bundle.versionMeta;
      const doc = bundle.document;
      const versionId = meta?.versionId ?? doc?.versionId;
      checkVersionId(versionId);
      const pages = doc?.pages;
      if (!Array.isArray(pages) || !pages.length) throw new Error('备课包缺少有效的原课件页。');
      const pageNumbers = pages.map(page => page?.number);
      pageNumbers.forEach(checkPageNumber);
      if (new Set(pageNumbers).size !== pageNumbers.length) throw new Error('备课包中的原课件页码重复。');
      const pageSet = new Set(pageNumbers);
      const name = String(meta?.name ?? doc?.name ?? doc?.title ?? '导入的备课本').trim() || '导入的备课本';
      const title = String(meta?.title ?? doc?.title ?? name).trim() || name;
      const type = String(meta?.type ?? doc?.type ?? 'text');
      const rawNotes = Array.isArray(bundle.notes) ? bundle.notes : [];
      const validNotes = [];
      for (const note of rawNotes) {
        if (!note || typeof note !== 'object') continue;
        if (!pageSet.has(note.pageNumber)) continue;
        checkNoteId(note.id);
        if (!noteKinds.has(note.kind) && note.kind !== 'classroom-reason') continue;
        if (note.packet == null) continue;
        validNotes.push({
          ...note,
          versionId,
          updatedAt: Number.isFinite(note.updatedAt) ? note.updatedAt : now(),
        });
      }
      const rawClassrooms = Array.isArray(bundle.classrooms) ? bundle.classrooms : [];
      const validClassrooms = rawClassrooms.filter(item => item && typeof item === 'object' && pageSet.has(item.pageNumber))
        .map(item => ({ ...item, versionId }));
      return run(['versions', 'documents', 'notes', 'classrooms'], 'readwrite', async ({ versions, documents, notes, classrooms }) => {
        const openedAt = now();
        const [existingVersion, existingDocument] = await Promise.all([
          readRequest(versions.get(versionId)), readRequest(documents.get(versionId)),
        ]);
        const nextVersion = {
          versionId,
          name,
          title,
          type,
          pageNumbers,
          pageCount: pages.length,
          lastPage: pageSet.has(meta?.lastPage) ? meta.lastPage : pageNumbers[0],
          createdAt: existingVersion?.createdAt ?? (Number.isFinite(meta?.createdAt) ? meta.createdAt : openedAt),
          openedAt,
        };
        const nextDocument = {
          ...doc,
          versionId,
          name,
          title,
          type,
          pages,
          file: existingDocument?.file ?? null,
          warnings: Array.isArray(doc?.warnings) ? doc.warnings : [],
        };
        await Promise.all([
          readRequest(versions.put(nextVersion)),
          readRequest(documents.put(nextDocument)),
          ...validNotes.map(note => readRequest(notes.put(note))),
          ...validClassrooms.map(item => readRequest(classrooms.put(item))),
        ]);
        return {
          versionId,
          name,
          pageCount: pages.length,
          noteCount: validNotes.length,
          classroomCount: validClassrooms.length,
        };
      });
    },
  };
}
