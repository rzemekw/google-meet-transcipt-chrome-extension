"""Run: python3 -m unittest host/test_host.py"""

import io
import json
import os
import struct
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import meet_transcript_host as host  # noqa: E402

HOST_SCRIPT = Path(__file__).parent / "meet_transcript_host.py"


def line(**overrides):
    base = {
        "code": "abc-defg-hij",
        "title": "Daily",
        "ts": "2026-09-07T07:31:12.345Z",
        "speaker": "Jan Kowalski",
        "text": "Dzień  dobry,\n to jest test.",
    }
    return {**base, **overrides}


class AppendLineTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name) / "transcripts"

    def tearDown(self):
        self.tmp.cleanup()

    def test_creates_file_with_header_and_line(self):
        path = host.append_line(self.dir, line())
        content = path.read_text(encoding="utf-8")
        started = host.parse_timestamp("2026-09-07T07:31:12.345Z")
        self.assertEqual(path.name, f"{started:%Y-%m-%d_%H%M}_abc-defg-hij.txt")
        self.assertTrue(content.startswith("# Daily\n# https://meet.google.com/abc-defg-hij\n# started "))
        self.assertTrue(content.endswith(f"[{started:%H:%M:%S}] Jan Kowalski: Dzień dobry, to jest test.\n"))

    def test_same_meeting_same_day_appends_to_first_file(self):
        first = host.append_line(self.dir, line())
        second = host.append_line(self.dir, line(ts="2026-09-07T09:00:00Z", speaker="Anna", text="Cześć"))
        self.assertEqual(first, second)
        lines = first.read_text(encoding="utf-8").splitlines()
        self.assertEqual(lines.count("# Daily"), 1)
        self.assertTrue(lines[-1].endswith("] Anna: Cześć"))

    def test_other_meeting_or_day_gets_own_file(self):
        a = host.append_line(self.dir, line())
        b = host.append_line(self.dir, line(code="xyz-abcd-efg"))
        c = host.append_line(self.dir, line(ts="2026-09-08T07:31:12Z"))
        self.assertEqual(len({a, b, c}), 3)

    def test_code_is_sanitised_for_filename(self):
        path = host.append_line(self.dir, line(code="../weird code"))
        self.assertTrue(path.name.endswith("_---weird-code.txt"))


class StdioProtocolTest(unittest.TestCase):
    def test_round_trip_over_stdio(self):
        with tempfile.TemporaryDirectory() as tmp:
            payload = json.dumps(line()).encode("utf-8")
            framed = struct.pack("@I", len(payload)) + payload
            result = subprocess.run(
                [sys.executable, str(HOST_SCRIPT)],
                input=framed,
                capture_output=True,
                env={**os.environ, "MEET_TRANSCRIPTS_DIR": tmp},
                check=True,
            )
            out = io.BytesIO(result.stdout)
            reply = host.read_message(out)
            self.assertTrue(reply["ok"], reply)
            self.assertTrue(Path(reply["file"]).read_text(encoding="utf-8").endswith("to jest test.\n"))

    def test_bad_message_is_reported_not_fatal(self):
        with tempfile.TemporaryDirectory() as tmp:
            payload = json.dumps({"code": "x", "ts": "not-a-date", "text": "t"}).encode("utf-8")
            framed = struct.pack("@I", len(payload)) + payload
            result = subprocess.run(
                [sys.executable, str(HOST_SCRIPT)],
                input=framed,
                capture_output=True,
                env={**os.environ, "MEET_TRANSCRIPTS_DIR": tmp},
                check=True,
            )
            reply = host.read_message(io.BytesIO(result.stdout))
            self.assertFalse(reply["ok"])
            self.assertIn("ValueError", reply["error"])


if __name__ == "__main__":
    unittest.main()
