import { it, expect, afterEach, beforeEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import EmbeddedPostgres from '../src/index.js';
import { PostgresOptions } from '../src/types.js';

const DB_NAME = 'embedded-pg-test-db';
const DB_PATH = path.join(__dirname, 'data', 'db');

const DEFAULT_SETTINGS: Partial<PostgresOptions> = {
    port: 5433,
    databaseDir: DB_PATH,
};

let pg: EmbeddedPostgres | undefined;

beforeEach(async () => {
    // Reset the client
    pg = undefined;

    //
});

afterEach(async () => {
    // Stop client
    await pg?.stop();
    
    // Remove all cluster files
    await fs.rm(path.join(DB_PATH), { recursive: true, force: true });
});

it('should be able to initialise a cluster', async () => {
    // Initialise and stop a basic cluster
    pg = new EmbeddedPostgres(DEFAULT_SETTINGS);
    await pg.initialise();

    // Check that the database files have been created
    const stat = await fs.stat(
        path.join(DB_PATH, 'pg_hba.conf')
    );
    expect(stat.isFile()).toBe(true);
});

it('should be able to start and stop a cluster', async () => {
    pg = new EmbeddedPostgres(DEFAULT_SETTINGS);
    await pg.initialise();

    await pg.start();
});

// it('should throw an error if the cluster is attempted to be started without initialising', async () => {
//     pg = new EmbeddedPostgres(DEFAULT_SETTINGS);
//     try {
//         await pg.start();
//     } catch (e) {
//         expect(e instanceof Error).toBe(true);
//         expect((e as Error).message).toBe('Cannot start cluster if it has not been initialised first.');
//     }
// });

it('should allow the creation of pg clients', async () => {
    // Initialise and start a basic cluster
    pg = new EmbeddedPostgres(DEFAULT_SETTINGS);
    await pg.initialise();
    await pg.start();

    // Create and connect a database client
    const client = pg.getPgClient();
    await client.connect();

    // Check if it can query the database
    const result = await client.query('SELECT datname FROM pg_database;');
    expect(result.rows.map((r) => r.datname)).toContain('postgres');
});

it('should allow creating databases', async () => {
    // Initialise and start a basic cluster
    pg = new EmbeddedPostgres(DEFAULT_SETTINGS);
    await pg.initialise();
    await pg.start();

    // Create the database
    await pg.createDatabase(DB_NAME);

    // Connect the client
    const client = pg.getPgClient();
    await client.connect();

    // Retrieve database names and check whether the database has been created
    const result = await client.query('SELECT datname FROM pg_database;');
    expect(result.rows.map((r) => r.datname)).toContain(DB_NAME);
});

it('should allow deleting databases', async () => {
    // Initialise and start a basic cluster
    pg = new EmbeddedPostgres(DEFAULT_SETTINGS);
    await pg.initialise();
    await pg.start();

    // Create the database
    await pg.createDatabase(DB_NAME);

    // Connect the client
    const client = pg.getPgClient();
    await client.connect();

    // Retrieve database names and check whether the database has been created
    let result = await client.query('SELECT datname FROM pg_database;');
    expect(result.rows.map((r) => r.datname)).toContain(DB_NAME);

    // Delete the database
    await pg.dropDatabase(DB_NAME);
    result = await client.query('SELECT datname FROM pg_database;');
    expect(result.rows.map((r) => r.datname)).not.toContain(DB_NAME);
});

it('should automatically remove files when persistent is set to false', async () => {
    // Initialise and start a basic cluster
    pg = new EmbeddedPostgres({ ...DEFAULT_SETTINGS, persistent: false });
    await pg.initialise();
    await pg.start();
    
    // Check that the database files have been created
    const stat = await fs.stat(
        path.join(DB_PATH, 'pg_hba.conf')
    );
    expect(stat.isFile()).toBe(true);

    // Auto-delete the database by stopping the cluster
    await pg.stop();

    // Check that the database files have been delete
    expect(() => fs.stat(path.join(DB_PATH, 'pg_hba.conf')))
        .rejects
        .toThrowError();
});

it('should ensure binary files have correct permissions', async () => {
    // r-xr-xr-x permissions (365 in decimal, 0o555 in octal)
    const expectedPermissions = 0b101101101;
    
    // Initialize postgres (which will call ensureBinIsExecutable on binaries)
    pg = new EmbeddedPostgres(DEFAULT_SETTINGS);
    await pg.initialise();
    
    // Check postgres binary has correct permissions
    const { postgres } = await import('../src/binary.js').then(m => m.default());
    const postgresStat = await fs.stat(postgres);
    
    // Should have all execute bits set
    expect((postgresStat.mode & expectedPermissions)).toBe(expectedPermissions);
    
    // Re-run initialization to verify permissions remain correct
    await fs.rm(path.join(DB_PATH), { recursive: true, force: true });
    pg = new EmbeddedPostgres(DEFAULT_SETTINGS);
    await pg.initialise();
    
    const afterFixStat = await fs.stat(postgres);
    // Permissions should still be correct
    expect((afterFixStat.mode & expectedPermissions)).toBe(expectedPermissions);
});

const EXIT_HELPER = path.join(__dirname, 'helpers', 'exit-behaviour.mjs');
const DIST_ENTRY = path.join(__dirname, '..', 'dist', 'index.js');

type ExitScenario = 'explicit' | 'natural' | 'signal';

interface ExitResult {
    code: number | null;
    stderr: string;
}

/**
 * Runs one exit scenario in a child process, because every guarantee the
 * shutdown hook makes is about a process on its way out, and a test runner
 * cannot exit to check them. The `signal` scenario waits for the child to
 * report that its postmaster is up, and then terminates it.
 */
async function runExitScenario(mode: ExitScenario, port: number, databaseDir: string): Promise<ExitResult> {
    // GUARD: The helper is a plain Node process, so it runs against `dist`.
    await fs.access(DIST_ENTRY).catch(() => {
        throw new Error(`Could not find ${DIST_ENTRY}. Run \`npm run build\` before these tests.`);
    });

    return new Promise<ExitResult>((resolve, reject) => {
        const child = spawn(process.execPath, [EXIT_HELPER], {
            env: { ...process.env, EP_MODE: mode, EP_PORT: String(port), EP_DIR: databaseDir },
            // Only the `signal` scenario gets an IPC channel: it is an active
            // handle, and a child holding one never drains its event loop, so
            // the scenarios that exit on their own would hang on it forever.
            stdio: mode === 'signal'
                ? ['ignore', 'ignore', 'pipe', 'ipc']
                : ['ignore', 'ignore', 'pipe'],
        });

        let stderr = '';

        child.stderr?.on('data', (chunk: Buffer) => {
            stderr += chunk.toString('utf-8');
        });

        child.on('message', () => {
            child.kill('SIGTERM');
        });

        child.on('error', reject);
        child.on('exit', (code) => resolve({ code, stderr }));
    });
}

it('should exit silently once every cluster has been stopped', async () => {
    const databaseDir = path.join(__dirname, 'data', 'exit-explicit');
    const { code, stderr } = await runExitScenario('explicit', 5435, databaseDir);

    // An embedder that stops its clusters before exiting explicitly has left the
    // hook nothing to do, and must not be told otherwise on its way out.
    expect(stderr).toBe('');
    expect(code).toBe(0);
});

it('should leave a custom process.exitCode alone on the way out', async () => {
    const databaseDir = path.join(__dirname, 'data', 'exit-natural');
    const { code, stderr } = await runExitScenario('natural', 5436, databaseDir);

    expect(stderr).toBe('');
    expect(code).toBe(42);
});

it('should stop a running cluster when the process is signalled', async () => {
    const databaseDir = path.join(__dirname, 'data', 'exit-signal');
    const { code } = await runExitScenario('signal', 5437, databaseDir);

    // 128 + SIGTERM, the conventional exit code for a signalled process.
    expect(code).toBe(143);

    // The cluster is not persistent, so a `stop()` that ran to the end took the
    // data directory with it. Its absence is the proof that it did.
    await expect(fs.stat(databaseDir)).rejects.toThrow();
});
