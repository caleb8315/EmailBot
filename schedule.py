#!/usr/bin/env python3
"""
Lightweight scheduler for the news intelligence briefing.

Runs the pipeline every Monday at a configurable time (default 7:00 AM local).
No external dependencies — uses only the Python standard library.

Usage:
  python schedule.py                  # start scheduler (runs Mondays at 7 AM)
  python schedule.py --time 09:00     # run Mondays at 9 AM instead
  python schedule.py --now            # run immediately, then resume weekly schedule

To run as a background service:
  nohup python schedule.py > scheduler.log 2>&1 &

To set up as a macOS Launch Agent instead (recommended):
  See the generated plist file: install_launchagent.py
"""

from __future__ import annotations

import argparse
import logging
import subprocess
import sys
import time
from datetime import datetime, timedelta

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("scheduler")

PYTHON = sys.executable
MAIN_SCRIPT = "main.py"


def next_monday(target_hour: int, target_minute: int) -> datetime:
    """Calculate the next Monday at the given time."""
    now = datetime.now()
    days_ahead = 0 - now.weekday()  # Monday = 0
    if days_ahead < 0:
        days_ahead += 7
    elif days_ahead == 0:
        target_today = now.replace(hour=target_hour, minute=target_minute, second=0, microsecond=0)
        if now >= target_today:
            days_ahead = 7

    target = now + timedelta(days=days_ahead)
    return target.replace(hour=target_hour, minute=target_minute, second=0, microsecond=0)


def run_briefing() -> None:
    """Execute the main pipeline."""
    logger.info("Running weekly intelligence briefing...")
    try:
        result = subprocess.run(
            [PYTHON, MAIN_SCRIPT],
            capture_output=True,
            text=True,
            timeout=600,
        )
        if result.returncode == 0:
            logger.info("Briefing completed successfully")
        else:
            logger.error("Briefing failed (exit %d): %s", result.returncode, result.stderr[-500:] if result.stderr else "")
    except subprocess.TimeoutExpired:
        logger.error("Briefing timed out after 10 minutes")
    except Exception as exc:
        logger.error("Failed to run briefing: %s", exc)


def main() -> None:
    parser = argparse.ArgumentParser(description="Weekly briefing scheduler")
    parser.add_argument(
        "--time",
        type=str,
        default="07:00",
        help="Time to run on Mondays (HH:MM, 24h format). Default: 07:00",
    )
    parser.add_argument(
        "--now",
        action="store_true",
        help="Run immediately, then resume weekly schedule",
    )
    args = parser.parse_args()

    hour, minute = map(int, args.time.split(":"))
    logger.info("Scheduler started — will run every Monday at %02d:%02d", hour, minute)

    if args.now:
        run_briefing()

    while True:
        target = next_monday(hour, minute)
        wait_seconds = (target - datetime.now()).total_seconds()

        if wait_seconds > 0:
            logger.info("Next briefing: %s (in %.1f hours)", target.strftime("%A %Y-%m-%d %H:%M"), wait_seconds / 3600)
            time.sleep(wait_seconds)

        run_briefing()
        time.sleep(60)


if __name__ == "__main__":
    main()
