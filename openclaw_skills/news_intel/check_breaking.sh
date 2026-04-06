#!/bin/bash
# Breaking news check — called by OpenClaw at 10:00, 13:00, 16:00, 19:00.
# Lightweight RSS scan of last 2 hours. Only returns breaking stories
# if they meet the multi-source corroboration threshold.
set -euo pipefail

REPO_DIR="${NEWS_INTEL_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
PREFS_FILE="${REPO_DIR}/data/user_preferences.json"
OUTPUT_FILE="/tmp/breaking_check.json"

cd "$REPO_DIR"

# Activate venv if present
if [ -f "venv/bin/activate" ]; then
    source venv/bin/activate
fi

PREFS_ARG=""
if [ -f "$PREFS_FILE" ]; then
    PREFS_ARG="--preferences-file $PREFS_FILE"
fi

python breaking_check.py --threshold 3 $PREFS_ARG > "$OUTPUT_FILE" 2>/tmp/breaking_stderr.log

EXIT_CODE=$?
if [ $EXIT_CODE -ne 0 ]; then
    echo '{"has_breaking": false, "error": "Check failed", "exit_code": '"$EXIT_CODE"'}' > "$OUTPUT_FILE"
    cat /tmp/breaking_stderr.log >&2
fi

cat "$OUTPUT_FILE"
