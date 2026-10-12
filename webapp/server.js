/**
 * Knowledge Base Pipeline — demo web server
 *
 * Upload an audio/video file -> transcribe (Groq Whisper) -> auto-generate a
 * standardized knowledge document (Groq LLM) -> log to the master tracker ->
 * browse the finished library. Pure Node; reuses the same Groq pipeline as the CLI.
 */

const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { marked } = require('marked');
const Groq = require('groq-sdk');

// ---------- paths ----------
const ROOT = path.dirname(__dirname); // Knowledge-Base-Pipeline/
const SOURCE_DIR = path.join(ROOT, '02_Source-Files');
const TRANSCRIPTS_DIR = path.join(ROOT, '03_Transcripts');
const LIBRARY_DIR = path.join(ROOT, '04_Knowledge-Library');
const TRACKER = path.join(ROOT, '05_Master-Tracker', 'Master-Tracker.csv');
const ENV_FILE = path.join(ROOT, '.env'); // GROQ_API_KEY=..., not committed

for (const d of [SOURCE_DIR, TRANSCRIPTS_DIR, LIBRARY_DIR]) fs.mkdirSync(d, { recursive: true });

// ---------- config ----------
const PORT = 4000;
const WHISPER_MODEL = 'whisper-large-v3';
const DOC_MODEL = 'llama-3.3-70b-versatile'; // change if Groq renames the model

function getGroqKey() {
  if (process.env.GROQ_API_KEY) return process.env.GROQ_API_KEY.trim();
  try {
    const m = fs.readFileSync(ENV_FILE, 'utf8').match(/^GROQ_API_KEY\s*=\s*(\S+)/m);
    if (m) return m[1];
  } catch (_) {}
  throw new Error('No Groq key: set GROQ_API_KEY or add it to .env');
}
const groq = new Groq({ apiKey: getGroqKey() });

// ---------- helpers ----------
const slug = (s) =>
  (s || '').toString().trim().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 60);

const ts = (sec) => {
  sec = Math.floor(sec || 0);
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
};

const csvCell = (v) => {
  v = (v ?? '').toString();
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
};

function firstHeading(md) {
  const m = md.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : null;
}
function metaField(md, field) {
  const re = new RegExp(`\\*\\*${field}\\*\\*\\s*\\|\\s*([^|]+)\\|`);
  const m = md.match(re);
  if (!m) return '';
  // strip markdown emphasis/code so cards + tracker rows read cleanly
  return m[1].trim().replace(/\*\*/g, '').replace(/[*`]/g, '').trim();
}

// ---------- the generation prompt ----------
function buildDocPrompt(meta, transcript) {
  return `You are a meticulous knowledge-operations editor. Turn the raw transcript below
into a clean, standardized knowledge-library document in GitHub-flavored Markdown.

Follow THIS exact structure and headings:

# <Document Title>
### <Source> · <Episode / Ref> · with <Speaker(s)>

## 📋 Metadata
A two-column markdown table with EXACTLY this shape — a "Field | Value" header, then one
row per field, with the field name in **bold**. Use these fields in this order:

| Field | Value |
|-------|-------|
| **Resource ID** | ... |
| **Title** | ... |
| **Type** | ... |
| **Source** | ... |
| **Host** | ... |
| **Speaker / Guest** | ... |
| **Date** | ... |
| **Duration** | ... |
| **Category** | ... |
| **Secondary categories** | ... |
| **Tags** | comma-separated |
| **Related resources** | ... |
| **Status** | Processed - Awaiting review |
| **Processed by** | Pipeline |

Do NOT put all fields in one horizontal row — use the vertical two-column layout above.

## Overview
2-4 sentence executive summary.

## Key Takeaways
Bulleted, standalone points.

## Numbered, descriptively-titled sections
Clean, edited prose. Remove filler ("um", "you know", "I mean"), false starts,
repetition, and crosstalk. PRESERVE the speakers' meaning and voice. Do NOT invent facts.

## 💬 Notable quotes
A few verbatim, high-value quotes with attribution.

## 🛠️ Tools & resources mentioned
Table: Name | What it is | Note.

## 🗂️ Classification
Primary, Secondary, Audience, Format, Content maturity.

## 🚩 Review flags — for internal decision (I flag; a human decides)
List anything uncertain, outdated, duplicate, or likely mis-transcribed. This is
critical: automatic speech recognition often mishears proper nouns (names, brands,
product names) — call these out with your best correction AND the evidence, but never
silently change a fact you cannot verify. Never decide to delete content; only flag it.

## 🔧 Processing notes
What you did: transcription model, cleanup, corrections, restructuring, template applied.

RULES:
- Output ONLY the Markdown document. No preamble, no code fences around the whole thing.
- Use the metadata hints provided; where a field is unknown, infer if reasonable and add
  a review flag, otherwise write "(confirm)".
- Status should be "Processed - Awaiting review".

METADATA HINTS (may be partial):
${JSON.stringify(meta, null, 2)}

RAW TRANSCRIPT:
${transcript}`;
}

// ---------- job store ----------
const jobs = new Map(); // id -> { status, stage, error, file, title, log: [] }
function setStage(job, stage) { job.stage = stage; job.log.push(stage); }

async function runPipeline(jobId, audioPath, meta) {
  const job = jobs.get(jobId);
  try {
    const id = meta.resourceId || path.parse(audioPath).name;

    // 1) transcribe
    setStage(job, 'Transcribing audio (Whisper)…');
    const tr = await groq.audio.transcriptions.create({
      file: fs.createReadStream(audioPath),
      model: WHISPER_MODEL,
      response_format: 'verbose_json',
      timestamp_granularities: ['segment'],
    });
    const text = (tr.text || '').trim();
    const segs = (tr.segments || []).map((s) => ({
      start: s.start || 0, end: s.end || 0, text: (s.text || '').trim(),
    }));

    const tdir = path.join(TRANSCRIPTS_DIR, id);
    fs.mkdirSync(tdir, { recursive: true });
    fs.writeFileSync(path.join(tdir, 'raw-transcript.txt'), text);
    fs.writeFileSync(path.join(tdir, 'segments.json'), JSON.stringify(segs, null, 2));
    fs.writeFileSync(path.join(tdir, 'timestamped.txt'), segs.map((s) => `[${ts(s.start)}] ${s.text}`).join('\n'));
    const duration = segs.length ? ts(segs[segs.length - 1].end) : '';

    // 2) generate structured document
    setStage(job, 'Structuring into a knowledge document (LLM)…');
    const completion = await groq.chat.completions.create({
      model: DOC_MODEL,
      temperature: 0.2,
      messages: [
        { role: 'system', content: 'You are a precise, careful knowledge-operations editor.' },
        { role: 'user', content: buildDocPrompt({ ...meta, resourceId: id, duration }, text) },
      ],
    });
    let doc = completion.choices[0].message.content.trim();
    doc = doc.replace(/^```(?:markdown)?\s*/i, '').replace(/```$/i, '').trim();

    // 3) save to library
    setStage(job, 'Saving to the knowledge library…');
    const title = firstHeading(doc) || meta.title || id;
    const outName = `${id}_${slug(title)}.md`;
    fs.writeFileSync(path.join(LIBRARY_DIR, outName), doc);

    // 4) append to tracker
    appendTracker(doc, id, outName);

    job.status = 'done';
    job.file = outName;
    job.title = title;
    setStage(job, 'Done ✓');
  } catch (err) {
    job.status = 'error';
    job.error = err.message || String(err);
    setStage(job, 'Error: ' + job.error);
  }
}

function appendTracker(doc, id, outName) {
  const row = [
    id,
    metaField(doc, 'Title') || firstHeading(doc) || id,
    metaField(doc, 'Type'),
    metaField(doc, 'Source'),
    metaField(doc, 'Speaker / Guest') || metaField(doc, 'Host'),
    metaField(doc, 'Date'),
    metaField(doc, 'Duration'),
    metaField(doc, 'Category'),
    metaField(doc, 'Secondary categories'),
    metaField(doc, 'Tags'),
    'Processed - Awaiting Review',
    'Yes',
    'See review flags in document',
    metaField(doc, 'Processed by') || 'Pipeline',
    new Date().toISOString().slice(0, 10),
    `../04_Knowledge-Library/${outName}`,
  ].map(csvCell).join(',');

  if (!fs.existsSync(TRACKER)) {
    const header = 'Resource ID,Title,Type,Source,Speaker(s),Date,Duration,Primary Category,Secondary Categories,Tags,Status,Needs Review,Review Notes,Processed By,Processed Date,Link';
    fs.mkdirSync(path.dirname(TRACKER), { recursive: true });
    fs.writeFileSync(TRACKER, header + '\n');
  }
  let body = fs.readFileSync(TRACKER, 'utf8');
  if (!body.endsWith('\n')) body += '\n';
  fs.writeFileSync(TRACKER, body + row + '\n');
}

// ---------- app ----------
const app = express();
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, SOURCE_DIR),
    // temp name here; renamed to the resource ID in the handler once body fields are parsed
    filename: (req, file, cb) => cb(null, `_upload-${Date.now()}${path.extname(file.originalname) || '.mp3'}`),
  }),
  limits: { fileSize: 300 * 1024 * 1024 }, // 300 MB
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/library', (req, res) => {
  const files = fs.existsSync(LIBRARY_DIR)
    ? fs.readdirSync(LIBRARY_DIR).filter((f) => f.endsWith('.md'))
    : [];
  const items = files.map((f) => {
    const md = fs.readFileSync(path.join(LIBRARY_DIR, f), 'utf8');
    return {
      file: f,
      id: metaField(md, 'Resource ID') || f.split('_')[0],
      title: metaField(md, 'Title') || firstHeading(md) || f,
      source: metaField(md, 'Source'),
      date: metaField(md, 'Date'),
      guest: metaField(md, 'Speaker / Guest'),
      category: metaField(md, 'Category'),
    };
  });
  items.sort((a, b) => a.id.localeCompare(b.id));
  res.json(items);
});

app.get('/api/doc', (req, res) => {
  const file = path.basename(req.query.file || ''); // prevent traversal
  const full = path.join(LIBRARY_DIR, file);
  if (!file.endsWith('.md') || !fs.existsSync(full)) return res.status(404).json({ error: 'Not found' });
  const md = fs.readFileSync(full, 'utf8');
  res.json({
    file,
    id: metaField(md, 'Resource ID') || file.split('_')[0],
    title: metaField(md, 'Title') || firstHeading(md) || file,
    html: marked.parse(md),
  });
});

// master tracker as JSON (for the Tracker view)
function parseCsvLine(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += ch;
    } else if (ch === ',') { out.push(cur); cur = ''; }
    else if (ch === '"') q = true;
    else cur += ch;
  }
  out.push(cur);
  return out;
}
app.get('/api/tracker', (req, res) => {
  if (!fs.existsSync(TRACKER)) return res.json({ headers: [], rows: [] });
  const lines = fs.readFileSync(TRACKER, 'utf8').split(/\r?\n/).filter((l) => l.trim().length);
  const headers = lines.length ? parseCsvLine(lines[0]) : [];
  const rows = lines.slice(1).map(parseCsvLine);
  res.json({ headers, rows });
});
app.get('/api/tracker-file', (req, res) => {
  if (!fs.existsSync(TRACKER)) return res.status(404).end();
  res.download(TRACKER, 'Master-Tracker.csv');
});

// transcript text for the reader tabs
app.get('/api/transcript', (req, res) => {
  const id = path.basename(req.query.id || '');
  const dir = path.join(TRANSCRIPTS_DIR, id);
  const readIf = (f) => { try { return fs.readFileSync(path.join(dir, f), 'utf8'); } catch { return ''; } };
  const raw = readIf('raw-transcript.txt');
  const timestamped = readIf('timestamped.txt');
  const hasSegments = fs.existsSync(path.join(dir, 'segments.json'));
  res.json({ id, raw, timestamped, hasSegments, hasTranscript: !!(raw || timestamped) });
});

// download a transcript artifact
app.get('/api/transcript-file', (req, res) => {
  const id = path.basename(req.query.id || '');
  const map = { raw: 'raw-transcript.txt', timestamped: 'timestamped.txt', segments: 'segments.json' };
  const fname = map[req.query.kind];
  if (!fname) return res.status(400).end();
  const full = path.join(TRANSCRIPTS_DIR, id, fname);
  if (!fs.existsSync(full)) return res.status(404).end();
  res.download(full, `${id}-${fname}`);
});

app.post('/api/process', upload.single('audio'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const resourceId = slug(req.body.resourceId) || `RES-${Date.now()}`;
  const meta = {
    resourceId,
    title: req.body.title || '',
    source: req.body.source || '',
    host: req.body.host || '',
    guest: req.body.guest || '',
    date: req.body.date || '',
    category: req.body.category || '',
  };
  // rename the uploaded source file to <resourceId><ext> (form field order safe)
  let audioPath = req.file.path;
  const finalPath = path.join(SOURCE_DIR, resourceId + (path.extname(req.file.originalname) || '.mp3'));
  try { if (audioPath !== finalPath) { fs.renameSync(audioPath, finalPath); audioPath = finalPath; } } catch (_) {}

  const jobId = crypto.randomUUID();
  jobs.set(jobId, { status: 'running', stage: 'Queued…', error: null, file: null, title: '', log: ['Uploaded'] });
  runPipeline(jobId, audioPath, meta); // async, don't await
  res.json({ jobId });
});

app.get('/api/job/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Unknown job' });
  res.json(job);
});

app.listen(PORT, () => console.log(`Knowledge Base Pipeline UI → http://localhost:${PORT}`));
