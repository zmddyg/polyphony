// The single-file rehearsal stores each published lecture once, outside the small synchronized room state.
function openStore() {
  return new Promise((resolve,reject)=>{
    if (!globalThis.indexedDB) return reject(new Error('当前浏览器无法保存讲义，请使用支持 IndexedDB 的浏览器或课堂服务。'));
    const request=indexedDB.open('polyphony-published-lectures-v1',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('lectures');
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
}

export async function publishedLecture(operation, code, score) {
  const db=await openStore();
  try {
    return await new Promise((resolve,reject)=>{
      const transaction=db.transaction('lectures',operation==='get'?'readonly':'readwrite');
      const store=transaction.objectStore('lectures');
      const request=operation==='add'?store.add(score,code):operation==='delete'?store.delete(code):store.get(code);
      transaction.oncomplete=()=>resolve(request.result);
      transaction.onabort=()=>reject(transaction.error ?? new Error('讲义未能保存，浏览器存储空间可能不足。'));
      transaction.onerror=()=>reject(transaction.error ?? request.error);
    });
  } finally {db.close();}
}
