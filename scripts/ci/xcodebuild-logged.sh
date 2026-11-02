#!/usr/bin/env bash
# Runs xcodebuild with the given arguments, writing the full log to $1 and
# printing only errors/warnings summary. On failure, prints the log tail and
# exits with xcodebuild's own status, so CI failures are never hidden.
#
# Usage: scripts/ci/xcodebuild-logged.sh <log-file> <xcodebuild args...>
set -uo pipefail

LOG="$1"
shift
mkdir -p "$(dirname "$LOG")"
echo "xcodebuild $*"
xcodebuild "$@" > "$LOG" 2>&1
STATUS=$?

grep -E '(^|: )(error|fatal error):' "$LOG" | head -50 || true
WARNINGS=$(grep -cE ': warning:' "$LOG" || true)
echo "xcodebuild finished with status $STATUS (${WARNINGS:-0} warnings). Full log: $LOG"

if [ "$STATUS" -ne 0 ]; then
  echo "::group::Last 150 lines of the xcodebuild log"
  tail -150 "$LOG"
  echo "::endgroup::"
  FIRST_ERROR=$(grep -m1 -E '(^|: )(error|fatal error):' "$LOG" | cut -c1-300)
  echo "::error title=xcodebuild failed::${FIRST_ERROR:-See the log above}"
fi
exit "$STATUS"
