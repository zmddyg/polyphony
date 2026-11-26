import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {SHOWCASE_DECKS,createDemoMaterial} from '../demo/demo-lesson.mjs';
import {rehearseDeckHarness} from '../dist/core/deck-harness.mjs';
const directory=new URL('../artifacts/v3-examples/',import.meta.url);
await mkdir(directory,{recursive:true});
const manifest={format:'polyphony.v3.examples@1',decks:[]};
for(const deck of SHOWCASE_DECKS){
  const r=await rehearseDeckHarness(createDemoMaterial(deck.id));
  const lesson=JSON.stringify(r.lectureScore,null,2),receipt=JSON.stringify(r.harnessReceipt,null,2);
  await writeFile(new URL(deck.id+'.lecture.json',directory),lesson);
  await writeFile(new URL(deck.id+'.receipt.json',directory),receipt);
  manifest.decks.push({id:deck.id,title:deck.title,pages:r.lectureScore.pages.length,modules:r.suggestions.map(s=>({page:s.pageNumber,activityId:s.activityId})),sourceVersion:r.harnessReceipt.versionId,sha256:createHash('sha256').update(lesson).digest('hex')});
}
await writeFile(new URL('manifest.json',directory),JSON.stringify(manifest,null,2));
console.log('Compiled three V3 example lessons and guardrail receipts.');
