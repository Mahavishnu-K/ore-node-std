import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bundlePath = path.join(__dirname, 'final_bundle_55b13844-a4b9-4f51-9c99-a043e9b982f3.js');
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
