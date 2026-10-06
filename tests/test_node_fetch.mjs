import './setup.mjs';
import fetch, { Headers, Request, Response } from 'node-fetch';
import assert from 'node:assert';

console.log('=== TEST SUITE: node-fetch Integration ===\n');

// 1. Headers test
console.log('[*] Test 1: Headers class functionality...');
const h = new Headers({ 'Content-Type': 'application/json', 'X-Custom-Header': 'foobar' });
assert.strictEqual(h.get('content-type'), 'application/json');
assert.strictEqual(h.get('x-custom-header'), 'foobar');
const rawHeaders = h.raw();
assert.ok(rawHeaders['content-type']);
assert.deepStrictEqual(rawHeaders['content-type'], ['application/json']);
console.log('    [OK] Headers instantiated and queried successfully.');

// 2. Request and Response classes
console.log('[*] Test 2: Request & Response constructors...');
const req = new Request('https://jsonplaceholder.typicode.com/todos/1', {
    method: 'GET',
    headers: { 'Accept': 'application/json' }
});
assert.strictEqual(req.url, 'https://jsonplaceholder.typicode.com/todos/1');
assert.strictEqual(req.method, 'GET');

const res = new Response(JSON.stringify({ hello: 'world' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
});
const body = await res.json();
assert.strictEqual(body.hello, 'world');
console.log('    [OK] Request and Response constructors operate correctly.');

// 3. Outbound fetch via node-fetch
console.log('[*] Test 3: Outbound node-fetch request...');
try {
    const nfRes = await fetch('https://jsonplaceholder.typicode.com/users/1');
    const nfData = await nfRes.json();
    console.log(`    [OK] Received user: ${nfData.name} (${nfData.email})`);
    assert.strictEqual(nfData.id, 1);
} catch (err) {
    console.error('    [FAIL] Outbound fetch error:', err);
    throw err;
}

console.log('\n[PASS] All node-fetch tests completed successfully.');
