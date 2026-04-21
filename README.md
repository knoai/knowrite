<p align="center">
  <img src="https://img.shields.io/badge/Knowrite-Novel%20Writing%20Engine-6366f1?style=for-the-badge&logo=book&logoColor=white" alt="Knowrite">
</p>

<h1 align="center">Knowrite Novel Writing Engine<br><sub>Engineered Novel Writing Backend</sub></h1>

<p align="center">
  <a href="#"><img src="https://img.shields.io/badge/Node.js-24+-339933?logo=nodedotjs&logoColor=white" alt="Node.js"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-AGPL--3.0-blue.svg" alt="License: AGPL-3.0"></a>
  <a href="#"><img src="https://img.shields.io/badge/Express-4.x-000000?logo=express&logoColor=white" alt="Express"></a>
  <a href="#"><img src="https://img.shields.io/badge/SQLite-3-003B57?logo=sqlite&logoColor=white" alt="SQLite"></a>
  <a href="#"><img src="https://img.shields.io/badge/OpenAI--Compatible-API-412991?logo=openai&logoColor=white" alt="OpenAI Compatible"></a>
  <a href="#"><img src="https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker&logoColor=white" alt="Docker"></a>
</p>

<p align="center">
  <a href="README.md">English</a> | <a href="README.zh.md">简体中文</a>
</p>

---

AI Agents autonomously write novels — draft, review, revise, and evaluate, fully automated. A multi-agent collaborative engineering pipeline covering strict industrial-grade review and free creative modes, with built-in RAG vector memory, five-dimensional Fitness quality assessment, automatic Prompt evolution, book deconstruction, and Skill extraction.

**Knowrite is a Node.js / Express backend service** providing a complete automated novel creation API from outline generation, chapter writing, editorial review, de-AIization, reader feedback to quality assessment. **All model calls use a unified OpenAI-compatible protocol** — users configure their own Provider, Base URL, and API Key. No built-in default models, zero external vector database dependencies, runs on a single node.

Companion frontend [`knowrite-ui`](https://github.com/knoai/knowrite-ui) (React 19 + Vite + Tailwind CSS, MIT license) provides work management, real-time creation flow visualization, Fitness dashboard, world-building editor, Prompt management, Plan preview, Trace debugger, and real-time log panel.

> **📁 Work Storage**: SQLite primary storage + local file dual-write mechanism. All chapter text, outlines, and review records are stored in `data/novel.db`, while automatically backed up to `works/<workId>/` directory as `.txt` / `.json` files for easy access.

---

## Quick Start

### Requirements

- Node.js 24+
- Any OpenAI-compatible API Key (user-configured Provider)

### Installation

```bash
# Clone backend repo
git clone https://github.com/knoai/knowrite.git
cd knowrite

# Install dependencies
npm install

# Configure environment variables (copy template and edit as needed)
cp .env.example .env

# Start service
npm start
# Service runs at http://localhost:8000

# ⚠️ First-time setup: You MUST configure models first:
# Open frontend "Settings → Model Config", add a Provider (e.g. Qwen/Bailian/DeepSeek),
# fill in Base URL, API Key, and model list, then assign models to each role.
```

### Frontend Dev

```bash
# In another terminal, start the companion frontend
cd ../knowrite-ui
npm install
npm run dev
# Frontend runs at http://localhost:5173, auto-proxies to backend
```

### Write Your First Novel

```bash
# Create a work
curl -X POST http://localhost:8000/api/novel/start \
  -H "Content-Type: application/json" \
  -d '{"topic":"Cultivation Novel","platformStyle":"Fanqie","authorStyle":"Hot-blooded","strategy":"knowrite"}'

# Continue next chapter (SSE streaming)
curl -X POST http://localhost:8000/api/novel/continue \
  -H "Content-Type: application/json" \
  -d '{"workId":"<returned workId>"}'

# View work details (with Fitness scores, review records)
curl http://localhost:8000/api/novel/works/<workId>
```

---

## Core Features

### Multi-Agent Writing Pipeline

Each chapter is completed by multiple Agents in relay, zero manual intervention:

| Agent | Responsibility |
|-------|---------------|
| **Writer** | Generates draft based on outline + smart context (word count governance + anti-repetition reminders + RAG retrieval injection) |
| **Editor** | Structured review (`[YES]`/`[NO]` dual-pass standard), up to 3 revision rounds |
| **Humanizer** | De-AI processing to eliminate LLM frequent words, monotonous sentence patterns, and excessive summarization traces |
| **Proofreader** | Proofreading and polishing (industrial mode) or skipped (free mode) |
| **Reader** | Simulates reader perspective, outputs structured feedback (immersion / pacing / character identification) |
| **Summarizer** | Generates chapter summary, auto-indexed to RAG vector database |
| **Fitness** | Five-dimensional quantitative scoring (word count / repetition / review / reader / coherence), auto-saved |

If Editor review fails, the pipeline automatically enters a "revise → re-review" loop until passed or max rounds reached.

### Editor Dual-Pass Standard

Editor review is not just about "feeling" — it's a structured judgment:

- **Keyword pass**: Must explicitly output `[YES]` to pass; `[NO]` immediately enters next revision round
- **Dimension pass rate**: Among 8~33 review dimensions, pass rate must be ≥ 80%
- **Historical feedback injection**: From round 2 onwards, Editor automatically sees previous rounds' review comments and revision traces, avoiding repeated mistakes
- **Review record persistence**: Each round's review results are auto-saved as `review_chapter_{n}/round_{i}.json` for Fitness assessment and human review

### Fitness Five-Dimensional Quality Assessment

Automatically scored after each chapter completion, no manual intervention needed:

| Dimension | Evaluation Content | Weight |
|-----------|-------------------|--------|
| **Word Count** | Deviation from target word count (Gaussian distribution scoring) | 20% |
| **Repetition** | Content repetition detection with historical chapters | 20% |
| **Review** | Editor review pass rate | 20% |
| **Reader** | Simulated reader feedback score | 20% |
| **Coherence** | Outline deviation detection (low/medium/high severity mapping) | 20% |

Fitness scores are written to `fitness.json` in real-time; the frontend Fitness dashboard can directly display trend charts.

### RAG Vector Memory Retrieval

Zero external vector database dependency, pure JS implementation:

- **Embedding generation**: Calls Provider's `/v1/embeddings` endpoint (reuses same API Key)
- **Vector storage**: SQLite JSON column stores embeddings, auto-indexed
- **Similarity calculation**: Pure JS cosine similarity, chapter summary retrieval threshold 0.65, character/setting retrieval threshold 0.7
- **Auto-indexing**: After each chapter's Summarizer completes, summary is automatically encoded and stored
- **Context injection**: Before Writer writes, automatically retrieves Top-3 relevant historical chapter summaries and injects into prompt

### Three-Layer Memory System

Unified memory architecture integrating dispersed memory modules into a three-layer model:

| Layer | Name | Content | Module |
|-------|------|---------|--------|
| **L1** | Working Memory | Current chapter's active context window | `context-builder.js` |
| **L2** | Episodic Memory | Character experiences, event flows, timelines | `character-memory.js` + `temporal-truth.js` |
| **L3** | Semantic Memory | Worldview, rules, character settings, voice dictionary | `world-context.js` + `voice-fingerprint.js` |

### Character Episodic Memory

Maintains independent experience archives for each character:

- **Experience extraction**: Automatically extracts character's major events, dialogues, relationship changes, and emotional turns from chapter summaries
- **Experience types**: event / dialogue / relationship_change / emotional_turn / goal_progress / knowledge_gain
- **Memory injection**: Before Writer writes, automatically retrieves relevant character's recent experiences and injects into prompt
- **Persistence**: Character memories are stored in both SQLite and `works/<workId>/characters/<name>.json`

### Voice Fingerprint Dictionary

Extracts character dialogue "voice prints" from chapter text to ensure consistent speaking style:

- **Statistical dimensions**: Average sentence length, sentence templates, frequent words/catchphrases (TF-IDF), tone markers, rhetorical preferences, person ratios
- **Auto-extraction**: After each chapter completes, automatically parses dialogues and updates corresponding character's voice data
- **Writing injection**: Writer receives target character's voice constraints to maintain dialogue style consistency

### Book Deconstruction

Upload any novel text, AI automatically deconstructs it into structured creative material:

- **Structure analysis**: Template patterns, chapter structure, beat density
- **Character analysis**: Character settings, relationship networks, growth arcs
- **Worldview analysis**: Force distribution, power systems, setting rules
- **Style analysis**: Reuses AuthorFingerprint module to extract language style
- **One-click creation**: Deconstruction results can directly generate `StoryTemplate` + `AuthorFingerprint` + Prompt

### Skill Auto-Extraction

Automatically distills reusable creative skills from high-scoring chapters:

- **Trigger condition**: Automatically triggers extraction when N consecutive chapters have Fitness ≥ threshold
- **Skill format**: Markdown metadata (name / tags / fitnessThreshold / extractedFrom) + creative key points body
- **Auto-injection**: During subsequent work creation, Skills matching current genre tags are automatically injected into Writer prompt
- **Persistence**: Extracted Skills are saved to `skills/generated/` directory

### Chat Agent

Interact with works through natural language dialogue:

- **Continue/Revise**: "Make the battle scene in Chapter 3 more intense"
- **Query info**: "What cultivation realm has the protagonist reached?"
- **Creative advice**: "How should I arrange a plot twist next?"
- **Context awareness**: Agent automatically loads the work's complete context (meta, outline, chapters, settings, characters) before responding

### MCP Server

Built-in lightweight [Model Context Protocol](https://modelcontextprotocol.io/) server (JSON-RPC 2.0 + SSE):

- **`search_hot_novels`** — Search popular novel database for genre references
- **`extract_novel_features`** — Extract novel features and save as templates
- Supports direct connection from Cursor / Claude Code and other MCP clients

### Outline Deviation Detection

AI automatically determines if chapter content deviates from the established outline:

- **low**: Slight deviation, Fitness coherence score = 1.0
- **medium**: Moderate deviation, Fitness coherence score = 0.6, triggers warning
- **high**: Severe deviation, Fitness coherence score = 0.3, can trigger automatic correction rewrite

### Prompt Auto-Evolution

Automatically optimizes Prompts based on Fitness low-score samples:

1. **Collect defects**: Extract chapters with Fitness score < 0.6 and corresponding Editor review comments
2. **Analyze root cause**: Identify whether it's unclear Prompt expression, insufficient constraints, or missing examples
3. **Generate variants**: Based on defect analysis, generate 3~5 Prompt variants
4. **Evaluate and select**: Use historical chapters for backtesting, select the variant with maximum Fitness improvement
5. **Progressive replacement**: New variants only take effect for subsequent new chapters, not affecting historical works

### Smart Context Management

Writer doesn't blindly stack context, but assembles it in layers:

| Context Layer | Content | Source |
|--------------|---------|--------|
| Near History Full Text | Full text of previous 4 chapters | `raw.txt` |
| Near History Summary | Chapter summaries of previous 5 chapters | `summary.txt` |
| Far History Compression | Ultra-compressed synopsis of earlier chapters | `compress-distant` prompt |
| Worldview | Characters, settings, plotlines, maps | SQLite memory database |
| RAG Retrieval | Semantically similar historical chapters/settings | Top-3 vector similarity |
| Anti-Repetition Reminder | Plot elements already appeared in near history | `antiRepeat` auto-extraction |
| Character Memory | Target character's recent experiences | `character-memory.js` |
| Voice Constraints | Target character's dialogue style | `voice-fingerprint.js` |

### Dual Strategy Modes

- **`knowrite`** (default): 7-Agent full pipeline, quality-first
- **`pipeline`**: Lightweight single-model fast mode, speed-first

Switch at runtime via `strategy` parameter; same work can use different strategies for different chapters.

### Writer Rotation

Multi-model chapter-by-chapter rotation to avoid single-model style固化. Configure `writerRotation.models` in "Settings → Model Config", system automatically rotates.

### Worldview Memory Database

Complete world-building data model:

| Entity | Purpose |
|--------|---------|
| **Character** | Character profiles, relationship networks, appearance records |
| **WorldLore** | Worldview settings, force distribution, historical events |
| **PlotLine / PlotNode** | Plotline structure and node status |
| **MapRegion / MapConnection** | Map regions and connectivity |
| **StoryTemplate** | Template pattern library (reusable plot structures) |

All data managed through REST API CRUD, automatically injected into context during writing.

### Input Governance

Zero-LLM-call intent compilation and context selection before writing:

| Layer | Entity | Purpose |
|-------|--------|---------|
| **L1 Long-term Vision** | `AuthorIntent` | Work-level themes, constraints, must-keep/avoid |
| **L2 Current Focus** | `CurrentFocus` | Short-term creative goals (target chapter count, priority, expiration) |
| **L3 Chapter Intent** | `ChapterIntent` | Single-chapter mustKeep / mustAvoid / scene beats / emotional goals / rule stack |

Flow: `planChapter()` compiles intent → `composeChapter()` selects truth fragments + worldview context → `getGovernanceVariables()` injects into Writer prompt.

### Temporal Truth Database

Event-sourcing driven world state tracking, supporting time-travel queries:

- **Event stream** (`TruthEvent`): Immutable append-only, records character position changes, foreshadowing creation, resource acquisition, etc.
- **Materialized views** (`TruthState`): Historical state snapshots at any chapter
- **Promise tracking** (`TruthHook`): Foreshadowing/suspense creation and resolution status
- **Resource ledger** (`TruthResource`): Item quantities and transfer history

After each chapter's Summarizer completes, automatically extracts delta events; Editor and Reader can query character states and detect resource contradictions.

### Full-Dimension Author Fingerprint

Five-layer style fingerprint analysis + auto-injection + compliance detection:

| Layer | Analysis Dimension | Detection Content |
|-------|-------------------|-------------------|
| **Narrative** | POV, scene switching, chapter structure | Perspective consistency, transition methods |
| **Character** | Naming habits, character voice | Naming patterns, dialogue characteristics |
| **Plot** | Chapter structure, beat density | Rhythm distribution, conflict density |
| **Language** | Sentence length distribution, word frequency, dialogue ratio | Sentence diversity, frequent words |
| **Worldview** | Setting types, power systems | Setting complexity, consistency |

Statistical extraction + LLM style guide extraction dual mode; auto-injects constraints before writing, detects style deviation after writing.

### Output Governance

Producer-consumer decoupled pre-publication verification pipeline:

- **L1 Auto-verification**: Truth consistency, style compliance, format validation, content policy
- **L2 LLM verification**: Readability, emotional continuity, anti-AI detection
- **State machine**: `pending → validating → approved | rejected → human_review → released`
- **Manual gate**: Must pass `release` operation to be officially published

### Agent-Level Model Configuration

Breaks the "one default model for all" limitation by independently assigning Provider and model for each Agent role:

- **Three-level priority chain**: `agentModels[role]` > `roleDefaults[role]` > `provider default`
- **Independent config**: Each Agent can separately set Provider, Model, Temperature
- **Batch management**: Supports one-click save of all Agent model assignments
- **Frontend panel**: "Settings → Agent Model Assignment" visual table, supports one-click sync from roleDefaults

### Plan Mode (Chapter Preview)

Before Writer starts, Planner Agent generates narrative beats for this chapter; author confirms before entering full writing pipeline:

- **Narrative beats**: Type / description / word count / must-include elements
- **Overall tone**: Writing style, pacing, emotional direction
- **Risk alerts**: Potential deviations, logic hole warnings
- **Confirm and continue**: After Plan confirmation, auto-injected into Writer prompt, seamlessly connecting to pipeline
- **Independent page**: `/plan?workId=xxx` independent preview page, WorksPage one-click plan modal

### Dynamic Pipeline Configuration

7-Agent writing pipeline is no longer "all or nothing" — stages can be flexibly toggled and auto-skipped:

- **Stage toggles**: Writer / Editor / Humanizer / Proofreader / Reader / Summarizer / Fitness can be independently enabled/disabled
- **Plan mode toggle**: Global control over whether chapter preview is enabled
- **AutoSkip**: Automatically skips low-value stages based on Fitness history (e.g., if Editor pass rate is 100% for consecutive chapters, subsequent chapters auto-skip Proofreader)
- **Frontend config**: "Settings → Pipeline Config" Tab for visual control

### Trace Debugger

Full LLM call chain traceability — a powerful tool for investigating "why it didn't write well":

- **Call statistics**: Per-Agent call count, token consumption, average latency
- **Timeline view**: Complete call chain sorted by chapter time
- **Agent filtering**: Single Agent historical record tracing
- **Dual-source reading**: DB (fileStore) + local file system, prioritizing file system
- **Frontend debugger**: `/traces` independent page, Agent stat cards + call timeline + detailed record filtering

---

## How It Works

### Complete Pipeline Flow

```
User Request → POST /api/novel/start or /api/novel/continue
    │
    ├─→ 0. Input Governance: planChapter → composeChapter → governance variables injected into Writer prompt
    │       ├─ AuthorIntent (long-term vision)
    │       ├─ CurrentFocus (current focus)
    │       └─ ChapterIntent (chapter intent + rule stack)
    │
    ├─→ 1. Context Compilation: outline + near history full text + far history compression + worldview + RAG retrieval + anti-repetition reminder + character memory + voice constraints + truth fragments
    │       └─ Author fingerprint constraints injection (narrative/character/plot/language/world 5 layers)
    │
    ├─→ 2. Writer: generates draft → raw.txt
    ├─→ 3. Editor: structured review → [YES]/[NO] (head-tail combo preview, supports long chapter review)
    │       └─ Not passed → revise → re-review (up to 3 rounds)
    ├─→ 4. Humanizer: de-AI processing → humanized.txt
    ├─→ 5. Proofreader: proofreading → final.txt (skipped in free mode)
    ├─→ 6. Reader: simulated reader feedback → feedback.json
    ├─→ 7. Summarizer: generates summary → summary.txt
    │       └─ Temporal truth: extracts delta events → TruthEvent / TruthState / TruthHook / TruthResource
    ├─→ 8. RAG Indexing: embedding → SQLite
    ├─→ 9. Fitness Assessment: 5-dimension scoring → fitness.json
    ├─→ 10. Character Memory: extracts character experiences → CharacterMemory
    ├─→ 11. Voice Update: parses dialogue → VoiceFingerprint
    └─→ 12. Output Governance: enqueue → L1 auto-verification → L2 LLM verification → human_review → release
```

### Memory System Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Input Governance Layer                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │ AuthorIntent │  │ CurrentFocus │  │ ChapterIntent│  │ Rule Stack   │ │
│  │ Long-term    │  │ Current      │  │ Chapter      │  │ L1→L4        │ │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘ │
│         └──────────────────┴──────────────────┘                 │         │
│                              │                                  │         │
├──────────────────────────────┼──────────────────────────────────┼─────────┤
│                         Smart Context Compiler                          │         │
│  ┌─────────┐ ┌─────────┐ ┌───────────┐ ┌─────────┐ ┌───────────┐ │         │
│  │ Near    │ │ Near    │ │ Far       │ │ World   │ │ RAG       │ │         │
│  │ History │ │ History │ │ History   │ │ Database│ │ Retrieval │ │         │
│  │ Full    │ │ Summary │ │ Compression│ │ SQLite  │ │ Top-3    │ │         │
│  └────┬────┘ └────┬────┘ └─────┬─────┘ └────┬────┘ └────┬────┘ │         │
│       └─────────────┴────────────┘          └─────────────┘      │         │
│                   │                                  │            │         │
│  ┌─────────┐ ┌─────────┐ ┌───────────┐  ┌──────────────┐        │         │
│  │Anti-    │ │Truth    │ │Author     │  │ Input Gov    │        │         │
│  │Repeat   │ │Fragments│ │Fingerprint│  │ Variables    │        │         │
│  │Auto-    │ │Temporal │ │5-Layer   │  │ mustKeep etc │        │         │
│  │extract  │ │Query    │ │Constraints│  │              │        │         │
│  └────┬────┘ └────┬────┘ └─────┬─────┘  └──────┬───────┘        │         │
│       └─────────────┴────────────┘             │                 │         │
│                   │                            │                 │         │
│  ┌─────────┐ ┌─────────┐                      │                 │         │
│  │Character│ │Voice    │                      │                 │         │
│  │Memory   │ │Constraints│                    │                 │         │
│  │Injection│ │Dialogue  │                      │                 │         │
│  └────┬────┘ └────┬────┘                      │                 │         │
│       └─────────────┴──────────────────────────┘                 │         │
│                   │                                              │         │
│              Injected into Writer ◄───────────────────────────────┘         │
├──────────────────────────────────────────────────────────────────────────┤
│                           Output Governance Layer                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │ L1 Auto-     │  │ L2 LLM       │  │ Style        │  │ Truth        │ │
│  │ Verification │  │ Verification │  │ Compliance   │  │ Consistency  │ │
│  │ Format/Policy│  │ Readability  │  │ Fingerprint  │  │ Temporal DB  │ │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘ │
│         └──────────────────┴──────────────────┘                 │         │
│                              │                                  │         │
│                         human_review → release                  │         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## API Overview

### Novel Creation (SSE Streaming)

```bash
# Create a work
curl -X POST http://localhost:8000/api/novel/start \
  -H "Content-Type: application/json" \
  -d '{"topic":"Cultivation Novel","platformStyle":"Fanqie","authorStyle":"Hot-blooded","strategy":"knowrite"}'

# Continue next chapter
curl -X POST http://localhost:8000/api/novel/continue \
  -H "Content-Type: application/json" \
  -d '{"workId":"xxx"}'

# Chapter preview (Plan mode, SSE streaming)
curl -X POST http://localhost:8000/api/novel/plan \
  -H "Content-Type: application/json" \
  -d '{"workId":"xxx","chapterNumber":5}'

# Import existing chapter for continuation
curl -X POST http://localhost:8000/api/novel/import \
  -H "Content-Type: application/json" \
  -d '{"workId":"xxx","content":"Chapter 1 ..."}'

# Outline deviation detection
curl -X POST http://localhost:8000/api/novel/deviate \
  -H "Content-Type: application/json" \
  -d '{"workId":"xxx","chapterNumber":5}'

# Outline correction rewrite
curl -X POST http://localhost:8000/api/novel/correct \
  -H "Content-Type: application/json" \
  -d '{"workId":"xxx","chapterNumber":5}'

# Get work details (chapter text, Fitness, review records)
curl http://localhost:8000/api/novel/works/:workId

# Delete work (cascading delete DB + files + local directory)
curl -X DELETE http://localhost:8000/api/novel/works/:workId
```

### Chat Agent

```bash
# Chat with work (SSE streaming)
curl -X POST http://localhost:8000/api/chat-agent \
  -H "Content-Type: application/json" \
  -d '{
    "workId": "xxx",
    "messages": [{"role": "user", "content": "Make the battle in Chapter 3 more intense"}]
  }'
```

### Book Deconstruction

```bash
# Deconstruct novel text
curl -X POST http://localhost:8000/api/book-deconstruct \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Chapter 1 ...",
    "title": "Battle Through the Heavens",
    "author": "Heavenly Silkworm Potato"
  }'

# One-click create template from deconstruction results
curl -X POST http://localhost:8000/api/book-deconstruct/artifacts \
  -H "Content-Type: application/json" \
  -d '{"analysis": {...}}'
```

### Skill Extraction

```bash
# View available Skills for current work
curl http://localhost:8000/api/skills?workId=xxx

# Manually trigger Skill extraction
curl -X POST http://localhost:8000/api/skills/extract/xxx \
  -H "Content-Type: application/json" \
  -d '{"minFitness": 0.85, "minConsecutive": 3}'

# Get Skill injection text
curl http://localhost:8000/api/skills/injection/xxx
```

### Character Memory

```bash
# Get character memory injection text
curl http://localhost:8000/api/novel/works/:workId/character-memories

# Extract character experiences from summary
curl -X POST http://localhost:8000/api/novel/works/:workId/character-memories/extract \
  -H "Content-Type: application/json" \
  -d '{"chapterNumber": 5, "summaryText": "..."}'

# Get a character's memory file
curl http://localhost:8000/api/novel/works/:workId/character-memories/:charName/file
```

### Voice Fingerprint

```bash
# Get voice fingerprint injection text
curl http://localhost:8000/api/novel/works/:workId/voice-fingerprints

# Extract voice fingerprint from chapter
curl -X POST http://localhost:8000/api/novel/works/:workId/voice-fingerprints/extract \
  -H "Content-Type: application/json" \
  -d '{"chapterNumber": 5, "chapterText": "..."}'
```

### OpenAI-Compatible Interface

```bash
curl http://localhost:8000/v1/chat/completions \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-v3",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": true
  }'
```

### World Context Management

```bash
# Character CRUD
GET    /api/world/:workId/characters
POST   /api/world/:workId/characters
PUT    /api/world/:workId/characters/:id
DELETE /api/world/:workId/characters/:id

# Lore / PlotLines / Map / Templates similarly
GET/POST/PUT/DELETE /api/world/:workId/lore
GET/POST/PUT/DELETE /api/world/:workId/plot-lines
GET/POST/PUT/DELETE /api/world/:workId/map-regions
GET/POST/PUT/DELETE /api/templates
```

### Temporal Truth Database

```bash
# Time-travel query: character/item/hook state at any chapter
GET /api/truth/state/:workId?subjectType=character&subjectId=xxx&chapterNumber=5

# Active hooks (unresolved as of chapter)
GET /api/truth/hooks/:workId?asOfChapter=5

# Resource ledger
GET /api/truth/resources/:workId?resourceName=xxx&asOfChapter=5

# All state change events
GET /api/truth/events/:workId?subjectType=character&subjectId=xxx

# Generate truth projection (Markdown truth file)
POST /api/truth/projection/:workId?chapterNumber=5

# Check continuity
POST /api/truth/continuity/:workId?chapterNumber=5
```

### Author Fingerprint

```bash
# Create/update fingerprint
POST /api/style/fingerprints

# Associate fingerprint with work
POST /api/style/works/:workId/fingerprints

# Analyze text to generate fingerprint
POST /api/style/analyze

# Get work's active fingerprint
GET /api/style/works/:workId/fingerprints

# Verify style compliance
POST /api/style/verify/:workId?chapterNumber=5
```

### Input Governance

```bash
# AuthorIntent CRUD
GET  /api/input-governance/author-intent/:workId
PUT  /api/input-governance/author-intent/:workId

# CurrentFocus CRUD
GET    /api/input-governance/current-focus/:workId
POST   /api/input-governance/current-focus/:workId
PUT    /api/input-governance/current-focus/:focusId
DELETE /api/input-governance/current-focus/:focusId

# ChapterIntent
GET /api/input-governance/chapter-intent/:workId/:chapterNumber
PUT /api/input-governance/chapter-intent/:workId/:chapterNumber

# plan + compose (auto-called before writing)
POST /api/input-governance/plan/:workId/:chapterNumber
POST /api/input-governance/compose/:workId/:chapterNumber

# Get governance variables (for debugging)
GET /api/input-governance/governance-variables/:workId/:chapterNumber
```

### Output Governance

```bash
# View queue status
GET /api/output/queue/:workId

# Manually trigger verification
POST /api/output/validate/:workId/:chapterNumber

# Manual release (pass human_review gate)
POST /api/output/release/:workId/:chapterNumber
  -d '{"reviewer": "human"}'

# View verification rules
GET /api/output/rules

# Add/update rules
POST /api/output/rules
```

### Trace Debugger

```bash
# Query call records (supports agentType, time range, pagination)
GET /api/traces/:workId?agentType=writer&limit=50&offset=0

# Per-Agent call statistics
GET /api/traces/:workId/stats

# Time-sorted call chain
GET /api/traces/:workId/timeline?chapterNumber=5

# Single Agent history
GET /api/traces/:workId/agent/:agentType?limit=100
```

### Settings & Evolution

```bash
GET  /api/settings          # Global config
GET  /api/prompts           # Prompt template list
POST /api/evolve            # Prompt evolution experiment

# Agent-level model config
GET    /api/novel/settings/agent-models
GET    /api/novel/settings/agent-models/:role
POST   /api/novel/settings/agent-models/:role
DELETE /api/novel/settings/agent-models/:role
POST   /api/novel/settings/agent-models        # Batch save

# Dynamic pipeline config
GET  /api/novel/engine/pipeline
POST /api/novel/engine/pipeline
```

### MCP Endpoints

```bash
# SSE connection (Cursor / Claude Code config)
GET /mcp/sse

# JSON-RPC message channel
POST /mcp/message
```

---

## Docker Deployment

### Quick Start

```bash
# 1. Copy environment variable template and edit
cp .env.example .env
# Edit .env, configure PROVIDER, PROXY_URL, etc.

# 2. Start with Docker Compose
docker-compose up -d

# 3. Check health status
curl http://localhost:8000/health
```

### Manual Build

```bash
docker build -t knowrite:latest .
docker run -p 8000:8000 --env-file .env \
  -v knowrite-data:/app/data \
  -v knowrite-works:/app/works \
  knowrite:latest
```

### Persistent Volumes

| Volume | Path | Description |
|--------|------|-------------|
| `knowrite-data` | `/app/data` | SQLite database |
| `knowrite-works` | `/app/works` | Work local backups |
| `knowrite-logs` | `/app/logs` | Runtime logs |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 24+ |
| Framework | Express 4 |
| Database | SQLite + Sequelize 6 |
| Model Calls | OpenAI-compatible HTTP API (user-configured Provider) |
| Embedding | OpenAI `/v1/embeddings` (reuses same Provider) |
| Vector Retrieval | Pure JS cosine similarity (zero external vector DB dependency) |
| Streaming | Server-Sent Events (SSE) |
| Config | `config/*.json` static config + DB dynamic config (all models user-defined) |
| Validation | Zod Schema (request parameter validation) |
| Security | Bearer Token / API Key, CORS, Rate Limit, path traversal protection, AES-256-GCM encryption |
| Work Storage | SQLite primary storage + `works/` directory local file dual-write |
| Containerization | Docker + Docker Compose |
| Testing | Jest + Supertest |

---

## Project Structure

```
knowrite/
├── src/
│   ├── server.js                  # Express entry (CORS/rate-limit/auth/routes/MCP)
│   ├── core/
│   │   ├── chat.js                # Unified chat entry (all Providers via OpenAI-compatible protocol)
│   │   └── paths.js               # Path utils + workId sanitize
│   ├── mcp/
│   │   └── server.js              # MCP server (JSON-RPC 2.0 + SSE)
│   ├── middleware/
│   │   ├── auth.js                # Bearer Token / X-API-Key auth
│   │   └── validator.js           # Zod Schema request validation
│   ├── models/
│   │   └── index.js               # Sequelize + SQLite models (30+ tables)
│   ├── providers/
│   │   ├── base-provider.js
│   │   ├── factory.js
│   │   └── openai/                # OpenAI-compatible Provider (chat + embed)
│   ├── routes/
│   │   ├── novel.js               # Novel creation API (start/continue/plan/import/deviate/correct/delete)
│   │   ├── chat-agent.js          # Chat Agent (SSE)
│   │   ├── book-deconstructor.js  # Book deconstruction
│   │   ├── character-memory.js    # Character episodic memory
│   │   ├── voice-fingerprint.js   # Voice fingerprint dictionary
│   │   ├── skill-extractor.js     # Skill extraction
│   │   ├── world-context.js       # Worldview CRUD
│   │   ├── templates.js           # Template pattern management
│   │   ├── temporal-truth.js      # Temporal truth database API
│   │   ├── author-fingerprint.js  # Author fingerprint API
│   │   ├── output-governance.js   # Output governance API
│   │   ├── input-governance.js    # Input governance API
│   │   └── traces.js              # Trace debugger API (query/stats/timeline/agentTraces)
│   ├── schemas/
│   │   ├── chat.js                # Chat Zod Schema
│   │   ├── novel.js               # Novel Zod Schema
│   │   └── routes.js              # Route common Zod Schema
│   └── services/
│       ├── novel-engine.js           # Core creation engine (knowrite / pipeline dual strategies)
│       ├── novel/                    # novel-engine.js sub-modules
│       │   ├── chapter-writer.js     # 7-Agent / Pipeline writing pipeline (stage skip + AutoSkip)
│       │   ├── chapter-planner.js    # Plan mode — chapter beat planning (SSE)
│       │   ├── chapter-processor.js  # Summary/feedback/Fitness/Truth-Delta/character memory/voice post-processing
│       │   ├── context-builder.js    # Rolling context + RAG + anti-repetition + character memory + voice
│       │   ├── outline-generator.js  # Outline generation (theme/detailed/multi-volume/volume-split)
│       │   ├── edit-reviewer.js      # Edit review + verdict parsing
│       │   └── novel-utils.js        # Pure utility functions
│       ├── fitness-evaluator.js      # 5-dimension Fitness assessment
│       ├── vector-store.js           # Vector storage (HNSW + SQLite + JS cosine fallback)
│       ├── rag-retriever.js          # RAG retrieval (chapter/character/setting relevance)
│       ├── memory-index.js           # Smart retrieval index + anti-repetition reminders + repetition detection
│       ├── memory-system.js          # Three-layer memory system unified entry
│       ├── character-memory.js       # Character episodic memory
│       ├── voice-fingerprint.js      # Voice fingerprint extraction and injection
│       ├── book-deconstructor.js     # Book deconstruction (structure/character/worldview/style)
│       ├── chat-agent.js             # Chat agent
│       ├── skill-extractor.js        # Skill auto-extraction and injection
│       ├── outline-deviation.js      # Outline deviation detection (independent module)
│       ├── world-extractor.js        # Worldview auto-extraction
│       ├── prompt-evolver.js         # Fitness-data-driven Prompt auto-evolution
│       ├── prompt-loader.js          # Prompt template system (i18n ready + variable substitution)
│       ├── settings-store.js         # DB config + AES-256-GCM encrypted storage + seed data
│       ├── world-context.js          # Worldview memory injection
│       ├── file-store.js             # File persistence (local backup)
│       ├── temporal-truth.js         # Event sourcing + time-travel queries
│       ├── truth-manager.js          # Truth management (init/delta apply/projection/continuity check)
│       ├── author-fingerprint.js     # 5-layer style fingerprint analysis + compliance detection
│       ├── output-governance.js      # Producer-consumer verification pipeline
│       ├── input-governance.js       # plan + compose input governance
│       ├── trace-service.js          # Trace query service (DB + file system dual-source)
│       └── log-stream.js             # Log stream collector (SSE real-time push)
├── prompts/                       # Markdown Prompt templates (writer/editor/summarizer/revise...)
├── config/                        # Static JSON config + example templates
│   ├── engine.example.json
│   ├── fitness.example.json
│   ├── network.example.json
│   ├── prompts.example.json
│   ├── seed-data.json
│   ├── model-library.example.json
│   ├── user-settings.example.json
│   └── i18n.example.json
├── works/                         # Work local backups (chapter text, review records, Fitness)
├── data/                          # SQLite database (novel.db)
├── evolution/                     # Prompt evolution candidates and evaluation reports
├── logs/                          # Access logs and API logs
├── skills/                        # Skill extraction results (generated/)
├── __tests__/                     # Jest test suites (services + routes)
├── scripts/                       # Helper scripts (setup/start/reset-config/start-chrome-cdp)
├── docs/                          # Documentation (ADVANTAGES.md / ROADMAP.md etc.)
├── Dockerfile                     # Multi-stage build Docker image
├── docker-compose.yml             # Docker Compose orchestration
├── .env.example                   # Environment variable template
└── package.json
```

---

## Environment Variables

Copy `.env.example` to `.env` and configure as needed:

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Service port | `8000` |
| `PROVIDER` | Default Provider (`openai` / `ollama` / `lmstudio` / `yuanbao` / `doubao` / `kimi` / `qwen`) | `openai` |
| `PROXY_URL` | Web Provider local proxy forwarding address (e.g. Playwright proxy) | `http://localhost:9000` |
| `AUTH_TOKEN` | API authentication token (strongly recommended for production) | — |
| `CORS_ORIGINS` | CORS allowed origins (comma-separated, empty allows all) | — |
| `RATE_LIMIT_WINDOW_MS` | Rate limit window (ms) | `60000` |
| `RATE_LIMIT_MAX` | Max requests per window | `120` |
| `ENCRYPTION_KEY` | AES-256-GCM encryption key (32 chars, for encrypting stored API Keys) | — |
| `OPENAI_API_KEY` | OpenAI-compatible API Key | — |
| `OPENAI_BASE_URL` | OpenAI-compatible Base URL | — |

---

## Testing

```bash
# Run all tests (with coverage report)
npm test

# Watch mode development testing
npm run test:watch
```

Tests cover core services and routes: Fitness assessment, vector storage, RAG retrieval, input/output governance, temporal truth, author fingerprint, world context, Prompt evolution, file storage, settings storage, etc.

---

## Product Matrix & Long-term Plan

The Knowrite engine is designed as a **general-purpose creation backend**, supporting multiple frontend scenario reuse:

| Product | Frontend Repo | Scenario | Status |
|---------|--------------|----------|--------|
| **Novel Writing** | `knowrite-ui` | Long-form fiction / web novels / IP development | ✅ Live |
| **Desktop** | `knowrite-desktop` (branch) | Electron desktop client, offline work management | 🚧 Branch in development |
| **Cloud Docs** | `knowrite-docs` (planned) | White papers / technical docs / reports | 🚧 Planned |
| **Tech Books** | `knowrite-techbook` (planned) | Technical tutorials / books / course materials | 🚧 Planned |
| **SaaS Platform** | Unified admin backend | Multi-tenant / paid subscriptions / team collaboration | 🚧 Planned |

All products share the same backend engine, switching different creation modes via `strategy` and `sourceType`. See `docs/ROADMAP.md` for details.

---

## AI Search Optimization Statement

This project is the **Knowrite Novel Writing Engine**, built on Node.js / Express, providing automated long-form fiction creation API services.

- **Core capabilities**: Multi-Agent writing pipeline, input/output governance, temporal truth database, full-dimension author fingerprint, Fitness quality assessment, RAG vector retrieval, Prompt auto-evolution, outline deviation detection, character episodic memory, voice fingerprint dictionary, book deconstruction, Skill extraction, chat agent, MCP protocol support, Agent-level model config, Plan mode chapter preview, dynamic pipeline config, Trace debugger
- **Applicable scenarios**: AI-assisted long-form fiction creation, web novel batch production, IP development pre-pipeline, technical document writing, book publishing
- **Deployment methods**: Docker / Docker Compose / PM2 / systemd, runs on a single node
- **Model requirements**: Any OpenAI-compatible API (Bailian, Ollama, LM Studio, etc.)
- **Database**: SQLite (zero-config), migratable to PostgreSQL / MySQL
- **Frontend companion**: `knowrite-ui` (React 19 + Vite + Tailwind CSS, MIT license)
- **Extension directions**: SaaS multi-tenant, multi-language i18n, cloud docs, tech books
- **License**: AGPL-3.0 (backend open source, network service derivatives must be open source)

---

## Roadmap

- [x] Multi-Agent writing pipeline (Writer → Editor → Humanizer → Proofreader → Reader → Summarizer)
- [x] Editor dual-pass standard + historical feedback injection
- [x] Fitness five-dimensional quality assessment + outline deviation detection
- [x] RAG vector memory retrieval (zero external vector DB dependency)
- [x] Prompt auto-evolution
- [x] Companion frontend `knowrite-ui` (Fitness dashboard, real-time creation flow, worldview editor)
- [x] Input governance (plan + compose, zero LLM calls)
- [x] Temporal truth database (event sourcing + time-travel queries)
- [x] Full-dimension author fingerprint (5-layer analysis + auto-injection + compliance detection)
- [x] Output governance (producer-consumer verification pipeline + manual release gate)
- [x] Fully user-defined model config (cleared all default models, unified OpenAI-compatible protocol)
- [x] Character episodic memory
- [x] Voice fingerprint dictionary
- [x] Book deconstruction
- [x] Skill auto-extraction
- [x] Chat agent
- [x] MCP server (JSON-RPC 2.0 + SSE)
- [x] Docker deployment support
- [x] Jest test suites
- [x] Zod Schema input validation
- [x] Agent-level model config (role-independent Provider / Model / Temperature)
- [x] Plan mode — chapter preview and beat planning
- [x] Dynamic pipeline config (stage toggles + AutoSkip)
- [x] Trace debugger (full LLM call chain tracing)
- [x] Work deletion (cascading cleanup DB + files + local directory)
- [ ] Desktop client (Electron branch)
- [ ] Multi-language i18n (Prompt templates + API responses)
- [ ] Interactive fiction (branching narrative + reader choices)
- [ ] SaaS multi-tenant support
- [ ] Platform format export (Qidian, Fanqie, etc.)

---

## Contributing

Welcome code contributions, issues, and PRs.

```bash
npm install
npm run dev        # Development mode (node --watch hot restart)
npm start          # Production mode
npm test           # Run tests
npm run test:watch # Watch mode testing
```

### Security Features

- **Auth**: `Authorization: Bearer <token>` or `X-API-Key: <token>`
- **Rate limiting**: `express-rate-limit`, default 120 requests/minute (SSE log stream `/api/logs/stream` skips rate limiting)
- **CORS**: Configurable allowed origins
- **Path traversal**: `workId` sanitized via `sanitizeWorkId`, prohibits `../` and special characters
- **Input validation**: All routes use Zod Schema request validation
- **API Key encryption**: Config keys prefer AES-256-GCM encrypted storage (requires `ENCRYPTION_KEY`), fallback to base64 encoding when not configured

---

## License

**Backend**: AGPL-3.0 (GNU Affero General Public License v3.0)

- ✅ Allowed for personal learning, research, modification, distribution
- ✅ Allowed for commercial use (including SaaS services)
- ⚠️ **Network service clause**: If you modify the backend code and provide services over a network (e.g. SaaS), you must make your modified source code available to users
- ⚠️ **Frontend knowrite-ui**: Remains MIT license, freely usable commercially, modifiable, distributable

**Frontend `knowrite-ui`**: MIT license, freely usable commercially, modifiable, distributable.

---

> Backend repo: `knowrite` (AGPL-3.0) | Frontend repo: `knowrite-ui` (MIT) | Roadmap: `docs/ROADMAP.md`
