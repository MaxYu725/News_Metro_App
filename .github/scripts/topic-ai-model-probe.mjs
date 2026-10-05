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
const res=await fetch('https://api.cloudflare.com/client/v4/accounts/'+process.env.CF_ACCOUNT_ID+'/ai/run/@cf/qwen/qwen3-30b-a3b-fp8',{method:'POST',headers:{Authorization:'Bearer '+process.env.CF_API_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({messages:[{role:'system',content:prompt},{role:'user',content:input}],max_tokens:2600,temperature:.2,response_format:{type:'json_object'}}),signal:AbortSignal.timeout(60000)});
const d=await res.json();
console.log('Provider status',res.status,'success',d.success,'errorCodes',d.errors?.map(x=>x.code));
if(!d.success)process.exit(1);
const r=d.result,raw=r.response??r.choices?.[0]?.message?.content;
console.log('Response metadata',JSON.stringify({keys:Object.keys(r),type:typeof raw,chars:typeof raw==='string'?raw.length:JSON.stringify(raw)?.length,finishReason:r.choices?.[0]?.finish_reason,usage:r.usage}));
try {const out=validateTopicOutput(raw,plan.batch);console.log('Validation passed',JSON.stringify(out).length)}
catch(e) {
 console.log('Validation failed',e.name,e.message);
 let v;try{v=typeof raw==='string'?JSON.parse(raw):raw}catch{}
 console.log('Shape',JSON.stringify({keys:v&&Object.keys(v),sections:v?.sections?.length,sectionStats:v?.sections?.map(s=>({headingType:typeof s.heading,headingChars:s.heading?.length,items:s.items?.length,itemsStats:s.items?.map(i=>({textType:typeof i.text,textChars:i.text?.length,idsType:typeof i.sourceIds,ids:i.sourceIds?.length,unknown:Array.isArray(i.sourceIds)?i.sourceIds.filter(id=>!plan.batch.some(a=>a.id===id)).map(id=>({type:typeof id,chars:String(id).length})):null}))}))}));
}
