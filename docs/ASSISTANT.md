# Factory data assistant

Open **Assistant** after signing in. Ask about stock, production costs and variance, orders and shortages, or outstanding payments. Answers use a fresh snapshot of records your role can access. Source buttons open the relevant app screen.

## Local AI with Ollama — no API key

1. Install [Ollama for Windows](https://ollama.com/download/windows), or use the portable runtime already configured in this workspace.
2. Download a local model: `ollama pull qwen3:0.6b`.
3. Copy `.env.example` to `.env` in the app directory. It selects `AI_PROVIDER=ollama`, `OLLAMA_BASE_URL=http://127.0.0.1:11434` and `OLLAMA_MODEL=qwen3:0.6b`.
4. On Windows, double-click `start.cmd`. It starts Ollama if needed, then starts Grain Ledger. Alternatively, keep `ollama serve` running and use `npm start`.
5. Open http://localhost:3000 and select **Assistant**. The badge shows **Local AI · Ollama**. The page checks the local service and model list. If setup is incomplete it shows a setup-needed badge and instructions. A ready badge confirms model availability, not answer accuracy.

The Qwen3 0.6B starter model is small and quick to download compared with larger models. For better language understanding, download `qwen3:4b` and change `OLLAMA_MODEL` in `.env`, then restart Grain Ledger. Small models can misunderstand complex questions. Verify important figures using the source records.

Standard fact questions use verified ledger responses after the local model call, labelled **Verified record answer · Ollama connected**. This preserves computed balances, units, source links and role-denial wording. Flexible questions and follow-ups use generated model text, labelled **AI answer**. Live testing found that this small model could confuse paid and outstanding amounts, so generated answers should be checked against source records.

This workspace uses Ollama 0.40.17's official signed CPU/Vulkan binaries in `../../work/ollama`, with models in `../../work/ollama-models`. `start-ollama.ps1` locates that portable runtime automatically; on another computer it uses an installed `ollama` command. The source ZIP does not contain runtime binaries, model downloads, the database or `.env`. Keep the `work` directory in place on this computer. The helper binds Ollama to localhost and disables cloud features via `OLLAMA_NO_CLOUD=1`.

For the portable installation, use `local-ai.cmd list` or `local-ai.cmd pull qwen3:4b` from the app folder while Ollama is running. This wrapper locates the local executable without changing your system PATH. Downloading a different model does not change the app's selected model; update `.env` and restart the app to select it.

Local requests go to Ollama on the app server. No API key or paid cloud account is required. Questions, up to six previous messages, and a limited authorized snapshot stay on that machine. This integration accepts only loopback addresses or Docker's host address and rejects cloud model names. See Ollama's [local-only configuration](https://docs.ollama.com/faq#how-do-i-disable-ollamas-cloud-features) and [structured output API](https://docs.ollama.com/capabilities/structured-outputs).

If Ollama is stopped, the assistant asks you to start it. If a model is missing, it shows the required `ollama pull` command. Errors do not silently substitute a different provider. Initial loading can take longer; local requests time out after three minutes. If you start Ollama yourself, configure its model directory to match your installation.

Docker Compose connects to `host.docker.internal:11434`. The host's Ollama service must be reachable from the container; a loopback-only Windows service may need Docker-specific networking configuration. Native `start.cmd` is the verified local path. Do not expose an unauthenticated Ollama endpoint publicly.

## Built-in lookup and optional OpenAI

Set `AI_PROVIDER=lookup` for deterministic local queries with no language model. Without any AI configuration the app defaults to this mode. It supports the suggested topics and current balances, but not unrestricted follow-ups or historical date ranges.

Optional OpenAI support remains available: set `AI_PROVIDER=openai`, configure `OPENAI_API_KEY` locally, and select `OPENAI_MODEL`. This sends authorized context to OpenAI using the Responses API with `store: false`. It requires your own key and account; it is not used in Ollama mode. Never put a key in chat, the browser or Git. `.env` is excluded from the source ZIP and Docker build context.

## Access and behavior

- Admin, owner and accountant: inventory, production, orders and receivables.
- Production: materials, production and inventory; no customer billing or collection data.
- Salesman: assigned customers and own orders; no factory-wide costing, inventory or payments.
- Roles come from authenticated server sessions. Prompts cannot expand the records included in a snapshot.
- Only selected fields enter the context. Passwords, sessions, GSTINs, addresses and raw audit payloads are excluded.
- Responses render as escaped text. Returned source IDs are checked against the authorized context.
- No mutation tools exist. The assistant cannot approve orders, dispatch stock, change recipes or record payments.
- Each user is limited to 12 requests per minute and one active request. Context and output are bounded.
- Chat is held in browser-tab memory and clears on sign-out, reload or new chat. Use Reports for historical periods and complete detail; snapshots include limited recent lists.

## Verification

`npm test` includes checks covering the mandatory factory benchmark plus assistant lookup, role isolation, no mutations, both provider transports, output source validation, safe errors, authentication and rate limiting. Model transport tests use controlled responses.

On 21 November 2026, live HTTP checks against Ollama 0.40.17 with Qwen3 0.6B passed for flour stock, cost per packet, receivables, order shortages and salesman access restrictions. Standard answers used the verified-record response path after successful local model calls. Ollama reported 100% GPU usage for the model. Interface rendering checks passed; visual browser verification could not be completed because the browser tool timed out.

Benchmark questions should identify 120 kg flour, ₹31.14 per packet, −6% yield variance, ₹3,875 outstanding and a 32-packet shortage. The assistant can explain recorded variance but cannot determine an unrecorded physical cause. It is not a tax adviser or a replacement for an auditor.

Latest full regression results: [Test report](TEST_REPORT.md).
