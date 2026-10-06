import { URL, URLSearchParams } from '../whatwg_url.js';
import * as legacyUrl from '../url.js';
import assert from 'node:assert';

console.log('=== TEST SUITE: WHATWG URL & URLSearchParams ===\n');

// 1. Basic URL parsing and toString()
console.log('[*] Test 1: URL basic parsing and toString()...');
const u = new URL('https://jsonplaceholder.typicode.com/todos/2');
assert.strictEqual(u.protocol, 'https:');
assert.strictEqual(u.hostname, 'jsonplaceholder.typicode.com');
assert.strictEqual(u.pathname, '/todos/2');
assert.strictEqual(u.href, 'https://jsonplaceholder.typicode.com/todos/2');
assert.strictEqual(u.toString(), 'https://jsonplaceholder.typicode.com/todos/2');
assert.strictEqual(String(u), 'https://jsonplaceholder.typicode.com/todos/2');
console.log('    [OK] URL.toString() returns full href string.');

// 2. URLSearchParams constructors
console.log('[*] Test 2: URLSearchParams constructor variants...');
const sp1 = new URLSearchParams('a=1&b=2');
assert.strictEqual(sp1.get('a'), '1');
assert.strictEqual(sp1.get('b'), '2');

const sp2 = new URLSearchParams([['foo', 'bar'], ['baz', 'qux']]);
assert.strictEqual(sp2.get('foo'), 'bar');
assert.strictEqual(sp2.get('baz'), 'qux');

const sp3 = new URLSearchParams({ key1: 'val1', key2: 'val2' });
assert.strictEqual(sp3.get('key1'), 'val1');
assert.strictEqual(sp3.get('key2'), 'val2');
console.log('    [OK] URLSearchParams constructor supports strings, sequences, and objects.');

// 3. URLSearchParams iterators: keys, values, entries, forEach
console.log('[*] Test 3: URLSearchParams iterators (keys, values, entries, forEach)...');
const spIter = new URLSearchParams('c=3&a=1&b=2');
spIter.sort();
const keys = [...spIter.keys()];
assert.deepStrictEqual(keys, ['a', 'b', 'c']);

const values = [...spIter.values()];
assert.deepStrictEqual(values, ['1', '2', '3']);

const entries = [...spIter.entries()];
assert.deepStrictEqual(entries, [['a', '1'], ['b', '2'], ['c', '3']]);

const forEachResults = [];
spIter.forEach((val, key) => {
    forEachResults.push([key, val]);
});
assert.deepStrictEqual(forEachResults, [['a', '1'], ['b', '2'], ['c', '3']]);
console.log('    [OK] keys(), values(), entries(), and forEach() match WHATWG spec.');

// 4. Node-fetch Headers inheritance compatibility
console.log('[*] Test 4: Node-fetch Headers inheritance pattern...');
class MockHeaders extends URLSearchParams {
    constructor(init) {
        super(init);
    }
}
const headers = new MockHeaders([['Accept', '*/*'], ['User-Agent', 'test-agent']]);
assert.strictEqual(headers.get('Accept'), '*/*');
const headerKeys = new Set(URLSearchParams.prototype.keys.call(headers));
assert.ok(headerKeys.has('Accept'));
assert.ok(headerKeys.has('User-Agent'));
console.log('    [OK] Subclassing and prototype.keys.call(instance) fully operational.');

// 5. Legacy url.js exports
console.log('[*] Test 5: Legacy url.js exports parity...');
assert.strictEqual(typeof legacyUrl.parse, 'function');
assert.strictEqual(typeof legacyUrl.format, 'function');
assert.strictEqual(typeof legacyUrl.resolve, 'function');
assert.strictEqual(typeof legacyUrl.URL, 'function');
assert.strictEqual(typeof legacyUrl.URLSearchParams, 'function');
assert.strictEqual(legacyUrl.URL, URL);
assert.strictEqual(legacyUrl.URLSearchParams, URLSearchParams);
console.log('    [OK] url.js exports URL and URLSearchParams identically.');

console.log('\n[PASS] All WHATWG URL & URLSearchParams tests completed successfully.');
