#!/usr/bin/env node
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { validateEvent } from '../lib/model.mjs';
import { validateObservation } from '../lib/recognition.mjs';

const args = process.argv.slice(2);
function option(name, fallback) { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; }
if (args.includes('--help')) {
  console.log('Usage: node collector/collect.mjs --source codex --member pm-01 [--file records.jsonl] [--observations]\nDefault: labeled events. --observations: unlabeled observations sent for automatic recognition. Set INGEST_TOKEN for authentication.');
  process.exit(0);
}
const observations=args.includes('--observations');
const endpoint = option('--endpoint', process.env.COLLECTOR_ENDPOINT || `http://127.0.0.1:4310/api/${observations?'observations':'events'}`);
const source = option('--source', 'codex');
const memberId = option('--member', 'local-pm');
const file = option('--file');
const lines = createInterface({ input: file ? createReadStream(file) : process.stdin, crlfDelay: Infinity });
let batch = []; let accepted = 0; let duplicates = 0; let paused=0; let lineNumber = 0;
async function flush() {
  if (!batch.length) return;
  const payload = JSON.stringify(observations?{observations:batch}:{events:batch});
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(process.env.INGEST_TOKEN ? { Authorization: `Bearer ${process.env.INGEST_TOKEN}` } : {}) }, body: payload, signal: AbortSignal.timeout(10000) });
      const result = await res.json();
      if (!res.ok) { const error = new Error(result.error || `HTTP ${res.status}`); error.permanent = res.status < 500; throw error; }
      accepted += result.accepted; duplicates += result.duplicates;paused+=result.paused||0; batch = []; return;
    } catch (error) {
      lastError = error;
      if (error.permanent) break;
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 250 * 2 ** attempt));
    }
  }
  throw lastError;
}
try {
  for await (const line of lines) {
    lineNumber++;
    if (!line.trim()) continue;
    const input = JSON.parse(line);
    batch.push((observations?validateObservation:validateEvent)({ ...input, id: input.id || randomUUID(), source: input.source || source, memberId: input.memberId || memberId, timestamp: input.timestamp || new Date().toISOString() }));
    if (batch.length >= 100) await flush();
  }
  await flush();
  console.log(`Collection complete: stored ${accepted} events; skipped ${duplicates} duplicates.${paused?` Telemetry disabled: ${paused} records were not stored.`:''}`);
} catch (error) {
  console.error(`Collection failed near line ${lineNumber}: ${error.message}. Keep the source JSONL, fix the error and retry with stable event IDs.`);
  process.exitCode = 1;
}
