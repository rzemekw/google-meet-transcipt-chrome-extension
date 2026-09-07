# Meet Transcript to File

Chrome extension that turns on Google Meet captions as soon as you are in a call and appends
every caption line to a text file on disk:

```
# Daily
# https://meet.google.com/abc-defg-hij
# started 2026-09-07T09:30:12+02:00

[09:30:12] Jan Kowalski: Wczoraj skończyłem etap piąty, dzisiaj testy end to end.
[09:30:41] Anna Nowak: Ja robiłam review i dzisiaj poprawki po komentarzach.
```

One file per meeting per day in `~/meet-transcripts/`, named `YYYY-MM-DD_HHMM_<meeting-code>.txt`.
Rejoining the same meeting on the same day appends to the same file.

It uses the captions Meet already shows (free in every Workspace edition), not the paid
transcript feature. Nothing is recorded; only the caption text is written.

## Install (once)

```
git clone https://github.com/rzemekw/google-meet-transcipt-chrome-extension.git
cd google-meet-transcipt-chrome-extension
./install.sh
```

Then in Chrome: `chrome://extensions` → enable *Developer mode* → *Load unpacked* → pick the
`extension/` directory. The extension id must match the one `install.sh` prints (the key in
`manifest.json` pins it), otherwise Chrome will refuse to start the native host.

`install.sh` registers the native messaging host for Chrome, Chromium, Brave, Edge and Vivaldi
profiles found under `~/.config`. Run it again if you move the repository.

## How it works

- `extension/content.js` runs on `meet.google.com`. Every second it clicks the captions button if
  captions are off, and watches the captions region with a `MutationObserver`. Meet keeps editing
  a caption block while its person speaks (several blocks at once when people talk over each
  other), so every block is tracked on its own and written out when it disappears or after
  8 seconds without changes. A block that grows afterwards only gets its new words written, with
  the last few already written words repeated if Meet corrected them.
- `extension/background.js` forwards each line to the native host, strictly in order.
- `host/meet_transcript_host.py` is started by Chrome per line, resolves the file from the date
  and meeting code, appends, exits. Requires Python 3.

## When it stops working

Meet changes its DOM a few times a year. The things that can break are listed at the top of
`extension/content.js`: the captions icon name, the captions region selector and the
speaker/text block shape. Symptoms: captions no longer turn on by themselves, or files stay
empty. Open the call tab's console and look for `[meet-transcript]` lines.

## Tests

```
python3 -m unittest host/test_host.py
```
