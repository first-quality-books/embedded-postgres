// Exercises the shutdown hook from a real child process, because everything
// under test here only happens as a process exits. `EP_MODE` picks the scenario:
//
//   explicit -- the cluster is stopped, then the process exits explicitly. This
//               is what an embedder that cleans up after itself does, an
//               Electron app calling `app.exit()` from `will-quit` among them.
//               Nothing may be written to stderr.
//   natural  -- the cluster is stopped, then the process is left to exit on its
//               own with a custom exit code, which has to survive.
//   signal   -- the cluster is left running and the process is signalled. The
//               hook has to stop the postmaster before the process goes away.
//
// It runs against `dist` rather than `src` because it is a plain Node process
// with no TypeScript loader. `npm run build` therefore has to have run first.
import EmbeddedPostgres from '../../dist/index.js';

const pg = new EmbeddedPostgres({
    port: Number(process.env.EP_PORT),
    databaseDir: process.env.EP_DIR,
    persistent: false,
    onLog: () => {},
    onError: () => {},
});

await pg.initialise();
await pg.start();

if (process.env.EP_MODE === 'signal') {
    // Tell the test the postmaster is up and it is safe to signal us.
    process.send?.('ready');
} else {
    await pg.stop();

    if (process.env.EP_MODE === 'explicit') {
        process.exit(0);
    }

    process.exitCode = 42;
}
