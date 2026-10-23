"""Mark exact checklist entries complete and append an honest task summary."""
from pathlib import Path
import sys
from datetime import date
p = Path(__file__).resolve().parents[1] / 'progress.md'
s = p.read_text()
for task in sys.argv[2:]:
    old = '- [ ] ' + task
    if old not in s:
        raise SystemExit('Checklist entry not found: ' + task)
    s = s.replace(old, '- [x] ' + task, 1)
s += '\n- ' + date.today().isoformat() + ' Summary: ' + sys.argv[1] + '\n'
p.write_text(s)
