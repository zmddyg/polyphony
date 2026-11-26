"""Build or verify the competition ZIP from existing materials and studio source."""

import argparse
from hashlib import sha256
import json
import os
from pathlib import Path
import tempfile
from zipfile import ZIP_DEFLATED, ZipFile


STUDIO = Path(__file__).resolve().parents[1]
SOURCE = STUDIO.parent
DELIVERY = SOURCE.parents[1] if SOURCE.name == 'source' and SOURCE.parent.name == '.polyphony-work' else SOURCE
ARCHIVE_NAME = '共演智课-AI教学大赛交付包.zip'
STUDIO_PREFIX = 'polyphony-studio'
MATERIALS = (
    'README.md',
    '启动V4共演.cmd',
    '共演智课-参赛作品介绍文档.pdf',
    '共演智课-决赛现场演示PPT.pptx',
    '共演智课-系统架构与Harness协议.pdf',
    '共演智课-单文件离线演示版.html',
    '共演智课-交互模组库独立版.html',
)
STUDIO_FILES = {'.dockerignore', 'Dockerfile', 'package.json', 'README.md'}
STUDIO_FOLDERS = ('dist', 'scripts', 'tests', 'tools')
EXCLUDED_NAMES = {'.cache', '.git', '.openai', '.pytest_cache', '__pycache__', 'artifacts', 'node_modules'}
EXCLUDED_SUFFIXES = (
    '.db', '.db-journal', '.db-shm', '.db-wal', '.lectures', '.log', '.pyc', '.pyo',
    '.sqlite', '.sqlite-journal', '.sqlite-shm', '.sqlite-wal',
    '.sqlite3', '.sqlite3-journal', '.sqlite3-shm', '.sqlite3-wal', '.tap', '.tmp',
)


def excluded(name):
    name = name.lower()
    return (
        name in EXCLUDED_NAMES
        or name.startswith(('.env', '.polyphony-rooms'))
        or name.endswith(EXCLUDED_SUFFIXES)
    )


def add_entry(entries, member, path, base):
    if not path.is_file() or not path.resolve().is_relative_to(base):
        raise ValueError(f'Missing or external release file: {path}')
    if member in entries:
        raise ValueError(f'Duplicate release file: {member}')
    entries[member] = path


def release_entries(delivery):
    entries = {}
    for name in MATERIALS:
        add_entry(entries, name, delivery / name, delivery)
    for number in range(1, 8):
        screenshots = sorted(delivery.glob(f'{number:02}-*.png'))
        if len(screenshots) != 1:
            raise ValueError(f'Expected one screenshot numbered {number:02} in {delivery}')
        add_entry(entries, screenshots[0].name, screenshots[0], delivery)

    examples = delivery / '示例课件'
    for pattern, count in (('*-*.pptx', 3), ('*-*.pdf', 1), ('V4原生实战课件/deck-*.json', 6)):
        samples = sorted(examples.glob(pattern))
        if len(samples) != count:
            raise ValueError(f'Expected {count} sample files matching {pattern} in {examples}')
        for path in samples:
            add_entry(entries, path.relative_to(delivery).as_posix(), path, delivery)

    for path in STUDIO.iterdir():
        if not excluded(path.name) and (path.suffix in {'.cmd', '.mjs'} or path.name in STUDIO_FILES):
            add_entry(entries, f'{STUDIO_PREFIX}/{path.name}', path, STUDIO)
    for folder in STUDIO_FOLDERS:
        source_dir = STUDIO / folder
        if not source_dir.is_dir() or not source_dir.resolve().is_relative_to(STUDIO):
            raise ValueError(f'Missing or external studio source directory: {source_dir}')
        for directory, dirs, files in os.walk(source_dir):
            dirs[:] = [name for name in dirs if not excluded(name)]
            for name in files:
                if not excluded(name):
                    path = Path(directory) / name
                    add_entry(entries, f'{STUDIO_PREFIX}/{path.relative_to(STUDIO).as_posix()}', path, STUDIO)

    for name in ('server.mjs', '启动共演.cmd', 'dist/index.html', 'dist/app.mjs'):
        if f'{STUDIO_PREFIX}/{name}' not in entries:
            raise ValueError(f'Missing launch file: {name}')
    return entries


def verify_archive(target, entries):
    with ZipFile(target) as archive:
        if sorted(archive.namelist()) != sorted(entries):
            raise ValueError('ZIP members differ from the required release files')
        for member, path in entries.items():
            if archive.read(member) != path.read_bytes():
                raise ValueError(f'ZIP member differs from source: {member}')


def build_archive(target, entries):
    with tempfile.NamedTemporaryFile(dir=target.parent, suffix='.tmp', delete=False) as temp:
        staged = Path(temp.name)
    try:
        with ZipFile(staged, 'w', ZIP_DEFLATED, compresslevel=6) as archive:
            for member, path in sorted(entries.items()):
                archive.write(path, member)
        verify_archive(staged, entries)
        staged.replace(target)
    finally:
        staged.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--delivery-root', type=Path, default=DELIVERY, help='Directory containing the existing competition materials.')
    parser.add_argument('--output', type=Path, help='ZIP path. Defaults to the competition ZIP in the delivery root.')
    parser.add_argument('--verify', action='store_true', help='Verify the existing ZIP without replacing it.')
    args = parser.parse_args()
    delivery = args.delivery_root.resolve()
    target = (args.output or delivery / ARCHIVE_NAME).absolute()
    entries = release_entries(delivery)
    if target.suffix.lower() != '.zip':
        parser.error('--output must be a .zip file')
    if args.verify:
        verify_archive(target, entries)
    else:
        build_archive(target, entries)
    print(json.dumps({
        'file': str(target),
        'entries': len(entries),
        'bytes': target.stat().st_size,
        'sha256': sha256(target.read_bytes()).hexdigest(),
    }, ensure_ascii=False))


if __name__ == '__main__':
    main()
