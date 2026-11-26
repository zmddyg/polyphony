import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { localLecturePlan } from '../dist/core/lecture-planner.mjs';

const script = fileURLToPath(new URL('../tools/check-ui-terminology.py', import.meta.url));

test('shipped teacher/student/projection copy contains no retired terminology', () => {
  const python = process.platform === 'win32' ? 'python' : 'python3';
  const report = JSON.parse(execFileSync(python, [script], { encoding: 'utf8', windowsHide: true }));
  assert.equal(report.visible_hits, 0);
  assert.equal(Object.keys(report.counts).length, 14);
  assert.ok(report.files_scanned >= 60);
});

test('retired course rules are not suggested for unrelated source text', () => {
  assert.deepEqual(localLecturePlan([{number:1,title:'普通记录核对',text:'比较两份来源记录。'}]).suggestions, []);
});

test('V3 API and Harness vocabulary is explicitly permitted', async () => {
  const source = await readFile(script, 'utf8');
  for (const word of ['Harness', 'Chat Completions', 'OpenAI']) assert.ok(source.includes(word));
});
