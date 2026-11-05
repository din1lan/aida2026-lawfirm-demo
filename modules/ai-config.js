/* AI 設定（2026-11-05）：Gemini 金鑰與模型只由「管理員設定」頁（網址加 #admin）設定一次。
 *
 * - 金鑰只存在「這台電腦這個瀏覽器」的 localStorage，不寫進程式、不上傳、不會出現在備份檔（不在 PERSIST_KEYS 裡）、不進 git
 * - 主畫面（AI 智慧閱卷、AI 自動填、掃描頁 Gemini 辨識）不再有貼金鑰的框，一律從這裡讀
 * - 沒有設定金鑰：各功能自動用示意版，畫面寫「尚未設定 AI，目前為示意版」
 * 瀏覽器：window.LF_AI；Node 測試：require('./modules/ai-config.js')
 */
(function (root) {
  'use strict';
  const KEY = 'lf_admin_gemini_key';
  const MODEL = 'lf_admin_gemini_model';
  const DEFAULT_MODEL = 'gemini-2.5-flash';
  const store = () => { try { return root.localStorage || null; } catch (e) { return null; } };
  const get = (k) => { try { const s = store(); return s ? String(s.getItem(k) || '').trim() : ''; } catch (e) { return ''; } };
  const notify = () => { try { if (root.dispatchEvent && typeof root.CustomEvent === 'function') root.dispatchEvent(new root.CustomEvent('lf-ai-config')); } catch (e) { /* ignore */ } };

  function getKey() { return get(KEY); }
  function getModel() { return get(MODEL) || DEFAULT_MODEL; }
  function hasKey() { return !!getKey(); }
  // 畫面上只顯示末 4 碼
  function masked() { const k = getKey(); return k ? '••••••' + k.slice(-4) : ''; }
  function save(key, model) {
    const s = store(); if (!s) throw new Error('這個瀏覽器不允許儲存設定（可能是無痕模式）');
    const k = String(key || '').trim(); const m = String(model || '').trim();
    if (k) s.setItem(KEY, k);
    if (m) s.setItem(MODEL, m);
    notify();
  }
  function clear() { const s = store(); if (s) { s.removeItem(KEY); s.removeItem(MODEL); } notify(); }

  const api = { getKey, getModel, hasKey, masked, save, clear, DEFAULT_MODEL, STORAGE_KEYS: [KEY, MODEL] };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.LF_AI = api;
})(typeof window !== 'undefined' ? window : globalThis);
