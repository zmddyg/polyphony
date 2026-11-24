import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writevSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';

const openObject = Buffer.from('{');
const closeObject = Buffer.from('}');
const comma = Buffer.from(',');
const require = createRequire(import.meta.url);

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
    try { fsyncSync(fd); } catch { /* Some virtual or network filesystems do not support fsync. */ }
  } finally {
    closeSync(fd);
  }
  renameSync(temporary, path);
}

function lastActivityTimestamp(record) {
  if (typeof record?.updatedAt === 'number' && Number.isFinite(record.updatedAt) && record.updatedAt > 0) {
    return record.updatedAt;
  }
  const events = record?.room?.events;
  if (!Array.isArray(events) || !events.length) return 0;
  for (let index = events.length - 1; index >= 0; index--) {
    const at = events[index]?.at;
    if (typeof at === 'number' && at > 1e11) return at;
    if (typeof at === 'string') {
      const parsed = Date.parse(at);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return 0;
}

function openSqliteStore(path) {
  const { DatabaseSync } = require('node:sqlite');
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
  db.exec('CREATE TABLE IF NOT EXISTS rooms (code TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at INTEGER NOT NULL);');
  const recent = new Map();
  const hasStmt = db.prepare('SELECT 1 FROM rooms WHERE code = ?');
  const getStmt = db.prepare('SELECT payload FROM rooms WHERE code = ?');
  const saveStmt = db.prepare('INSERT INTO rooms (code, payload, updated_at) VALUES (?, ?, ?) ON CONFLICT(code) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at');
  const deleteStmt = db.prepare('DELETE FROM rooms WHERE code = ?');
  const codesStmt = db.prepare('SELECT code FROM rooms');
  const staleStmt = db.prepare('SELECT code FROM rooms WHERE updated_at > 0 AND updated_at < ?');

  function remember(code, record) {
    recent.delete(code);
    recent.set(code, record);
    if (recent.size > 32) recent.delete(recent.keys().next().value);
    return record;
  }

  return {
    backend: 'sqlite',
    has: code => recent.has(code) || Boolean(hasStmt.get(code)),
    get(code) {
      if (recent.has(code)) return remember(code, recent.get(code));
      const row = getStmt.get(code);
      if (!row) return undefined;
      return remember(code, JSON.parse(row.payload));
    },
    save(code, record) {
      const payload = JSON.stringify(record);
      const updatedAt = lastActivityTimestamp(record) || Date.now();
      saveStmt.run(code, payload, updatedAt);
      remember(code, record);
    },
    delete(code) {
      recent.delete(code);
      return deleteStmt.run(code).changes > 0;
    },
    codes() {
      return codesStmt.all().map(row => row.code);
    },
    prune(maxAgeMs, onDelete) {
      if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) return 0;
      const cutoff = Date.now() - maxAgeMs;
      const rows = staleStmt.all(cutoff);
      for (const { code } of rows) {
        recent.delete(code);
        deleteStmt.run(code);
        onDelete?.(code);
      }
      return rows.length;
    },
    close() {
      recent.clear();
      db.close();
    },
  };
}

export function openRoomStore(path, { backend } = {}) {
  const useSqlite = backend === 'sqlite' || (backend !== 'json' && (/\.(?:db|sqlite3?)$/i.test(path) || process.env.POLYPHONY_STORAGE === 'sqlite'));
  if (useSqlite) return openSqliteStore(path);

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
    if (recent.size > 32) recent.delete(recent.keys().next().value);
    return record;
  }

  function persistMap(overrideCode, overrideEntry, omitCode) {
    const chunks = [openObject];
    for (const [otherCode, existing] of stored) {
      if (otherCode === omitCode) continue;
      const next = otherCode === overrideCode ? overrideEntry : existing;
      chunks.push(next.key, next.value, comma);
    }
    if (overrideCode && !stored.has(overrideCode)) chunks.push(overrideEntry.key, overrideEntry.value, comma);
    if (chunks.length === 1) chunks.push(closeObject);
    else chunks[chunks.length - 1] = closeObject;
    writeSnapshot(path, chunks);
  }

  return {
    backend: 'json',
    has: code => stored.has(code),
    get(code) {
      const entry = stored.get(code);
      if (!entry) return undefined;
      return remember(code, recent.get(code) ?? JSON.parse(entry.value.toString('utf8')));
    },
    save(code, record) {
      const previous = stored.get(code);
      const entry = { key: previous?.key ?? keyFor(code), value: Buffer.from(JSON.stringify(record)) };
      persistMap(code, entry, null);
      stored.set(code, entry);
      remember(code, record);
    },
    delete(code) {
      if (!stored.has(code)) return false;
      persistMap(null, null, code);
      stored.delete(code);
      recent.delete(code);
      return true;
    },
    codes() {
      return [...stored.keys()];
    },
    prune(maxAgeMs, onDelete) {
      if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) return 0;
      const cutoff = Date.now() - maxAgeMs;
      const expired = [];
      for (const [code, entry] of stored) {
        const record = recent.get(code) ?? JSON.parse(entry.value.toString('utf8'));
        const at = lastActivityTimestamp(record);
        if (at > 0 && at < cutoff) expired.push(code);
      }
      if (!expired.length) return 0;
      const drop = new Set(expired);
      const chunks = [openObject];
      for (const [code, entry] of stored) {
        if (!drop.has(code)) chunks.push(entry.key, entry.value, comma);
      }
      if (chunks.length === 1) chunks.push(closeObject);
      else chunks[chunks.length - 1] = closeObject;
      writeSnapshot(path, chunks);
      for (const code of expired) {
        stored.delete(code);
        recent.delete(code);
        onDelete?.(code);
      }
      return expired.length;
    },
    close() { recent.clear(); },
  };
}
