
// Fallback recursive proxy for unsupported or optional Node built-in modules.
// Returns undefined for 'then' and Symbol.iterator to prevent Promise resolution deadlocks in dynamic imports and require shims.

const noop = () => false;
export const isatty = noop;
export const isIP = noop;

const proxy = new Proxy(noop, {
    get: (target, prop) => {
        // Critical: Never report as a Thenable or async/await freezes forever!
        if (prop === 'then') return undefined;
        if (prop === Symbol.iterator) return undefined;
        if (prop === 'isatty' || prop === 'isIP') return noop;
        if (prop === Symbol.toPrimitive) return () => '';
        if (prop === 'default') return proxy;
        return proxy;
    },
    apply: () => proxy,
    construct: () => proxy
});

export default proxy;

