const {chromium}=require('playwright');const {serve,wireCDN,ROOT}=require('./common');const fs=require('fs');
const VDIR='/tmp/claude-0/qa/video';
(async()=>{const srv=await serve(8769);const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1,recordVideo:{dir:VDIR,size:{width:1440,height:900}}});await wireCDN(ctx);
const p=await ctx.newPage();p.on('dialog',d=>d.dismiss());const P=(ms=1800)=>p.waitForTimeout(ms);const log=[];const t0=Date.now();const mark=s=>log.push(((Date.now()-t0)/1000).toFixed(1)+'s '+s);
const smooth=async(sel,block='start')=>{await p.evaluate(([s,bk])=>{const e=document.querySelector(s);if(e)e.scrollIntoView({behavior:'smooth',block:bk});},[sel,block]);await P(2000);};
await p.goto('http://localhost:8769/');await P(2500);mark('登入畫面');
await p.selectOption('#login-role-select','ding').catch(()=>{});await P(1500);
await p.click('#form-login button');await P(2500);mark('首頁總覽');
await p.click('button[data-page="page-ai-brief"]');await P(2200);mark('AI 智慧閱卷');
await smooth('#aib-engine','center');await p.selectOption('#aib-engine','local');await P(1800);mark('切換示意版');
await p.click('#aib-load-case');for(let i=0;i<60;i++){const ok=await p.evaluate(()=>document.querySelector('#page-ai-brief').innerText.includes('04_原告民事準備書狀'));if(ok)break;await P(250);}await P(1800);mark('載入 4 份示範文件');
await smooth('#aib-analyze','center');await p.click('#aib-analyze');await P(2500);mark('開始分析');
await smooth('#aib-trace','start');await P(1500);mark('溯源結果');
for(let k=0;k<4;k++){await p.evaluate(()=>document.querySelector('main').scrollBy({top:420,behavior:'smooth'}));await P(1800);}
const clickBadge=async(re)=>{const hs=await p.$$('#aib-trace .aib-badge');for(const h of hs){const t=await h.textContent();if(re.test(t.trim())){await h.scrollIntoViewIfNeeded();await P(1200);await h.click();return t.trim();}}return null;};
const t1=await clickBadge(/^原文 文件3/);await P(3500);mark('點原文 → 跳到原句 '+t1);
await p.click('#aib-viewer-close');await P(1800);
const t2=await clickBadge(/^重點/);await P(3500);mark('點重點 → 對照原文 '+t2);await p.click('#aib-viewer-close').catch(()=>{});await P(1500);
const ver=await p.$('#aib-verify:not(.hidden)');if(ver){await p.click('#aib-verify-check');await P(1500);await p.click('#aib-verify-ok').catch(()=>{});await P(2000);}
await p.evaluate(()=>document.querySelector('main').scrollTo({top:0,behavior:'smooth'}));await P(2500);mark('結束');
const v=p.video();await ctx.close();const path=await v.path();fs.copyFileSync(path,ROOT+'/qa/demo-backup.webm');fs.writeFileSync('/tmp/claude-0/qa/video-log.txt',log.join('\n'));console.log(log.join('\n'));await b.close();srv.close();})();
