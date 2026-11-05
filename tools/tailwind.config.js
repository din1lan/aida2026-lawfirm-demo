// 把 Tailwind 編成靜態 CSS（vendor/tailwind.css），網站不再依賴 cdn.tailwindcss.com。
// 重新產生：npx tailwindcss@3.4.17 -c tools/tailwind.config.js -i tools/tailwind.input.css -o vendor/tailwind.css --minify
// （設定內容跟原本 index.html 裡的 tailwind.config 一樣）
const path = require('path');
const root = path.join(__dirname, '..');
module.exports = {
  content: [path.join(root, 'index.html'), path.join(root, 'modules/*.js')],
  theme: {
    extend: {
      colors: {
        navy: { 950: '#0a1128', 900: '#0f172a', 800: '#1e293b', 700: '#334155' },
      },
    },
  },
};
