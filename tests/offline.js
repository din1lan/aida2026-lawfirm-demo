// 測試共用：模擬「完全斷網」。除了本機網站（localhost）以外，所有外部網址一律擋掉並記下來。
// 網站的外部元件（Tailwind、pdf.js、xlsx、Tesseract＋繁中語言檔）都已放在 vendor/，斷網照樣要能跑。
// 要假裝 Gemini 回應的測試，自己再註冊 generativelanguage.googleapis.com 的路由（後註冊的優先）。
// opts.blockLocal：正規表示式，連本機的某些路徑也擋（例如模擬 OCR 元件下載失敗）
'use strict';
async function offline(ctx, opts = {}) {
  const blocked = [];
  ctx.__vendorHits = {};
  await ctx.route(() => true, (r) => {
    const u = r.request().url();
    const local = /^(https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/|data:|blob:)/.test(u);
    if (local) {
      const m = u.match(/\/vendor\/([^/?#]+)/); if (m) ctx.__vendorHits[m[1]] = (ctx.__vendorHits[m[1]] || 0) + 1;
      if (opts.blockLocal && opts.blockLocal.test(u)) return r.abort();
      return r.continue();
    }
    blocked.push(u);
    return r.abort('internetdisconnected');
  });
  return blocked;
}
// Google 字型擋掉是預期中的（斷網時用系統字型），其餘被擋的外部網址都算問題
const unexpected = (blocked) => blocked.filter((u) => !/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(u) && !/^https:\/\/generativelanguage\.googleapis\.com\//.test(u));
module.exports = { offline, unexpected };
