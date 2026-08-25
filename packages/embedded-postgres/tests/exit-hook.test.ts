import { it, expect, vi } from 'vitest';

// Capture the registration `src/index.ts` performs, instead of letting
// `exit-hook` wire itself up to real process events.
const { asyncExitHook } = vi.hoisted(() => ({
    asyncExitHook: vi.fn(() => vi.fn()),
}));

vi.mock('exit-hook', () => ({ asyncExitHook }));

it('registers no shutdown hook until a cluster is running', async () => {
    const { default: EmbeddedPostgres } = await import('../src/index.js');

    new EmbeddedPostgres({ databaseDir: '/tmp/embedded-postgres-never-started' });

    // `exit-hook` prints a `SYNCHRONOUS TERMINATION NOTICE` on every explicit
    // `process.exit()` for as long as an asynchronous hook is registered.
    // Registering one at import time, or for a cluster that was never started,
    // puts that warning on the exit of every process that so much as loads this
    // module, and there is nothing it could usefully do about it.
    expect(asyncExitHook).not.toHaveBeenCalled();
});
