import { it, expect, vi } from 'vitest';

// Capture the hook that `src/index.ts` registers at import time, instead of
// letting async-exit-hook wire it up to real process events.
const { registered } = vi.hoisted(() => ({
    registered: [] as Array<(done?: () => void) => unknown>,
}));

vi.mock('async-exit-hook', () => ({
    default: (hook: (done?: () => void) => unknown) => {
        registered.push(hook);
    },
}));

it('registers a shutdown hook that async-exit-hook still treats as async', async () => {
    await import('../src/index.js');
    const hook = registered[0];

    expect(hook).toBeTypeOf('function');

    // async-exit-hook decides sync vs. async off `hook.length`: on the signal
    // paths it only passes a `done` callback (and waits for it) when the hook
    // declares a parameter. Giving `done` a default value would silently drop
    // arity to 0 and let the process exit before clusters are stopped.
    expect(hook.length).toBe(1);
});

it('resolves when called with no callback, as the `exit` event does', async () => {
    await import('../src/index.js');
    const hook = registered[0];

    // The plain `exit` event maps to `exit(false, undefined)`, so runHook takes
    // the synchronous branch and invokes the hook with no arguments. Calling a
    // missing `done()` there throws inside the async function and surfaces as an
    // unhandled rejection on every process exit.
    await expect(hook()).resolves.toBeUndefined();
});
