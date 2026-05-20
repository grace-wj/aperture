# Aperture — working rules

A visual debugger for AI agent traces. Tree + timeline + span detail, local-first, no backend for MVP. See `../aperture.md` for the full plan.

## Anti-bloat rules (these override defaults)

1. **Edit existing files before creating new ones.** A new file must justify itself. Three related functions can live in one file; do not split prematurely.
2. **No premature abstractions.** Wait until there are ~3 real call sites before extracting a helper, interface, or wrapper. Inline duplication is fine until then.
3. **No comments unless they explain a non-obvious WHY.** Never narrate WHAT the code does. Never reference tasks, tickets, or callers. If removing the comment wouldn't confuse a future reader, don't write it.
4. **No defensive code on internal boundaries.** No try/catch around our own functions. No null-checks the types already guarantee. Validate only at true system boundaries (file input, network, user-pasted JSON).
5. **No barrel `index.ts` re-export files.** Import from the source.
6. **No "future-proof" parameters, generics, or config knobs.** Add them when a second caller actually appears.
7. **Delete dead code immediately.** No commented-out blocks. No `_unused` renames. No "// removed" markers.
8. **Prefer the smallest change.** A bug fix doesn't need surrounding cleanup. A one-shot doesn't need a helper.

## Style

- TypeScript strict. No `any` without a one-line comment explaining why.
- Functional React. No class components.
- Zustand for app state, useState for local-only state. No Redux, no Context for state.
- Zod schemas live next to the type they validate, not in a separate `schemas/` tree.
- File names: kebab-case. Component names: PascalCase. Hook names: `useFoo`.

## Definitely out of scope (do not propose)

- Auth, user accounts, multi-tenant.
- Backend, database, server-side rendering.
- Live streaming traces.
- Eval scoring / regression tracking / metrics dashboards.
- LLM-powered "auto-explain this trace."

## Before suggesting a refactor

Ask: does the user's request actually require this, or am I cleaning up adjacent code? If adjacent, mention it as a follow-up, don't do it.

## Keep `DECISIONS.md` updated

When a material design choice is made (stack pick, scope cut, format decision, rejected alternative worth remembering), append an entry to `DECISIONS.md`. Routine "did X file edit" work does NOT belong there — only decisions with a *why* that wouldn't be recoverable from git diff. Always include the rejected alternatives.
