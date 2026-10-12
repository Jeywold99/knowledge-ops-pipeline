# Knowledge-Ops Pipeline — Demo

A working demo of a system that turns raw training resources (videos, podcasts,
articles, PDFs) into a clean, consistently-formatted, tagged, and tracked knowledge
library — one resource at a time, with a human keeping quality and judgment in the loop.

---

## 📂 Folder guide

| Folder | What's inside |
|--------|---------------|
| **`01_Overview/`** | How the system works — the [Automation Map](01_Overview/Automation-Map.md) diagram and the blank [Document Template](01_Overview/Document-Template.md) every doc conforms to |
| **`02_Source-Files/`** | The raw inputs (audio/video/docs) |
| **`03_Transcripts/`** | One subfolder per resource — the raw transcript, timestamped version, and segment data (the "before"). Generated locally, not committed to the repo |
| **`04_Knowledge-Library/`** | The finished, review-ready documents (the "after") |
| **`05_Master-Tracker/`** | [Master-Tracker.csv](05_Master-Tracker/Master-Tracker.csv) — progress log for every resource |
| **`webapp/`** | The **web UI** — upload a recording, auto-generate its document, browse the library |
| **`system/`** | The CLI tooling — [`transcribe.py`](system/transcribe.py) |

---

## 🎬 Suggested Loom walkthrough order

1. **`01_Overview/Automation-Map.md`** — the system at a glance (two ingest paths → one
   standardization engine → human review → library + tracker).
2. **`02_Source-Files/`** — "here's a raw 24-minute podcast episode."
3. **`03_Transcripts/GYLF-EP342/raw-transcript.txt`** — "one command turns it into this."
4. **`04_Knowledge-Library/GYLF-EP342_AI-in-a-High-Volume-Law-Firm.md`** — the payoff:
   cleaned, sectioned, templated, tagged, with **review flags** and **corrections**
   (e.g. the ASR misheard "Hiller" as "Miller" — caught and flagged). In the web UI's
   reader, flip between the **Document**, **Transcript**, and **Timestamped** tabs to show
   the raw "before" next to the finished "after" (each downloadable, incl. `segments.json`).
5. **`05_Master-Tracker/Master-Tracker.csv`** — every resource logged and status-tracked.

---

## 🖥️ Run the web UI (best for the Loom)

One-time install:

```bash
cd "D:\Projects - Personal\Knowledge-Base-Pipeline\webapp"; npm install
```

Start it:

```bash
cd "D:\Projects - Personal\Knowledge-Base-Pipeline\webapp"; npm start
```

Then open **http://localhost:4000**. Drop in an audio/video file, add a few optional
hints (Resource ID, source, guest, date), and click **Process** — the page shows a live
Upload → Transcribe → Structure → Save stepper, then opens the finished document and adds
it to the library gallery and the master tracker automatically.

> Uses the same Groq key as the CLI (`GROQ_API_KEY`, or a `GROQ_API_KEY=...` line in the project's `.env`
> file). The doc is auto-drafted by an LLM — it gets you ~90% there and flags what it's
> unsure of; a human still gives each doc a final polish before approval.

---

## 🏷️ Naming convention

Every resource carries **one ID** — `GYLF-EP###` (source + episode) — used across all
of its assets so they always line up:

```
02_Source-Files/GYLF-EP342_Tim-Hiller_2026-07-31.mp3
03_Transcripts/GYLF-EP342/
04_Knowledge-Library/GYLF-EP342_AI-in-a-High-Volume-Law-Firm.md
```

---

## ▶️ Add another resource

1. Drop the file in `02_Source-Files/` (name it `GYLF-EP###_Short-Name.ext`).
2. Transcribe it (writes into `03_Transcripts/GYLF-EP###/`):

```bash
& "D:\Projects - Personal\projects\note-taker\ai-env\Scripts\python.exe" "D:\Projects - Personal\Knowledge-Base-Pipeline\system\transcribe.py" "D:\Projects - Personal\Knowledge-Base-Pipeline\02_Source-Files\GYLF-EP343_Guest-Name.mp3" "GYLF-EP343"
```

3. Produce the finished doc from the [Document Template](01_Overview/Document-Template.md)
   into `04_Knowledge-Library/`, and add a row to the [Master Tracker](05_Master-Tracker/Master-Tracker.csv).
