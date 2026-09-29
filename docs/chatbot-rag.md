# TickXplore Chatbot and RAG

A chatbot for TickXplore that answers questions using three things:

1. **A Hugging Face chat model** for writing the reply.
2. **A knowledge base (RAG)** of TickXplore's own documentation, stored in MongoDB.
3. **Backend tools** that query the live database for real information.

The browser never talks to Hugging Face. It only ever talks to our own
`POST /api/chatbot`.

---

## Why the API key moved to the server

The chatbot used to run entirely in the browser. It read a key from
`import.meta.env.VITE_HF_API_KEY` and called Hugging Face directly.

Vite inlines every `VITE_*` variable into the public JavaScript bundle. That means
the key was downloaded by every visitor and readable by anyone who opened the site.
It also meant a visitor could bypass all of our logic and spend the API quota.

Now the flow is:

```
Browser  --POST /api/chatbot-->  Express  -->  RAG (MongoDB)
                                          -->  Tools (MongoDB)
                                          -->  Hugging Face chat model
```

The token lives only in `HUGGINGFACE_API_KEY` on the server. There is no `VITE_`
Hugging Face variable, and `npm run check:secrets` fails the build if one is
reintroduced.

---

## Folder map

| Path | What it does |
| --- | --- |
| `Back_End/knowledge/` | Ten Markdown files describing TickXplore. The assistant's knowledge. |
| `Back_End/utils/rag/chunker.js` | Splits a Markdown file into small overlapping chunks. |
| `Back_End/utils/rag/embeddings.js` | Turns text into vectors using Hugging Face. Caches results on disk. |
| `Back_End/utils/rag/ingest.js` | Reads `knowledge/`, embeds it, and stores it in MongoDB. |
| `Back_End/utils/rag/retriever.js` | Finds the most relevant chunks for a question. |
| `Back_End/utils/rag/prompts.js` | The assistant's system prompt. |
| `Back_End/utils/chat/hfClient.js` | The only file that calls the chat model. |
| `Back_End/utils/chat/tools.js` | The allowlist of things the assistant may look up. |
| `Back_End/utils/chat/confirmation.js` | Signed, expiring tokens for actions that change data. |
| `Back_End/utils/chat/orchestrator.js` | Ties RAG, tools and the model together. |
| `Back_End/middleware/chatAuth.js` | Optional JWT check, so guests can still ask questions. |
| `Front_End/src/Component/ChatBot.tsx` | The chat window. Calls only our own API. |

---

## Two different models, two different jobs

This is the part that confuses people most often.

**The embedding model** (`sentence-transformers/all-MiniLM-L6-v2`) reads a piece of
text and returns 384 numbers that capture its meaning. It cannot write a reply. We
use it to search the knowledge base.

**The chat model** (`meta-llama/Llama-3.1-8B-Instruct`) reads the text we retrieved
and writes the answer you actually read.

The chatbot does not "know" anything. It looks things up and then explains them.

---

## How a question gets answered

1. The browser sends `{ message, conversation }` to `POST /api/chatbot`.
2. `optionalAuth` reads the JWT if there is one. The user is identified **only**
   from that token, never from the request body.
3. If the message asks for something destructive, the server proposes a
   confirmation instead of acting.
4. Otherwise the orchestrator retrieves relevant knowledge chunks and, if the
   question needs real data, calls one allowlisted tool.
5. The chat model writes the reply using the retrieved text and tool output.
6. The response includes which knowledge documents were used, shown as citations.

If nothing relevant is found, the assistant says it does not have that information
rather than guessing.

---

## Security design

**The model cannot choose who it is acting for.** Every personal tool filters on
`ctx.user._id`, taken from the verified JWT. A `userId` supplied by the model is
dropped before the tool runs.

**The model cannot run code or queries.** Tools are a fixed list. Each one takes
named arguments and builds its own query. There is no tool that accepts a raw
query, collection name or arbitrary field, so there is nothing to inject into.

**Destructive actions need a signed confirmation.** Cancelling a booking or
requesting a refund returns an opaque token containing the action, the target and
the user. The server verifies the signature and the user on the way back in, so a
token cannot be edited, swapped between actions, or reused by someone else. Tokens
expire after 10 minutes.

**Knowledge is fenced.** Retrieved text is wrapped in `<knowledge>` tags and
labelled as reference material, not instructions, so a document cannot give the
model new orders.

**The model cannot change role.** The system prompt opens with a role lock naming
the common jailbreak patterns, and it sits above the persona so it has primacy.
The assistant declines to role-play, and declines requests for developer mode.

**Rate limits.** 20 messages per 10 minutes per IP, tighter than the general API
limiter, because each message costs an upstream call.

**Errors are safe by default.** Upstream failures become short friendly messages.
Stack traces, database errors and file paths stay on the server.

---

## Running it

```bash
# 1. Install
cd Back_End && npm install
cd ../Front_End && npm install

# 2. Set HUGGINGFACE_API_KEY and MONGO_URI in the root .env

# 3. Build the knowledge base (re-run after editing any knowledge/*.md file)
cd Back_End && npm run chat:ingest

# 4. Run
cd Back_End && npm start
cd Front_End && npm run dev
```

### Useful commands

| Command | What it does |
| --- | --- |
| `npm run chat:ingest` | Re-index the knowledge base. Only changed chunks are re-embedded. |
| `npm run test:chat` | Run the chatbot and RAG verification suite. |
| `npm run check:secrets` | Fail if a secret is about to reach the browser. |

### Configuration

| Variable | Where | Notes |
| --- | --- | --- |
| `HUGGINGFACE_API_KEY` | server only | Never prefix this with `VITE_`. |
| `HF_CHAT_MODEL` | server only | Defaults to `meta-llama/Llama-3.1-8B-Instruct`. |
| `HF_EMBEDDING_MODEL` | server only | Defaults to `sentence-transformers/all-MiniLM-L6-v2`. |

Changing `HF_EMBEDDING_MODEL` invalidates the cache, so re-run `npm run chat:ingest`
afterwards.

---

## Editing what the assistant knows

Add or edit a Markdown file in `Back_End/knowledge/`, then re-run
`npm run chat:ingest`. Only the chunks whose text actually changed are re-embedded,
so a one-line edit costs one API call, not sixty-three.

Each file starts with front matter giving it a title and topic:

```markdown
---
title: Booking
topic: How TickXplore bookings work
---

## Making a booking

...
```

Two rules matter:

- **Only write what the code actually does.** Check the relevant controller or model
  before documenting a behaviour.
- **Never invent contact details, prices or policies.** If something is not
  implemented, say so. The assistant is instructed to prefer "I don't have that
  information" over a plausible guess.

---

## Known limits

- **Hotel and villa booking is not implemented.** TickXplore can search and quote
  stays, but there is no room reservation or checkout flow. The assistant says so
  rather than pretending.
- **Vehicle cancellation is blocked.** The existing refund controller deletes every
  reservation for a vehicle rather than the one booking, so the assistant refuses
  this action instead of causing data loss.
- **The free Hugging Face tier is heavily rate limited.** During heavy testing you
  may see HTTP 402 or 429. The chatbot shows "the assistant is very busy" and the
  test suite reports those checks as skipped rather than failing.
- **`json_schema` output is not supported by every model.** The client degrades to
  `json_object`, then to no format at all, then to no tool.
- **Embeddings are averaged for long chunks.** A chunk split into several sentences
  is represented by the mean of its sentence vectors, which is a small loss of
  precision compared to embedding the whole chunk at once.

---

## Testing

```bash
cd Back_End && npm run test:chat
```

The suite has three layers:

1. **Offline** — chunking, vector similarity, prompt contents, request limits, the
   tool allowlist and the confirmation tokens. These need no network and always run.
2. **Live retrieval** — asks real questions and checks the right knowledge document
   comes back.
3. **Live answers and security** — checks the assistant answers from knowledge, does
   not leak personal data when signed out, and refuses prompt-injection attempts.

Live checks are skipped, not failed, when the free tier throttles. The summary line
tells you how many were skipped so a green run is never mistaken for full coverage.
