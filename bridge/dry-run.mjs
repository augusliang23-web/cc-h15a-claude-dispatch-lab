// Local fixtures only. No live reader, task ownership or execution invocation.
import { readFile } from 'node:fs/promises';
import { FixtureQueueReader, dryRun } from './foundation.mjs';
try {
  if (process.argv.length !== 2) throw Error('UNSUPPORTED_ARGUMENT');
  const text=await readFile(new URL('./fixtures/queue.json',import.meta.url),'utf8');
  const report=await dryRun(new FixtureQueueReader(JSON.parse(text)));
  console.log(JSON.stringify(report,null,2));
  if (report.status==='HOLD') process.exitCode=1;
} catch {
  console.log(JSON.stringify({status:'HOLD',reason:'FIXTURE_READ_OR_ARGUMENT_ERROR',next_eligible_task:null}));
  process.exitCode=1;
}
