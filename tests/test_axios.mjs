import './setup.mjs';
import axios from 'axios';
import * as oreHttp from '../http.js';
import * as oreFs from '../fs.js';
import assert from 'node:assert';

console.log('=== TEST SUITE: Axios Integration ===\n');

// 1. Basic Axios GET request
console.log('[*] Test 1: Testing axios.get(jsonplaceholder/users/2)...');
try {
    const res = await axios.get('https://jsonplaceholder.typicode.com/users/2', {
        // Use our http/https polyfills as the transport
        transport: oreHttp
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.id, 2);
    console.log(`    [OK] Axios GET User: ${res.data.name} (${res.data.username})`);
} catch (err) {
    console.error('    [FAIL] Axios GET failed:', err);
    throw err;
}

// 2. Axios POST request
console.log('[*] Test 2: Testing axios.post(jsonplaceholder/posts)...');
try {
    const postPayload = { title: 'WASM Sandbox', body: 'Axios in Ore', userId: 42 };
    const resPost = await axios.post('https://jsonplaceholder.typicode.com/posts', postPayload, {
        transport: oreHttp
    });
    assert.strictEqual(resPost.status, 200);
    console.log(`    [OK] Axios POST created ID: ${resPost.data.id}`);
} catch (err) {
    console.error('    [FAIL] Axios POST failed:', err);
    throw err;
}

// 3. Axios ArrayBuffer download
console.log('[*] Test 3: Testing binary download with axios (responseType: arraybuffer)...');
try {
    const dlRes = await axios.get('https://jsonplaceholder.typicode.com/comments?id=1', {
        responseType: 'arraybuffer',
        transport: oreHttp
    });
    assert.strictEqual(dlRes.status, 200);
    assert.ok(dlRes.data.byteLength > 0);
    console.log(`    [OK] Downloaded binary size: ${dlRes.data.byteLength} bytes`);
} catch (err) {
    console.error('    [FAIL] Axios download failed:', err);
    throw err;
}

console.log('\n[PASS] All Axios tests completed successfully.');
