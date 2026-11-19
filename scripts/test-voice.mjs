// Runs the Deno.test files of process-incident-turn under Node (>= 22.18 / 23.6, native TS type stripping)
// for machines without the Deno CLI. With Deno installed, prefer:
//   deno test supabase/functions/process-incident-turn/
// Usage: node scripts/test-voice.mjs
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const files = [
  'supabase/functions/process-incident-turn/validate.test.ts',
  'supabase/functions/process-incident-turn/mock_extract.test.ts',
  'supabase/functions/process-incident-turn/providers.test.ts',
  'supabase/functions/process-incident-turn/audio.test.ts',
  'supabase/functions/process-incident-turn/form_catalog.test.ts',
];

const tests = [];
globalThis.Deno = {
  test: (name, fn) => tests.push({ name, fn }),
  env: { get: (name) => process.env[name] },
};

let failed = 0;
for (const file of files) {
  tests.length = 0;
  await import(pathToFileURL(resolve(file)).href);
  console.log(`\n${file}`);
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`  ok    ${name}`);
    } catch (error) {
      failed++;
      console.log(`  FAIL  ${name}\n        ${String(error?.message ?? error).split('\n').join('\n        ')}`);
    }
  }
}

console.log(failed ? `\n${failed} test(s) failed` : '\nall tests passed');
process.exit(failed ? 1 : 0);
