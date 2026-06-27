const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const ignored = new Set(['node_modules']);
const files = [];

function collect(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) collect(fullPath);
    else if (entry.name.endsWith('.js')) files.push(fullPath);
  }
}

collect(root);

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  new vm.Script(source, { filename: file });
}

console.log(`✓ Đã kiểm tra cú pháp ${files.length} file JavaScript.`);
