import { Readable, PassThrough, pipeline } from '../stream.js';
import { Buffer } from '../buffer.js';

class MockIncomingMessage extends Readable {
    constructor() {
        super();
        this._sent = false;
    }

    _read() {
        console.log('[MockIncomingMessage] _read called, _sent:', this._sent);
        if (this._sent) return;
        this._sent = true;

        const data = Buffer.from(JSON.stringify({ title: "hello test" }));
        console.log('[MockIncomingMessage] pushing data');
        this.push(data);
        console.log('[MockIncomingMessage] pushing null');
        this.push(null);
    }
}

async function run() {
    console.log('[*] Step 1: create response stream');
    const response_ = new MockIncomingMessage();

    console.log('[*] Step 2: pump into PassThrough');
    let body = pipeline(response_, new PassThrough(), (err) => {
        console.log('[*] pipeline callback:', err);
    });

    console.log('[*] Step 2.5: simulate async tick before consuming body');
    await new Promise(r => setTimeout(r, 50));

    console.log('[*] Step 3: consume body via for-await');
    const accum = [];
    for await (const chunk of body) {
        console.log('[*] Got chunk:', chunk.toString());
        accum.push(chunk);
    }
    console.log('[*] Finished for-await, total chunks:', accum.length);
}

run().catch(console.error);
