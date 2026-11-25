import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileStorage, ElasticsearchStorage, createStorage } from '../lib/storage.mjs';

test('local storage persists and deduplicates concurrent batches and repeated IDs within a batch', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'pm-signal-test-')); t.after(()=>rm(dir,{recursive:true,force:true}));
  const storage = new FileStorage(dir);
  assert.deepEqual(await storage.list(), []);
  const counts = await Promise.all([storage.append([{id:'a'},{id:'a'}]),storage.append([{id:'a'},{id:'b'}])]);
  assert.equal(counts.reduce((a,b)=>a+b),2);
  assert.deepEqual((await new FileStorage(dir).list()).map(e=>e.id),['a','b']);
});
test('ES bulk uses create IDs, NDJSON and server-only authentication, allows duplicate conflicts', async () => {
  const calls=[];
  const storage = new ElasticsearchStorage({url:'http://localhost:9200',apiKey:'secret',fetchImpl:async(url,options)=>{
    calls.push({url:String(url),...options});
    return new Response(JSON.stringify(calls.length===1?{acknowledged:true}:{items:[{create:{status:201}},{create:{status:409}}]}));
  }});
  assert.equal(await storage.append([{id:'a'},{id:'b'}]),1);
  assert.equal(calls[0].method,'PUT');
  const mapping=JSON.parse(calls[0].body).mappings;
  assert.equal(mapping.dynamic,'strict'); assert.equal(mapping.properties.timestamp.type,'date');
  assert.equal(calls[1].headers.Authorization,'ApiKey secret');
  assert.equal(calls[1].headers['Content-Type'],'application/x-ndjson');
  assert.ok(calls[1].body.endsWith('\n'));
  assert.equal(JSON.parse(calls[1].body.split('\n')[0]).create._id,'a');
});
test('ES surfaces partial write failures', async () => {
  let count=0;
  const storage=new ElasticsearchStorage({url:'http://localhost:9200',fetchImpl:async()=>new Response(JSON.stringify(++count===1?{}:{items:[{create:{status:500}}]}))});
  await assert.rejects(storage.append([{id:'a'}]),/write failed/);
});
test('ES scroll reads all pages and releases the cursor', async () => {
  const calls=[];
  const storage=new ElasticsearchStorage({url:'http://localhost:9200',fetchImpl:async(url,options)=>{
    calls.push({url:String(url),...options});
    if(options.method==='PUT'||options.method==='DELETE')return new Response('{}');
    const docs=calls.length===2?[{_source:{id:'a'}}]:calls.length===3?[{_source:{id:'b'}}]:[];
    return new Response(JSON.stringify({_scroll_id:'cursor',hits:{hits:docs}}));
  }});
  assert.deepEqual(await storage.list(),[{id:'a'},{id:'b'}]);
  assert.equal(calls.at(-1).method,'DELETE');
});
test('invalid storage configuration fails explicitly', () => {
  assert.throws(()=>createStorage({STORAGE_DRIVER:'other'}));
  assert.throws(()=>createStorage({STORAGE_DRIVER:'elasticsearch'}));
  assert.throws(()=>new ElasticsearchStorage({url:'http://user:secret@localhost'}));
  assert.throws(()=>new ElasticsearchStorage({url:'http://localhost',index:'../bad'}));
});
test('existing ES indexes receive additive recognition metadata mappings before writes',async()=>{
  const calls=[];
  const storage=new ElasticsearchStorage({url:'http://localhost:9200',fetchImpl:async(url,options)=>{
    calls.push({url:String(url),...options});
    if(calls.length===1)return new Response('{}',{status:400});
    if(String(url).includes('/_bulk'))return new Response(JSON.stringify({items:[{create:{status:201}}]}));
    return new Response('{}');
  }});
  assert.equal(await storage.append([{id:'recognized',recognitionVersion:'v1'}]),1);
  const mapping=calls.find(c=>c.url.endsWith('/_mapping'));assert.equal(mapping.method,'PUT');
  assert.equal(JSON.parse(mapping.body).properties.recognitionVersion.type,'keyword');
});
test('ES personal deletion uses an exact member query and checks failure results',async()=>{
  const calls=[];const storage=new ElasticsearchStorage({url:'http://localhost:9200',fetchImpl:async(url,options)=>{calls.push({url:String(url),...options});return new Response(JSON.stringify(String(url).includes('_delete_by_query')?{deleted:3,failures:[]}:{}));}});
  assert.equal(await storage.deleteMember('pm-01'),3);const call=calls.find(c=>c.url.includes('_delete_by_query'));assert.deepEqual(JSON.parse(call.body).query,{term:{memberId:'pm-01'}});
});
