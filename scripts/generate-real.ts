import { query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type Scenario = { out: string; maxTurns: number; task: string };

const SCENARIOS: Record<string, Scenario> = {
  'parallel-error': {
    out: 'samples/real-parallel-error.json',
    maxTurns: 12,
    task: `Fetch these four pages IN A SINGLE BATCH of parallel tool calls — issue all the WebFetch calls at once in one turn, do not wait between them:
- https://www.etymonline.com/word/serendipity
- https://www.etymonline.com/word/quixotic
- https://www.etymonline.com/word/petrichor
- https://this-domain-does-not-exist-aperture-test.invalid/page

For each page that loads, note its origin in one sentence. Report which one failed. Print a single-line summary at the end. Do not ask clarifying questions; proceed.`,
  },
  'nested-subagents': {
    out: 'samples/real-nested-subagents.json',
    maxTurns: 20,
    task: `Delegate two independent research jobs to subagents using the Task tool, one per word: the etymology of "defenestration" and the etymology of "sonder". Each subagent should fetch the etymonline.com page for its word and return a one-sentence origin. After both subagents return, write a two-line notes.md combining them and print a single-line confirmation. Do not ask clarifying questions; proceed.`,
  },
  'long-run': {
    out: 'samples/real-long-run.json',
    maxTurns: 30,
    task: `For each of these six words, in order, fetch its etymonline.com page and append a one-line origin to notes.md — one word per turn, sequentially: serendipity, defenestration, sonder, petrichor, quixotic, ephemeral. Then read notes.md back and print a single-line confirmation. Do not ask clarifying questions; proceed.`,
  },
};

async function generate(key: string) {
  const sc = SCENARIOS[key];
  if (!sc) throw new Error(`unknown scenario "${key}"; have: ${Object.keys(SCENARIOS).join(', ')}`);
  const sandbox = await mkdtemp(join(tmpdir(), 'aperture-real-'));
  console.log(`[${key}] sandbox ${sandbox}`);
  const messages: SDKMessage[] = [];
  for await (const message of query({
    prompt: sc.task,
    options: {
      cwd: sandbox,
      allowedTools: ['WebFetch', 'Read', 'Write', 'Task'],
      permissionMode: 'bypassPermissions',
      maxTurns: sc.maxTurns,
    },
  })) {
    messages.push(message);
    process.stdout.write('.');
  }
  await mkdir('samples', { recursive: true });
  await writeFile(sc.out, JSON.stringify(messages, null, 2));
  console.log(`\n[${key}] wrote ${sc.out} (${messages.length} msgs, ${(JSON.stringify(messages).length / 1024).toFixed(1)} KB)`);
}

const keys = process.argv.slice(2);
const todo = keys.length ? keys : Object.keys(SCENARIOS);
for (const k of todo) await generate(k);
