const {chromium}=require('playwright');const {serve,wireCDN}=require('./common');const fs=require('fs');
(async()=>{const srv=await serve(8770);const b=await chromium.launch();const ctx=await b.newContext({viewport:{width:1440,height:900}});await wireCDN(ctx);const p=await ctx.newPage();p.on('dialog',d=>d.dismiss());
await p.goto('http://localhost:8770/');await p.waitForTimeout(1000);let out={'登入畫面':await p.evaluate(()=>document.getElementById('login-gate').innerText)};
await p.goto('http://localhost:8770/?demo=ding&autorun=pdf-view');await p.waitForTimeout(6000);out['閱卷原文視窗']=await p.evaluate(()=>document.getElementById('aib-viewer').innerText);
await p.click('#aib-viewer-close');
// export report html text
out['AI結果']=await p.evaluate(()=>document.getElementById('page-ai-brief').innerText);
for(const id of await p.$$eval('button[data-page]',bs=>[...new Set(bs.map(b=>b.dataset.page))])){await p.click(`button[data-page="${id}"]`).catch(()=>{});await p.waitForTimeout(400);out[id]=await p.evaluate(i=>document.getElementById(i).innerText,id);}
out['側欄']=await p.evaluate(()=>document.getElementById('app-sidebar').innerText);
fs.writeFileSync('vis.json',JSON.stringify(out,null,1));await b.close();srv.close();})();
