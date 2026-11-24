import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { openRoomStore } from '../room-store.mjs';

test('rooms survive cache eviction, a failed write, a retry and restart in the original JSON format', t => {
  const dir = mkdtempSync(join(tmpdir(), 'room-store-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'rooms.json');
  const original = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [
    '房间' + i, { room: { version: i, answer: '一行带有引号 " 和换行\n的回答' }, students: { cookie: 'student' } },
  ]));
  writeFileSync(path, JSON.stringify(original));
  const store = openRoomStore(path);
  for (const [code, record] of Object.entries(original)) assert.deepEqual(store.get(code), record);
  assert.equal(store.has('missing'), false);
  const added = { room: { version: 1 }, owner: 'teacher' };
  store.save('NEW247', added);
  const after = { ...original, NEW247: added };
  assert.deepEqual(JSON.parse(readFileSync(path)), after);

  mkdirSync(path + '.tmp');
  const changed = { ...added, room: { version: 2 } };
  assert.throws(() => store.save('NEW247', changed));
  assert.deepEqual(store.get('NEW247'), added);
  assert.deepEqual(JSON.parse(readFileSync(path)), after);
  rmdirSync(path + '.tmp');
  store.save('NEW247', changed);
  assert.deepEqual(JSON.parse(readFileSync(path)), { ...after, NEW247: changed });
  const restarted = openRoomStore(path);
  assert.deepEqual(restarted.get('NEW247'), changed);
  assert.deepEqual(restarted.get('房间0'), original['房间0']);
});
