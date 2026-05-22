import { query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OUT_PATH = 'samples/canonical.json';

const TASK = `You are generating a debugging trace for a visual debugger.

Research the etymology of three English words: "serendipity", "defenestration", and "sonder".
For each:
  1. Fetch the etymonline.com page for that word (https://www.etymonline.com/word/<word>).
  2. Extract the origin/first-known-use in one sentence.
  3. Append it to notes.md in your working directory.

After all three are in notes.md, delegate to a subagent (Task tool) to synthesize a one-paragraph summary of all three etymologies, and have it save the summary to summary.md.

Finish by printing a single-line confirmation. Do not ask clarifying questions; make reasonable choices and proceed.`;

async function main() {
  const sandbox = await mkdtemp(join(tmpdir(), 'aperture-fixture-'));
  console.log(`Sandbox: ${sandbox}`);

  const messages: SDKMessage[] = [];

  for await (const message of query({
    prompt: TASK,
    options: {
      cwd: sandbox,
      allowedTools: ['WebFetch', 'Read', 'Write', 'Task'],
      permissionMode: 'bypassPermissions',
      maxTurns: 20,
    },
  })) {
    messages.push(message);
    process.stdout.write('.');
  }

  console.log(`\nCaptured ${messages.length} messages`);

  await mkdir('samples', { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(messages, null, 2));
  console.log(`Wrote ${OUT_PATH} (${(JSON.stringify(messages).length / 1024).toFixed(1)} KB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
