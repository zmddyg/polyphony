"""Audit shipped UI source, including SVG labels, without rewriting protocol identifiers.

Usage: python tools/check-ui-terminology.py [--json report.json]
The narrow compatibility exceptions below are never rendered as labels. Everything
else, including comments and CSS selectors, is checked case-insensitively.
"""
from pathlib import Path
import argparse
import json
import re
import sys

PERMITTED = ['Harness', 'Agent', 'Chat Completions', 'OpenAI']

FORBIDDEN = [
    '课谱', '总谱', '排练', 'Playlab', 'Polyphony Studio', 'ScorePackage',
    'TypeSafe', 'Jev', '史料', '夜校', '数字黑箱', '城市里哪里更凉快',
    '光电探究台', '确定性物理数值引擎 (核心防线)',
]

# Public exports, environment settings, endpoint and provider metadata are contracts.
# Each exception is restricted to its original module and exact lexical context.
INTERNAL = {
    'dist/views/material-workspace.mjs': [r'\bjev(?=:)', r"(?<=')jev(?=')"],
    'lecture-quick-provider.mjs': [
        r'\bisJevConfigured\b', r'\bplanLectureWithJev\b',
        r'\bPOLYPHONY_JEV_(?:KEY|MODEL)\b',
        r'https://api\.typesafe\.ai/v1/systemone', r"(?<=')jev-latest(?=')", r"(?<=')jev(?=')",
    ],
    'server.mjs': [r'\bisJevConfigured\b', r'\bplanLectureWithJev\b', r"(?<=')jev(?=')"],
}

def audit(root):
    files = sorted(p for p in (root / 'dist').rglob('*')
                   if p.is_file() and p.suffix in {'.mjs', '.html', '.css', '.svg'} and 'tests' not in p.parts)
    files += sorted(root.glob('*.mjs'))
    counts = dict.fromkeys(FORBIDDEN, 0)
    hits, exceptions = [], []
    chinese_strings = 0
    for path in files:
        name = path.relative_to(root).as_posix()
        source = path.read_text(encoding='utf-8-sig')
        chinese_strings += len(re.findall(r"(['\"`])[^'\"`\n]*[\u3400-\u9fff][^'\"`\n]*\1", source))
        for number, line in enumerate(source.splitlines(), 1):
            checked = line
            for pattern in INTERNAL.get(name, []):
                checked, n = re.subn(pattern, '', checked)
                if n:
                    exceptions.append({'file': name, 'line': number, 'matches': n, 'kind': 'non-rendered compatibility identifier'})
            for term in FORBIDDEN:
                n = len(re.findall(re.escape(term), checked, re.IGNORECASE))
                counts[term] += n
                if n:
                    hits.append({'file': name, 'line': number, 'term': term, 'text': line.strip()})
    return {'files_scanned': len(files), 'chinese_string_fragments': chinese_strings,
            'visible_hits': sum(counts.values()), 'counts': counts, 'hits': hits,
            'compatibility_exceptions': exceptions}

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--json', type=Path)
    options = parser.parse_args()
    result = audit(Path(__file__).resolve().parents[1])
    if options.json:
        options.json.parent.mkdir(parents=True, exist_ok=True)
        options.json.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    sys.stdout.reconfigure(encoding='utf-8')
    print(json.dumps({key: result[key] for key in ['files_scanned', 'chinese_string_fragments', 'visible_hits', 'counts', 'hits']}, ensure_ascii=False, indent=2))
    raise SystemExit(bool(result['visible_hits']))
