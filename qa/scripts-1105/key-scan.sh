#!/usr/bin/env bash
# 金鑰掃描：目前所有檔案＋git 歷史所有分支的每個 commit（2026-11-05）
# 用法：在專案根目錄 bash qa/scripts-1105/key-scan.sh（先 git fetch 全部分支）
# vendor/tesseract/core/*.wasm.js 是官方 tesseract.js-core@5.1.1 原檔，裡面的 base64 二進位資料有兩段「湊巧」長得像
# AWS 金鑰格式（AKIA 開頭＋16 碼），不是金鑰，另外列出、不算命中。
PAT='AIza[0-9A-Za-z_-]{35}|sk-[A-Za-z0-9_-]{20,}|sk-ant-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|xox[baprs]-[A-Za-z0-9-]{10,}|ya29\.[0-9A-Za-z_-]{20,}|hook\.[a-z0-9]+\.make\.com/[a-z0-9]{20,}'
PAT2="(api[_-]?key|apikey|secret|token|password)['\"]?\s*[:=]\s*['\"][A-Za-z0-9_\-]{16,}['\"]"
echo "commit 數：$(git rev-list --all | wc -l)"
echo "== 目前檔案"
grep -rIEo "$PAT" --exclude-dir=.git --exclude-dir=vendor . ; grep -rIiEn "$PAT2" --exclude-dir=.git --exclude-dir=vendor .
echo "== 目前檔案裡的 AIza 字樣"; grep -rIn 'AIza' --exclude-dir=.git . | grep -v 'qa/scripts-1105/key-scan.sh'
echo "== git 歷史（全部分支、每個 commit）"
git rev-list --all | while read -r c; do git grep -IEo "$PAT" "$c" -- . ':!vendor/tesseract/core' 2>/dev/null; git grep -IiEn "$PAT2" "$c" -- . ':!vendor' 2>/dev/null; done | sort -u
echo "== git 歷史裡出現過 AIza 的 commit"; git log --all -S'AIza' --oneline -- . ':!qa/scripts-1105/key-scan.sh' ':!docs/正式版規格-1105.md'
echo "== 已知的假陽性（Tesseract 官方核心檔的 base64 資料）"; grep -oE 'AKIA[0-9A-Z]{16}' vendor/tesseract/core/*.wasm.js | sort -u
echo "（上面三段「目前檔案」「git 歷史」「AIza」沒有輸出＝沒有找到金鑰）"
