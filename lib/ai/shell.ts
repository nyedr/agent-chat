import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { PassThrough } from "stream";
import { randomUUID } from "crypto";
import * as path from "path";
import * as fs from "fs";
import { type DataStreamWriter } from "ai";
import { createScopedLogger } from "../terminal/log";

const logger = createScopedLogger("Shell");

export interface ShellExecResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

// --- Constants ---
const BASE_SESSION_DIR_HOST = path.resolve("./wsl_sessions/global_shell");
const BASE_SESSION_DIR_WSL = "/mnt/session";
const NSJAIL_PATH_WSL = "/usr/local/bin/nsjail";
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

// Helper function to convert Windows path to WSL path
function windowsPathToWslPath(winPath: string): string | null {
  const driveMatch = winPath.match(/^([a-zA-Z]):\\?/);
  if (!driveMatch) {
    logger.warn(
      `[ShellManager] Path does not seem to be a Windows drive path: ${winPath}`
    );
    return null;
  }
  const driveLetter = driveMatch[1].toLowerCase();
  const restOfPath = winPath
    .substring(driveMatch[0].length)
    .replace(/\\/g, "/");
  return `/mnt/${driveLetter}/${restOfPath}`;
}

// --- Singleton Process Management ---

interface ManagedProcess {
  process: ChildProcessWithoutNullStreams;
  stdout: PassThrough;
  stderr: PassThrough;
  sessionHostDir: string;
  sessionWslDir: string;
  lastActivityTime: number;
}

let globalManagedProcess: ManagedProcess | null = null;
let idleCheckInterval: NodeJS.Timeout | null = null;

/**
 * Gets the existing global sandboxed shell process or creates a new one if needed.
 * Ensures only one persistent process runs at a time.
 */
async function getOrCreateGlobalProcess(): Promise<ManagedProcess> {
  const now = Date.now();
  if (globalManagedProcess) {
    if (
      globalManagedProcess.process.exitCode === null &&
      !globalManagedProcess.process.killed
    ) {
      logger.log(`[ShellManager] Reusing global sandboxed process.`);
      globalManagedProcess.lastActivityTime = now;
      return globalManagedProcess;
    }
    logger.warn(
      `[ShellManager] Global sandboxed process existed but was dead. Cleaning up.`
    );
    globalManagedProcess = null;
  }

  logger.log(`[ShellManager] Creating new global sandboxed process.`);

  // Prepare Session Directory
  try {
    if (!fs.existsSync(BASE_SESSION_DIR_HOST)) {
      fs.mkdirSync(BASE_SESSION_DIR_HOST, { recursive: true });
      logger.log(
        `[ShellManager] Created global session directory on host: ${BASE_SESSION_DIR_HOST}`
      );
    }
  } catch (err) {
    logger.error(
      `[ShellManager] Failed to create global session directory ${BASE_SESSION_DIR_HOST}:`,
      err
    );
    throw new Error(
      `Failed setup global session directory. ${
        err instanceof Error ? err.message : ""
      }`
    );
  }

  // Convert the host session directory path to its WSL equivalent for the bind mount
  const wslBindSourcePath = windowsPathToWslPath(BASE_SESSION_DIR_HOST);
  if (!wslBindSourcePath) {
    throw new Error(
      `[ShellManager] Failed to convert host session directory ${BASE_SESSION_DIR_HOST} to a WSL path for bind mount.`
    );
  }
  logger.debug(
    `[ShellManager] Host path ${BASE_SESSION_DIR_HOST} converted to WSL path ${wslBindSourcePath}`
  );

  const wslCommand = "wsl";
  const nsjailArgs = [
    "sudo", // Execute nsjail with sudo inside WSL
    NSJAIL_PATH_WSL,
    // "-v", // Verbose flag (disabled for now)
    "--hostname",
    `sandbox-global`,
    "--chroot",
    "/",
    "-Q", // Keep quiet unless errors
    // Mounts
    "-R",
    "/bin",
    "-R",
    "/lib",
    "-R",
    "/lib64",
    "-R",
    "/usr/bin",
    "-R",
    "/usr/lib",
    `-B`,
    `${wslBindSourcePath}:${BASE_SESSION_DIR_WSL}`,
    "-m",
    `none:/tmp:tmpfs:size=67108864`, // Use correct tmpfs syntax
    "--cwd",
    BASE_SESSION_DIR_WSL,
    // Resource Limits (currently disabled)
    // "--rlimit_cpu", "60",
    // "--rlimit_as", "512",
    // "--rlimit_nofile", "128",
    // "--rlimit_fsize", "100",
    "-N", // Keep network disabled for now
    "--",
    "/bin/bash",
    "-i", // Keep interactive
    "-s", // Read commands from stdin, keeps shell alive
  ];

  logger.debug(
    `[ShellManager] Spawning WSL with nsjail args for global process:`,
    nsjailArgs
  );

  try {
    const process = spawn(wslCommand, nsjailArgs, {
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
    });

    const stdout = new PassThrough();
    const stderr = new PassThrough();
    process.stdout.pipe(stdout);
    process.stderr.pipe(stderr);

    const managedProcess: ManagedProcess = {
      process,
      stdout,
      stderr,
      sessionHostDir: BASE_SESSION_DIR_HOST,
      sessionWslDir: BASE_SESSION_DIR_WSL,
      lastActivityTime: now,
    };

    // Process Lifecycle Handlers
    process.on("error", (err) => {
      logger.error(`[ShellManager Global] Process spawn error:`, err);
      managedProcess.stdout.end();
      managedProcess.stderr.end();
      if (globalManagedProcess === managedProcess) globalManagedProcess = null;
    });
    process.on("exit", (code, signal) => {
      logger.log(
        `[ShellManager Global] Persistent process exited (code: ${code}, signal: ${signal})`
      );
      managedProcess.stdout.end();
      managedProcess.stderr.end();
      // Only clear the global reference if the exit was abnormal or via expected methods
      if (code !== 0 || signal !== null) {
        logger.warn(
          `[ShellManager Global] Abnormal exit detected. Clearing global reference.`
        );
        if (globalManagedProcess === managedProcess) {
          globalManagedProcess = null;
          stopIdleCheckInterval();
        }
      } else {
        logger.log(
          `[ShellManager Global] Normal exit (code 0), potentially idle timeout or manual termination.`
        );
        if (globalManagedProcess === managedProcess) {
          globalManagedProcess = null;
          stopIdleCheckInterval();
        }
      }
    });

    await new Promise((resolve) => setTimeout(resolve, 500)); // Allow time for potential early exit

    if (process.exitCode !== null || process.killed) {
      throw new Error(
        `Global sandboxed process terminated during initialization.`
      );
    }

    globalManagedProcess = managedProcess;
    logger.log(
      `[ShellManager] Global sandboxed process created successfully. CWD inside: ${BASE_SESSION_DIR_WSL}`
    );
    startIdleCheckInterval();
    return managedProcess;
  } catch (error) {
    logger.error(
      `[ShellManager] Failed to spawn or initialize global sandboxed process:`,
      error
    );
    globalManagedProcess = null;
    throw new Error(
      `Failed to spawn global sandboxed shell process. ${
        error instanceof Error ? error.message : ""
      }`
    );
  }
}

/**
 * Terminates the global shell process forcefully.
 */
function terminateGlobalShellProcess(): boolean {
  if (globalManagedProcess) {
    logger.log(`[ShellManager] Terminating global process.`);
    globalManagedProcess.process.kill("SIGKILL");
    return true;
  }
  return false;
}

// --- Idle Process Cleanup ---
function checkIdleProcess() {
  if (!globalManagedProcess) return;

  const now = Date.now();
  const idleTime = now - globalManagedProcess.lastActivityTime;
  logger.debug(
    `[ShellManager] Checking idle global process. Idle time: ${Math.round(
      idleTime / 1000
    )}s`
  );

  if (idleTime > IDLE_TIMEOUT_MS) {
    logger.log(
      `[ShellManager] Global process is idle for ${Math.round(
        idleTime / 1000
      )}s. Terminating.`
    );
    terminateGlobalShellProcess();
    stopIdleCheckInterval();
  }
}

function startIdleCheckInterval() {
  if (
    globalManagedProcess &&
    !idleCheckInterval &&
    typeof process !== "undefined" &&
    process.env.NODE_ENV !== "test"
  ) {
    idleCheckInterval = setInterval(checkIdleProcess, CHECK_INTERVAL_MS);
    logger.log(
      `[ShellManager] Started idle check for global process (${
        CHECK_INTERVAL_MS / 1000
      }s). Timeout: ${IDLE_TIMEOUT_MS / 1000}s.`
    );

    const cleanupInterval = () => {
      if (idleCheckInterval) {
        clearInterval(idleCheckInterval);
        idleCheckInterval = null;
      }
    };
    process.off("beforeExit", cleanupInterval);
    process.on("beforeExit", cleanupInterval);
  }
}

function stopIdleCheckInterval() {
  if (idleCheckInterval) {
    clearInterval(idleCheckInterval);
    idleCheckInterval = null;
    logger.log("[ShellManager] Stopped idle process check interval.");
  }
}

// --- Application/Chat Lifecycle Management ---

/**
 * Terminates the current global shell process and optionally starts a new one.
 */
export async function resetGlobalShellProcess(
  startNew: boolean = true
): Promise<void> {
  logger.log(
    `[ShellManager] Resetting global shell process. Start new: ${startNew}`
  );
  stopIdleCheckInterval();
  const terminated = terminateGlobalShellProcess();
  if (terminated) {
    await new Promise((resolve) => setTimeout(resolve, 100)); // Short delay
  }
  if (startNew) {
    try {
      await getOrCreateGlobalProcess();
    } catch (error) {
      logger.error(
        "[ShellManager] Failed to start new process after reset:",
        error
      );
    }
  }
}

/**
 * Terminates the global shell process during application shutdown.
 */
export function cleanupOnShutdown() {
  logger.log(
    "[ShellManager] Cleaning up global shell process on server shutdown..."
  );
  stopIdleCheckInterval();
  terminateGlobalShellProcess();
  logger.log("[ShellManager] Global process cleanup complete.");
}

// --- Core Command Execution ---

/**
 * Executes a command in the managed global shell process.
 * Streams stdout/stderr deltas via the provided DataStreamWriter.
 */
export async function executeCommandInShell(
  command: string,
  dataStream: DataStreamWriter,
  chatId?: string
): Promise<ShellExecResult> {
  const logPrefix = chatId
    ? `[ShellManager Chat:${chatId}]`
    : `[ShellManager Global]`;
  logger.log(
    `${logPrefix} Entered executeCommandInShell for command: ${command}`
  );

  let managedProcess: ManagedProcess;
  try {
    managedProcess = await getOrCreateGlobalProcess();
  } catch (procError) {
    logger.error(
      `${logPrefix} Failed to get or create global process for command execution:`,
      procError
    );
    const errorMessage =
      procError instanceof Error ? procError.message : String(procError);
    throw new Error(`Process Initialization Failed: ${errorMessage}`);
  }

  const executionId = randomUUID();
  const endMarker = `__CMD_END_${executionId}__`;
  const exitMarker = `__EXIT_END_${executionId}__`;

  // Command 1: User command + newline + echo end marker + newline
  const commandToSend = `${command}\necho "${endMarker}"\n`;
  // Command 2: Echo exit code + newline + echo exit marker + newline
  const exitCommandToSend = `echo $?\necho "${exitMarker}"\n`;

  logger.debug(
    `${logPrefix} Constructed commands (executionId: ${executionId}):\nCMD1: ${commandToSend.trim()}\nCMD2: ${exitCommandToSend.trim()}`
  );

  let commandStdout = "";
  let commandStderr = "";
  let exitCode: number | null = null;
  let actualExitCode: number | null = null; // Store exit code from marker
  let state: "running_command" | "waiting_for_exit_code" = "running_command";

  let timeoutHandle: NodeJS.Timeout | null = null;
  let cleanupListeners = () => {};

  const outputPromise = new Promise<void>((resolve, reject) => {
    let stdoutBuffer = "";
    let stderrBuffer = "";
    let resolved = false;

    const onStdout = (chunk: Buffer) => {
      if (resolved) return;
      const data = chunk.toString();
      logger.debug(
        `${logPrefix} Received stdout chunk (State: ${state}): ${JSON.stringify(
          data
        )}`
      );
      stdoutBuffer += data;

      if (state === "running_command") {
        const markerIndex = stdoutBuffer.indexOf(endMarker);
        if (markerIndex !== -1) {
          commandStdout = stdoutBuffer.substring(0, markerIndex).trim();
          logger.debug(
            `${logPrefix} User command End marker found. Final stdout: ${JSON.stringify(
              commandStdout
            )}`
          );
          stdoutBuffer = stdoutBuffer.substring(markerIndex + endMarker.length);

          state = "waiting_for_exit_code";
          logger.debug(
            `${logPrefix} Sending exit code command: ${exitCommandToSend.trim()}`
          );
          managedProcess.process.stdin.write(exitCommandToSend, (err) => {
            if (err) {
              logger.error(
                `${logPrefix} Error writing exit command to stdin:`,
                err
              );
              reject(new Error(`Failed to write exit command: ${err.message}`));
              resolved = true;
              cleanupListeners();
            } else {
              logger.debug(
                `${logPrefix} Successfully wrote exit code command.`
              );
            }
          });
        } else {
          dataStream.writeData({ type: "shell-stdout-delta", content: data });
        }
      } else if (state === "waiting_for_exit_code") {
        const exitMarkerIndex = stdoutBuffer.indexOf(exitMarker);
        if (exitMarkerIndex !== -1) {
          const exitOutput = stdoutBuffer.substring(0, exitMarkerIndex).trim();
          const lines = exitOutput.split("\n");
          const lastLine = lines[lines.length - 1];
          const exitCodeMatch = lastLine.match(/^(\d+)$/);
          if (exitCodeMatch) {
            actualExitCode = parseInt(exitCodeMatch[1], 10);
            logger.debug(`${logPrefix} Parsed exit code: ${actualExitCode}`);
          } else {
            logger.warn(
              `${logPrefix} Could not parse exit code from output: ${exitOutput}`
            );
            actualExitCode = null;
          }
          resolve();
          resolved = true;
          cleanupListeners();
        }
      }
    };

    const onStderr = (chunk: Buffer) => {
      // Always buffer stderr for the final result, and stream deltas
      const data = chunk.toString();
      logger.debug(
        `${logPrefix} Received stderr chunk: ${JSON.stringify(data)}`
      );
      commandStderr += data;
      dataStream.writeData({ type: "shell-stderr-delta", content: data });
    };

    cleanupListeners = () => {
      managedProcess.stdout.removeListener("data", onStdout);
      managedProcess.stderr.removeListener("data", onStderr);
      managedProcess.stdout.removeListener("error", onError);
      managedProcess.stderr.removeListener("error", onError);
      managedProcess.stdout.removeListener("close", onClose);
      managedProcess.stderr.removeListener("close", onClose);
      logger.debug(
        `${logPrefix} Listeners cleaned up for execution ${executionId}.`
      );
    };

    const onError = (err: Error) => {
      if (resolved) return;
      logger.error(
        `${logPrefix} Process stream error during command ${executionId}:`,
        err
      );
      cleanupListeners();
      reject(err);
      resolved = true;
    };

    const onClose = () => {
      if (resolved) return;
      logger.warn(
        `${logPrefix} Process streams closed unexpectedly during command ${executionId} (State: ${state}). The persistent shell might have died.`
      );
      cleanupListeners();
      // Don't resolve here, let the process exit handler or timeout handle final state
      // unless we want to signal this specific error?
      // For now, we assume the main process exit handler will catch the death.
    };

    managedProcess.stdout.on("data", onStdout);
    managedProcess.stderr.on("data", onStderr);
    managedProcess.stdout.once("error", onError);
    managedProcess.stderr.once("error", onError);
    managedProcess.stdout.once("close", onClose);
    managedProcess.stderr.once("close", onClose);

    logger.debug(
      `${logPrefix} Listeners attached for execution ${executionId}`
    );

    const executionTimeoutMillis = 60000;
    timeoutHandle = setTimeout(() => {
      logger.warn(
        `${logPrefix} Command execution timeout (${executionTimeoutMillis}ms) reached for ${executionId}.`
      );
      if (!resolved) {
        cleanupListeners();
        exitCode = -2;
        commandStdout = stdoutBuffer.trim();
        logger.warn(
          `${logPrefix} Timeout occurred. State: ${state}. Captured stdout: ${JSON.stringify(
            commandStdout
          )}`
        );
        resolve();
        resolved = true;
      }
    }, executionTimeoutMillis);

    logger.debug(
      `${logPrefix} Attempting to write command to stdin for ${executionId}`
    );
    managedProcess.process.stdin.write(commandToSend, (err) => {
      if (err) {
        logger.error(
          `${logPrefix} Error writing command to stdin for ${executionId}:`,
          err
        );
        cleanupListeners();
        if (timeoutHandle) clearTimeout(timeoutHandle);
        reject(new Error(`Failed to write command: ${err.message}`));
        resolved = true;
      } else {
        logger.debug(
          `${logPrefix} Successfully wrote command to stdin for ${executionId}`
        );
        // DO NOT close stdin for persistent shell
      }
    });
  });

  // Ensure cleanup happens when the promise settles (resolves or rejects)
  let cleanedUp = false;
  const finalCleanup = () => {
    if (!cleanedUp) {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      cleanupListeners();
      cleanedUp = true;
    }
  };
  outputPromise.finally(finalCleanup);

  try {
    await outputPromise;

    // --- TODO: CWD Management ---
    // Current working directory handling could be added here if needed
    // by parsing the `pwd` output included before the end marker.

    if (globalManagedProcess) {
      globalManagedProcess.lastActivityTime = Date.now();
    }

    exitCode = actualExitCode;
    logger.log(
      `${logPrefix} Command processing complete for ${executionId}. Final Exit Code: ${exitCode}`
    );

    return {
      stdout: commandStdout,
      stderr: commandStderr,
      exitCode: exitCode,
    };
  } catch (execError) {
    logger.error(
      `${logPrefix} Caught execution error for ${executionId}:`,
      execError
    );
    throw execError;
  }
}

// Register cleanup handlers if in a Node.js environment
if (typeof process !== "undefined") {
  process.on("SIGTERM", cleanupOnShutdown);
  process.on("SIGINT", cleanupOnShutdown);
}
