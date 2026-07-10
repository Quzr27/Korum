#!/usr/bin/env bash

set -euo pipefail

usage() {
  echo "Usage: $0 [duration-seconds] [interval-seconds] [output.csv] [korum-pid]"
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

duration="${1:-60}"
interval="${2:-5}"
output="${3:-/tmp/korum-memory-$(date +%Y%m%d-%H%M%S).csv}"
korum_pid="${4:-${KORUM_PID:-}}"

if [[ -z "$korum_pid" ]]; then
  korum_pid="$(pgrep -x korum | head -n 1 || true)"
fi

if [[ -z "$korum_pid" ]] || ! kill -0 "$korum_pid" 2>/dev/null; then
  echo "Korum process not found. Launch Korum or pass its PID as the fourth argument." >&2
  exit 1
fi

if ! [[ "$duration" =~ ^[0-9]+$ && "$interval" =~ ^[0-9]+$ ]] || (( interval == 0 )); then
  echo "Duration and interval must be non-negative integer seconds; interval must be greater than zero." >&2
  exit 1
fi

coalition_id() {
  launchctl print "pid/$1" 2>/dev/null | awk '
    /resource coalition =/ { in_resource = 1; next }
    in_resource && /ID =/ { print $3; exit }
  '
}

physical_footprint_bytes() {
  footprint --format bytes --noCategories "$1" 2>/dev/null | awk '
    /phys_footprint:/ { print $2; found = 1; exit }
    END { if (!found) print 0 }
  '
}

coalition_process_footprint() {
  local pattern="$1"
  local target_coalition="$2"
  local total=0
  local pid

  while read -r pid; do
    [[ -n "$pid" ]] || continue
    if [[ "$(coalition_id "$pid")" == "$target_coalition" ]]; then
      total=$((total + $(physical_footprint_bytes "$pid")))
    fi
  done < <(pgrep -f "$pattern" || true)

  echo "$total"
}

descendant_rss_bytes() {
  ps -axo pid=,ppid=,rss= | awk -v root="$1" '
    { pid[NR] = $1; parent[NR] = $2; rss[NR] = $3 }
    END {
      included[root] = 1
      for (round = 0; round < 32; round++) {
        for (i = 1; i <= NR; i++) {
          if (included[parent[i]]) included[pid[i]] = 1
        }
      }
      total = 0
      for (i = 1; i <= NR; i++) {
        if (pid[i] != root && included[pid[i]]) total += rss[i]
      }
      printf "%.0f\n", total * 1024
    }
  '
}

resource_coalition="$(coalition_id "$korum_pid")"
if [[ -z "$resource_coalition" ]]; then
  echo "Could not resolve the Korum resource coalition." >&2
  exit 1
fi

mkdir -p "$(dirname "$output")"
echo "timestamp,native_footprint_bytes,webcontent_footprint_bytes,gpu_footprint_bytes,terminal_descendant_rss_bytes" > "$output"

started_at="$(date +%s)"
while true; do
  now="$(date +%s)"
  native="$(physical_footprint_bytes "$korum_pid")"
  webcontent="$(coalition_process_footprint 'com\.apple\.WebKit\.WebContent' "$resource_coalition")"
  gpu="$(coalition_process_footprint 'com\.apple\.WebKit\.GPU' "$resource_coalition")"
  descendants="$(descendant_rss_bytes "$korum_pid")"

  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ),$native,$webcontent,$gpu,$descendants" | tee -a "$output"

  if (( now - started_at >= duration )); then
    break
  fi
  sleep "$interval"
done

echo "Memory profile written to $output"
