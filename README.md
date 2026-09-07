# Meet Transcript to File

Saves what people say on your Google Meet calls to a text file on your computer.

Install it once and forget it. Every time you join a call, the extension turns on Meet's
captions by itself, reads them as they appear and writes them line by line, with the time and
the speaker's name, to a file in `~/meet-transcripts/`:

```
[09:30:12] Jan Kowalski: Wczoraj skończyłem etap piąty, dzisiaj testy end to end.
[09:30:41] Anna Nowak: Ja robiłam review i dzisiaj poprawki po komentarzach.
```

One file per meeting per day. Nothing is recorded, no audio or video is stored and nothing
leaves your computer; the extension only copies the caption text Meet already shows on screen.
Captions are free in every Google Workspace edition, so this does not need the paid Meet
transcript feature.

## Install

You need Google Chrome (or Brave, Chromium, Edge, Vivaldi) and Python 3. On Windows install
Python from <https://www.python.org/downloads/> and tick *Add python.exe to PATH*; on macOS and
most Linux distributions it is already there.

1. Download the project and register the helper that writes the files.

   Linux and macOS:

   ```
   git clone https://github.com/rzemekw/google-meet-transcipt-chrome-extension.git
   cd google-meet-transcipt-chrome-extension
   ./install.sh
   ```

   Windows (PowerShell):

   ```
   git clone https://github.com/rzemekw/google-meet-transcipt-chrome-extension.git
   cd google-meet-transcipt-chrome-extension
   powershell -ExecutionPolicy Bypass -File install.ps1
   ```

   No administrator rights are needed on any system.

2. Load the extension in your browser:
   - open `chrome://extensions` (in Brave: `brave://extensions`, in Edge: `edge://extensions`),
   - switch on **Developer mode** in the top right corner,
   - click **Load unpacked** and choose the `extension` folder inside the project.

3. Join any Meet call. Captions switch on by themselves and the file appears in
   `meet-transcripts` in your home folder (`~/meet-transcripts/` on Linux and macOS,
   `C:\Users\<you>\meet-transcripts\` on Windows) as soon as somebody says something.

That is all. Do not move or delete the project folder afterwards; the browser loads the extension
from it. If you do move it, run the install script again and reload the extension.

### Is it working?

Open a call and check that the captions button in the toolbar turned itself on. If it did not, or
the file stays empty, open the browser console on the call tab (F12 → Console) and look for lines
starting with `[meet-transcript]`. Send them along with a bug report.

---

## For developers

### Layout

- `extension/manifest.json` — Manifest V3. The `key` field pins the extension id so that the
  native host's `allowed_origins` is the same on every machine.
- `extension/content.js` — runs on `meet.google.com`. Every second it clicks the captions
  button if captions are off, and watches the captions region with a `MutationObserver`. Meet keeps
  editing a caption block while its person speaks (several blocks at once when people talk over
  each other), so every block is tracked on its own and written out when it disappears or after
  8 seconds without changes. A block that grows afterwards only gets its new words written, with
  the last few already written words repeated if Meet corrected them.
- `extension/background.js` — service worker; forwards each line to the native host with
  `chrome.runtime.sendNativeMessage`, strictly in order.
- `host/meet_transcript_host.py` — native messaging host. Chrome starts one process per line; it
  resolves the file from the date and meeting code (`YYYY-MM-DD_HHMM_<code>.txt`, rejoining the
  same meeting on the same day appends), writes the line and exits. Stateless on purpose.
- `install.sh` (Linux, macOS) and `install.ps1` (Windows) — derive the extension id from the
  pinned key and register the host manifest: as a file in every browser's `NativeMessagingHosts/`
  directory under `~/.config` or `~/Library/Application Support`, or as per-user registry keys
  under `HKCU:\Software\<browser>\NativeMessagingHosts` pointing at a manifest written next to
  the host. On Windows the manifest points at `host/meet_transcript_host.bat`, which runs the
  script with `py -3` or `python`; the script switches stdio to binary mode there.

### Line format

```
# <meeting title or code>
# https://meet.google.com/<code>
# started <ISO time>

[HH:MM:SS] <speaker>: <text>
```

The time is when the caption block first appeared. Your own captions carry the label Meet uses for
you ("Ty" / "You").

### When it stops working

Meet changes its DOM a few times a year. The assumptions that can break are listed at the top of
`extension/content.js`: the captions icon name, the captions region selector and the
speaker/text block shape. Symptoms: captions no longer turn on by themselves, or files stay empty.
The `[meet-transcript]` console lines say which stage was reached.

After editing `content.js`, reload the extension on `chrome://extensions` and refresh the call tab;
an old copy left on a tab shuts itself down and logs `extension reloaded, refresh this tab`.

### Tests

```
python3 -m unittest host/test_host.py
```

The content script has no automated tests; it is verified against a live call.
