"""Unzip the actual delivery, verify hashes, and exercise its server and offline entry."""
from pathlib import Path
import json,zipfile,hashlib,tempfile,subprocess,os,socket,time,http.cookiejar,urllib.request
ROOT=Path(__file__).resolve().parents[1];DELIVERY=ROOT.parents[2]
archive_path=DELIVERY/'共演智课-V4-Phase1交付包.zip'
folder=Path(tempfile.mkdtemp(prefix='v4-release-',dir=ROOT/'artifacts'))
with zipfile.ZipFile(archive_path) as archive:
    manifest=json.loads(archive.read('SHA256.json'))
    assert all(hashlib.sha256(archive.read(name)).hexdigest()==digest for name,digest in manifest.items())
    assert not any('..' in Path(name).parts or Path(name).is_absolute() or '.polyphony-rooms' in name for name in archive.namelist())
    archive.extractall(folder)
with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
env={k:v for k,v in os.environ.items() if not k.startswith('POLYPHONY_AI_')}
env.pop('POLYPHONY_PUBLIC_ORIGIN',None)
env.update(HOST='127.0.0.1',PORT=str(port),POLYPHONY_ROOM_FILE=str(folder/'test-rooms.json'))
report={'entryHashesVerified':len(manifest),'serverStarted':False,'nativePages':0,'offlineVerified':False,'serverStopped':False}
with (folder/'server.log').open('w',encoding='utf-8') as log:
    server=subprocess.Popen(['node','server.mjs'],cwd=folder/'studio',env=env,stdout=log,stderr=subprocess.STDOUT,creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
    try:
        for _ in range(100):
            with socket.socket() as sock:
                if sock.connect_ex(('127.0.0.1',port))==0:break
            if server.poll() is not None:raise RuntimeError('Extracted server exited')
            time.sleep(.1)
        opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        def api(path,data=None):
            request=urllib.request.Request(f'http://127.0.0.1:{port}'+path,data=json.dumps(data).encode() if data is not None else None,headers={'Content-Type':'application/json'})
            with opener.open(request,timeout=30) as response:return json.load(response)
        assert api('/api/status')['polyphony'];report['serverStarted']=True
        base=api('/api/rooms',{'demo':False})['room']['code']
        result=api('/api/rooms/'+base+'/author-deck',{'spec':{'course':'物理光学','topic':'夫琅禾费衍射与干涉','pageCount':8}})
        assert result['source']=='local' and len(result['lectureScore']['pages'])==8
        assert all(s['status']=='complete' for s in result['harnessReceipt']['stages'])
        room=api('/api/rooms',{'lecture':result['lectureScore']})['room']
        assert api('/api/rooms/'+room['code']+'/frame?index=0')['blocks'];report['nativePages']=8
    finally:
        server.terminate()
        try:server.wait(timeout=8)
        except subprocess.TimeoutExpired:server.kill();server.wait()
        report['serverStopped']=server.poll() is not None
subprocess.run(['python','tools/verify-v4-offline.py'],cwd=folder/'studio',check=True,timeout=45)
report['offlineVerified']=True
(ROOT/'artifacts/v4-release-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False))
