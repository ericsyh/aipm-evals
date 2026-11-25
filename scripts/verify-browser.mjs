// Optional, dependency-free browser smoke test using a local Chrome installation.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { createServer } from '../server.mjs';
import { FileStorage } from '../lib/storage.mjs';
import { PrivacyStore } from '../lib/privacy.mjs';
import { RuleStore } from '../lib/rules.mjs';

const temp = await mkdtemp(join(tmpdir(), 'pm-signal-browser-'));
const server = createServer({ storage: new FileStorage(join(temp, 'data')), ruleStore:new RuleStore(join(temp,'rules.json')),privacyStore:new PrivacyStore(join(temp,'privacy.json')),memberId:'pm-01',token: '' });
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
const chrome = spawn(process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--disable-background-networking', '--remote-debugging-port=0', `--user-data-dir=${join(temp, 'profile')}`, 'about:blank',
], { stdio: 'ignore' });
let launchError; chrome.on('error', error => { launchError = error; });
let ws;
async function retry(fn, timeout = 15000) {
  const start = Date.now(); let lastError;
  while (Date.now() - start < timeout) {
    if (launchError) throw launchError;
    try { const result = await fn(); if (result) return result; } catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw lastError || new Error('Timed out waiting for browser state');
}
try {
  const [port, path] = (await retry(() => readFile(join(temp, 'profile', 'DevToolsActivePort'), 'utf8'))).trim().split('\n');
  ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
  await once(ws, 'open');
  let id = 0; let sessionId; const pending = new Map(); const errors = [];const postedBodies=[];
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject, timer } = pending.get(message.id); pending.delete(message.id); clearTimeout(timer);
      if (message.error) reject(new Error(message.error.message)); else resolve(message.result);
    }
    if(message.method==='Network.requestWillBeSent'&&message.params.request.postData)postedBodies.push(message.params.request.postData);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') errors.push(message.params.entry.text);
  });
  const rpc = (method, params = {}, attach = true) => new Promise((resolve, reject) => {
    const callId = ++id;
    const timer = setTimeout(() => { pending.delete(callId); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
    pending.set(callId, { resolve, reject, timer });
    ws.send(JSON.stringify({ id: callId, method, params, ...(attach && sessionId ? { sessionId } : {}) }));
  });
  const target = await rpc('Target.createTarget', { url: base }, false);
  sessionId = (await rpc('Target.attachToTarget', { targetId: target.targetId, flatten: true }, false)).sessionId;
  await rpc('Runtime.enable'); await rpc('Page.enable');
  const evaluate = async expression => {
    const result = await rpc('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  const ready=()=>retry(()=>evaluate('Boolean(document.querySelector(".helper-hero"))'));
  const assertEnglish=async()=>{assert.equal(await evaluate('document.documentElement.lang'),'en');assert.equal(await evaluate('document.body.innerText.match(/[\\u3400-\\u9fff]+/g)'),null);assert.ok(await evaluate('!document.querySelector("[data-session], .drawer, .score-panel")'));};
  const size=(width,height)=>rpc('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<500});
  const screenshot=async name=>{await evaluate('document.fonts.ready');await assertEnglish();await evaluate('document.getElementById("toast").style.visibility="hidden"');const result=await rpc('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(resolve('artifacts',name),Buffer.from(result.data,'base64'));};
  const switchView=async view=>{await evaluate(`document.getElementById("view").value=${JSON.stringify(view)};document.getElementById("view").dispatchEvent(new Event("change",{bubbles:true}))`);await retry(()=>evaluate(`Boolean(document.querySelector(${JSON.stringify(view==='personal'?'.helper-hero':'.insights')}))`));};
  await mkdir('artifacts',{recursive:true});await size(1440,1120);await ready();await rpc('Network.enable');
  const preference=await evaluate('fetch("/api/me/preferences").then(r=>r.json())');assert.equal(preference.telemetryEnabled,false);assert.equal(preference.teamSharingEnabled,false);
  assert.equal(await evaluate('Array.from(document.querySelectorAll(".sidebar a")).some(a=>a.getAttribute("href")==="#integrations")'),false);
  await evaluate('location.hash="integrations"');await retry(()=>evaluate('document.querySelector("h1")?.textContent==="My AI workspace."'));assert.equal(await evaluate('Boolean(document.querySelector(".setup-panel"))'),false);
  assert.equal(await evaluate('document.querySelectorAll("[data-kit]").length'),6);await screenshot('personal-workspace.png');
  await evaluate('document.getElementById("helper-brief").value="PRIVATE-BRIEF-DO-NOT-UPLOAD";document.querySelector("[data-action=prepare]").click()');
  await retry(()=>evaluate('Boolean(document.getElementById("prepared-prompt"))'));assert.ok(await evaluate('document.getElementById("prepared-prompt").value.includes("PRIVATE-BRIEF-DO-NOT-UPLOAD")'));
  await evaluate('document.querySelector("[data-action=save-practice]").click()');
  const local=await evaluate('localStorage.getItem("pm-signal-private-practice")');assert.ok(!local.includes('PRIVATE-BRIEF'));assert.equal(JSON.parse(local).length,1);
  assert.equal(await evaluate('document.querySelector("[data-action=complete-workflow-step]").disabled'),true);
  assert.equal(await evaluate('localStorage.getItem("pm-signal-workflow-runs")'),null);
  await evaluate('document.getElementById("workflow-result").value="PRIVATE-RESULT-DO-NOT-UPLOAD";document.getElementById("workflow-result").dispatchEvent(new Event("input",{bubbles:true}))');
  assert.equal(await evaluate('document.querySelector("[data-action=complete-workflow-step]").disabled'),true);
  await evaluate('document.querySelectorAll("[data-run-check]").forEach(el=>{el.checked=true;el.dispatchEvent(new Event("change",{bubbles:true}))});document.querySelector("[data-action=complete-workflow-step]").click()');
  assert.ok(await evaluate('document.getElementById("prepared-prompt").value.includes("PRIVATE-RESULT-DO-NOT-UPLOAD")'));
  await evaluate('document.querySelector("[data-action=edit-workflow-template]").click();document.getElementById("template-title").value="My evidence comparison";document.querySelector("[data-step-instructions]").value="CUSTOM-INSTRUCTIONS-PRIVATE";document.querySelector("[data-action=add-workflow-step]").click()');
  assert.equal(await evaluate('document.querySelectorAll("[data-editor-step]").length'),6);
  await evaluate('document.querySelectorAll("[data-move-step]")[1].click();document.querySelector("[data-action=save-workflow-template]").click()');
  const custom=JSON.parse(await evaluate('localStorage.getItem("pm-signal-workflow-templates")'))[0];assert.equal(custom.version,2);assert.equal(custom.steps[1].instructions,'CUSTOM-INSTRUCTIONS-PRIVATE');
  assert.ok(await evaluate('document.querySelector(".workflow-runner .panel-heading p").innerText.includes("Template v1")'));
  await evaluate('document.getElementById("save-run-confirm").checked=true;document.getElementById("save-run-confirm").dispatchEvent(new Event("change",{bubbles:true}));document.querySelector("[data-action=save-workflow-run]").click()');
  const snapshot=JSON.parse(await evaluate('localStorage.getItem("pm-signal-workflow-runs")'))[0];assert.equal(snapshot.currentStep,1);assert.equal(snapshot.brief,'PRIVATE-BRIEF-DO-NOT-UPLOAD');assert.equal(snapshot.steps[0].output,'PRIVATE-RESULT-DO-NOT-UPLOAD');
  await rpc('Page.reload');await ready();assert.equal(await evaluate('Boolean(document.getElementById("workflow-runner"))'),false);
  await evaluate('document.querySelector("[data-resume-run]").click()');assert.ok(await evaluate('document.getElementById("prepared-prompt").value.includes("PRIVATE-RESULT-DO-NOT-UPLOAD")'));
  await evaluate('document.querySelector("[data-reopen-step]").click()');assert.equal(await evaluate('document.querySelectorAll("[data-run-check]:checked").length'),0);
  await size(390,900);await evaluate('document.getElementById("workflow-runner").scrollIntoView()');await screenshot('workflow-run-mobile.png');assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'));
  await evaluate('document.querySelector("[data-action=edit-workflow-template]").click()');assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'));await screenshot('workflow-editor-mobile.png');
  await size(1440,1120);await evaluate('document.querySelector(".template-editor").scrollIntoView()');await screenshot('workflow-editor.png');await evaluate('document.querySelector("[data-action=cancel-template-edit]").click();document.getElementById("workflow-runner").scrollIntoView()');await screenshot('workflow-run.png');
  const imported={...custom,id:'imported-review',task:'documentation',title:'Imported review',steps:custom.steps.slice(0,1)};
  await evaluate(`(()=>{const input=document.getElementById('import-workflow-template'),files=new DataTransfer();files.items.add(new File([${JSON.stringify(JSON.stringify(imported))}],'workflow.json',{type:'application/json'}));input.files=files.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await retry(()=>evaluate('document.querySelectorAll("[data-kit]").length===7'));
  await evaluate('document.querySelector("[data-action=edit-workflow-template]").click();document.querySelector("[data-action=save-workflow-copy]").click()');assert.equal(await evaluate('document.querySelectorAll("[data-kit]").length'),8);
  await rpc('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:join(temp,'downloads')},false);await evaluate('document.querySelector("[data-action=export-workflow-template]").click()');
  const exported=await retry(async()=>{const {readdir}=await import('node:fs/promises');return (await readdir(join(temp,'downloads'))).find(n=>n.endsWith('.json'));});
  const exportedText=await readFile(join(temp,'downloads',exported),'utf8');assert.equal(JSON.parse(exportedText).task,'documentation');assert.ok(!exportedText.includes('PRIVATE-BRIEF'));assert.ok(!exportedText.includes('PRIVATE-RESULT'));
  await evaluate('document.querySelector("[data-action=prepare]").click();document.getElementById("workflow-result").value="FINAL-RESULT-PRIVATE";document.getElementById("workflow-result").dispatchEvent(new Event("input",{bubbles:true}));document.querySelectorAll("[data-run-check]").forEach(el=>{el.checked=true;el.dispatchEvent(new Event("change",{bubbles:true}))})');
  assert.equal(await evaluate('document.querySelector("[data-action=complete-workflow-step]").disabled'),false);
  await evaluate('document.getElementById("workflow-result").value+=" edited";document.getElementById("workflow-result").dispatchEvent(new Event("input",{bubbles:true}))');assert.equal(await evaluate('document.querySelectorAll("[data-run-check]:checked").length'),0);
  await evaluate('document.querySelectorAll("[data-run-check]").forEach(el=>{el.checked=true;el.dispatchEvent(new Event("change",{bubbles:true}))});document.querySelector("[data-action=complete-workflow-step]").click()');
  assert.ok(await evaluate('document.querySelector(".workflow-complete textarea").value.includes("FINAL-RESULT-PRIVATE")'));
  await switchView('team');assert.ok(!(await evaluate('document.body.innerText')).includes('PRIVATE-BRIEF'));
  assert.equal(await evaluate('Array.from(document.querySelectorAll(".sidebar a")).some(a=>a.getAttribute("href")==="#integrations")'),false);
  await evaluate('location.hash="integrations"');await retry(()=>evaluate('document.querySelector("h1")?.textContent==="Team improvement."'));assert.equal(await evaluate('Boolean(document.querySelector(".setup-panel"))'),false);
  const team=await evaluate('fetch("/api/dashboard").then(r=>r.json())');assert.equal(team.adoption,null);assert.ok(!Object.hasOwn(team,'members'));await screenshot('team-improvement.png');
  await evaluate('location.hash="workflows"');await retry(()=>evaluate('Boolean(document.querySelector(".heatmap-panel"))'));assert.equal(await evaluate('document.querySelectorAll("[data-workflow]").length'),13);
  await evaluate('document.getElementById("query").value="prototype";document.getElementById("query").dispatchEvent(new Event("input",{bubbles:true}))');await retry(()=>evaluate('document.querySelectorAll("[data-workflow]").length===1'));
  await switchView('personal');await evaluate('location.hash="privacy"');await retry(()=>evaluate('Boolean(document.getElementById("telemetry-switch"))'));assert.equal(await evaluate('document.getElementById("telemetry-switch").checked'),false);await screenshot('privacy-controls.png');
  await evaluate('document.getElementById("telemetry-switch").checked=true;document.getElementById("telemetry-switch").dispatchEvent(new Event("change",{bubbles:true}))');
  await retry(()=>evaluate('fetch("/api/me/preferences").then(r=>r.json()).then(p=>p.telemetryEnabled)'));await retry(()=>evaluate('document.getElementById("telemetry-switch")?.checked===true && !document.getElementById("team-sharing-switch")?.checked'));
  // Seed recorded activity through the test fixture API; collection setup is not a PM page.
  const recorded=await evaluate(`fetch('/api/observations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({observations:[{id:'browser-prompt',sessionId:'browser-private',memberId:'pm-01',source:'codex',kind:'prompt_submitted',text:'Analyze requirements based on feedback and compare alternatives.',timestamp:new Date(Date.now()-60000).toISOString(),origin:'sample'},{id:'browser-result',sessionId:'browser-private',memberId:'pm-01',source:'codex',kind:'task_completed',text:'Requirements were verified against sources and revised after review.',artifactProduced:true,timestamp:new Date().toISOString(),origin:'sample'}]})}).then(r=>r.json())`);assert.ok(recorded.accepted>0);
  await evaluate('location.hash="progress"');await retry(()=>evaluate('Boolean(document.getElementById("mode"))'));
  await evaluate('document.getElementById("mode").value="collected";document.getElementById("mode").dispatchEvent(new Event("change",{bubbles:true}))');
  await retry(()=>evaluate('Boolean(document.querySelector(".private-index")) && document.getElementById("mode")?.value==="collected"'));
  const mine=await evaluate('fetch("/api/me/dashboard?mode=collected").then(r=>r.json())');assert.equal(mine.summary.total,1);assert.equal(mine.adoption.members.length,1);
  await screenshot('private-progress.png');await switchView('team');await retry(()=>evaluate('Boolean(document.querySelector(".cohort-notice"))'));const withheld=await evaluate('fetch("/api/dashboard?mode=collected").then(r=>r.json())');assert.equal(withheld.summary.total,0);assert.equal(withheld.privacy.suppressed,true);
  await switchView('personal');await evaluate('location.hash="privacy"');await retry(()=>evaluate('Boolean(document.getElementById("telemetry-switch"))'));
  await evaluate('document.getElementById("team-sharing-switch").checked=true;document.getElementById("team-sharing-switch").dispatchEvent(new Event("change",{bubbles:true}))');await retry(()=>evaluate('fetch("/api/me/preferences").then(r=>r.json()).then(p=>p.teamSharingEnabled)'));
  await retry(()=>evaluate('!document.getElementById("telemetry-switch").disabled'));await evaluate('document.getElementById("telemetry-switch").checked=false;document.getElementById("telemetry-switch").dispatchEvent(new Event("change",{bubbles:true}))');
  await retry(()=>evaluate('fetch("/api/me/preferences").then(r=>r.json()).then(p=>!p.telemetryEnabled&&!p.teamSharingEnabled)'));
  const paused=await evaluate('fetch("/api/observations",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({observations:[{id:"paused",sessionId:"paused",memberId:"pm-01",source:"codex",kind:"prompt_submitted",text:"Compare competitor pricing.",timestamp:new Date().toISOString()}]})}).then(r=>r.json())');assert.equal(paused.accepted,0);assert.equal(paused.paused,1);
  assert.equal((await evaluate('fetch("/api/me/dashboard?mode=collected").then(r=>r.json())')).summary.total,1);
  await rpc('Page.reload');await retry(()=>evaluate('Boolean(document.getElementById("telemetry-switch"))'));assert.equal(await evaluate('document.getElementById("telemetry-switch").checked'),false);
  await evaluate('location.hash="sharing"');await ready();assert.equal(await evaluate('Boolean(document.querySelector(".share-builder"))'),false);
  assert.equal(await evaluate('Array.from(document.querySelectorAll(".sidebar a")).some(a=>a.getAttribute("href")==="#sharing")'),false);
  await switchView('team');assert.equal(await evaluate('Boolean(document.querySelector(".shared-methods"))'),false);assert.ok(!(await evaluate('document.body.innerText')).includes('PRIVATE-BRIEF'));
  await rpc('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:join(temp,'downloads')},false);await evaluate('document.querySelector("[data-action=export]").click()');const {readdir}=await import('node:fs/promises');const report=await retry(async()=>(await readdir(join(temp,'downloads'))).find(n=>n.endsWith('.md')));const reportText=await readFile(join(temp,'downloads',report),'utf8');assert.match(reportText,/Team improvement summary/);assert.ok(!reportText.includes('PM adoption scores'));assert.ok(!reportText.includes('PRIVATE-BRIEF'));assert.ok(!reportText.includes('Methods explicitly shared'));
  await switchView('personal');
  await evaluate('location.hash="privacy"');await retry(()=>evaluate('Boolean(document.querySelector("[data-action=review-delete]"))'));await evaluate('document.querySelector("[data-action=review-delete]").click()');await evaluate('document.querySelector("[data-action=delete-data]").click()');await retry(()=>evaluate('!document.querySelector(".delete-confirm")'));assert.equal((await evaluate('fetch("/api/me/dashboard?mode=collected").then(r=>r.json())')).summary.total,0);
  await evaluate('document.querySelector("[data-action=clear-local]").click()');assert.equal(await evaluate('localStorage.getItem("pm-signal-private-practice")'),null);
  await evaluate('document.querySelector("[data-action=clear-workflow-runs]").click()');assert.equal(await evaluate('localStorage.getItem("pm-signal-workflow-runs")'),null);assert.ok(await evaluate('localStorage.getItem("pm-signal-workflow-templates")'));
  assert.ok(!postedBodies.some(body=>['PRIVATE-BRIEF-DO-NOT-UPLOAD','PRIVATE-RESULT-DO-NOT-UPLOAD','CUSTOM-INSTRUCTIONS-PRIVATE','FINAL-RESULT-PRIVATE'].some(secret=>body.includes(secret))));
  await size(390,900);await switchView('personal');await screenshot('personal-workspace-mobile.png');
  for(const page of ['assistant','progress','privacy','methodology']){await evaluate(`location.hash=${JSON.stringify(page)}`);await retry(()=>evaluate(`document.querySelector("h1")?.textContent.toLowerCase().includes(${JSON.stringify({assistant:'workspace',progress:'progress',privacy:'privacy',methodology:'works'}[page])})`));await assertEnglish();const bounds=await evaluate('({viewport:innerWidth,body:document.documentElement.scrollWidth})');assert.ok(bounds.body<=bounds.viewport,`${page} overflow: ${JSON.stringify(bounds)}`);if(page==='privacy')await screenshot('privacy-controls-mobile.png');}
  await switchView('team');await screenshot('team-improvement-mobile.png');
  for(const page of ['overview','workflows','behaviors','rules','methodology']){await evaluate(`location.hash=${JSON.stringify(page)}`);await assertEnglish();const bounds=await evaluate('({viewport:innerWidth,body:document.documentElement.scrollWidth})');assert.ok(bounds.body<=bounds.viewport,`${page} team overflow: ${JSON.stringify(bounds)}`);}
  assert.deepEqual(errors,[]);console.log('Browser checks passed: editable templates, gated workflow execution, explicit local snapshot save/resume, private results, private progress, telemetry persistence/stop, no method-sharing UI, deletion, aggregate-only team export and mobile views.');
} finally {
  ws?.close();
  chrome.kill('SIGTERM');
  await new Promise(resolve => server.close(resolve));
  await Promise.race([once(chrome, 'exit').catch(() => {}), new Promise(resolve => setTimeout(resolve, 2000))]);
  await rm(temp, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
