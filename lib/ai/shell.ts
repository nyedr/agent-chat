import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { PassThrough } from "stream";
import { randomUUID } from "crypto";
import * as path from "path";
import * as fs from "fs";
import { type DataStreamWriter } from "ai";
import { createScopedLogger } from "../terminal/log";

// TODO: Replace with your actual logging implementation
const logger = createScopedLogger("Shell");

export interface ShellExecResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  // Optional: Include observed CWD if tracked
  // finalCwd?: string | null;
}

// --- Constants ---
const BASE_SESSION_DIR_HOST = path.resolve("./wsl_sessions/global_shell"); // Single directory for the global process
const BASE_SESSION_DIR_WSL = "/mnt/session"; // Mount point inside sandbox
const NSJAIL_PATH_WSL = "/usr/local/bin/nsjail";
const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // Keep idle timeout for the single process
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

// Helper function to convert Windows path to WSL path
function windowsPathToWslPath(winPath: string): string | null {
  // Match drive letter and rest of path, converting backslashes
  const driveMatch = winPath.match(/^([a-zA-Z]):\\?/);
  if (!driveMatch) {
    logger.warn(
      `[ShellManager] Path does not seem to be a Windows drive path: ${winPath}`
    );
    // Assume it might already be a Linux-style path or handle differently?
    // For now, return null to indicate conversion failure for standard C:\ format.
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

// Single global variable to hold the process reference
let globalManagedProcess: ManagedProcess | null = null;
let idleCheckInterval: NodeJS.Timeout | null = null;

/**
 * Gets the existing global sandboxed shell process or creates a new one if needed.
 */
async function getOrCreateGlobalProcess(): Promise<ManagedProcess> {
  const now = Date.now();
  if (globalManagedProcess) {
    if (
      globalManagedProcess.process.exitCode === null &&
      !globalManagedProcess.process.killed
    ) {
      logger.log(`[ShellManager] Reusing global sandboxed process.`);
      globalManagedProcess.lastActivityTime = now; // Update activity time
      return globalManagedProcess;
    }
    logger.warn(
      `[ShellManager] Global sandboxed process existed but was dead. Cleaning up.`
    );
    globalManagedProcess = null; // Clear the dead process reference
  }

  logger.log(`[ShellManager] Creating new global sandboxed process.`);

  // --- Prepare Session Directory (Single Global) ---
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

  // --- Construct nsjail Command (Global Instance) ---

  // Convert the host session directory path to its WSL equivalent for the bind mount
  const wslBindSourcePath = windowsPathToWslPath(BASE_SESSION_DIR_HOST);
  if (!wslBindSourcePath) {
    // Handle error: could not convert the path
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
    // "-v", // Remove verbose for now
    "--hostname",
    `sandbox-global`,
    "--chroot",
    "/", // Use the actual root filesystem of the WSL instance
    "-Q", // Keep quiet unless errors
    // Mounts (Bind standard directories read-only into the jail)
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
    `${wslBindSourcePath}:${BASE_SESSION_DIR_WSL}`, // Use the converted WSL path
    "-m",
    `none:/tmp:tmpfs:size=67108864`,
    "--cwd",
    BASE_SESSION_DIR_WSL, // Start in the mounted global dir
    // Disable Resource Limits again for testing
    // "--rlimit_cpu",
    // "60",
    // "--rlimit_as",
    // "512",
    // "--rlimit_nofile",
    // "128",
    // "--rlimit_fsize",
    // "100",
    "-N", // Keep network disabled for now
    "--",
    "/bin/bash",
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

    // --- Process Lifecycle Handlers ---
    process.on("error", (err) => {
      logger.error(`[ShellManager Global] Process spawn error:`, err);
      managedProcess.stdout.end();
      managedProcess.stderr.end();
      if (globalManagedProcess === managedProcess) globalManagedProcess = null;
    });
    process.on("exit", (code, signal) => {
      logger.log(
        `[ShellManager Global] Process exited (code: ${code}, signal: ${signal})`
      );
      managedProcess.stdout.end();
      managedProcess.stderr.end();
      if (globalManagedProcess === managedProcess) globalManagedProcess = null;
    });
    // --- End Lifecycle Handlers ---

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
    // Consider directory cleanup policy here
    throw new Error(
      `Failed to spawn global sandboxed shell process. ${
        error instanceof Error ? error.message : ""
      }`
    );
  }
}

/**
 * Terminates the global shell process forcefully, if it exists.
 */
function terminateGlobalShellProcess(): boolean {
  if (globalManagedProcess) {
    logger.log(`[ShellManager] Terminating global process.`);
    globalManagedProcess.process.kill("SIGKILL");
    // The 'exit' handler will set globalManagedProcess to null
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
    stopIdleCheckInterval(); // Stop checking once terminated
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

    // Ensure interval is cleared on process exit
    const cleanupInterval = () => {
      if (idleCheckInterval) {
        clearInterval(idleCheckInterval);
        idleCheckInterval = null;
      }
    };
    process.off("beforeExit", cleanupInterval); // Remove old listener if exists
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
      await getOrCreateGlobalProcess(); // Start a fresh one
    } catch (error) {
      logger.error(
        "[ShellManager] Failed to start new process after reset:",
        error
      );
      // Consider re-throwing or handling differently
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
  // Consider directory cleanup policy here
  logger.log("[ShellManager] Global process cleanup complete.");
}

// --- Core Command Execution ---

/**
 * Executes a command in the managed global shell process.
 * Handles process acquisition, command wrapping, stream piping,
 * exit code parsing, and CWD observation.
 * Streams stdout/stderr deltas via the provided DataStreamWriter.
 */
export async function executeCommandInShell(
  command: string,
  dataStream: DataStreamWriter,
  chatId?: string // For logging context
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
    // Don't use dataStream here, let the caller (tool) handle tool-specific errors
    throw new Error(`Process Initialization Failed: ${errorMessage}`);
  }

  const executionId = randomUUID();

  // --- TODO: CWD Management (using chatId for state lookup) ---
  // let commandToRun = command; // Default
  // const targetCwd = await getStoredCwd(chatId); // Implement persistence
  // if (targetCwd && targetCwd !== managedProcess.sessionWslDir /* Check if already there */) {
  //   const sanitizedCwd = sanitizePathForShell(targetCwd); // Implement robust sanitization
  //   if (sanitizedCwd) {
  //     commandToRun = `cd "${sanitizedCwd}" && ${command}`;
  //     logger.debug(`${logPrefix} Prepended cd to: ${sanitizedCwd}`);
  //   } else {
  //     logger.warn(`${logPrefix} Invalid target CWD skipped: ${targetCwd}`);
  //   }
  // }
  const commandToRun = command; // Using base command for now
  // --- End CWD TODO ---

  const startMarker = `__CMD_START_${executionId}__`;
  const commandToSend = `bash -c 'echo "${startMarker}"; ${commandToRun}'\n`;

  logger.debug(
    `${logPrefix} Constructed command to send (executionId: ${executionId}):\n${commandToSend}`
  );

  let commandStdout = "";
  let commandStderr = "";
  let exitCode: number | null = null;
  let finalPwdOutput: string | null = null;
  let capturing = false;
  let actualExitCode: number | null = null; // Variable to store the real exit code

  // Declare timeout and cleanup in the outer scope
  let timeoutHandle: NodeJS.Timeout | null = null;
  let cleanupListeners = () => {}; // Placeholder

  const outputPromise = new Promise<void>((resolve, reject) => {
    let stdoutBuffer = "";
    let stderrBuffer = ""; // Buffer stderr locally too

    const onStdout = (chunk: Buffer) => {
      const data = chunk.toString();
      logger.debug(
        `${logPrefix} Received stdout chunk (executionId: ${executionId}, capturing: ${capturing}): ${JSON.stringify(
          data
        )}`
      );
      // Always accumulate raw buffer
      stdoutBuffer += data;

      if (capturing) {
        // If already capturing, just append the new data to the clean stdout
        commandStdout += data;
        dataStream.writeData({ type: "shell-stdout-delta", content: data });
      } else if (stdoutBuffer.includes(startMarker)) {
        // Found marker for the first time
        capturing = true;
        // Find the index AFTER the start marker
        const markerEndIndex =
          stdoutBuffer.indexOf(startMarker) + startMarker.length;
        // Extract everything after the marker from the current buffer
        const initialContent = stdoutBuffer.substring(markerEndIndex);
        commandStdout = initialContent; // Initialize clean stdout
        if (initialContent) {
          // Only stream if there's content after marker in this chunk
          dataStream.writeData({
            type: "shell-stdout-delta",
            content: initialContent,
          });
        }
      }
      // We no longer look for end marker here
    };

    const onStderr = (chunk: Buffer) => {
      const data = chunk.toString();
      stderrBuffer += data; // Buffer all stderr
      if (capturing) {
        commandStderr += data; // Also accumulate for final result
        // Stream delta to the tool's dataStream
        dataStream.writeData({ type: "shell-stderr-delta", content: data });
      }
    };

    // Assign the actual cleanup logic to the outer variable
    cleanupListeners = () => {
      managedProcess.stdout.removeListener("data", onStdout);
      managedProcess.stderr.removeListener("data", onStderr);
      managedProcess.stdout.removeListener("error", onError);
      managedProcess.stderr.removeListener("error", onError);
      managedProcess.process.removeListener("exit", onExit); // Remove exit listener
      logger.debug(
        `${logPrefix} Listeners cleaned up for execution ${executionId}.`
      );
    };

    const onError = (err: Error) => {
      logger.error(
        `${logPrefix} Process stream error during command ${executionId}:`,
        err
      );
      cleanupListeners(); // Call outer cleanup
      reject(err); // Reject the promise on stream error
    };

    // Listener for the actual process exit event
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      logger.log(
        `${logPrefix} Process exited (executionId: ${executionId}). Code: ${code}, Signal: ${signal}`
      );
      actualExitCode = code;
      // Trim whitespace/newlines from the captured stdout *after* process exit
      commandStdout = commandStdout.trim();
      // Removed logic checking for startMarker or trailing newline specifically
      resolve(); // Resolve the promise now that the process has truly exited
    };

    // Attach listeners
    managedProcess.stdout.on("data", onStdout);
    managedProcess.stderr.on("data", onStderr);
    managedProcess.stdout.once("error", onError);
    managedProcess.stderr.once("error", onError);
    managedProcess.process.once("exit", onExit); // Listen for process exit

    logger.debug(
      `${logPrefix} Listeners attached for execution ${executionId}`
    );

    const executionTimeoutMillis = 60000; // TODO: Make configurable?
    // Assign the timeout handle to the outer variable
    timeoutHandle = setTimeout(() => {
      logger.warn(
        `${logPrefix} Command execution timeout (${executionTimeoutMillis}ms) reached for ${executionId}.`
      );
      cleanupListeners(); // Call cleanup function from the outer scope
      if (exitCode === null) exitCode = -2; // Specific timeout exit code
      resolve(); // Resolve on timeout
    }, executionTimeoutMillis);

    // Write the command to the process stdin
    logger.debug(
      `${logPrefix} Attempting to write command to stdin for ${executionId}`
    );
    managedProcess.process.stdin.write(commandToSend, (err) => {
      if (err) {
        logger.error(
          `${logPrefix} Error writing to stdin for ${executionId}:`,
          err
        );
        cleanupListeners();
        if (timeoutHandle) clearTimeout(timeoutHandle);
        reject(new Error(`Failed to write command: ${err.message}`));
      } else {
        logger.debug(
          `${logPrefix} Successfully wrote command to stdin for ${executionId}`
        );
        // Explicitly close stdin to signal end of input
        managedProcess.process.stdin.end();
        logger.debug(`${logPrefix} Closed stdin for ${executionId}`); // Added log
      }
    });
  }); // End outputPromise

  // Ensure cleanup happens when the promise settles (resolves or rejects)
  outputPromise.finally(() => {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle); // Clear timeout using the handle from the outer scope
    }
    cleanupListeners(); // Call cleanup function from the outer scope
  });

  try {
    await outputPromise;

    // --- TODO: CWD/Log Persistence ---
    if (chatId && finalPwdOutput) {
      // await storeCwd(chatId, finalPwdOutput); // Implement persistence
      logger.debug(`${logPrefix} Observed CWD: ${finalPwdOutput}`);
    }
    // Logging the command outcome might be better handled by the caller (tool)
    // --- End CWD/Log TODO ---

    // Update activity time AFTER command finishes
    if (globalManagedProcess) {
      globalManagedProcess.lastActivityTime = Date.now();
    }

    // Use the actualExitCode captured from the 'exit' event
    exitCode = actualExitCode;
    logger.log(
      `${logPrefix} Command processing complete for ${executionId}. Final Exit Code: ${exitCode}`
    );

    // Return the structured result
    return {
      stdout: commandStdout, // Return accumulated stdout
      stderr: commandStderr, // Return the fully captured stderr
      exitCode: exitCode,
    };
  } catch (execError) {
    logger.error(
      `${logPrefix} Caught execution error for ${executionId}:`,
      execError
    );
    // Re-throw the error so the caller (tool) can handle it appropriately
    // (e.g., send a tool-error message via dataStream)
    throw execError;
  }
}

// Register cleanup handlers if in a Node.js environment
if (typeof process !== "undefined") {
  process.on("SIGTERM", cleanupOnShutdown);
  process.on("SIGINT", cleanupOnShutdown);
}
