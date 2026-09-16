#!/usr/bin/env python3
"""Status feed for the Porcupine Pet.

Emits clean, labelled lines for the think box:

    STATUS      ACTIVE
    MODEL       deepseek-v4.1-flash
    PROVIDER    opencode-go
    SUBAGENTS   0 working
    LAST PROMPT 2m 14s ago
    DOING       bash: ffmpeg -i flight-v3/f-00.png
    SESSIONS    1 active, 3 recent

Everything comes from Porcupine's own session JSONL, plus the task store for
queued tasks. No server needed.
"""
import glob
import json
import re
import os
import time

HOME = os.path.expanduser('~')
SESS = os.path.join(HOME, '.porcupine/agent/sessions')
TASKS = os.path.join(HOME, '.porcupine/agent/tasks/tasks.json')
ACTIVE_WINDOW = 120          # seconds since last write = still active
TAIL_BYTES = 600_000
LABEL_W = 12


def last_user_message(path, max_bytes=24_000_000, chunk=2_000_000):
    """Walk BACKWARDS until the last user message is found.

    A fixed tail window is not enough: this session file is tens of megabytes and the last
    600 KB was entirely tool output, so LAST PROMPT showed n/a and the elapsed time was
    wrong. Reading backwards costs the same when the answer is near the end and still works
    when it is far back.
    """
    size = os.path.getsize(path)
    end = size
    scanned = 0
    carry = b''
    while end > 0 and scanned < max_bytes:
        start = max(0, end - chunk)
        with open(path, 'rb') as fh:
            fh.seek(start)
            buf = fh.read(end - start)
        data = buf + carry
        lines = data.split(b'\n')
        carry = lines[0] if start > 0 else b''
        for raw in reversed(lines[1:] if start > 0 else lines):
            raw = raw.strip()
            if not raw:
                continue
            try:
                d = json.loads(raw)
            except Exception:
                continue
            m = d.get('message')
            if not isinstance(m, dict) or m.get('role') != 'user':
                continue
            text = text_of(m.get('content'))
            if text and not text.startswith('<'):
                return text, d.get('timestamp')
        end = start
        scanned += len(buf)
    return None, None


def records(path):
    size = os.path.getsize(path)
    with open(path, 'rb') as fh:
        if size > 8_000_000:
            fh.seek(max(0, size - TAIL_BYTES))
            fh.readline()
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                yield json.loads(line)
            except Exception:
                continue


def text_of(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return ' '.join(str(p.get('text', '')) for p in content
                        if isinstance(p, dict) and p.get('type') == 'text')
    return ''


SECRET_PATTERNS = [
    (re.compile(r"(?i)(?<![A-Za-z0-9])(password|passwd|pwd|pass|token|secret|api[_-]?key|apikey|access[_-]?key"
                r"|auth[_-]?token|client[_-]?secret|private[_-]?key|passphrase|askpass)\b\s*[:=]\s*\S+"),
     r"\1=[redacted]"),
    (re.compile(r"(?i)(sshpass\s+-p\s*)\S+"), r"\1[redacted]"),
    (re.compile(r"(?i)\b(bearer)\s+\S+"), r"\1 [redacted]"),
    (re.compile(r"\bsk-[A-Za-z0-9_\-]{12,}"), "[redacted]"),
    (re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}"), "[redacted]"),
    (re.compile(r"\bxox[baprs]-[A-Za-z0-9\-]{10,}"), "[redacted]"),
    (re.compile(r"\b[0-9]{9,10}:[A-Za-z0-9_\-]{30,}"), "[redacted]"),
]


def redact(text):
    if not text:
        return text
    out = text
    for pattern, repl in SECRET_PATTERNS:
        out = pattern.sub(repl, out)
    return out


def interaction_mode():
    """Ask/Normal/Auto. Not exposed to extensions and never written to the session JSONL
    (AgentSession keeps it in memory only), so this reports the session default from
    settings.json. Accurate unless the mode was switched mid-session."""
    try:
        d = json.load(open(os.path.join(HOME, '.porcupine/agent/settings.json')))
        return str(d.get('defaultInteractionMode') or 'normal').upper()
    except Exception:
        return 'UNKNOWN'


def human(delta):
    delta = max(0, int(delta))
    if delta < 60:
        return f'{delta}s ago'
    if delta < 3600:
        return f'{delta // 60}m {delta % 60:02d}s ago'
    return f'{delta // 3600}h {(delta % 3600) // 60:02d}m ago'


def short_args(tool, args):
    if not isinstance(args, dict):
        return tool
    for key in ('command', 'path', 'file_path', 'query', 'url', 'pattern'):
        if key in args:
            v = str(args[key]).split('\n')[0].strip()
            v = re.sub(r'^(cd\s+\S+\s*&&?\s*|echo\s+\S+\s*;?\s*)', '', v).strip()
            return f'{tool}: {v[:64]}'
    return tool


def digest(path):
    """Walk a session file and pull out what the pet needs to say.

    Sub-agents are detected as `subagent` tool calls whose toolCallId never gets a
    matching toolResult, i.e. still in flight. Their delegated brief is the best
    available description of what each one is doing.
    """
    out = {'model': None, 'provider': None, 'last_user_ts': None, 'last_assistant': '',
           'doing': None, 'subs': [], 'subs_finished': 0, 'last_user_text': None,
           'thinking': None}
    calls = {}            # toolCallId -> (name, args)
    finished = set()
    for rec in records(path):
        t = rec.get('type')
        if t == 'thinking_level_change':
            out['thinking'] = rec.get('thinkingLevel') or out['thinking']
        if t == 'request_header':
            out['model'] = rec.get('model') or out['model']
            out['provider'] = rec.get('provider') or out['provider']
            # each request header carries the live thinking level, unlike the change
            # record which sits at the head of the file, outside the tail we read
            out['thinking'] = rec.get('thinkingLevel') or out['thinking']
        m = rec.get('message')
        if not isinstance(m, dict):
            continue
        role = m.get('role')
        content = m.get('content')
        if role == 'user':
            s = text_of(content)
            if s and not s.startswith('<'):
                out['last_user_ts'] = rec.get('timestamp')
                out['last_user_text'] = s
        elif role == 'toolResult':
            cid = m.get('toolCallId')
            if cid:
                finished.add(cid)
        elif role == 'assistant':
            if isinstance(content, list):
                for part in content:
                    if not isinstance(part, dict) or part.get('type') != 'toolCall':
                        continue
                    name = part.get('name') or 'tool'
                    args = part.get('arguments') or part.get('input') or {}
                    cid = part.get('toolCallId') or part.get('id')
                    if cid:
                        calls[cid] = (name, args)
                    out['doing'] = short_args(name, args)
            s = text_of(content)
            if s.strip():
                out['last_assistant'] = s.strip()
    for cid, (name, args) in calls.items():
        if name == 'subagent':
            if cid in finished:
                out['subs_finished'] += 1
            else:
                brief = ''
                if isinstance(args, dict):
                    brief = str(args.get('task') or args.get('prompt') or args.get('name') or '')
                brief = ' '.join(brief.split())
                out['subs'].append(short_args('subagent', args) if brief else 'subagent')
    return out


def other_session_activity(newest_path, now, window=ACTIVE_WINDOW):
    """last tool call in any other session file that is still warm"""
    lines = []
    for f in sorted(glob.glob(os.path.join(SESS, '*', '*.jsonl')),
                    key=os.path.getmtime, reverse=True):
        if f == newest_path or now - os.path.getmtime(f) > window:
            continue
        d = digest(f)
        if d.get('doing'):
            lines.append(d['doing'])
        if len(lines) >= 2:
            break
    return lines


def tasks_running():
    try:
        d = json.load(open(TASKS))
    except Exception:
        return 0
    items = d if isinstance(d, list) else d.get('tasks', [])
    n = 0
    for t in items:
        runs = t.get('runs') or []
        if runs and isinstance(runs[-1], dict) and runs[-1].get('status') in ('running', 'queued'):
            n += 1
    return n


def main():
    files = glob.glob(os.path.join(SESS, '*', '*.jsonl'))
    now = time.time()
    recent = sorted(((os.path.getmtime(f), f) for f in files), reverse=True)[:6]
    active = [(m, f) for m, f in recent if now - m < ACTIVE_WINDOW]
    top = recent[0] if recent else (0, None)
    d = digest(top[1]) if top[1] else {}

    status = 'ACTIVE' if active else ('IDLE' if recent else 'NO SESSIONS')
    since = 'n/a'
    back_text, back_ts = last_user_message(top[1]) if top[1] else (None, None)
    ts = back_ts or d.get('last_user_ts')
    if ts:
        try:
            t = time.strptime(ts.replace('Z', '').split('.')[0], '%Y-%m-%dT%H:%M:%S')
            since = human(now - (time.mktime(t) - time.timezone))
        except Exception:
            pass

    # sub-agents only: in-flight subagent calls in this session
    subs = list(d.get('subs', []))
    others = other_session_activity(top[1] if top[1] else None, now)
    queued = tasks_running()

    main_doing = d.get('doing') or (d.get('last_assistant', '')[:64] or 'idle')
    last_prompt = ' '.join(str(back_text or d.get('last_user_text') or '').split()) or 'n/a'

    try:
        with open(os.path.join(HOME, 'wallpaper-lab/pet/species.txt')) as fh:
            pet_species = fh.read().strip() or 'porcupine'
    except Exception:
        pet_species = 'porcupine'
    rows = [
        ('PET', pet_species),
        ('STATUS', status + (f'  ({since.replace(" ago", "")})' if since != 'n/a' else '')),
        ('MODEL', d.get('model') or 'unknown'),
        ('PROVIDER', d.get('provider') or 'unknown'),
        ('MODE', interaction_mode()),
        ('THINKING', str(d.get('thinking') or 'default').upper()),
        ('SUBAGENTS', f'{len(subs)} working' + (f', {queued} task(s)' if queued else '')
                     + f', {len(active)} session(s)'),
    ]
    for s_line in subs[:2]:
        rows.append(('  -', s_line))
    rows += [
        ('LAST PROMPT', last_prompt),
        ('MAIN', main_doing),
    ]
    for label, value in rows:
        print(f'{label}|{redact(str(value))}')


if __name__ == '__main__':
    main()
