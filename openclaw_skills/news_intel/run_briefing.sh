#!/bin/bash
# Morning briefing — called by OpenClaw at 07:00 daily.
# Syncs preferences from OpenClaw memory, runs the full pipeline,
# outputs structured JSON for OpenClaw to format and send via chat.
set -euo pipefail

REPO_DIR="${NEWS_INTEL_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
PREFS_FILE="${REPO_DIR}/data/user_preferences.json"
OUTPUT_FILE="/tmp/briefing.json"

cd "$REPO_DIR"

# Activate venv if present
if [ -f "venv/bin/activate" ]; then
    source venv/bin/activate
fi

# Sync OpenClaw preferences into pipeline config
if [ -f "$PREFS_FILE" ]; then
    python preferences_updater.py --from-openclaw "$PREFS_FILE" 2>&1 | head -5
fi

# Run full pipeline with JSON output
python main.py --output-json --no-email --preferences-file "$PREFS_FILE" > "$OUTPUT_FILE" 2>/tmp/briefing_stderr.log

EXIT_CODE=$?
if [ $EXIT_CODE -ne 0 ]; then
    echo '{"error": "Pipeline failed", "exit_code": '"$EXIT_CODE"'}' > "$OUTPUT_FILE"
    cat /tmp/briefing_stderr.log >&2
fi

cat "$OUTPUT_FILE"
