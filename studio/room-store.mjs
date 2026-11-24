import { closeSync, existsSync, openSync, readFileSync, renameSync, writevSync } from 'node:fs';

const openObject = Buffer.from('{');
const closeObject = Buffer.from('}');
const comma = Buffer.from(',');

// Keep the existing single JSON snapshot atomic, including when the filesystem writes only part of a batch.
function writeSnapshot(path, chunks) {
  const temporary = path + '.tmp';
  const fd = openSync(temporary, 'w', 0o600);
  try {
    let index = 0;
    while (index < chunks.length) {
      let written = writevSync(fd, chunks.slice(index, index + 128));
      if (!written) throw new Error('Could not finish writing the classroom snapshot.');
      while (index < chunks.length && written >= chunks[index].length) {
        written -= chunks[index++].length;
      }
      if (written) chunks[index] = chunks[index].subarray(written);
    }
  } finally {
    closeSync(fd);
  }
  renameSync(temporary, path);
}

export function openRoomStore(path) {
  const stored = new Map();
  const recent = new Map();
  const keyFor = code => Buffer.from(JSON.stringify(code) + ':');
  if (existsSync(path)) {
    const records = JSON.parse(readFileSync(path, 'utf8'));
    for (const code of Object.keys(records)) {
      stored.set(code, { key: keyFor(code), value: Buffer.from(JSON.stringify(records[code])) });
      delete records[code];
    }
  }

  function remember(code, record) {
    recent.delete(code);
    recent.set(code, record);
    if (recent.size > 16) recent.delete(recent.keys().next().value);
    return record;
  }

  return {
    has: code => stored.has(code),
    get(code) {
      const entry = stored.get(code);
      if (!entry) return undefined;
      return remember(code, recent.get(code) ?? JSON.parse(entry.value.toString('utf8')));
    },
    save(code, record) {
      const previous = stored.get(code);
      const entry = { key: previous?.key ?? keyFor(code), value: Buffer.from(JSON.stringify(record)) };
      const chunks = [openObject];
      for (const [otherCode, existing] of stored) {
        const next = otherCode === code ? entry : existing;
        chunks.push(next.key, next.value, comma);
      }
      if (!previous) chunks.push(entry.key, entry.value, comma);
      chunks[chunks.length - 1] = closeObject;
      writeSnapshot(path, chunks);
      stored.set(code, entry);
      remember(code, record);
    },
  };
}
