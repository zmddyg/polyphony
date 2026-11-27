"""Independently check the Sprint 3B delivery and the published file mirror."""

from hashlib import sha256
import json
from pathlib import Path
import re
from zipfile import ZipFile

from PIL import Image
from pptx import Presentation
import pymupdf


STUDIO = Path(__file__).resolve().parents[1]
SOURCE = STUDIO.parent
ROOT = SOURCE.parents[1]
MIRROR = SOURCE.parent / 'github-publish-20261124/polyphony'
QA = STUDIO / 'artifacts/sprint3b-qa'
CAPTURE = STUDIO / 'artifacts/v4-phase2/browser-report.json'
BUNDLES = {'共演智课-离线平台.html', '共演智课-单文件离线演示版.html'}
ARCHITECTURE = '共演智课-系统架构与Harness协议.pdf'
INTRO = ROOT / '共演智课-参赛作品介绍文档.pdf'
PITCH = ROOT / '共演智课-决赛现场演示PPT.pptx'
ARCHIVE = ROOT / '共演智课-AI教学大赛交付包.zip'
EXAMPLES = Path('示例课件')
NATIVE = EXAMPLES / 'V4原生实战课件'


def digest(path):
    return sha256(path.read_bytes()).hexdigest()


def mirrored(relative):
    hashes = {digest(folder / relative) for folder in (ROOT, SOURCE, MIRROR)}
    assert len(hashes) == 1, relative
    return hashes.pop()


def tests_receipt():
    log = (QA / 'commands/01-npm-test.log').read_bytes()
    text = log.decode('utf-16' if log.startswith((b'\xff\xfe', b'\xfe\xff')) else 'utf-8-sig')
    counts = {}
    for name in ('tests', 'pass', 'fail', 'skipped', 'cancelled'):
        counts[name] = int(re.findall(rf'\b{name} (\d+)\s*$', text, re.MULTILINE)[-1])
    assert counts['pass'] == counts['tests'] and counts['fail'] == counts['skipped'] == counts['cancelled'] == 0
    return counts


def examples_receipt():
    examples = []
    slides = sorted((ROOT / EXAMPLES).glob('*.pptx'))
    assert len(slides) == 3
    for path, count in zip(slides, [12, 10, 10]):
        deck = Presentation(path)
        assert len(deck.slides) == count and abs(deck.slide_width / deck.slide_height - 16 / 9) < .0001
        assert all(slide.shapes.title and slide.shapes.title.text for slide in deck.slides)
        examples.append({'file': path.name, 'pages': count, 'sha256': mirrored(EXAMPLES / path.name)})
    legacy = next((ROOT / EXAMPLES).glob('04-*.pdf'))
    with pymupdf.open(legacy) as pdf:
        assert len(pdf) == 8 and all(abs(page.rect.width / page.rect.height - 16 / 9) < .0001 for page in pdf)
    examples.append({'file': legacy.name, 'pages': 8, 'sha256': mirrored(EXAMPLES / legacy.name)})
    json_files = sorted((ROOT / NATIVE).glob('deck-*.json'))
    assert len(json_files) == 6
    for path in json_files:
        examples.append({'file': path.name, 'sha256': mirrored(NATIVE / path.name)})
    return examples


def main():
    assert SOURCE.name == 'source' and SOURCE.parent.name == '.polyphony-work'
    browser = json.loads(CAPTURE.read_text(encoding='utf-8'))
    assert not any(browser[key] for key in ('consoleErrors', 'pageErrors', 'offlineRequests'))
    assert {item['bundle'] for item in browser['checks'] if 'bundle' in item} == BUNDLES
    assert len(browser['screenshots']) == len(browser['geometry']) == 7
    assert all(g['viewport'] == [1920, 1080] and g['dpr'] == 2 and g['clipped'] == [] for g in browser['geometry'])
    shots = []
    for item in browser['screenshots']:
        name = item['name']
        with Image.open(ROOT / name) as image:
            assert image.size == (3840, 2160)
        shots.append({'file': name, 'pixels': [3840, 2160], 'dpr': 2, 'sha256': mirrored(name)})
    for name in BUNDLES | {ARCHITECTURE, 'README.md'}:
        mirrored(name)
    for folder in (ROOT, SOURCE, MIRROR):
        assert not (folder / '共演智课-交互模组库独立版.html').exists()
        assert len(list(folder.glob('0[1-7]-*.png'))) == 7
    with pymupdf.open(ROOT / ARCHITECTURE) as pdf:
        assert len(pdf) == 2 and all(abs(page.rect.width - 595.28) < 1 and abs(page.rect.height - 841.89) < 1 for page in pdf)
    with pymupdf.open(INTRO) as pdf:
        assert len(pdf) == 2 and all('\ufffd' not in page.get_text() for page in pdf)
    assert len(Presentation(PITCH).slides) == 13
    with ZipFile(ARCHIVE) as package:
        assert package.testzip() is None
        members = package.namelist()
        assert all(f'比赛演示/系统截图/{shot["file"]}' in members for shot in shots)
        assert all(f'polyphony-studio/{name}' in members for name in ('AGENT.md', 'media-search.mjs', 'demo/entry.mjs'))
    sync = json.loads((QA / 'sync-report.json').read_text(encoding='utf-8'))
    for name, value in sync['sha256'].items():
        assert digest(SOURCE / name) == digest(MIRROR / name) == value, name
    assert not any((MIRROR / 'studio' / name).exists() for name in ('artifacts', 'node_modules', '.polyphony-rooms.json.lectures'))
    sample_ids = [path.stem for path in (ROOT / NATIVE).glob('*.json') if not path.name.endswith('.receipt.json')]
    for path in (STUDIO / 'dist').rglob('*'):
        if path.is_file() and path.suffix in {'.mjs', '.js', '.html', '.svg', '.css', '.json'}:
            text = path.read_text(encoding='utf-8-sig')
            assert not any(key in text for key in sample_ids), path
    release = {
        'version': '4.0 / Sprint 3B', 'tests': tests_receipt(), 'examples': examples_receipt(),
        'offline': {'bundles': sorted(BUNDLES), 'consoleErrors': 0, 'pageErrors': 0, 'networkRequests': 0},
        'screenshots': shots, 'filesMirrored': sync['filesVerified'], 'distDemoIdHits': 0,
        'deliverables': [{'file': path.name, 'bytes': path.stat().st_size, 'sha256': digest(path)}
                         for path in (INTRO, PITCH, ARCHIVE)],
    }
    (QA / 'release-report.json').write_text(json.dumps(release, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(release, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
