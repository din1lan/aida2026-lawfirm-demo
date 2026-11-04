const {chromium}=require('playwright');const {serve,wireCDN,ROOT}=require('./common');
(async()=>{const srv=await serve(8768);const b=await chromium.launch();const ctx=await b.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1});await wireCDN(ctx);const p=await ctx.newPage();const dl=[];p.on('dialog',d=>{dl.push(d.message().slice(0,120));d.dismiss();});
await p.goto('http://localhost:8768/?demo=ding');await p.waitForTimeout(1200);await p.click('button[data-page="page-ai-brief"]');await p.waitForTimeout(400);
// Gemini 金鑰畫面
await p.selectOption('#aib-engine',{index:0});await p.waitForTimeout(300);console.log('engine opts',await p.$$eval('#aib-engine option',o=>o.map(x=>x.value+':'+x.textContent)));
await p.click('#aib-load-case');await p.waitForTimeout(2500);await p.click('#aib-analyze');await p.waitForTimeout(1200);
await p.evaluate(()=>document.getElementById('aib-engine').scrollIntoView({block:'center'}));await p.screenshot({path:ROOT+'/qa/screenshots/ai-gemini-key-required.png'});console.log('dialogs gemini',dl);
// 斷網後用貼入示範文字
await ctx.setOffline(true);dl.length=0;await p.selectOption('#aib-engine','local');await p.click('#aib-load-sample');await p.waitForTimeout(300);await p.click('#aib-analyze');await p.waitForTimeout(2500);
console.log('offline text badges',await p.$$eval('#aib-trace .aib-badge',x=>x.length),dl);await p.screenshot({path:ROOT+'/qa/screenshots/net-offline-05-sample-text-ok.png'});
await b.close();srv.close();})();
