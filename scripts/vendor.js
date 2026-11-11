'use strict';

/* 把 marked / DOMPurify 的浏览器构建复制到 src/vendor，运行时完全离线。 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'src', 'vendor');

fs.mkdirSync(outDir, { recursive: true });

const pairs = [
  ['marked/marked.min.js', 'marked.min.js'],
  ['dompurify/dist/purify.min.js', 'purify.min.js'],
];

let missing = 0;
for (const [from, to] of pairs) {
  const src = path.join(root, 'node_modules', from);
  if (!fs.existsSync(src)) {
    console.warn(`[vendor] 缺少 ${from}，请先执行 npm install`);
    missing += 1;
    continue;
  }
  fs.copyFileSync(src, path.join(outDir, to));
  console.log(`[vendor] ${from} -> src/vendor/${to}`);
}

if (missing) process.exitCode = 1;
