# graph-llm-backend

Tool-calling API for [graph-llm](https://github.com/KrzysztofStaron/graph-llm) (graphai.one). The browser sends the whole conversation on every request. This service calls OpenRouter, streams the reply, and runs the image and YouTube tools. It does not store chats.

The process runs as one [Vercel Function](https://vercel.com/docs/frameworks/backend/nestjs) (Fluid compute, Frankfurt). Vercel detects NestJS from `src/main.ts` and `app.listen()`, so the same controllers serve locally and in production.

## Endpoints

| Method | Path | Response |
| --- | --- | --- |
| GET | `/` | Plain-text index |
| POST | `/api/v1/chat` | Full assistant text |
| POST | `/api/v1/chat/stream` | SSE (`data: {...}\n\n`, then `data: [DONE]\n\n`) |
| POST | `/api/v1/text-to-speech` | Chunked `audio/mpeg`, or JSON when `includeTimestamps` is true |
| POST | `/api/v1/document/parse` | Multipart field `file` |
| POST | `/api/v1/storage/upload` | Multipart field `file`, image stored in Firebase |
| GET | `/api/v1/collaboration` | Stub (`works`) |

There is no user authentication. The OpenRouter and Deepgram keys stay in environment variables. Browser access is limited by the origin allowlist in `src/cors.ts`.

SSE events the frontend already understands:

- `{ "content": "..." }` text
- `{ "reasoning": "..." }` reasoning
- `{ "type": "image", "content": "", "prompt": "..." }` when no `imageModel` was sent (the Next.js app generates the image)
- `{ "type": "image", "content": "<url>", "prompt": "..." }` when `imageModel` is set
- `{ "type": "youtube", "videoId": "...", "explanation": "..." }`
- `{ "error": "...", "details": "..." }`
- `[DONE]`

`socket.io` is installed and unused. Nothing in this service holds a websocket.

## Environment variables

Copy `.env.example` to `.env` for local runs. On Vercel, set the same names in Project → Settings → Environment Variables. Do not commit `.env`.

| Name | Required | Purpose |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | Yes, for real chat | OpenRouter key used by `/api/v1/chat` and `/api/v1/chat/stream` |
| `DEEPGRAM_API_KEY` | Only for TTS | Deepgram Aura speech and optional word timestamps |
| `POSTHOG_API_KEY` | No | `message_sent` and `document_parsed` events. Sent immediately so a frozen instance does not drop them |
| `FIREBASE_API_KEY` | No | Firebase web config for image upload. Public client values are the fallback |
| `FIREBASE_AUTH_DOMAIN` | No | Firebase web config |
| `FIREBASE_PROJECT_ID` | No | Firebase web config |
| `FIREBASE_STORAGE_BUCKET` | No | Bucket for `POST /api/v1/storage/upload` |
| `FIREBASE_MESSAGING_SENDER_ID` | No | Firebase web config |
| `FIREBASE_APP_ID` | No | Firebase web config |
| `FIREBASE_MEASUREMENT_ID` | No | Firebase web config |
| `LOKI_HOST` | No | Grafana Loki push URL. `GRAPHANA_URL` is an alias |
| `LOKI_BASIC_AUTH` | No | `instanceId:token`. Or set `GRAPHANA_USER` and `GRAPHANA_TOKEN` |
| `LOG_LEVEL` | No | Winston level. Default `info`. Vercel also stores stdout |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | No | Turns on OpenTelemetry export. Off when unset |
| `OTEL_EXPORTER_OTLP_HEADERS` | No | OTLP headers, read by the exporter |
| `OTEL_RESOURCE_ATTRIBUTES` | No | Resource attributes |
| `PORT` | No | Local listen port. Default `9955`. Vercel sets this itself |
| `GRAPH_LLM_MOCK` | No | Set to `1` to stream a canned reply and a `generate_image` tool call without calling OpenRouter. Ignored when `VERCEL_ENV=production`. Do not set it on Production |

## Local development

```bash
pnpm install
pnpm start:dev
```

`pnpm start:dev` is the same Nest process Vercel runs. To boot it through the Vercel CLI instead (CLI 48.4 or newer; `vercel login` once):

```bash
pnpm dlx vercel@latest dev --listen 9955
```

Mock a chat stream without a model key:

```bash
GRAPH_LLM_MOCK=1 pnpm start
pnpm verify:stream
```

`verify:stream` reads `BASE_URL` (default `http://127.0.0.1:9955`). It fails unless text, the image tool event, and `[DONE]` arrive as more than one chunk.

```bash
pnpm test
pnpm build
```

## Deploy

1. Import `KrzysztofStaron/graph-llm-backend` at [vercel.com/new](https://vercel.com/new). Leave the framework on the detected NestJS preset. Do not set a build command or output directory.
2. Set the environment variables above for Production and Preview. `OPENROUTER_API_KEY` is the one chat needs. Leave `GRAPH_LLM_MOCK` unset.
3. Deploy. The function region is `fra1` and `maxDuration` is 300 seconds (`vercel.json`).
4. Check `GET /` on the deployment URL, then a real stream:

```bash
curl -N -X POST "$DEPLOYMENT_URL/api/v1/chat/stream" \
  -H 'content-type: application/json' \
  -d '{"messages":[{"role":"user","content":"Say hi in one word"}]}'
```

Tokens should print before the request finishes. The body ends with `data: [DONE]`.

5. In the Vercel project, add the domain `api.graphai.one` and follow the DNS record Vercel shows (replace the A record that pointed at the Contabo host `109.199.102.132`).
6. After DNS moves, the frontend keeps working with no code change, because it already defaults to `https://api.graphai.one`.

Pull requests get a Vercel preview URL. Preview origins of the frontend are already allowed by `src/cors.ts`.

## Limits

- **Duration.** The function is allowed to run for 300 seconds. That covers the frontend's 120 second stream timeout plus an OpenRouter image call (60 seconds, or 120 seconds for `openai/gpt-image-*`). Hobby and Pro both allow 300 seconds with Fluid compute. Pro can be raised to 800 seconds in `vercel.json` if image calls start getting cut off. A client that goes idle still aborts on its own.
- **Body size.** Vercel rejects request bodies over 4.5 MB. This service rejects `Content-Length` over 4 MB, and document and image uploads use the same cap (previously 25 MB and 10 MB on the VPS). Chat from the frontend is already capped at 450 KB in `app/utils/chatPayload.ts`, so normal messages are unaffected.
- **Cold starts.** The Nest container is built once per warm instance and then reused. The first request after idle pays that startup. There is no always-on process.
- **Cost.** Fluid compute bills CPU while the handler is running and memory while the instance is awake. Time spent waiting on OpenRouter or Deepgram is I/O, not busy CPU. There is no charge for an idle VPS. Streaming responses are not held to the 4.5 MB buffered-body cap.
- **Rate limits.** `@nestjs/throttler` counts in the memory of one instance only. It does not coordinate across instances and it does not store chats. See `RATE_LIMITING.md`.
- **Logs.** Stdout goes to Vercel. Loki and PostHog remain optional. A failed Loki push is ignored.

## VPS deployment (removed)

This repo used to deploy itself. `.github/workflows/deploy.yml` SSHed to `109.199.102.132` as root, reset `/root/graph-llm-backend` to `origin/master`, and restarted systemd unit `graph-llm-backend.service`. That workflow is gone. Pushes to `master` no longer touch the VPS. CI (`.github/workflows/ci.yml`) only installs, tests, and builds.

There was no Dockerfile and no pm2 config in this repo. The only process manager was that systemd unit.

If the Contabo machine comes back and you want it to stay down:

```bash
sudo systemctl disable --now graph-llm-backend.service
```

You can delete `/root/graph-llm-backend` and the GitHub Actions secret `VPS_SSH_KEY` after DNS for `api.graphai.one` points at Vercel. Do not restore the SSH workflow.

## Frontend cutover

Repository: [KrzysztofStaron/graph-llm](https://github.com/KrzysztofStaron/graph-llm). No route moves into the Next.js app. Paths and JSON shapes stay the same.

`app/globals.ts` reads `NEXT_PUBLIC_GRAPH_LLM_BACKEND_URL` and otherwise uses `https://api.graphai.one`. These files call that base URL:

- `app/interfaces/aiService.ts` → `POST /api/v1/chat` and `POST /api/v1/chat/stream`
- `app/interfaces/audioService.ts` → `POST /api/v1/text-to-speech`
- `app/interfaces/storageService.ts` → `POST /api/v1/storage/upload`
- `app/utils/documentParserClient.ts` → `POST /api/v1/document/parse`

**Preferred cutover:** attach `api.graphai.one` to this Vercel project and update DNS. Redeploying the frontend is unnecessary, because the default base URL does not change.

**Cutover before DNS, or a different host:** in the **graph-llm** Vercel project, set `NEXT_PUBLIC_GRAPH_LLM_BACKEND_URL` to the backend deployment origin (`https://<project>.vercel.app`, no trailing slash) for Production, Preview, and Development, then redeploy the frontend. Next.js inlines `NEXT_PUBLIC_*` at build time, so a running deployment will not pick the new value up by itself.

CORS checks the page origin, not the API host. `https://graphai.one`, `https://www.graphai.one`, `https://graph-llm-seven.vercel.app`, other `graph-llm-*.vercel.app` hosts, and `*.krzysztof-starons-projects.vercel.app` are already allowed. A new site origin has to be added in `src/cors.ts`.

Image generation for OpenAI image models stays in the frontend (`app/api/generate-image`). This API only calls OpenRouter for images when the request includes `imageModel`.
