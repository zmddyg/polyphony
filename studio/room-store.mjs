import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, writevSync } from 'node:fs';
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
  } finally {
    closeSync(fd);
  }
  renameSync(temporary, path);
}

function openSqliteRoomStore(path) {
  const { DatabaseSync } = require('node:sqlite');
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  // Restrict access to new database files because records include classroom credentials.
  closeSync(openSync(path, 'a', 0o600));
  const database = new DatabaseSync(path);
  try {
    database.exec('PRAGMA busy_timeout = 5000;');
    const { journal_mode: journalMode } = database.prepare('PRAGMA journal_mode = WAL').get();
    if (journalMode !== 'wal') throw new Error('The SQLite classroom store requires WAL mode.');
    database.exec('PRAGMA synchronous = NORMAL;');
    database.exec('CREATE TABLE IF NOT EXISTS rooms (code TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at INTEGER NOT NULL);');
    const hasRoom = database.prepare('SELECT 1 FROM rooms WHERE code = ?');
    const getRoom = database.prepare('SELECT payload FROM rooms WHERE code = ?');
    const saveRoom = database.prepare(`
      INSERT INTO rooms (code, payload, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(code) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
    `);

    return {
      backend: 'sqlite',
      has: code => Boolean(hasRoom.get(code)),
      get(code) {
        const stored = getRoom.get(code);
        return stored ? JSON.parse(stored.payload) : undefined;
      },
      save(code, record) {
        saveRoom.run(code, JSON.stringify(record), Date.now());
      },
      close() { database.close(); },
    };
  } catch (error) {
    database.close();
    throw error;
  }
}

export function openRoomStore(path, { backend = process.env.POLYPHONY_STORAGE } = {}) {
  if (backend === 'sqlite' || (backend !== 'json' && /\.(?:db|sqlite3?)$/i.test(path))) {
    return openSqliteRoomStore(path);
  }

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
    close() { recent.clear(); },
  };
}
