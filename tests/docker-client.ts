import Docker from "dockerode";
import { Writable } from "stream";
import stripAnsi from "strip-ansi";
import { execSync } from "child_process";

export interface DockerClientOptions {
  containerName: string;
  imageName: string;
}

export interface ContainerConfig {
  env?: string[];
  binds?: string[];
  privileged?: boolean;
  devices?: Array<{
    PathOnHost: string;
    PathInContainer: string;
    CgroupPermissions: string;
  }>;
  capAdd?: string[];
  securityOpt?: string[];
  user?: string;
}

export class DockerClient {
  private docker: Docker;
  private container: Docker.Container | null = null;
  private containerName: string;
  private imageName: string;
  private defaultUser: string | undefined;

  constructor(options: DockerClientOptions) {
    // Configure Docker socket based on platform
    const dockerOptions =
      process.platform === "win32"
        ? { socketPath: "//./pipe/docker_engine" }
        : { socketPath: "/var/run/docker.sock" };

    this.docker = new Docker(dockerOptions);
    this.containerName = options.containerName;
    this.imageName = options.imageName;
  }

  /**
   * Build Docker image from context
   */
  async buildImage(context: string, src: string[], tag: string): Promise<void> {
    console.log("🏗️  Building Docker image...");

    const stream = await this.docker.buildImage(
      {
        context,
        src,
      },
      { t: tag }
    );

    await new Promise((resolve, reject) => {
      this.docker.modem.followProgress(stream, (err, res) =>
        err ? reject(err) : resolve(res)
      );
    });

    console.log("✅ Image built successfully");
  }

  /**
   * Create and start a container
   */
  async startContainer(config: ContainerConfig): Promise<void> {
    console.log("🚀 Starting container...");

    // Clean up any existing container
    try {
      const existing = this.docker.getContainer(this.containerName);
      await existing.stop({ t: 5 });
      await existing.remove();
    } catch (error) {
      // Container doesn't exist, ignore
    }

    this.container = await this.docker.createContainer({
      name: this.containerName,
      Image: this.imageName,
      Env: config.env || [],
      HostConfig: {
        Privileged: config.privileged ?? true,
        Binds: config.binds,
        Devices: config.devices,
        CapAdd: config.capAdd,
        SecurityOpt: config.securityOpt,
      },
    });

    await this.container.start();
    console.log("✅ Container started");
  }

  /**
   * Stop and remove the container
   */
  async stopContainer(): Promise<void> {
    if (!this.container) return;

    try {
      await this.container.stop({ t: 5 });
      await this.container.remove();
      this.container = null;
    } catch (error) {
      // Container might not exist, ignore
    }
  }

  /**
   * Execute a command in the container
   */
  async exec(cmd: string[]): Promise<string> {
    if (!this.container) throw new Error("Container not started");

    const targetContainer = this.docker.getContainer(this.containerName);

    const exec = await targetContainer.exec({
      Cmd: cmd,
      AttachStdout: true,
      AttachStderr: true,
    });

    const stream = await exec.start({ Detach: false });

    return new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";

      const stdoutStream = new Writable({
        write(chunk, encoding, callback) {
          stdout += chunk.toString();
          callback();
        },
      });

      const stderrStream = new Writable({
        write(chunk, encoding, callback) {
          stderr += chunk.toString();
          callback();
        },
      });

      this.docker.modem.demuxStream(stream, stdoutStream, stderrStream);

      stream.on("end", async () => {
        const inspectResult = await exec.inspect();

        const output = stripAnsi(stdout + stderr);

        if (inspectResult.ExitCode !== 0) {
          reject(
            new Error(
              `Command exited with code ${
                inspectResult.ExitCode
              }: ${output.trim()}`
            )
          );
        } else {
          resolve(output.trim());
        }
      });
      stream.on("error", reject);
    });
  }

  /**
   * Check if container is running
   */
  async isRunning(): Promise<boolean> {
    if (!this.container) return false;

    try {
      const info = await this.container.inspect();
      return info.State.Running;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get container logs
   */
  async getLogs(): Promise<string> {
    if (!this.container) return "";

    try {
      const logs = await this.container.logs({ stdout: true, stderr: true });
      return logs.toString();
    } catch (error) {
      return "";
    }
  }

  /**
   * Inspect container state
   */
  async inspect(): Promise<Docker.ContainerInspectInfo | null> {
    if (!this.container) return null;

    try {
      return await this.container.inspect();
    } catch (error) {
      return null;
    }
  }

  /**
   * Wait for a mount to be ready
   */
  async waitForMount(
    mountPath: string,
    maxWait: number = 30
  ): Promise<boolean> {
    console.log(`⏳ Waiting for mount at ${mountPath}...`);

    const maxAttempts = maxWait * 2;
    for (let i = 0; i < maxAttempts; i++) {
      try {
        await this.exec(["mountpoint", "-q", mountPath]);
        console.log(
          `✅ Mount ready at ${mountPath} (${((i * 500) / 1000).toFixed(1)}s)`
        );
        return true;
      } catch (error) {
        if (i % 4 === 0) {
          console.log(
            `   Still waiting for ${mountPath}... (${((i * 500) / 1000).toFixed(
              1
            )}s)`
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    console.log(`❌ Mount not ready after ${maxWait} seconds`);
    return false;
  }

  /**
   * Wait for container to be healthy
   */
  async waitForHealthy(maxWait: number = 60): Promise<boolean> {
    console.log("⏳ Waiting for container to be healthy...");

    for (let i = 0; i < maxWait; i++) {
      const info = await this.inspect();

      if (!info || !info.State.Running) {
        console.log("❌ Container stopped");
        return false;
      }

      if (info.State.Health && info.State.Health.Status === "healthy") {
        console.log("✅ Container is healthy");
        return true;
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    console.log(`❌ Container healthcheck did not pass within timeout`);
    return false;
  }
}

/**
 * Utility function to sleep
 */
export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Measure operation duration
 */
export interface PerformanceResult {
  operation: string;
  duration: number;
  throughput?: number;
  fileSize?: number;
}

export async function measureOperation(
  name: string,
  operation: () => Promise<void>
): Promise<PerformanceResult> {
  const start = Date.now();
  await operation();
  const duration = Date.now() - start;

  return {
    operation: name,
    duration,
  };
}

/**
 * Measure operation time inside container using /usr/bin/time
 */
export async function measureOperationInContainer(
  client: DockerClient,
  name: string,
  commands: string[]
): Promise<PerformanceResult> {
  const script = commands.join(" && ");

  // Use /usr/bin/time with -f format to get elapsed time
  // Write to a temp file to avoid parsing issues with command output
  const tempFile = "/tmp/timing_result.txt";
  const timeCmd = `/usr/bin/time -f "%e" bash -c "${script.replace(
    /"/g,
    '\\"'
  )}" 2>${tempFile} && cat ${tempFile} && rm ${tempFile}`;

  let output: string;
  try {
    output = await client.exec(["sh", "-c", timeCmd]);
  } catch (error) {
    console.error(`Error executing timed command: ${error}`);
    throw error;
  }

  // Extract the last line which should be the elapsed time
  const lines = output.trim().split("\n");
  const elapsedStr = lines[lines.length - 1];

  if (!elapsedStr) {
    console.error(`Failed to parse elapsed time from: "${output}"`);
    throw new Error(`Failed to parse elapsed time from: "${output}"`);
  }

  const elapsedSeconds = parseFloat(elapsedStr);

  if (isNaN(elapsedSeconds)) {
    console.error(`Failed to parse elapsed time from: "${elapsedStr}"`);
    console.error(`Raw output: "${output}"`);
    throw new Error(`Failed to parse elapsed time from: "${elapsedStr}"`);
  }

  const duration = Math.round(elapsedSeconds * 1000); // Convert to milliseconds

  return {
    operation: name,
    duration,
  };
}
