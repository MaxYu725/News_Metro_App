import { readFileSync } from 'node:fs';
import { analyzeTopic,prepareEvidence,planEvidence,buildTopicInput,validateTopicOutput } from '../../worker/src/topic-ai-policy.js';
const query='蔡天鳳案', rows=[];
let cursor='';
for(let i=0;i<3;i++){
 const u=new URL('https://news-proxy.maxyu0725us.workers.dev/api/search');
 u.searchParams.set('q',query);u.searchParams.set('scope','all');u.searchParams.set('sources','hk01,bastille');if(cursor)u.searchParams.set('cursor',cursor);
 const d=await(await fetch(u)).json();if(!d.success)throw Error('search unavailable');rows.push(...d.data);cursor=d.nextCursor;if(!d.hasMore||!cursor)break;
}
const a=analyzeTopic(query,rows,'auto'), evidence=await prepareEvidence(a.selected.filter(x=>x.description.length>=80)), plan=planEvidence(evidence,null,a.mode);
const input=buildTopicInput(a.mode,query,plan.batch,null);
const src=readFileSync('worker/src/topic-ai.js','utf8'), prompt=src.match(/const PROMPT = `([\s\S]*?)`;/)[1];
console.log('Input metadata',JSON.stringify({mode:a.mode,rows:rows.length,batch:plan.batch.length,chars:input.length,idLengths:plan.batch.map(x=>x.id.length)}));
const res=await fetch('http://127.0.0.1:8787/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt,input,sources:plan.batch.map(a=>({id:a.id}))}),signal:AbortSignal.timeout(65000)});console.log('Preview result',await res.text());