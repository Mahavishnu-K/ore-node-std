import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const suites = [
    { name: 'WHATWG URL & URLSearchParams', script: 'test_whatwg_url.mjs' },
    { name: 'Node-Fetch Integration', script: 'test_node_fetch.mjs' },
    { name: 'Axios Integration', script: 'test_axios.mjs' },
    { name: 'Final Production Bundle Execution', script: 'bundle_runner.mjs' }
];

console.log('=====================================================');
console.log('       ORE WASM STANDARD MODULES - TEST HARNESS       ');
console.log('=====================================================\n');

let allPassed = true;

for (const suite of suites) {
    console.log(`\n>>> RUNNING: ${suite.name} (${suite.script})`);
    try {
        const output = execSync(`node "${path.join(__dirname, suite.script)}"`, {
            cwd: __dirname,
            encoding: 'utf8',
            stdio: 'pipe'
        });
        console.log(output);
        console.log(`>>> [PASSED]: ${suite.name}`);
    } catch (err) {
        allPassed = false;
        console.error(`>>> [FAILED]: ${suite.name}`);
        if (err.stdout) console.log(err.stdout);
        if (err.stderr) console.error(err.stderr);
    }
}

console.log('\n=====================================================');
if (allPassed) {
    console.log('   RESULT: ALL TEST SUITES PASSED CLEANLY (4/4)!     ');
} else {
    console.log('   RESULT: SOME TEST SUITES FAILED!                   ');
    process.exit(1);
}
console.log('=====================================================\n');
