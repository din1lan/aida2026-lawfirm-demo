const {chromium}=require('playwright');const {serve,collect,ROOT}=require('./common');const fs=require('fs');
const NM='/tmp/claude-0/qa/node_modules';
const CDN=[['https://cdn.tailwindcss.com','/tmp/claude-0/qa/tw-shim.js',407000],
 ['https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',NM+'/xlsx/dist/xlsx.full.min.js',0],
 ['https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',NM+'/pdfjs-dist/build/pdf.min.js',0],
 ['https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',NM+'/pdfjs-dist/build/pdf.worker.min.js',0]];
const MODE=process.argv[2];const BPS=500*1024/8*0.8, LAT=2000; // Chrome DevTools "Slow 3G"
(async()=>{const srv=await serve(8767);const b=await chromium.launch();const ctx=await b.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1});
for(const [u,f,real] of CDN){await ctx.route(u+'*',async rt=>{
  if(MODE==='nocdn')return rt.abort('internetdisconnected');
  const body=fs.readFileSync(f);if(MODE==='slow'){const n=real||body.length;await new Promise(r=>setTimeout(r,LAT+n/BPS*1000));}
  rt.fulfill({status:200,contentType:'text/javascript',headers:{'access-control-allow-origin':'*'},body});});}
if(MODE==='nocdn')await ctx.route(/fonts\.(googleapis|gstatic)\.com/,rt=>rt.abort('internetdisconnected'));
const log={console:[],pageerrors:[],failed:[]};const p=await ctx.newPage();collect(p,log);p.on('dialog',d=>{log.console.push({type:'dialog',text:d.message().slice(0,150)});d.dismiss();});
if(MODE==='slow'){const c=await ctx.newCDPSession(p);await c.send('Network.enable');await c.send('Network.emulateNetworkConditions',{offline:false,latency:LAT,downloadThroughput:BPS,uploadThroughput:BPS});}
const t0=Date.now();const steps=[];const pre='net-'+MODE;
const shot=async(n)=>{await p.screenshot({path:`${ROOT}/qa/screenshots/${pre}-${n}.png`});steps.push({n,s:((Date.now()-t0)/1000).toFixed(1)});};
const state=()=>p.evaluate(()=>({tailwind:!!document.getElementById('tw-shim')||!!window.tailwind,pdfjs:!!window.pdfjsLib,badges:document.querySelectorAll('#aib-trace .aib-badge').length,viewer:(()=>{const v=document.getElementById('aib-viewer');return !!v&&!v.classList.contains('hidden')})(),msg:(document.getElementById('aib-doc-status')||{}).textContent}));
if(MODE==='offline'){
  // 情境：比賽前已開好網頁，之後網路斷掉，再按示範
  await p.goto('http://localhost:8767/?demo=ding');await p.waitForTimeout(1500);await shot('01-loaded-online');
  await ctx.setOffline(true);
  await p.click('button[data-page="page-ai-brief"]');await p.waitForTimeout(500);
  await p.selectOption('#aib-engine','local');await p.click('#aib-load-case');await p.waitForTimeout(4000);await shot('02-offline-load-case');
  steps.push({n:'after-load-case',st:await state()});
  await p.click('#aib-analyze').catch(()=>{});await p.waitForTimeout(3000);await shot('03-offline-analyze');steps.push({n:'after-analyze',st:await state()});
  // 再試：斷網時重新整理
  await p.reload().catch(e=>steps.push({n:'reload',err:String(e.message).slice(0,80)}));await p.waitForTimeout(1500);await shot('04-offline-reload');
}else{
  const nav=p.goto('http://localhost:8767/?demo=ding&autorun=pdf-view',{timeout:180000,waitUntil:'commit'});
  for(let i=0;i<24;i++){await p.waitForTimeout(5000);const st=await state().catch(()=>null);steps.push({n:'t+'+((Date.now()-t0)/1000).toFixed(0),st});if(i%3==0)await shot('t'+String(i*5).padStart(3,'0')).catch(()=>{});if(st&&st.viewer)break;}
  await nav.catch(()=>{});await p.waitForTimeout(1500);await shot('final');
}
fs.writeFileSync(`/tmp/claude-0/qa/net-${MODE}.json`,JSON.stringify({steps,log},null,1));await b.close();srv.close();})();
