import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bundlePath = path.join(__dirname, 'final_bundle_4b63aeb3-6d86-4ac2-a1ba-781fa44bcc8a.js');
const code = fs.readFileSync(bundlePath, 'utf8');

console.log('[*] Auditing bundle top-level constructs...');

// Check class extends
const classExtendsRegex = /class\s+([A-Za-z0-9_$]+)?\s+extends\s+([A-Za-z0-9_$.]+)/g;
let m;
const extendsSet = new Set();
while ((m = classExtendsRegex.exec(code)) !== null) {
    extendsSet.add(`${m[1] || 'anonymous'} extends ${m[2]}`);
}
console.log('[*] Found class extends:');
for (const item of extendsSet) {
    console.log('   ', item);
}

// Check imports
const importRegex = /import\s+(?:[\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;
const importsSet = new Set();
while ((m = importRegex.exec(code)) !== null) {
    importsSet.add(m[1]);
}
console.log('\n[*] Found static imports:');
for (const item of importsSet) {
    console.log('   ', item);
}
