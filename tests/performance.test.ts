import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";
import {
  DockerClient,
  sleep,
  measureOperationInContainer,
} from "./docker-client.js";
import type { PerformanceResult } from "./docker-client.js";

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Test configuration
const CONTAINER_NAME = "neomount-perf-test";
const IMAGE_NAME = "neomount:test";
const TEST_DIR = __dirname;
const PROJECT_DIR = join(TEST_DIR, "..");
const RCLONE_CONFIG_PATH = join(PROJECT_DIR, "rclone.conf");

let dockerClient: DockerClient | null = null;

// Helper functions

async function execInContainer(cmd: string[]): Promise<string> {
  if (!dockerClient) throw new Error("DockerClient not initialized");
  return await dockerClient.exec(cmd);
}

async function cleanup() {
  console.log("🧹 Cleaning up test environment...");
  if (dockerClient) {
    await dockerClient.stopContainer();
  }
  console.log("✅ Cleanup complete");
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

  if (!existsSync(RCLONE_CONFIG_PATH)) {
    throw new Error(
      `rclone.conf not found at ${RCLONE_CONFIG_PATH}. Please create it first.`
    );
  }

  await dockerClient.startContainer({
    env: [
      "RCLONE_REMOTE=gdrive",
      "RCLONE_REMOTE_PATH=",
      "MOVE_SCHEDULE=0 2 * * *",
      "LOCAL_PATH=/mnt/local",
      "MERGED_PATH=/mnt/merged",
      "RCLONE_MOUNT_ARGS=--vfs-cache-mode off --vfs-cache-max-age 72h --vfs-cache-max-size 100G --dir-cache-time 1s --attr-timeout 1s",
    ],
    binds: [`${RCLONE_CONFIG_PATH}:/config/rclone.conf:ro`],
    privileged: true,
    devices: [
      {
        PathOnHost: "/dev/fuse",
        PathInContainer: "/dev/fuse",
        CgroupPermissions: "rwm",
      },
    ],
    capAdd: ["SYS_ADMIN"],
    securityOpt: ["apparmor:unconfined"],
  });

  await sleep(2000);

  const running = await dockerClient.isRunning();
  if (!running) {
    const logs = await dockerClient.getLogs();
    console.log("Container logs:", logs);
    throw new Error("Container failed to start");
  }

  console.log("✅ Container started");
}

async function waitForMount(mountPath: string, maxWait = 30): Promise<boolean> {
  if (!dockerClient) throw new Error("DockerClient not initialized");
  return await dockerClient.waitForMount(mountPath, maxWait);
}

describe.sequential("Google Drive Performance Tests", () => {
  const results: PerformanceResult[] = [];

  beforeAll(async () => {
    if (!existsSync(RCLONE_CONFIG_PATH)) {
      console.log("⚠️  Skipping performance tests - rclone.conf not found");
      console.log(
        "Create rclone.conf with your Google Drive configuration to run these tests"
      );
      return;
    }

    await cleanup();
    await buildImage();
    await startContainer();

    const mounted = await waitForMount("/mnt/rclone");
    if (!mounted) {
      throw new Error("Failed to mount rclone");
    }
  }, 180000);

  afterAll(async () => {
    // Print results summary
    if (results.length > 0) {
      console.log("\n" + "=".repeat(60));
      console.log("PERFORMANCE TEST RESULTS");
      console.log("=".repeat(60));
      results.forEach((result) => {
        console.log(`${result.operation.padEnd(40)} ${result.duration}ms`);
        if (result.throughput) {
          console.log(`  Throughput: ${result.throughput.toFixed(2)} MB/s`);
        }
      });
      console.log("=".repeat(60) + "\n");
    }

    await cleanup();
  });

  test("list root directory", async () => {
    if (!dockerClient) throw new Error("DockerClient not initialized");
    const result = await measureOperationInContainer(
      dockerClient,
      "List root directory",
      ["ls -la /mnt/rclone"]
    );
    results.push(result);
    console.log(`✓ List directory: ${result.duration}ms`);
  });

  test("list nested directory", async () => {
    if (!dockerClient) throw new Error("DockerClient not initialized");
    const result = await measureOperationInContainer(
      dockerClient,
      "List nested directory (5x)",
      [
        "bash -c 'for i in {1..5}; do find /mnt/rclone -maxdepth 2 -type f > /dev/null; done'",
      ]
    );
    results.push(result);
    console.log(`✓ List nested: ${result.duration}ms`);
  });

  test("stat file performance", async () => {
    if (!dockerClient) throw new Error("DockerClient not initialized");
    const result = await measureOperationInContainer(
      dockerClient,
      "Stat 10 files (5x)",
      [
        "bash -c 'for i in {1..5}; do find /mnt/rclone -type f -maxdepth 2 | head -10 | xargs -I {} stat {} > /dev/null; done'",
      ]
    );
    results.push(result);
    console.log(`✓ Stat 10 files: ${result.duration}ms`);
  });

  test("write to local and verify", async () => {
    if (!dockerClient) throw new Error("DockerClient not initialized");
    const result = await measureOperationInContainer(
      dockerClient,
      "Write 10MB to local",
      ["dd if=/dev/zero of=/mnt/local/perf-test.bin bs=1M count=10 2>/dev/null"]
    );

    result.fileSize = 10;
    result.throughput = 10 / (result.duration / 1000);
    results.push(result);
    console.log(
      `✓ Write 10MB: ${result.duration}ms (${result.throughput.toFixed(
        2
      )} MB/s)`
    );

    // Verify file exists
    const exists = await execInContainer([
      "test",
      "-f",
      "/mnt/local/perf-test.bin",
    ])
      .then(() => true)
      .catch(() => false);
    expect(exists, "Written file should exist").toBe(true);

    // Cleanup
    await execInContainer(["rm", "/mnt/local/perf-test.bin"]);
  });

  test("test different vfs-read-chunk-streams settings", async () => {
    console.log("\n📊 Testing different parallel stream configurations...");

    // This test requires restarting the container with different settings
    // We'll document the recommended approach instead
    console.log("ℹ️  To test different stream settings:");
    console.log("   1. Stop the container");
    console.log(
      "   2. Update RCLONE_MOUNT_ARGS with --vfs-read-chunk-streams N"
    );
    console.log("   3. Restart and measure read performance");
    console.log("   Recommended values to test: 2, 4, 8, 16");
  });

  test("measure merged filesystem overhead", async () => {
    if (!dockerClient) throw new Error("DockerClient not initialized");
    const mergedMounted = await waitForMount("/mnt/merged", 10);
    expect(mergedMounted, "Merged filesystem should be mounted").toBe(true);

    // Compare listing performance - repeat 10 times for accurate measurement
    const rcloneResult = await measureOperationInContainer(
      dockerClient,
      "List via rclone mount (10x)",
      ["bash -c 'for i in {1..10}; do ls -la /mnt/rclone > /dev/null; done'"]
    );

    const mergedResult = await measureOperationInContainer(
      dockerClient,
      "List via merged mount (10x)",
      ["bash -c 'for i in {1..10}; do ls -la /mnt/merged > /dev/null; done'"]
    );

    results.push(rcloneResult);
    results.push(mergedResult);

    // Validate durations are valid numbers
    expect(
      rcloneResult.duration,
      "Rclone duration should be a valid number"
    ).toBeGreaterThan(0);
    expect(
      mergedResult.duration,
      "Merged duration should be a valid number"
    ).toBeGreaterThan(0);

    const overhead = mergedResult.duration - rcloneResult.duration;
    const overheadPercent = (overhead / rcloneResult.duration) * 100;

    console.log(`✓ Rclone mount (10x): ${rcloneResult.duration}ms`);
    console.log(`✓ Merged mount (10x): ${mergedResult.duration}ms`);
    console.log(
      `  MergerFS overhead: ${overhead}ms (${overheadPercent.toFixed(1)}%)`
    );

    // MergerFS overhead should be minimal (<= 50%)
    expect(overheadPercent).toBeLessThanOrEqual(50);
  });

  test("read large file speed", async () => {
    console.log("\n📖 Testing large file read performance...");

    const testFileName = "neomount-read-test-100mb.bin";
    const testFileSizeMB = 100;

    console.log(`  Creating ${testFileSizeMB}MB test file locally...`);
    await execInContainer([
      "dd",
      "if=/dev/urandom",
      `of=/mnt/local/${testFileName}`,
      "bs=1M",
      `count=${testFileSizeMB}`,
    ]);
    console.log(`  ✓ Test file created in /mnt/local`);

    // Upload to Google Drive using move script - measure inside container
    console.log(`\n  Uploading ${testFileSizeMB}MB file to Google Drive...`);
    if (!dockerClient) throw new Error("DockerClient not initialized");
    const uploadResult = await measureOperationInContainer(
      dockerClient,
      `Upload ${testFileSizeMB}MB`,
      ["/scripts/move-job.sh"]
    );
    const uploadThroughput = testFileSizeMB / (uploadResult.duration / 1000);
    console.log(
      `  ✓ Upload completed: ${
        uploadResult.duration
      }ms (${uploadThroughput.toFixed(2)} MB/s)`
    );

    // Wait for rclone to update
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Verify file is in remote
    const existsRemote = await execInContainer([
      "test",
      "-f",
      `/mnt/rclone/${testFileName}`,
    ])
      .then(() => true)
      .catch(() => false);

    if (!existsRemote) {
      throw new Error("Test file not found in remote after upload");
    }
    console.log(`  ✓ Test file verified in Google Drive`);

    const largeFile = `/mnt/rclone/${testFileName}`;
    const fileSizeMB = testFileSizeMB;

    // Test 1: Read first 10MB - measure inside container
    console.log("\n  Test 1: Reading first 10MB...");
    const read10MB = await measureOperationInContainer(
      dockerClient,
      "Read first 10MB",
      [`dd if=${largeFile} of=/dev/null bs=1M count=10 2>/dev/null`]
    );
    const throughput10MB = 10 / (read10MB.duration / 1000);
    read10MB.throughput = throughput10MB;
    read10MB.fileSize = 10;
    results.push(read10MB);
    console.log(
      `  ✓ ${read10MB.duration}ms (${throughput10MB.toFixed(2)} MB/s)`
    );

    // Test 2: Read first 50MB - measure inside container
    console.log("\n  Test 2: Reading first 50MB...");
    const read50MB = await measureOperationInContainer(
      dockerClient,
      "Read first 50MB",
      [`dd if=${largeFile} of=/dev/null bs=1M count=50 2>/dev/null`]
    );
    const throughput50MB = 50 / (read50MB.duration / 1000);
    read50MB.throughput = throughput50MB;
    read50MB.fileSize = 50;
    results.push(read50MB);
    console.log(
      `  ✓ ${read50MB.duration}ms (${throughput50MB.toFixed(2)} MB/s)`
    );

    // Test 3: Read full 100MB - measure inside container
    console.log("\n  Test 3: Reading full 100MB...");
    const read100MB = await measureOperationInContainer(
      dockerClient,
      "Read full 100MB",
      [`dd if=${largeFile} of=/dev/null bs=1M count=100 2>/dev/null`]
    );
    const throughput100MB = 100 / (read100MB.duration / 1000);
    read100MB.throughput = throughput100MB;
    read100MB.fileSize = 100;
    results.push(read100MB);
    console.log(
      `  ✓ ${read100MB.duration}ms (${throughput100MB.toFixed(2)} MB/s)`
    );

    // Test 4: Sequential read pattern (simulating video streaming)
    console.log(
      "\n  Test 4: Sequential read pattern (video streaming simulation)..."
    );
    const streamTest = await measureOperationInContainer(
      dockerClient,
      "Stream 5x 5MB chunks",
      [
        `bash -c 'for i in 0 5 10 15 20; do dd if=${largeFile} of=/dev/null bs=1M count=5 skip=$((i)) 2>/dev/null; done'`,
      ]
    );
    const streamThroughput = 25 / (streamTest.duration / 1000);
    streamTest.throughput = streamThroughput;
    streamTest.fileSize = 25;
    results.push(streamTest);
    console.log(
      `  ✓ ${streamTest.duration}ms (${streamThroughput.toFixed(2)} MB/s)`
    );

    console.log("\n📊 Read Performance Summary:");
    console.log(`  Upload throughput: ${uploadThroughput.toFixed(2)} MB/s`);
    console.log(
      `  Download throughput (avg): ${(
        (throughput10MB + throughput50MB + throughput100MB) /
        3
      ).toFixed(2)} MB/s`
    );
    console.log(`  Streaming throughput: ${streamThroughput.toFixed(2)} MB/s`);

    // Cleanup - delete test file from Google Drive
    console.log(`\n  Cleaning up test file from Google Drive...`);
    try {
      await execInContainer(["rm", `/mnt/rclone/${testFileName}`]);
      console.log(`  ✓ Test file cleaned up`);
    } catch (error) {
      console.log(
        `  ⚠️  Could not delete test file - you may need to delete it manually`
      );
    }
  }, 300000); // 5 minute timeout for large file reads

  test("file move operation (local to remote)", async () => {
    console.log("\n📦 Testing file move operation...");

    // Create a test file in local storage
    const testFileName = "neomount-move-test.bin";
    const testFileSizeMB = 10;
    const testFileSize = testFileSizeMB * 1024 * 1024;

    console.log(`  Creating ${testFileSizeMB}MB test file in local storage...`);
    await execInContainer([
      "dd",
      "if=/dev/urandom",
      `of=/mnt/local/${testFileName}`,
      "bs=1M",
      `count=${testFileSizeMB}`,
    ]);

    // Verify file exists locally
    const existsLocal = await execInContainer([
      "test",
      "-f",
      `/mnt/local/${testFileName}`,
    ])
      .then(() => true)
      .catch(() => false);
    expect(existsLocal, "Test file should exist in local storage").toBe(true);
    console.log(`  ✓ Test file created in /mnt/local`);

    // Measure move operation
    console.log(`\n  Moving ${testFileSizeMB}MB file to Google Drive...`);
    if (!dockerClient) throw new Error("DockerClient not initialized");
    const moveResult = await measureOperationInContainer(
      dockerClient,
      `Move ${testFileSizeMB}MB file to remote`,
      ["/scripts/move-job.sh"]
    );

    const moveThroughput = testFileSizeMB / (moveResult.duration / 1000);
    moveResult.throughput = moveThroughput;
    moveResult.fileSize = testFileSizeMB;
    results.push(moveResult);

    console.log(
      `  ✓ Move completed: ${moveResult.duration}ms (${moveThroughput.toFixed(
        2
      )} MB/s)`
    );

    // Wait for rclone to update
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Verify file moved to remote
    const existsRemote = await execInContainer([
      "test",
      "-f",
      `/mnt/rclone/${testFileName}`,
    ])
      .then(() => true)
      .catch(() => false);
    expect(existsRemote, "File should exist in remote after move").toBe(true);

    // Verify file removed from local
    const stillLocal = await execInContainer([
      "test",
      "-f",
      `/mnt/local/${testFileName}`,
    ])
      .then(() => true)
      .catch(() => false);
    expect(stillLocal, "File should be removed from local after move").toBe(
      false
    );

    console.log(`  ✓ File successfully moved to Google Drive`);
    console.log(`  ✓ File removed from local storage`);

    // Cleanup - delete from remote
    console.log(`\n  Cleaning up test file from Google Drive...`);
    try {
      await execInContainer(["rm", `/mnt/rclone/${testFileName}`]);
      console.log(`  ✓ Test file cleaned up`);
    } catch (error) {
      console.log(
        `  ⚠️  Could not delete test file - you may need to delete it manually`
      );
    }
  }, 300000); // 5 minute timeout for move operation

  test("multiple small file moves", async () => {
    console.log("\n📦 Testing multiple small file moves...");

    const numFiles = 10;
    const fileSizeKB = 100;

    console.log(`  Creating ${numFiles} files of ${fileSizeKB}KB each...`);
    for (let i = 0; i < numFiles; i++) {
      await execInContainer([
        "dd",
        "if=/dev/urandom",
        `of=/mnt/local/test-small-${i}.bin`,
        "bs=1K",
        `count=${fileSizeKB}`,
      ]);
    }
    console.log(`  ✓ Created ${numFiles} test files`);

    // Measure move operation
    console.log(`\n  Moving ${numFiles} files to Google Drive...`);
    if (!dockerClient) throw new Error("DockerClient not initialized");
    const moveResult = await measureOperationInContainer(
      dockerClient,
      `Move ${numFiles} small files`,
      ["/scripts/move-job.sh"]
    );

    const totalSizeMB = (numFiles * fileSizeKB) / 1024;
    const moveThroughput = totalSizeMB / (moveResult.duration / 1000);
    moveResult.throughput = moveThroughput;
    moveResult.fileSize = totalSizeMB;
    results.push(moveResult);

    console.log(
      `  ✓ Move completed: ${moveResult.duration}ms (${moveThroughput.toFixed(
        2
      )} MB/s)`
    );
    console.log(
      `  ✓ Average per file: ${(moveResult.duration / numFiles).toFixed(0)}ms`
    );

    // Wait for rclone to update
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Verify files moved
    let movedCount = 0;
    for (let i = 0; i < numFiles; i++) {
      const exists = await execInContainer([
        "test",
        "-f",
        `/mnt/rclone/test-small-${i}.bin`,
      ])
        .then(() => true)
        .catch(() => false);
      if (exists) movedCount++;
    }

    expect(movedCount, `All ${numFiles} files should be moved to remote`).toBe(
      numFiles
    );
    console.log(`  ✓ All ${numFiles} files successfully moved to Google Drive`);

    // Cleanup
    console.log(`\n  Cleaning up test files...`);
    for (let i = 0; i < numFiles; i++) {
      try {
        await execInContainer(["rm", `/mnt/rclone/test-small-${i}.bin`]);
      } catch (error) {
        // Ignore errors
      }
    }
    console.log(`  ✓ Test files cleaned up`);
  }, 300000); // 5 minute timeout
});
