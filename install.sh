#!/usr/bin/env bash
# Registers the native messaging host for every Chromium-based browser found in ~/.config.
# Run once after cloning; run again if the repository is moved.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOST_NAME="com.rzemekw.meet_transcript"
HOST_SCRIPT="$ROOT/host/meet_transcript_host.py"
MANIFEST="$ROOT/extension/manifest.json"

EXT_ID="$(python3 - "$MANIFEST" <<'EOF'
import base64, hashlib, json, sys
key = json.load(open(sys.argv[1]))["key"]
digest = hashlib.sha256(base64.b64decode(key)).hexdigest()[:32]
print("".join(chr(ord("a") + int(c, 16)) for c in digest))
EOF
)"

chmod +x "$HOST_SCRIPT"

registered=0
for config_dir in \
  "$HOME/.config/google-chrome" \
  "$HOME/.config/google-chrome-beta" \
  "$HOME/.config/google-chrome-unstable" \
  "$HOME/.config/chromium" \
  "$HOME/.config/BraveSoftware/Brave-Browser" \
  "$HOME/.config/microsoft-edge" \
  "$HOME/.config/vivaldi"; do
  [ -d "$config_dir" ] || continue
  mkdir -p "$config_dir/NativeMessagingHosts"
  cat > "$config_dir/NativeMessagingHosts/$HOST_NAME.json" <<EOF
{
  "name": "$HOST_NAME",
  "description": "Appends Google Meet caption lines to ~/meet-transcripts",
  "path": "$HOST_SCRIPT",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXT_ID/"]
}
EOF
  echo "registered host in $config_dir/NativeMessagingHosts"
  registered=$((registered + 1))
done

if [ "$registered" -eq 0 ]; then
  echo "no Chromium-based browser profile found under ~/.config" >&2
  exit 1
fi

cat <<EOF

Native host registered. Now load the extension (one time):
  1. open chrome://extensions
  2. enable "Developer mode" (top right)
  3. "Load unpacked" -> $ROOT/extension
The extension id must be: $EXT_ID
Transcripts land in ~/meet-transcripts/
EOF
