# WebMCP reference for this repo

WebMCP is new and still moving. Agents working in this repo should **not** research it independently — use the sources below, which the orchestrator has verified, and report anything that looks out of date. Last verified: **2026-08-28**.

## Primary sources (verified)

| What | URL | Notes |
|---|---|---|
| Spec draft (WebIDL) | https://webmachinelearning.github.io/webmcp/ | Source of truth for `ModelContext`, `ModelContextTool`, `ToolAnnotations` |
| Spec repo, issues | https://github.com/webmachinelearning/webmcp | 100+ open issues; check before assuming a behaviour is settled |
| Declarative API explainer | https://github.com/webmachinelearning/webmcp/blob/main/declarative-api-explainer.md | `<form toolname …>` |
| Implementation status | https://github.com/webmachinelearning/webmcp/blob/main/implementation-status.md | Browser support table |
| Type definitions | https://github.com/webmachinelearning/webmcp-types | Published by the spec's org (sole maintainer: a Chrome DevRel engineer); linked from the spec README. Evaluated 2026-08-28 at v0.1.5: **not adopted** — lacks `executeTool` and `navigator.modelContext`, declares `document.modelContext` readonly (breaks the dev shim). We keep `src/types/webmcp.d.ts`; re-check when a newer version adds `executeTool`. |
| Chrome overview | https://developer.chrome.com/docs/ai/webmcp | Chrome 149+, flag `chrome://flags/#enable-webmcp-testing`, origin trial |
| Chrome imperative API | https://developer.chrome.com/docs/ai/webmcp/imperative-api | `document.modelContext.registerTool(...)`, `getTools`, `executeTool`, `toolchange` |
| Chrome declarative API | https://developer.chrome.com/docs/ai/webmcp/declarative-api | `toolname`, `tooldescription`, `toolparamdescription`, `toolautosubmit`; events `toolactivated`, `toolcancel`; `SubmitEvent.agentInvoked` |
| Chrome best practices | https://developer.chrome.com/docs/ai/webmcp/best-practices | Read before designing a tool's schema/description |
| Chrome secure tools | https://developer.chrome.com/docs/ai/webmcp/secure-tools | `untrustedContentHint`, confirmation, cross-origin `exposedTo` |
| Chrome evals | https://developer.chrome.com/docs/ai/webmcp/evals | How to measure whether an agent can actually use your tools — relevant to our screenshot-vs-WebMCP comparison |
| Model Context Tool Inspector (extension) | https://chromewebstore.google.com/detail/model-context-tool-inspec/gbpdfapgefenggkahomfgkhfehlcenpd | Fallback agent for demos and manual testing |
| Chrome demo repo | https://github.com/GoogleChromeLabs/webmcp-tools/tree/main/demos | `pizza-maker` (imperative), `react-flightsearch` (React), `french-bistro` (declarative) — copy patterns, not code |
| Chrome Status entry | https://chromestatus.com/feature/5117755740913664 | Ship status |
| Origin trial | https://developer.chrome.com/origintrials/#/register_trial/4163014905550602241 | Not needed for our demo (flag is enough); consider if judges must not toggle flags |
| The WebMCP Challenge rules | https://webmcp.devpost.com/rules | Deadline 2026-09-03 13:00 PDT; video < 3 min with audio; public repo + licence |
| ChatGPT changelog | https://learn.chatgpt.com/docs/changelog | ChatGPT desktop built-in browser supports WebMCP (specific plans/models); our D1 gate |

## API shape we code against

```ts
// document.modelContext (current spec + Chrome)
await document.modelContext.registerTool(
  { name, title?, description, inputSchema, annotations?: { readOnlyHint, untrustedContentHint }, execute },
  { signal?: AbortSignal, exposedTo?: string[] },
);            // returns Promise<void>; abort the signal to unregister — there is no unregisterTool
const tools = await document.modelContext.getTools();          // RegisteredTool[] (no execute)
const out   = await document.modelContext.executeTool(tool, input); // Promise<string>
document.modelContext.addEventListener("toolchange", …);
// execute(input, { signal }) — spec says Promise<any>; Chrome samples return a string. We always return a JSON string.
```

Older clients may expose `navigator.modelContext` with `registerTool / unregisterTool / provideContext`. `src/lib/webmcp/register.ts` registers on both when present and installs a dev shim (`src/lib/webmcp/shim.ts`) when neither exists.

## Things that are NOT settled (check the issue tracker before relying on them)

- Whether ChatGPT's implementation uses `document.modelContext` or `navigator.modelContext` — we register on both.
- Whether clients accept non-string `execute` results — we return strings.
- `toolactivated` / `toolcanceled` events on the imperative API (spec issue #146).
- Service-worker tools — out of scope for us.
