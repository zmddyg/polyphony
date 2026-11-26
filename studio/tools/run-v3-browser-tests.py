"""Own the actual Node PID on Windows; never launch the server through a shell."""
from pathlib import Path
import os,socket,subprocess,sys,time
ROOT=Path(__file__).resolve().parents[1]
(ROOT/'artifacts').mkdir(parents=True,exist_ok=True)
port=4188
def listening():
    with socket.socket() as s:
        s.settimeout(.2)
        return s.connect_ex(('127.0.0.1',port))==0
if listening():raise SystemExit('Port 4188 is already in use; refusing to use or stop an unrelated server.')
env=os.environ.copy()
for key in ['POLYPHONY_AI_KEY','POLYPHONY_AI_BASE_URL','POLYPHONY_AI_MODEL']:env.pop(key,None)
env.update(HOST='127.0.0.1',PORT=str(port),POLYPHONY_ROOM_FILE=str(ROOT/'artifacts'/'v3-validation-runtime.json'))
with (ROOT/'artifacts'/'v3-validation-server.log').open('w',encoding='utf-8') as log:
    server=subprocess.Popen(['node',str(ROOT/'server.mjs')],cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT,creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
    try:
        deadline=time.monotonic()+15
        while not listening():
            if server.poll() is not None or time.monotonic()>deadline:raise RuntimeError('Test server failed to start')
            time.sleep(.1)
        print(f'Started isolated Node test server PID {server.pid}',flush=True)
        result=subprocess.run([sys.executable,*sys.argv[1:]],cwd=ROOT)
    finally:
        server.terminate()
        try:server.wait(timeout=8)
        except subprocess.TimeoutExpired:server.kill();server.wait(timeout=5)
        print(f'Stopped Node test server PID {server.pid}; listening={listening()}',flush=True)
if listening():raise RuntimeError('Test port remains occupied')
raise SystemExit(result.returncode)
