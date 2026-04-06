#!/usr/bin/env python3
"""
Install a macOS Launch Agent that runs the briefing every Monday at 7 AM.

This is the recommended way to schedule on macOS — it survives reboots,
wakes the machine if sleeping, and runs even if you're not logged in.

Usage:
  python install_launchagent.py           # install the agent
  python install_launchagent.py --remove  # uninstall it
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

LABEL = "com.newsintel.weeklybrief"
PROJECT_DIR = Path(__file__).resolve().parent
PYTHON = sys.executable
PLIST_DIR = Path.home() / "Library" / "LaunchAgents"
PLIST_PATH = PLIST_DIR / f"{LABEL}.plist"
LOG_PATH = PROJECT_DIR / "output" / "scheduler.log"

PLIST_CONTENT = f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>{LABEL}</string>

    <key>ProgramArguments</key>
    <array>
        <string>{PYTHON}</string>
        <string>{PROJECT_DIR / "main.py"}</string>
    </array>

    <key>WorkingDirectory</key>
    <string>{PROJECT_DIR}</string>

    <key>StartCalendarInterval</key>
    <dict>
        <key>Weekday</key>
        <integer>1</integer>
        <key>Hour</key>
        <integer>7</integer>
        <key>Minute</key>
        <integer>0</integer>
    </dict>

    <key>StandardOutPath</key>
    <string>{LOG_PATH}</string>
    <key>StandardErrorPath</key>
    <string>{LOG_PATH}</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:{Path(PYTHON).parent}</string>
    </dict>

    <key>RunAtLoad</key>
    <false/>
</dict>
</plist>
"""


def install() -> None:
    PLIST_DIR.mkdir(parents=True, exist_ok=True)
    (PROJECT_DIR / "output").mkdir(exist_ok=True)

    PLIST_PATH.write_text(PLIST_CONTENT)
    print(f"Written: {PLIST_PATH}")

    subprocess.run(["launchctl", "unload", str(PLIST_PATH)], capture_output=True)
    result = subprocess.run(["launchctl", "load", str(PLIST_PATH)], capture_output=True, text=True)

    if result.returncode == 0:
        print(f"Loaded successfully. Briefing will run every Monday at 7:00 AM.")
        print(f"Logs: {LOG_PATH}")
        print(f"\nTo test immediately:  launchctl start {LABEL}")
        print(f"To check status:      launchctl list | grep {LABEL}")
    else:
        print(f"Failed to load: {result.stderr}")


def remove() -> None:
    subprocess.run(["launchctl", "unload", str(PLIST_PATH)], capture_output=True)
    if PLIST_PATH.exists():
        PLIST_PATH.unlink()
        print(f"Removed: {PLIST_PATH}")
    else:
        print("Launch agent was not installed.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Install/remove macOS Launch Agent for weekly briefing")
    parser.add_argument("--remove", action="store_true", help="Remove the launch agent")
    args = parser.parse_args()

    if args.remove:
        remove()
    else:
        install()


if __name__ == "__main__":
    main()
