const {chromium,devices}=require('playwright');const {serve,wireCDN,collect,ROOT}=require('./common');const fs=require('fs');
const MODE=process.argv[2]||'desktop';const BASE='http://localhost:8765/';
const OVSEL='.fixed.inset-0';
function analyze(){const W=innerWidth;const act=[...document.querySelectorAll('[id^="page-"]')].find(e=>e.offsetParent!==null&&!e.classList.contains('hidden'));
 const res={active:act&&act.id,scrollW:document.documentElement.scrollWidth,W,overflow:[],small:{},smallEx:[],blocked:[],tiny:0};
 const root=act||document.body;
 for(const el of root.querySelectorAll('*')){const r=el.getBoundingClientRect();if(!r.width||!r.height)continue;const cs=getComputedStyle(el);if(cs.visibility==='hidden')continue;
  if(r.right>W+2&&cs.position!=='fixed'){let anc=el.parentElement,sc=false;while(anc&&anc!==document.body){const o=getComputedStyle(anc).overflowX;if(o==='auto'||o==='scroll'||o==='hidden'){sc=true;break;}anc=anc.parentElement;}if(!sc&&res.overflow.length<8)res.overflow.push({tag:el.tagName,cls:(el.className||'').toString().slice(0,60),right:Math.round(r.right),txt:(el.innerText||'').trim().slice(0,30)});}
  const own=[...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim().length>1);
  if(own){const f=parseFloat(cs.fontSize);const k=f<12?'<12':f<14?'12-13':f<16?'14-15':'>=16';res.small[k]=(res.small[k]||0)+1;if(f<12&&res.smallEx.length<6)res.smallEx.push(f+'px:'+el.textContent.trim().slice(0,25));}
 }
 for(const bt of root.querySelectorAll('button,a,select')){const r=bt.getBoundingClientRect();if(!r.width||!r.height||bt.offsetParent===null)continue;
  const cx=r.left+r.width/2,cy=r.top+r.height/2;if(cy<0||cy>innerHeight||cx<0||cx>W)continue;const top=document.elementFromPoint(cx,cy);
  if(top&&top!==bt&&!bt.contains(top)&&!top.contains(bt)&&res.blocked.length<6)res.blocked.push({btn:(bt.innerText||bt.id||'').trim().slice(0,20),by:(top.id||top.tagName)+'.'+(top.className||'').toString().slice(0,40)});
  if(bt.tagName!=='SELECT'&&(r.height<32||r.width<32)&&W<500)res.tiny++;}
 return res;}
function openOverlays(){const W=innerWidth,H=innerHeight;return [...document.querySelectorAll('body *')].filter(e=>{if(e.id==='app-sidebar'||e.id==='sidebar-backdrop'||e.id==='login-gate'||e.closest('#app-sidebar'))return false;const cs=getComputedStyle(e);if(cs.position!=='fixed'||cs.display==='none'||cs.visibility==='hidden')return false;const r=e.getBoundingClientRect();return r.width*r.height>W*H*0.25;}).map(e=>e.id||e.className.toString().slice(0,30)).slice(0,3);}
function activeId(){const a=[...document.querySelectorAll('[id^="page-"]')].find(e=>e.offsetParent!==null&&!e.classList.contains('hidden'));return a&&a.id;}
(async()=>{const srv=await serve();const b=await chromium.launch();
const opts=MODE==='mobile'?{...devices['iPhone 13'],deviceScaleFactor:1}:{viewport:{width:1440,height:900},deviceScaleFactor:1};
const ctx=await b.newContext(opts);await wireCDN(ctx);
const log={console:[],pageerrors:[],failed:[]};const out={pages:[],dialogs:[]};
const p=await ctx.newPage();collect(p,log);p.on('dialog',d=>{out.dialogs.push(d.message().slice(0,120));d.dismiss().catch(()=>{});});
const pre=MODE==='mobile'?'m':'d';
await p.goto(BASE);await p.waitForTimeout(1200);await p.screenshot({path:`${ROOT}/qa/screenshots/${pre}-00-login.png`});
out.loginAnalyze=await p.evaluate(()=>({scrollW:document.documentElement.scrollWidth,W:innerWidth}));
const pages=await p.evaluate(()=>[...new Set([...document.querySelectorAll('[id^="page-"]')].map(e=>e.id))]);
const navMap=await p.evaluate(()=>Object.fromEntries([...document.querySelectorAll('button[data-page]')].map(b=>[b.dataset.page,b.textContent.trim().replace(/\s+/g,' ')])));
await p.goto(BASE+'?demo=ding');await p.waitForTimeout(900);
if(MODE==='mobile'){await p.screenshot({path:`${ROOT}/qa/screenshots/m-01-home.png`});}
const go=async(id)=>{const nav=await p.$(`button[data-page="${id}"]`);let how='選單';
 if(nav){ if(MODE==='mobile'&&(await p.evaluate(()=>document.getElementById('app-sidebar').getBoundingClientRect().right<10))){const tg=await p.$('#btn-sidebar-toggle');if(tg)await tg.click().catch(()=>{});await p.waitForTimeout(400);}
   try{await nav.click({timeout:3000});}catch(e){how='選單點不到,改用程式切換';await p.evaluate(i=>{try{showPage(i)}catch(e){}},id);} }
 else {how='不在選單';await p.evaluate(i=>{try{showPage(i)}catch(e){}},id);}
 await p.waitForTimeout(500);return how;};
for(const id of pages){
 const t0=Date.now();const how=await go(id);
 const a=await p.evaluate(analyze);
 {const vs=p.viewportSize();const h=await p.evaluate(()=>Math.min(6000,document.querySelector('main').scrollHeight+60));await p.setViewportSize({width:vs.width,height:Math.max(vs.height,h)});await p.waitForTimeout(200);await p.screenshot({path:`${ROOT}/qa/screenshots/${pre}-${id}.png`}).catch(()=>{});await p.setViewportSize(vs);await p.waitForTimeout(100);}
 const errBefore=log.pageerrors.length+log.console.length;
 const labels=await p.$$eval(`#${id} button`,bs=>bs.filter(b=>b.offsetParent!==null&&!b.disabled).map((b,i)=>({i,t:(b.innerText||b.title||b.id||'').trim().replace(/\s+/g,' ').slice(0,30)})));
 const issues=[],modalShots=[];let n=0;
 for(const {i,t} of labels.slice(0,60)){
  if(/登出/.test(t))continue;
  const bs=await p.$$(`#${id} button`);const vis=[];for(const x of bs){if(await x.evaluate(b=>b.offsetParent!==null&&!b.disabled))vis.push(x);}
  const bt=vis[i];if(!bt)continue;const e0=log.pageerrors.length;n++;
  const popP=ctx.waitForEvent('page',{timeout:700}).catch(()=>null);
  await bt.click({timeout:1500}).catch(e=>issues.push({t,err:'無法點擊: '+String(e.message).split('\n')[0].slice(0,90)}));
  const pop=await popP;if(pop){issues.push({t,note:'開新分頁 '+pop.url().slice(0,80)});await pop.close().catch(()=>{});}
  await p.waitForTimeout(250);
  const ov=await p.evaluate(openOverlays);
  if(ov.length){ if(modalShots.length<2){const fn=`${pre}-${id}-modal${modalShots.length+1}.png`;await p.screenshot({path:`${ROOT}/qa/screenshots/${fn}`});modalShots.push({t,fn,ov});}
    await p.keyboard.press('Escape');await p.waitForTimeout(150);
    if((await p.evaluate(openOverlays)).length){await p.goto(BASE+'?demo=ding');await p.waitForTimeout(700);await go(id);}}
  const cur=await p.evaluate(activeId);
  if(cur!==id){issues.push({t,note:'跳到 '+cur});await go(id);}
  if(log.pageerrors.length>e0)issues.push({t,err:log.pageerrors[log.pageerrors.length-1]});
 }
 out.pages.push({id,nav:navMap[id]||'(不在選單)',how,ms:Date.now()-t0,...a,nButtons:labels.length,clicked:n,issues,modalShots,errors:log.pageerrors.length+log.console.length-errBefore});
}
out.links=await p.evaluate(()=>[...document.querySelectorAll('a[href]')].map(a=>({h:a.getAttribute('href'),t:a.innerText.trim().slice(0,20)})));
out.log=log;fs.writeFileSync(`/tmp/claude-0/qa/crawl-${MODE}.json`,JSON.stringify(out,null,1));await b.close();srv.close();})();
