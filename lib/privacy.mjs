import { readFile,mkdir,writeFile,rename } from 'node:fs/promises';
import { dirname,resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
const defaults=()=>({telemetryEnabled:false,teamSharingEnabled:false,updatedAt:null});
export class PrivacyStore {
  constructor(file=process.env.PRIVACY_FILE||resolve(process.env.DATA_DIR||'./data','privacy.json')){this.file=file;this.queue=Promise.resolve();}
  async read(){try{return JSON.parse(await readFile(this.file,'utf8'));}catch(e){if(e.code==='ENOENT')return {members:{}};throw e;}}
  async write(data){await mkdir(dirname(this.file),{recursive:true});const temp=`${this.file}.${randomUUID()}.tmp`;await writeFile(temp,JSON.stringify(data,null,2)+'\n',{mode:0o600});await rename(temp,this.file);}
  transaction(work){const operation=this.queue.then(work);this.queue=operation.catch(()=>{});return operation;}
  async get(memberId){const data=await this.read();return Object.hasOwn(data.members,memberId)?data.members[memberId]:defaults();}
  async update(memberId,input){
    if(typeof input?.telemetryEnabled!=='boolean'||typeof input?.teamSharingEnabled!=='boolean')throw new Error('Telemetry and sharing settings must be boolean');
    return this.transaction(async()=>{const data=await this.read();const preference={telemetryEnabled:input.telemetryEnabled,teamSharingEnabled:input.telemetryEnabled&&input.teamSharingEnabled,updatedAt:new Date().toISOString()};data.members[memberId]=preference;await this.write(data);return preference;});
  }
  async ingest(memberIds,work){return this.transaction(async()=>{const data=await this.read();if(memberIds.some(id=>!Object.hasOwn(data.members,id)||!data.members[id].telemetryEnabled))return {paused:true};return {paused:false,value:await work()};});}
  async sharedMemberIds(){const data=await this.read();return new Set(Object.entries(data.members).filter(([,p])=>p.telemetryEnabled&&p.teamSharingEnabled).map(([id])=>id));}
  async erase(memberId,work){return this.transaction(async()=>{const data=await this.read();data.members[memberId]={...defaults(),updatedAt:new Date().toISOString()};if(Array.isArray(data.shares))data.shares=data.shares.filter(s=>s.memberId!==memberId);await this.write(data);return work();});}
}
