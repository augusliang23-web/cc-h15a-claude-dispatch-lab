// CLI only shows OFFLINE fixture state. It NEVER contacts GitHub/agents.
import {readFile} from 'node:fs/promises';
import {projectTelemetry} from './telemetry-mock.mjs';
const HOLD = {status:'HOLD',reason:'FIXTURE_INVALID',simulated:true};
try {
  if (process.argv.length !== 2) throw Error('UNSUPPORTED_ARGUMENT');
  const raw=await readFile(new URL('./fixtures/telemetry.json',import.meta.url),'utf8');
  if (Buffer.byteLength(raw)>65536) throw Error('TOO_LARGE');
  const out=projectTelemetry(JSON.parse(raw),{asOf:'2026-10-31T07:00:11.000Z',staleAfterMs:120000,noProgressAfterMs:300000});
  process.stdout.write(JSON.stringify(out,null,2)+'\n');
  if (out.status !== 'MOCK_OBSERVED') process.exitCode=2;
} catch {
  process.stdout.write(JSON.stringify(HOLD)+'\n');
  process.exitCode=2;
}
