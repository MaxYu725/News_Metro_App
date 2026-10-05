import {validateTopicOutput} from './src/topic-ai-policy.js';
export default {async fetch(req,env){
 if(req.method!=='POST')return new Response('ready');
 const {prompt,input,sources,aliases}=await req.json();
 let stage='model';
 try{
 const r=await env.AI.run('@cf/qwen/qwen3-30b-a3b-fp8',{messages:[{role:'system',content:prompt},{role:'user',content:input}],max_tokens:2600,temperature:.2,response_format:{type:'json_object'}});
 stage='validation';const raw=r?.response??r?.choices?.[0]?.message?.content;
 const meta={keys:Object.keys(r||{}),type:typeof raw,chars:typeof raw==='string'?raw.length:JSON.stringify(raw)?.length,usage:r?.usage};
 try{const o=validateTopicOutput(raw,sources,new Map(aliases));return Response.json({status:'valid',meta,outputChars:JSON.stringify(o).length})}
 catch(e){let v;try{v=typeof raw==='string'?JSON.parse(raw):raw}catch{}
 return Response.json({status:'invalid',error:e.message,meta,shape:{keys:v&&Object.keys(v),sections:v?.sections?.length,sectionStats:v?.sections?.map(s=>({headingType:typeof s.heading,headingChars:s.heading?.length,items:s.items?.length,itemStats:s.items?.map(i=>({textType:typeof i.text,textChars:i.text?.length,ids:i.sourceIds?.length,unknown:Array.isArray(i.sourceIds)?i.sourceIds.filter(id=>!sources.some(a=>a.id===id)).map(id=>({type:typeof id,chars:String(id).length})):null}))}))}})}
 }catch(e){return Response.json({status:'failed',stage,name:e.name,code:e.code??null})}
}};