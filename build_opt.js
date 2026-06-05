// build_opt.js — inject optimizer.js + optdata.js source into index.html between markers.
// Run after changing optimizer.js or optdata.js so the embedded code == the tested code.
const fs = require('fs'), path = require('path'), dir = __dirname;
const opt = fs.readFileSync(path.join(dir, 'optimizer.js'), 'utf8');
const data = fs.readFileSync(path.join(dir, 'optdata.js'), 'utf8');
let html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const START = '/* OPT-INJECT:START */', END = '/* OPT-INJECT:END */';
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const re = new RegExp(esc(START) + '[\\s\\S]*?' + esc(END));
if (!re.test(html)) throw new Error('inject markers not found in index.html');
const block = START + '\n' + data + '\n' + opt + '\n' + END;
html = html.replace(re, () => block);
fs.writeFileSync(path.join(dir, 'index.html'), html);
console.log('injected optimizer (' + opt.length + ' bytes) + optdata (' + data.length + ' bytes)');
