import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {COMBAT_DECKS,combatMaterial} from '../demo/combat-decks.mjs';
import {runDeckHarness} from '../dist/core/deck-harness.mjs';
const target=process.argv[2]??fileURLToPath(new URL('../artifacts/v4-decks/',import.meta.url));
await mkdir(target,{recursive:true});
for(const deck of COMBAT_DECKS){
  const {lectureScore,harnessReceipt}=await runDeckHarness(combatMaterial(deck.id),{pacingMode:'full-demo'});
  await writeFile(target+'/'+deck.id+'.json',JSON.stringify(lectureScore,null,2));
  await writeFile(target+'/'+deck.id+'.receipt.json',JSON.stringify(harnessReceipt,null,2));
  console.log(deck.id,lectureScore.pages.length,'pages;',harnessReceipt.dryRuns.length,'two-round checkpoints');
}
