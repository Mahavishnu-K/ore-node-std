import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bundlePath = path.join(__dirname, 'final_bundle_4b63aeb3-6d86-4ac2-a1ba-781fa44bcc8a.js');
let bundleCode = fs.readFileSync(bundlePath, 'utf8');

// Replace static ESM 'from /modules/' with relative paths to '../'
bundleCode = bundleCode.replaceAll("from '/modules/", "from '../");
bundleCode = bundleCode.replaceAll('from "/modules/', 'from "../');

const tempPath = path.join(__dirname, 'temp_test_bundle.mjs');
fs.writeFileSync(tempPath, bundleCode);

console.log('[*] Created temp_test_bundle.mjs. Now attempting dynamic import...');
try {
    await import('./temp_test_bundle.mjs');
    console.log('[*] Dynamic import completed.');
} catch (err) {
    console.error('\n[FATAL ERROR IN BUNDLE]:', err);
}
