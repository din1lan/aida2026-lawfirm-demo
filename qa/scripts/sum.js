const o=require(`./crawl-${process.argv[2]}.json`);
for(const p of o.pages)console.log(p.id,'|',p.nav,'|',p.how,'| active',p.active,'| btn',p.nButtons,'clicked',p.clicked,'| err',p.errors,'| font',JSON.stringify(p.small),'| blocked',JSON.stringify(p.blocked),'| overflow',p.scrollW,'/',p.W,JSON.stringify(p.overflow.slice(0,2)),'| tiny',p.tiny,'| issues',JSON.stringify(p.issues).slice(0,400),'| modals',p.modalShots.map(m=>m.t).join(','));
console.log('dialogs',o.dialogs.length,JSON.stringify([...new Set(o.dialogs)]).slice(0,800));
console.log('pageerr',JSON.stringify(o.log.pageerrors));console.log('console',JSON.stringify(o.log.console.slice(0,15)));console.log('failed',JSON.stringify(o.log.failed.slice(0,15)));
console.log('links',JSON.stringify(o.links));console.log('login',JSON.stringify(o.loginAnalyze));
