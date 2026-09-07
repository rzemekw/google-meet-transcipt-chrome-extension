#!/usr/bin/env python3
"""Native messaging host: appends one caption line to the meeting's transcript file.

Chrome starts one process per message (chrome.runtime.sendNativeMessage), so the host keeps
no state. The file is found by date and meeting code: rejoining the same meeting on the same
day appends to the file created the first time.

Message (from extension/content.js):
    {"code": "abc-defg-hij", "title": "Daily", "ts": "2026-09-07T07:31:12.345Z",
     "speaker": "Jan Kowalski", "text": "..."}
Reply:
    {"ok": true, "file": "/home/x/meet-transcripts/2026-09-07_0931_abc-defg-hij.txt"}
    {"ok": false, "error": "..."}

Native messaging framing: 4-byte native-endian length prefix + UTF-8 JSON, both directions.
"""

import json
import os
import struct
import sys
from datetime import datetime, timezone
from pathlib import Path

TRANSCRIPTS_DIR = Path(os.environ.get("MEET_TRANSCRIPTS_DIR", Path.home() / "meet-transcripts"))


def read_message(stream):
    raw_length = stream.read(4)
    if len(raw_length) < 4:
        return None
    (length,) = struct.unpack("@I", raw_length)
    return json.loads(stream.read(length).decode("utf-8"))


def write_message(stream, message):
    payload = json.dumps(message, ensure_ascii=False).encode("utf-8")
    stream.write(struct.pack("@I", len(payload)))
    stream.write(payload)
    stream.flush()


def parse_timestamp(value):
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone()


def safe_code(code):
    cleaned = "".join(ch if ch.isalnum() or ch in "-_" else "-" for ch in code.strip())
    return cleaned[:64] or "unknown"


def transcript_file(directory, code, started_at):
    day = started_at.strftime("%Y-%m-%d")
    existing = sorted(directory.glob(f"{day}_*_{code}.txt"))
    if existing:
        return existing[0], False
    return directory / f"{day}_{started_at.strftime('%H%M')}_{code}.txt", True


def append_line(directory, message):
    started_at = parse_timestamp(message["ts"])
    code = safe_code(message.get("code", ""))
    directory.mkdir(parents=True, exist_ok=True)
    path, is_new = transcript_file(directory, code, started_at)
    with path.open("a", encoding="utf-8") as handle:
        if is_new:
            handle.write(f"# {message.get('title') or code}\n")
            handle.write(f"# https://meet.google.com/{code}\n")
            handle.write(f"# started {started_at.isoformat(timespec='seconds')}\n\n")
        speaker = (message.get("speaker") or "?").strip()
        text = " ".join(message.get("text", "").split())
        handle.write(f"[{started_at.strftime('%H:%M:%S')}] {speaker}: {text}\n")
    return path


def main():
    stdin = sys.stdin.buffer
    stdout = sys.stdout.buffer
    while True:
        message = read_message(stdin)
        if message is None:
            return
        try:
            path = append_line(TRANSCRIPTS_DIR, message)
            write_message(stdout, {"ok": True, "file": str(path)})
        except Exception as error:  # reported back to the extension console
            write_message(stdout, {"ok": False, "error": f"{type(error).__name__}: {error}"})


if __name__ == "__main__":
    main()
