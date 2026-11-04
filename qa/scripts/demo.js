const {chromium}=require('playwright');const {serve,wireCDN,collect,ROOT}=require('./common');const fs=require('fs');
(async()=>{const srv=await serve();const b=await chromium.launch();const ctx=await b.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1});await wireCDN(ctx);
const log={console:[],pageerrors:[],failed:[]};const p=await ctx.newPage();collect(p,log);
const t0=Date.now();const steps=[];const shot=async(n,d)=>{await p.screenshot({path:`${ROOT}/qa/screenshots/demo-${n}.png`});steps.push({n,d,ms:Date.now()-t0});};
await p.goto('http://localhost:8765/?demo=ding&autorun=pdf-view');await shot('01-loaded','頁面載入完成');
await p.waitForTimeout(1200);await shot('02-ai-brief','進入AI智慧閱卷');
try{await p.waitForFunction(()=>window.AIB_DOC?true:document.querySelector('#aib-trace .aib-badge'),null,{timeout:20000});}catch(e){steps.push({n:'wait-fail',d:String(e).slice(0,100)})}
await shot('03-mid','分析中/後');
try{await p.waitForSelector('#aib-viewer:not(.hidden)',{timeout:25000});steps.push({n:'viewer-open',ms:Date.now()-t0});}catch(e){steps.push({n:'viewer-timeout',d:'原文視窗 25 秒內未開'});}
await p.waitForTimeout(1500);await shot('04-viewer','原文定位視窗');
const info=await p.evaluate(()=>({title:document.getElementById('aib-viewer-title')?.textContent,sub:document.getElementById('aib-viewer-sub')?.textContent,badges:[...document.querySelectorAll('#aib-trace .aib-badge')].map(x=>x.textContent.trim()).slice(0,30),files:(window.AIB_DOC||{}).files?.length,engine:document.getElementById('aib-engine')?.value}));
fs.writeFileSync('/tmp/claude-0/qa/demo-result.json',JSON.stringify({steps,info,log},null,1));await b.close();srv.close();})();
