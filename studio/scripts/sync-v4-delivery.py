"""Sync the authorized V4 source and delivery mirror; never visits source-v1-backup."""
from pathlib import Path
import os,shutil,hashlib,json,re
S=Path(__file__).resolve().parents[1];SOURCE=S.parent
assert SOURCE.name=='source' and SOURCE.parent.name=='.polyphony-work','Run from the main production source'
ROOT=SOURCE.parent.parent;M=ROOT/'.polyphony-work/github-publish-20261124/polyphony';OUT=S/'artifacts/sprint4b-qa'
assert M.resolve().is_relative_to(ROOT.resolve()) and M.name=='polyphony'
OUT.mkdir(parents=True,exist_ok=True)
OLD=['01-C语言指针与线性代数空间精讲.pptx','02-光电调制与探测链路精选.pptx','03-人工智能与工程伦理导论研讨.pptx']
screens=sorted(ROOT.glob('0[1-7]-*.png'));assert len(screens)==7
root_files=[ROOT/n for n in ['README.md','启动V4共演.cmd','共演智课-离线平台.html','共演智课-单文件离线演示版.html','共演智课-系统架构与Harness协议.pdf']]+screens
for path in root_files:assert path.exists();shutil.copy2(path,SOURCE/path.name)
native=SOURCE/'示例课件/V4原生实战课件'
if native.is_file():
 assert native.read_bytes() in [p.read_bytes() for p in (ROOT/'示例课件/V4原生实战课件').glob('*.json')],'Unexpected file at native-deck directory'
 native.unlink()
native.mkdir(parents=True,exist_ok=True)
for path in (ROOT/'示例课件/V4原生实战课件').glob('*.json'):shutil.copy2(path,native/path.name)
for target in [SOURCE,M]:
 for path in target.glob('0[1-7]-*.png'):
  if path.name not in {s.name for s in screens}:path.unlink()
 for name in OLD:
  p=target/'示例课件'/name
  if p.exists():p.unlink()
 for name in ['共演智课-V4-Phase1交付包.zip','共演智课-V4原生互动课堂.html','共演智课-交互模组库独立版.html']:
  p=target/name
  if p.exists():p.unlink()
 for name in ['acceptance.json','browser.log','delivery.md','editor.png','focused.log','home.png','test-initial.log','test.log']:
  (target/'studio'/f'sprint1-{name}').unlink(missing_ok=True)
exclude={'node_modules','artifacts','__pycache__','.git','.cache','.pytest_cache','.openai','source-v1-backup'}
runtime_suffixes=(
 '.db','.db-journal','.db-shm','.db-wal','.lectures','.log','.pyc','.pyo',
 '.sqlite','.sqlite-journal','.sqlite-shm','.sqlite-wal',
 '.sqlite3','.sqlite3-journal','.sqlite3-shm','.sqlite3-wal','.tap','.tmp',
)
def excluded(name):
 name=name.lower()
 if name == '.env.example':return False
 return name in exclude or name.startswith(('.env','.polyphony-rooms','backup-')) or name.endswith(runtime_suffixes)

manifest={}
for folder,dirs,files in os.walk(SOURCE):
 dirs[:]=[d for d in dirs if not excluded(d)]
 for name in files:
  if excluded(name):continue
  p=Path(folder)/name;rel=p.relative_to(SOURCE);dest=M/rel;assert dest.resolve().is_relative_to(M.resolve());dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,dest)
  digest=hashlib.sha256(p.read_bytes()).hexdigest();assert hashlib.sha256(dest.read_bytes()).hexdigest()==digest;manifest[rel.as_posix()]=digest
# An audit records the actual copied byte identities, without modifying .git.
report={'source':str(SOURCE),'mirror':str(M),'filesVerified':len(manifest),'excluded':sorted(exclude),'sourceV1BackupTouched':False,'sha256':manifest}
(OUT/'sync-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps({k:v for k,v in report.items() if k!='sha256'},ensure_ascii=False))
