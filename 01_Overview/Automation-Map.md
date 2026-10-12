# Automation Map — Knowledge Library Pipeline

A model of how I'd run this project. The design principle: **AI does the heavy
lifting, a human owns the judgment.** Every path ends at a human review gate before
anything is called "done" — matching the posting's rule that I *flag*, but a person
*decides*.

---

## The big picture

Two ingest paths (video and text) feed **one** standardization engine, which feeds
**one** library and **one** master tracker. That single shared engine is what keeps
hundreds of resources consistent.

```mermaid
flowchart TD
    subgraph A["① INGEST — two source paths"]
        V["🎥 Recorded training videos"]
        W["🌐 Articles & blog posts"]
        D["📄 Books · SOPs · PDFs · worksheets · templates · checklists"]
    end

    V -->|AI transcription\nWhisper / Groq| T1["Timestamped transcript\n+ speaker labels"]
    W -->|Custom web crawl / extract| T2["Raw article text"]
    D -->|PDF / doc parse · OCR| T3["Raw document text"]

    T1 --> CLEAN
    T2 --> CLEAN
    T3 --> CLEAN

    subgraph B["② STANDARDIZATION ENGINE — shared by every resource"]
        CLEAN["🧹 Clean & edit\n(remove filler, repetition,\nglitches, tangents —\nmeaning preserved)"]
        SECT["🧱 Structure\ninto sections +\ndescriptive headings"]
        TMPL["📐 Apply standardized\ntemplate"]
        META["🏷️ Apply metadata\ntopic · speaker · date ·\ncategory · related resources"]
        CLASS["🗂️ Classify into\nlibrary taxonomy"]
        CLEAN --> SECT --> TMPL --> META --> CLASS
    end

    CLASS --> FLAG{"🚩 Flag: outdated?\nduplicate?\nquestionable?"}

    FLAG -->|clean| REVIEW
    FLAG -->|flagged w/ note| REVIEW

    subgraph C["③ HUMAN GATE"]
        REVIEW["👤 Internal review\n(human decides —\nnot me)"]
    end

    REVIEW -->|approved| LIB["📚 Structured Knowledge Library\n(Notion)"]
    REVIEW -->|needs changes| CLEAN

    LIB --> SHEET["📊 Master progress spreadsheet\n(status · type · owner · links)"]
    LIB -. enables later .-> RAG["🤖 RAG-ready AI knowledge base"]

    style A fill:#eef6ff,stroke:#4a90d9
    style B fill:#f2fff0,stroke:#3aa655
    style C fill:#fff6e6,stroke:#e0a52c
    style LIB fill:#efeaff,stroke:#7b5cff
    style RAG fill:#f7f7f7,stroke:#999,stroke-dasharray: 4 3
```

---

## Where the hours actually get saved

| Step | Manual way | With this pipeline |
|------|-----------|--------------------|
| Get words out of a video | Watch + type/clean by hand (hrs) | **Auto-transcribe**, then edit (mins) |
| Collect articles/blogs | Open, copy, paste, strip formatting | **Crawl/extract** in one pass |
| First-pass cleanup | Read line by line | LLM removes filler/repetition, human verifies |
| Sectioning + headings | Manual judgment each time | LLM proposes, human confirms |
| Metadata + classification | Retype fields every doc | Auto-suggested from content, human approves |
| Consistency across 100s | Drift creeps in | **One shared engine** = identical output shape |

The human is never removed from the loop — they move from *doing the grunt work* to
*approving and exercising judgment*, which is where the "do not decide whether content
should be removed" boundary lives.

---

## How this maps to tools I've already built

- **Video/audio → clean structured document** is exactly my **AI Note Taker**
  (`projects/note-taker`): Groq Whisper-large-v3 transcription with timestamped
  segments + speaker labeling → local LLM turns raw transcript into a structured,
  templated document (Summary / Action Items / Key Decisions / Notes) → stored in a
  searchable library with editable speaker metadata. The core loop of this job is
  already running code.
- **Runs locally / privately** — the same architecture keeps a client's proprietary
  training library on-machine instead of shipping it to third-party services (see
  `taglish-voice`, which is explicitly "everything runs locally, nothing uploaded").
- **Provenance & licensing discipline** — in `Helmora` I chose models/datasets by
  license and flagged non-commercial data before it could contaminate a shippable
  product. Same instinct that makes me good at the "flag outdated/duplicate/
  questionable content" responsibility.

---

## Build order if hired

1. **Lock the standard** — template + metadata schema + taxonomy + master-sheet
   columns (the contracts everything else conforms to).
2. **Wire path ① (video)** — reuse the Note Taker pipeline, tune cleanup prompts to
   their template.
3. **Wire path ② (text/crawl)** — small extractor for articles/blogs; PDF parser for
   the rest.
4. **Run the trial 10** through end-to-end, refine prompts + template from their
   feedback.
5. **Scale** — batch the hundreds, human-review-gated, tracked in the sheet.
