# Aperture

A visual debugger for AI agent traces.

When an agent does something weird — wrong tool, runaway loop, hallucinated argument — all you usually have is a JSON dump of the run: thousands of lines, deeply nested, hard to scan. Aperture renders that JSON as a tree and a timeline. You see the shape of the run at a glance, then click into any span for its prompt, response, and tool I/O.

For example: an agent tells a customer their order is canceled when it isn't. The tree view immediately shows two `lookup_order` calls. Clicking the assistant turn between them reveals the model misread the order ID the second time. About ninety seconds, instead of scrolling for fifteen minutes.

Built for traces from the [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk-typescript). The internal schema is documented so traces from other harnesses can be ingested via a short adapter.

**Stack:** Vite + React 19 + TypeScript, Zustand, Zod. Three.js and GSAP for the timeline canvas. No backend — drop a trace JSON file on the page and it works.
