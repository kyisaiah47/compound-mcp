#!/bin/zsh
# ops/health/run.sh, what launchd invokes.
#
# The probe wants three things a launchd job does not get for free, so they live here rather
# than in the plist where the next job would have to remember them:
#
#   1. Homebrew's node. launchd's PATH has no /opt/homebrew/bin, so a bare `node` dies every
#      tick and a bare `npx` dies the moment --target public tries to spawn.
#   2. Both targets, in one tick. They answer different questions and a tick that ran only one
#      of them leaves the other unwatched: local says the tree still works, public says what a
#      stranger gets still works, and the interesting day is the one where they disagree.
#   3. The public run second. It is the slower of the two, about 7s against about 1s measured
#      2026-09-20, and running the cheap one first means a broken tree is reported even if the
#      registry is having a bad minute.
#
# ⛔ IT EXITS 0 ON A FINDING, ON PURPOSE, AND THAT IS NOT LAZINESS.
#
# tools/job-run.sh boots a job out of launchd after 3 consecutive failures carrying the same
# exit code. A health check that exits non zero while the thing it watches is down disarms
# itself on day one of the outage and then reports nothing at all, which is strictly worse than
# having no check: the dashboard goes quiet and quiet reads as fine. That is the same shape as
# the contrast sweep that went dark between 2026-09-08 and 09-10.
#
# The finding travels in the receipt and the Mac notice instead, both of which survive the lane
# staying up. Only a probe that cannot produce a verdict at all exits non zero, and that IS the
# identical-forever failure the breaker exists to stop.

set -u

export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
HERE="${0:A:h}"
REPO="${HERE:h:h}"
NODE=/opt/homebrew/bin/node

cd "$REPO" || exit 1

fault=0

echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) local ==="
"$NODE" ops/health/probe.mjs --target local || fault=1

echo
echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) public ==="
"$NODE" ops/health/probe.mjs --target public || fault=1

# `fault` is only ever set by the probe failing to reach a verdict, because a finding exits 0.
exit $fault
