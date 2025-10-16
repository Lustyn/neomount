import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { DockerClient, sleep } from "./docker-client.js";

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Test configuration
const CONTAINER_NAME = "neomount-test";
const IMAGE_NAME = "neomount:test";
const TEST_DIR = __dirname;
const PROJECT_DIR = join(TEST_DIR, "..");
const TEST_DATA_DIR = join(TEST_DIR, "test_data");
const TEST_REMOTE_DIR = join(TEST_DATA_DIR, "remote");
const TEST_LOCAL_DIR = join(TEST_DATA_DIR, "local");
const TEST_MERGED_DIR = join(TEST_DATA_DIR, "merged");

let dockerClient: DockerClient | null = null;

// Helper functions

async function cleanup() {
  console.log("🧹 Cleaning up test environment...");

  if (dockerClient) {
    await dockerClient.stopContainer();
  }

  // Remove test data
  if (existsSync(TEST_DATA_DIR)) {
    try {
      rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    } catch (error) {
      // Ignore permission errors during cleanup
      console.log("⚠️  Could not fully clean up test data, continuing...");
    }
  }

  console.log("✅ Cleanup complete");
}

async function setup() {
  console.log("🔧 Setting up test environment...");

  // Cleanup any previous test runs
  await cleanup();

  // Create test directories
  mkdirSync(TEST_REMOTE_DIR, { recursive: true });
  mkdirSync(TEST_LOCAL_DIR, { recursive: true });
  mkdirSync(TEST_MERGED_DIR, { recursive: true });

  // Create test rclone config
  const rcloneConfig = `[testlocal]
type = local
nounc = true

[testremote]
type = alias
remote = testlocal:/mnt/local-remote
`;
  writeFileSync(join(TEST_DATA_DIR, "rclone.conf"), rcloneConfig);

  // Create some initial files in the remote
  writeFileSync(join(TEST_REMOTE_DIR, "remote1.txt"), "remote file 1");
  writeFileSync(join(TEST_REMOTE_DIR, "remote2.txt"), "remote file 2");
  mkdirSync(join(TEST_REMOTE_DIR, "subdir"), { recursive: true });
  writeFileSync(
    join(TEST_REMOTE_DIR, "subdir", "remote3.txt"),
    "remote file in subdir"
  );

  console.log("✅ Setup complete");
}

async function buildImage() {
  dockerClient = new DockerClient({
    containerName: CONTAINER_NAME,
    imageName: IMAGE_NAME,
  });

  await dockerClient.buildImage(
    PROJECT_DIR,
    ["Dockerfile", "supervisord.conf", "entrypoint.sh", "scripts", "services"],
    IMAGE_NAME
  );
}

async function startContainer() {
  if (!dockerClient) throw new Error("DockerClient not initialized");

  const binds = [
    `${TEST_DATA_DIR}/rclone.conf:/config/rclone.conf:ro`,
    `${TEST_DATA_DIR}/remote:/mnt/local-remote:rw`,
  ];

  await dockerClient.startContainer({
    env: [
      "RCLONE_REMOTE=testremote",
      "RCLONE_REMOTE_PATH=",
      "MOVE_SCHEDULE=0 2 * * *",
      "LOCAL_PATH=/mnt/local",
      "MERGED_PATH=/mnt/merged",
      "RCLONE_MOUNT_ARGS=--vfs-cache-mode off --dir-cache-time 1s --poll-interval 1s",
    ],
    binds,
    privileged: true,
  });

  // Wait for container healthcheck to pass
  const healthy = await dockerClient.waitForHealthy(60);
  if (!healthy) {
    const logs = await dockerClient.getLogs();
    console.log("Container logs:", logs);
    throw new Error("Container healthcheck did not pass within timeout");
  }

  // Test basic command execution
  console.log("🔍 Testing command execution...");
  try {
    const echoTest = await dockerClient.exec(["echo", "test"]);
    if (!echoTest.includes("test")) {
      throw new Error("Basic command execution failed!");
    }
  } catch (e) {
    console.log("❌ Command execution failed:", e);
    const logs = await dockerClient.getLogs();
    console.log("Container logs:", logs);
    throw new Error(`Command execution not working: ${e}`);
  }

  // Validate bind mounts are working
  console.log("🔍 Validating bind mounts...");
  try {
    const testBinds = await dockerClient.exec([
      "ls",
      "-la",
      "/mnt/local-remote",
    ]);
    if (!testBinds.includes("remote1.txt")) {
      throw new Error("Bind mount failed - remote files not accessible!");
    }
  } catch (e) {
    console.log("❌ Bind mount validation failed:", e);
    const logs = await dockerClient.getLogs();
    console.log("Container logs:", logs);
    throw new Error(`Bind mounts not working: ${e}`);
  }

  // Wait for services to be ready
  await sleep(2000);

  // Final check if container is still running
  const running = await dockerClient.isRunning();
  if (!running) {
    console.log("❌ Container stopped/crashed");
    const logs = await dockerClient.getLogs();
    console.log("Container logs:", logs);
    throw new Error("Container failed");
  }

  console.log("✅ Container started and healthy");
}

async function execInContainer(cmd: string[]): Promise<string> {
  if (!dockerClient) throw new Error("DockerClient not initialized");
  return await dockerClient.exec(cmd);
}

async function waitForMount(mountPath: string, maxWait = 10): Promise<boolean> {
  if (!dockerClient) throw new Error("DockerClient not initialized");
  return await dockerClient.waitForMount(mountPath, maxWait);
}

async function checkFileExists(
  relativePath: string,
  inRemote: boolean = false
): Promise<boolean> {
  const basePath = inRemote ? "/mnt/rclone" : "/mnt/local";
  const fullPath = `${basePath}/${relativePath}`;
  try {
    await execInContainer(["test", "-f", fullPath]);
    return true;
  } catch (e) {
    return false;
  }
}

async function writeFileToRemote(
  relativePath: string,
  content: string
): Promise<void> {
  const fullPath = join(TEST_REMOTE_DIR, relativePath);
  const dir = dirname(fullPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(fullPath, content);
}

async function writeFileInContainer(
  path: string,
  content: string
): Promise<void> {
  await execInContainer(["sh", "-c", `echo "${content}" > ${path}`]);
}

async function readFileInContainer(path: string): Promise<string> {
  return await execInContainer(["cat", path]);
}

async function createDirectory(path: string): Promise<void> {
  await execInContainer(["mkdir", "-p", path]);
}

async function fileExistsInContainer(path: string): Promise<boolean> {
  try {
    await execInContainer(["test", "-f", path]);
    return true;
  } catch (e) {
    return false;
  }
}

// Tests - use describe.sequential to ensure proper ordering
describe.sequential("Neomount Integration Tests", () => {
  beforeAll(async () => {
    await setup();
    await buildImage();
    await startContainer();
  }, 120000); // 2 minute timeout for setup

  afterAll(async () => {
    await cleanup();
  });

  test("container is running", async () => {
    if (!dockerClient) throw new Error("DockerClient not initialized");
    const running = await dockerClient.isRunning();
    expect(running, "Container should be running").toBe(true);
  });

  test("rclone mount is working", async () => {
    const mounted = await waitForMount("/mnt/rclone");
    expect(mounted, "Rclone should be mounted at /mnt/rclone").toBe(true);

    // Verify files are visible
    const output = await execInContainer(["ls", "-la", "/mnt/rclone"]);
    expect(output).toContain("remote1.txt");
    expect(output).toContain("remote2.txt");

    // Verify file contents
    const content = await readFileInContainer("/mnt/rclone/remote1.txt");
    expect(content).toContain("remote file 1");
  });

  test("mergerfs mount is working", async () => {
    const mounted = await waitForMount("/mnt/merged");
    expect(mounted, "Mergerfs should be mounted at /mnt/merged").toBe(true);

    // Wait for mergerfs to fully initialize
    await sleep(3000);

    // Verify remote files are visible through merged mount
    const output = await execInContainer(["ls", "-la", "/mnt/merged"]);
    expect(output).toContain("remote1.txt");
    expect(output).toContain("remote2.txt");

    // Verify we can read remote files
    const content = await readFileInContainer("/mnt/merged/remote1.txt");
    expect(content).toContain("remote file 1");
  });

  test("writes go to local filesystem only", async () => {
    // Write a file through merged mount
    await writeFileInContainer("/mnt/merged/local1.txt", "local file");
    await sleep(1000);

    // Verify file exists in local
    expect(
      await checkFileExists("local1.txt", false),
      "File should exist in /mnt/local"
    ).toBe(true);

    // Verify file does NOT exist in remote (rclone mount)
    expect(
      await checkFileExists("local1.txt", true),
      "File should NOT exist in /mnt/rclone (read-only)"
    ).toBe(false);

    // Verify file is readable through merged mount
    const content = await readFileInContainer("/mnt/merged/local1.txt");
    expect(content).toContain("local file");
  });

  test("local files take priority over remote", async () => {
    // Create a file with same name in remote
    await writeFileToRemote("duplicate.txt", "remote version");

    // Create same file in local through container
    await writeFileInContainer("/mnt/local/duplicate.txt", "local version");
    await sleep(2000);

    // Read through merged mount should get local version
    const content = await readFileInContainer("/mnt/merged/duplicate.txt");
    expect(content).toContain("local version");
  });

  test("subdirectory operations work", async () => {
    // Create subdirectory and file
    await createDirectory("/mnt/merged/testdir");
    await writeFileInContainer("/mnt/merged/testdir/test.txt", "test content");
    await sleep(1000);

    // Verify directory and file exist locally
    expect(
      await checkFileExists("testdir/test.txt", false),
      "Subdirectory file should exist in /mnt/local"
    ).toBe(true);

    // Verify readable through merged mount
    const content = await readFileInContainer("/mnt/merged/testdir/test.txt");
    expect(content).toContain("test content");
  });

  test("files from rclone can be moved through mergerfs", async () => {
    // Create a file in the remote (simulating existing remote file)
    await writeFileToRemote("remote-to-move.txt", "remote file to move");
    await sleep(2000); // Wait for rclone to see the file

    // Verify file is visible through rclone mount
    expect(
      await checkFileExists("remote-to-move.txt", true),
      "File should be visible in /mnt/rclone"
    ).toBe(true);

    // Verify file is NOT in local yet
    expect(
      await checkFileExists("remote-to-move.txt", false),
      "File should NOT be in /mnt/local initially"
    ).toBe(false);

    // Move the file through mergerfs mount (stays on rclone, just renamed)
    await execInContainer([
      "mv",
      "/mnt/merged/remote-to-move.txt",
      "/mnt/merged/moved-from-remote.txt",
    ]);
    await sleep(2000);

    // Verify new file exists on rclone (not local)
    expect(
      await checkFileExists("moved-from-remote.txt", true),
      "Moved file should exist in /mnt/rclone"
    ).toBe(true);

    // Verify file is still NOT in local (move happened on rclone)
    expect(
      await checkFileExists("moved-from-remote.txt", false),
      "Moved file should NOT be in /mnt/local (stayed on rclone)"
    ).toBe(false);

    // Verify original file no longer exists
    expect(
      await checkFileExists("remote-to-move.txt", true),
      "Original file should be removed from /mnt/rclone"
    ).toBe(false);

    // Verify content is preserved and accessible through merged mount
    const content = await readFileInContainer(
      "/mnt/merged/moved-from-remote.txt"
    );
    expect(content).toContain("remote file to move");
  });

  test("move job transfers files from local to remote", async () => {
    // Create test files in local
    await writeFileInContainer("/mnt/local/move1.txt", "move test 1");
    await writeFileInContainer("/mnt/local/move2.txt", "move test 2");
    await createDirectory("/mnt/local/movedir");
    await writeFileInContainer("/mnt/local/movedir/move3.txt", "move test 3");
    await sleep(1000);

    // Verify files exist locally before move
    expect(
      await checkFileExists("move1.txt", false),
      "File should exist in /mnt/local before move"
    ).toBe(true);

    // Execute move job
    await execInContainer(["/scripts/move-job.sh"]);

    // Wait for rclone to update
    await sleep(4000);

    // Verify files moved to remote (visible through rclone mount)
    expect(
      await checkFileExists("move1.txt", true),
      "move1.txt should be visible in /mnt/rclone after move"
    ).toBe(true);
    expect(
      await checkFileExists("move2.txt", true),
      "move2.txt should be visible in /mnt/rclone after move"
    ).toBe(true);
    expect(
      await checkFileExists("movedir/move3.txt", true),
      "move3.txt should be visible in /mnt/rclone after move"
    ).toBe(true);

    // Verify files removed from local
    expect(
      await checkFileExists("move1.txt", false),
      "move1.txt should be removed from /mnt/local after move"
    ).toBe(false);
    expect(
      await checkFileExists("move2.txt", false),
      "move2.txt should be removed from /mnt/local after move"
    ).toBe(false);

    // Verify files still accessible through merged mount (now from remote)
    const content = await readFileInContainer("/mnt/merged/move1.txt");
    expect(content).toContain("move test 1");
  });

  test("services are running", async () => {
    // Check if supervisorctl shows services running
    // Note: supervisorctl returns exit code 3 if any process is not RUNNING,
    // but move-job-init is expected to be EXITED, so we catch and check output
    let status;
    try {
      status = await execInContainer(["supervisorctl", "status"]);
    } catch (e: any) {
      // Use the error message as-is, it contains the output
      status = e.message;
    }

    expect(status).toContain("rclone");
    expect(status).toContain("mergerfs");
    expect(status).toContain("RUNNING");
  });

  test("cron is configured correctly", async () => {
    // Check if cron job file exists
    const cronFileExists = await fileExistsInContainer("/etc/cron.d/move-job");
    expect(cronFileExists, "Cron job file should exist").toBe(true);

    // Check if cron daemon is running
    const cronPs = await execInContainer(["pgrep", "cron"]);
    expect(cronPs).toBeTruthy();
  });

  test("log files are created", async () => {
    // List of expected log files from supervisord.conf
    const expectedLogFiles = [
      "/var/log/supervisor/supervisord.log",
      "/var/log/supervisor/rclone.log",
      "/var/log/supervisor/rclone_error.log",
      "/var/log/supervisor/mergerfs.log",
      "/var/log/supervisor/mergerfs_error.log",
      "/var/log/supervisor/cron.log",
      "/var/log/supervisor/cron_error.log",
      "/var/log/supervisor/move-job-init.log",
      "/var/log/supervisor/move-job-init_error.log",
    ];

    // Check each log file exists
    for (const logFile of expectedLogFiles) {
      const exists = await fileExistsInContainer(logFile);
      expect(exists, `Log file ${logFile} should exist`).toBe(true);
    }

    // Verify log files have content (at least supervisord.log should have startup logs)
    const supervisordLog = await readFileInContainer(
      "/var/log/supervisor/supervisord.log"
    );
    expect(supervisordLog).toContain("supervisord started");
  });
});

describe.sequential("Error Handling Tests", () => {
  afterAll(async () => {
    await cleanup();
  });

  test("container exits when config is missing", async () => {
    const testClient = new DockerClient({
      containerName: `${CONTAINER_NAME}-noconfig`,
      imageName: IMAGE_NAME,
    });

    try {
      await testClient.startContainer({
        env: ["RCLONE_REMOTE=testremote"],
        privileged: true,
      });

      await sleep(3000);

      const info = await testClient.inspect();
      expect(
        info?.State.Running,
        "Container should exit when config is missing"
      ).toBe(false);
    } finally {
      await testClient.stopContainer();
    }
  });

  test("container exits when remote is invalid", async () => {
    const testClient = new DockerClient({
      containerName: `${CONTAINER_NAME}-badremote`,
      imageName: IMAGE_NAME,
    });

    try {
      // Create minimal config for this test
      const tempDir = join(TEST_DIR, "temp_test_data");
      mkdirSync(tempDir, { recursive: true });
      writeFileSync(
        join(tempDir, "rclone.conf"),
        "[testremote]\ntype = local\nnounc = true\n"
      );

      await testClient.startContainer({
        env: ["RCLONE_REMOTE=nonexistent"],
        binds: [`${join(tempDir, "rclone.conf")}:/config/rclone.conf:ro`],
        privileged: true,
      });

      await sleep(3000);

      const info = await testClient.inspect();
      expect(
        info?.State.Running,
        "Container should exit when remote is invalid"
      ).toBe(false);

      // Cleanup temp dir
      rmSync(tempDir, { recursive: true, force: true });
    } finally {
      await testClient.stopContainer();
    }
  });
});
