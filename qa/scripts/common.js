const fs=require('fs'),path=require('path'),http=require('http');
const ROOT='/home/user/aida2026-lawfirm-demo', NM='/tmp/claude-0/qa/node_modules';
const MIME={'.html':'text/html; charset=utf-8','.pdf':'application/pdf','.js':'text/javascript','.md':'text/markdown'};
function serve(port=8765){return new Promise(r=>{const s=http.createServer((q,res)=>{let p=decodeURIComponent(q.url.split('?')[0]);if(p.endsWith('/'))p+='index.html';p=p.replace(/^\/aida2026-lawfirm-demo/,'');const f=path.join(ROOT,p);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);res.end('404');return;}res.writeHead(200,{'content-type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(res);});s.listen(port,()=>r(s));});}
const CDN={
 'https://cdn.tailwindcss.com/':'/tmp/claude-0/qa/tw-shim.js',
 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js':NM+'/xlsx/dist/xlsx.full.min.js',
 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js':NM+'/pdfjs-dist/build/pdf.min.js',
 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js':NM+'/pdfjs-dist/build/pdf.worker.min.js',
};
async function wireCDN(ctx){
 for(const [u,f] of Object.entries(CDN)){ await ctx.route(u.replace(/\/$/,'')+'*',rt=>rt.fulfill({status:200,contentType:'text/javascript',headers:{'access-control-allow-origin':'*'},body:fs.readFileSync(f)})); }
}
function collect(page,log){
 page.on('console',m=>{if(['error','warning'].includes(m.type()))log.console.push({type:m.type(),text:m.text().slice(0,300),url:page.url()});});
 page.on('pageerror',e=>log.pageerrors.push(String(e).slice(0,300)));
 page.on('requestfailed',r=>log.failed.push({url:r.url().slice(0,200),err:r.failure()&&r.failure().errorText}));
 page.on('response',r=>{if(r.status()>=400)log.failed.push({url:r.url().slice(0,200),status:r.status()});});
}
module.exports={serve,wireCDN,collect,ROOT};
