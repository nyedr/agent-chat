import { tool, type DataStreamWriter } from "ai";
import { z } from "zod";
import { executeCommandInShell, type ShellExecResult } from "../shell";

const logger = console;

const shellExecParametersSchema = z.object({
  command: z
    .string()
    .describe("The shell command to execute in the global session."),
});

export { type ShellExecResult } from "../shell";

export { resetGlobalShellProcess, cleanupOnShutdown } from "../shell";

export const shellExecTool = ({
  dataStream,
  chatId,
}: {
  dataStream: DataStreamWriter;
  chatId?: string;
}) =>
  tool({
    description:
      "Executes a shell command within a SINGLE persistent, sandboxed server-side session. Use for running code, managing files, and installing packages in the shared global environment.",
    parameters: shellExecParametersSchema,

    execute: async ({
      command,
    }: z.infer<typeof shellExecParametersSchema>): Promise<ShellExecResult> => {
      const logPrefix = chatId
        ? `[ShellExecTool Chat:${chatId}]`
        : `[ShellExecTool Global]`;
      logger.log(`${logPrefix} Received command: ${command}`);

      dataStream.writeData({
        type: "tool-start",
        content: { tool: "shell_exec", args: { command } },
      });

      try {
        const result = await executeCommandInShell(command, dataStream, chatId);

        logger.log(
          `${logPrefix} Command finished. Exit Code: ${result.exitCode}`
        );

        const streamableResult = {
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode === null ? "null" : result.exitCode,
        };

        dataStream.writeData({
          type: "tool-end",
          content: { tool: "shell_exec", result: streamableResult },
        });

        return result;
      } catch (error) {
        logger.error(`${logPrefix} Command execution failed:`, error);
        const errorMessage =
          error instanceof Error ? error.message : String(error);

        dataStream.writeData({
          type: "tool-error",
          content: {
            tool: "shell_exec",
            error: errorMessage,
          },
        });

        return {
          stdout: "",
          stderr: errorMessage,
          exitCode: -1,
        };
      }
    },
  });
