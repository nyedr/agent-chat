import { DataStreamWriter, tool } from "ai";
import { z } from "zod";
import { generateUUID } from "@/lib/utils";

interface PythonInterpreterProps {
  dataStream: DataStreamWriter;
  chatId: string;
}

// Define a schema for input files
const InputFileSchema = z.object({
  filename: z
    .string()
    .describe("The name the file should have in the execution environment."),
  url: z
    .string()
    .describe(
      "The relative URL path from which the file content can be fetched (e.g., /api/uploads/... must start with /)."
    ),
});

// Keep the result structure, but adapt how it's populated
export interface PythonInterpreterResult {
  executionId: string;
  status: "success" | "error";
  stdout?: string;
  stderr?: string;
  error?: string;
  plot_url?: string;
}

// Keep stream delta types for UI compatibility, though loading steps are removed
export type PythonStreamDelta = {
  type:
    | "python-execution-start"
    | "python-stdout-delta"
    | "python-stderr-delta"
    | "python-execution-end"
    | "python-error";
  content: any;
};

const PYTHON_SERVER_URL =
  process.env.PYTHON_SERVER_URL ?? "http://localhost:5328";

const PYTHON_EXECUTION_ENDPOINT = PYTHON_SERVER_URL + "/api/python/execute";
const EXECUTION_TIMEOUT_MS = 15000; // e.g., 15 seconds client-side timeout

export const pythonInterpreter = ({
  dataStream,
  chatId,
}: PythonInterpreterProps) =>
  tool({
    description:
      "Execute Python code snippets via a secure backend service and get the standard output, standard error, and potentially a plot image URL. Can access provided input files relative to the execution directory. Use this for calculations, data manipulation, plotting, or scripting tasks. Available libraries: Python standard library, Matplotlib.",
    parameters: z.object({
      code: z
        .string()
        .describe(
          "The Python code to execute. Ensure the code is complete and runnable."
        ),
      input_files: z
        .array(InputFileSchema)
        .optional()
        .describe(
          "An optional list of files to be made available in the execution environment. Files will be fetched from their URLs and placed in the execution directory."
        ),
    }),
    execute: async ({
      code,
      input_files,
    }): Promise<PythonInterpreterResult> => {
      const executionId = generateUUID();

      const sendData = (type: PythonStreamDelta["type"], content: any) => {
        dataStream.writeData({ type, content: { executionId, ...content } });
      };

      sendData("python-execution-start", {});

      // Prepare file data to send to the Python backend
      // We'll send filename and URL, the Python backend will fetch content
      const filesToSend = input_files?.map((file) => ({
        filename: file.filename,
        url: file.url, // Pass the URL directly
      }));

      try {
        // Abort controller for client-side timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(
          () => controller.abort(),
          EXECUTION_TIMEOUT_MS
        );

        const response = await fetch(PYTHON_EXECUTION_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            code: code,
            input_files: filesToSend ?? [],
            chat_id: chatId,
          }),
          signal: controller.signal,
        });

        // Clear timeout if fetch completes
        clearTimeout(timeoutId);

        if (!response.ok) {
          let errorBody = "Unknown error";
          try {
            const errorJson = await response.json();
            errorBody = errorJson.error || JSON.stringify(errorJson);
          } catch {
            /* Ignore if error body isn't JSON */
          }
          const errorMessage = `Python execution service failed with status ${response.status}: ${errorBody}`;
          console.error(errorMessage);
          sendData("python-error", { error: errorMessage });
          sendData("python-execution-end", {
            status: "error",
            error: errorMessage,
          });
          return {
            executionId,
            status: "error",
            error: errorMessage,
          };
        }

        const result = await response.json();

        // Stream stdout/stderr deltas (currently sending all at once)
        // TODO: Modify Python endpoint to stream if possible for real-time feedback
        if (result.stdout) {
          sendData("python-stdout-delta", { chunk: result.stdout });
        }
        if (result.stderr) {
          sendData("python-stderr-delta", { chunk: result.stderr });
        }
        if (result.error) {
          sendData("python-error", { error: result.error });
        }

        const finalStatus = result.success ? "success" : "error";
        sendData("python-execution-end", {
          status: finalStatus,
          error: result.error,
        });

        return {
          executionId,
          status: finalStatus,
          stdout: result.stdout,
          stderr: result.stderr,
          error: result.error,
          plot_url: result.plot_url,
        };
      } catch (error: any) {
        let errorMessage =
          "An unexpected error occurred calling the Python execution service.";
        if (error.name === "AbortError") {
          errorMessage = `Python execution timed out after ${
            EXECUTION_TIMEOUT_MS / 1000
          } seconds (client-side).`;
        } else if (error instanceof Error) {
          errorMessage = `${errorMessage} ${error.message}`;
        }
        console.error("Python Interpreter Tool Fetch Error:", error);
        sendData("python-error", { error: errorMessage });
        sendData("python-execution-end", {
          status: "error",
          error: errorMessage,
        });
        return {
          executionId,
          status: "error",
          error: errorMessage,
        };
      }
    },
  });
