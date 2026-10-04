
// Fallback recursive proxy for unsupported or optional Node built-in modules.
// Returns undefined for 'then' to prevent Promise resolution deadlocks in require shims.

const noop = () => false;
export const isatty = noop;
export const isIP = noop;
const proxy = new Proxy(noop, {
    get: (t, p) => (p === 'isatty' || p === 'isIP') ? noop : proxy,
    apply: () => proxy,
    construct: () => proxy
});
export default proxy;
