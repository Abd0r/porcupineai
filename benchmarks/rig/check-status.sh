#!/bin/bash
# Porcupine benchmark rig status — one-shot snapshot
# Usage: bash check-status.sh
SSHPASS='Hello1123'
HOST='abdur@192.168.0.213'
REMOTE_SCRIPT=$(cat <<'EOF'
echo "=== uptime: $(uptime -p)"
echo "=== harbor procs: $(ps aux | grep -c '[h]arbor')"
D=$(ls -t ${HOME}/tbench-results/ 2>/dev/null | head -1)
echo "=== tbench dir: ${D:-none}"
if [ -n "$D" ]; then
D="${HOME}/tbench-results/${D}"
python3 - "$D" <<'PY'
import json, glob, os, sys
from collections import Counter
kinds = Counter()
for f in glob.glob(os.path.expanduser(f"{sys.argv[1]}/*/result.json")):
    try:
        d = json.load(open(f))
        ex = d.get("exception_info")
        kinds["ok" if ex is None else ex.get("exception_type", "?")] += 1
    except Exception:
        pass
print("  trials:", dict(kinds) or "none yet")
PY
fi
echo "=== polyglot workers: $(pgrep -fc 'run_polyglo[t]' || echo 0)"
for f in python javascript; do
  F=~/polyglot-results/results-$f.jsonl
  [ -f "$F" ] && python3 - "$F" <<'PY'
import json, sys
rows = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
last = {}
for r in rows:
    if "name" in r and ("passed" in r or r["name"] not in last):
        last[r["name"]] = r
done = [r for r in last.values() if "passed" in r]
p = sum(1 for r in done if r["passed"])
print(f"  {sys.argv[1].split('-')[-1].split('.')[0]}: {p}/{len(done)} passed")
PY
done
echo "=== docker networks: $(docker network ls -q | wc -l)"
echo "=== http server (sandbox installs): $(pgrep -fc http.server || echo 0)"
echo "=== disk: $(df -h / | tail -1 | awk '{print $5}')"
echo "=== mem: $(free -h | grep Mem | awk '{print $3"/"$2}') swap: $(free -h | grep Swap | awk '{print $3"/"$2}')"
echo "=== top mem: $(ps aux --sort=-%mem | sed -n 2p | awk '{print $4"% "$11" "$12}')"
EOF
)
sshpass -p "$SSHPASS" ssh -o StrictHostKeyChecking=no "$HOST" "bash -s" <<< "$REMOTE_SCRIPT"
