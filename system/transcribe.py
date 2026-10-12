"""
Transcribe an audio/video file with Groq Whisper-large-v3.

Usage:
    python transcribe.py "path\\to\\file.mp3" [RESOURCE-ID]

    RESOURCE-ID (optional) names the output subfolder, e.g. GYLF-EP343.
    If omitted, the audio file's name is used.

Outputs (in ../03_Transcripts/<RESOURCE-ID>/):
    raw-transcript.txt   - plain full transcript
    timestamped.txt      - [mm:ss] per segment
    segments.json        - raw timestamped segments

API key resolution order:
    1. GROQ_API_KEY environment variable (preferred)
    2. GROQ_API_KEY=... in the project's .env file (not committed)
"""

import sys, os, re, json
from groq import Groq

HERE = os.path.dirname(os.path.abspath(__file__))          # ...\system
ROOT = os.path.dirname(HERE)                               # project root
TRANSCRIPTS = os.path.join(ROOT, "03_Transcripts")
ENV_FILE = os.path.join(ROOT, ".env")


def get_key():
    env = os.environ.get("GROQ_API_KEY")
    if env:
        return env.strip()
    m = None
    if os.path.exists(ENV_FILE):
        with open(ENV_FILE, "r", encoding="utf-8") as f:
            m = re.search(r"^GROQ_API_KEY\s*=\s*(\S+)", f.read(), re.M)
    if not m:
        sys.exit("ERROR: set GROQ_API_KEY or add it to .env")
    return m.group(1)


def ts(sec):
    sec = int(sec)
    return f"{sec // 60:02d}:{sec % 60:02d}"


def main():
    if len(sys.argv) < 2:
        sys.exit('Usage: python transcribe.py "path\\to\\file.mp3" [RESOURCE-ID]')
    audio = sys.argv[1]
    if not os.path.isfile(audio):
        sys.exit(f"ERROR: file not found: {audio}")

    name = sys.argv[2] if len(sys.argv) > 2 else os.path.splitext(os.path.basename(audio))[0]
    outdir = os.path.join(TRANSCRIPTS, name)
    os.makedirs(outdir, exist_ok=True)

    size_mb = os.path.getsize(audio) / (1024 * 1024)
    print(f"File: {audio}  ({size_mb:.1f} MB)", flush=True)
    if size_mb > 24:
        print("WARNING: Groq's limit is ~25 MB. Compress or split if this fails.", flush=True)

    client = Groq(api_key=get_key())
    print("Transcribing with whisper-large-v3 ...", flush=True)
    with open(audio, "rb") as af:
        tr = client.audio.transcriptions.create(
            file=(os.path.basename(audio), af.read()),
            model="whisper-large-v3",
            response_format="verbose_json",
            timestamp_granularities=["segment"],
        )

    text = tr.text if hasattr(tr, "text") else tr.get("text", "")
    segs = tr.segments if hasattr(tr, "segments") else tr.get("segments", [])
    norm = []
    for s in segs:
        d = s if isinstance(s, dict) else {"start": s.start, "end": s.end, "text": s.text}
        norm.append({"start": d.get("start", 0), "end": d.get("end", 0), "text": d.get("text", "").strip()})

    with open(os.path.join(outdir, "raw-transcript.txt"), "w", encoding="utf-8") as f:
        f.write(text.strip())
    with open(os.path.join(outdir, "segments.json"), "w", encoding="utf-8") as f:
        json.dump(norm, f, ensure_ascii=False, indent=2)
    with open(os.path.join(outdir, "timestamped.txt"), "w", encoding="utf-8") as f:
        for s in norm:
            f.write(f"[{ts(s['start'])}] {s['text']}\n")

    dur = ts(norm[-1]["end"]) if norm else "0:00"
    print(f"DONE. {len(norm)} segments, ~{dur}, {len(text)} chars.", flush=True)
    print(f"Output in: {outdir}", flush=True)


if __name__ == "__main__":
    main()
