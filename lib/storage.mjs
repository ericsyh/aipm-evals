import { mkdir, readFile, appendFile,writeFile,rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve, join } from 'node:path';

export class FileStorage {
  constructor(dir = './data') { this.dir = resolve(dir); this.file = join(this.dir, 'events.jsonl'); this.queue = Promise.resolve(); }
  async list() {
    try { return (await readFile(this.file, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line)); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  }
  async append(events) {
    const write = this.queue.then(async () => {
      await mkdir(this.dir, { recursive: true });
      const seen = new Set((await this.list()).map(e => e.id));
      const fresh = events.filter(e => { if (seen.has(e.id)) return false; seen.add(e.id); return true; });
      if (fresh.length) await appendFile(this.file, fresh.map(e => JSON.stringify(e)).join('\n') + '\n');
      return fresh.length;
    });
    this.queue = write.catch(() => {});
    return write;
  }
  async info() { return { driver: 'file', ready: true, label: 'Local JSONL', detail: 'Local event storage is ready' }; }
  async deleteMember(memberId){const operation=this.queue.then(async()=>{const events=await this.list(),keep=events.filter(e=>e.memberId!==memberId);await mkdir(this.dir,{recursive:true});const temp=`${this.file}.${randomUUID()}.tmp`;await writeFile(temp,keep.length?keep.map(e=>JSON.stringify(e)).join('\n')+'\n':'');await rename(temp,this.file);return events.length-keep.length;});this.queue=operation.catch(()=>{});return operation;}
}

export class ElasticsearchStorage {
  constructor({ url, index = 'aipm-events', apiKey = '', fetchImpl = fetch }) {
    this.url = new URL(url);
    if (!['http:', 'https:'].includes(this.url.protocol) || this.url.username || this.url.password) throw new Error('ES_URL must be an HTTP(S) URL without embedded credentials');
    if (!/^[a-z0-9][a-z0-9_-]{0,100}$/.test(index)) throw new Error('Invalid ES_INDEX format');
    this.index = index; this.apiKey = apiKey; this.fetch = fetchImpl;
  }
  async request(path, options = {}) {
    const res = await this.fetch(new URL(path, this.url), { ...options, headers: {
      'Content-Type': 'application/json', ...(this.apiKey ? { Authorization: `ApiKey ${this.apiKey}` } : {}), ...options.headers,
    }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) { const error = new Error(`Elasticsearch returned HTTP ${res.status}`); error.status = res.status; throw error; }
    return res.json();
  }
  async ensureIndex() {
    if (!this.initialized) {
      this.initialized = this.request(`/${this.index}`, { method: 'PUT', body: JSON.stringify({ mappings: { dynamic: 'strict', properties: {
        id: { type: 'keyword' }, sessionId: { type: 'keyword' }, memberId: { type: 'keyword' }, source: { type: 'keyword' },
        action: { type: 'keyword' }, task: { type: 'keyword' }, timestamp: { type: 'date' },
        title: { type: 'text' }, evidence: { type: 'text' }, origin: { type: 'keyword' },
        taskMethod: { type:'keyword' }, actionMethod: { type:'keyword' }, observationId: { type:'keyword' }, recognitionVersion: { type:'keyword' },
      } } }) }).catch(async error => {
        if (error.status !== 400) { this.initialized = undefined; throw error; }
        // A 400 is only acceptable if the index really exists and is accessible.
        await this.request(`/${this.index}`);
        return this.request(`/${this.index}/_mapping`,{method:'PUT',body:JSON.stringify({properties:{taskMethod:{type:'keyword'},actionMethod:{type:'keyword'},observationId:{type:'keyword'},recognitionVersion:{type:'keyword'}}})});
      });
    }
    await this.initialized;
  }
  async append(events) {
    await this.ensureIndex();
    const body = events.map(e => JSON.stringify({ create: { _index: this.index, _id: e.id } }) + '\n' + JSON.stringify(e)).join('\n') + '\n';
    const result = await this.request('/_bulk?refresh=wait_for', { method: 'POST', headers: { 'Content-Type': 'application/x-ndjson' }, body });
    const errors = result.items.filter(item => ![201, 409].includes(item.create.status));
    if (errors.length) throw new Error(`Elasticsearch write failed for ${errors.length} events. Retry with stable IDs to preserve successful writes`);
    return result.items.filter(item => item.create.status === 201).length;
  }
  async list() {
    await this.ensureIndex();
    const events = [];
    // Scroll avoids the default 10,000-result limit and gives a consistent snapshot.
    let result = await this.request(`/${this.index}/_search?scroll=1m`, { method: 'POST', body: JSON.stringify({ size: 1000, sort: ['_doc'], query: { match_all: {} } }) });
    let scrollId = result._scroll_id;
    try {
      while (result.hits.hits.length) {
        events.push(...result.hits.hits.map(hit => hit._source));
        result = await this.request('/_search/scroll', { method: 'POST', body: JSON.stringify({ scroll: '1m', scroll_id: scrollId }) });
        scrollId = result._scroll_id ?? scrollId;
      }
    } finally {
      if (scrollId) await this.request('/_search/scroll', { method: 'DELETE', body: JSON.stringify({ scroll_id: [scrollId] }) }).catch(() => {});
    }
    return events;
  }
  async info() {
    try { await this.request('/'); return { driver: 'elasticsearch', ready: true, label: 'Elasticsearch', detail: `Index ${this.index} · Connected` }; }
    catch { return { driver: 'elasticsearch', ready: false, label: 'Elasticsearch', detail: 'Connection failed. Check the server configuration' }; }
  }
  async deleteMember(memberId){await this.ensureIndex();const result=await this.request(`/${this.index}/_delete_by_query?refresh=true`,{method:'POST',body:JSON.stringify({query:{term:{memberId}}})});if(result.failures?.length||result.timed_out)throw new Error('Elasticsearch deletion incomplete');return result.deleted;}
}

export function createStorage(env = process.env) {
  const driver = env.STORAGE_DRIVER || 'file';
  if (driver === 'file') return new FileStorage(env.DATA_DIR);
  if (driver === 'elasticsearch') {
    if (!env.ES_URL) throw new Error('Elasticsearch storage requires ES_URL');
    return new ElasticsearchStorage({ url: env.ES_URL, index: env.ES_INDEX, apiKey: env.ES_API_KEY });
  }
  throw new Error(`Unsupported STORAGE_DRIVER: ${driver}`);
}
