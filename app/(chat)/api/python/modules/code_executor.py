import subprocess
import sys
import logging
import tempfile
import os
import shutil
import requests  # Added for fetching input files
from urllib.parse import urljoin  # For constructing absolute URLs if needed
import uuid  # For unique plot filenames
import logging

# --- Logging Setup ---
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Calculate project root and define UPLOADS_DIR relative to this script's location
# Assumes this script is at app/(chat)/api/python/modules/code_executor.py
_MODULE_DIR = os.path.dirname(__file__)
_PROJECT_ROOT = os.path.abspath(os.path.join(
    _MODULE_DIR, "..", "..", "..", "..", ".."))
UPLOADS_DIR = os.path.join(_PROJECT_ROOT, "data", "uploads")

# Get Frontend Base URL from environment variable
# Provide a default for local development, but warn if used
FRONTEND_BASE_URL = os.environ.get("FRONTEND_BASE_URL")
if not FRONTEND_BASE_URL:
    FRONTEND_BASE_URL = "http://localhost:3000"  # Default if not set
    # Consider adding a check for FLASK_ENV or similar to only warn in production
    logger.warning(
        f"FRONTEND_BASE_URL environment variable not set. Using default: {FRONTEND_BASE_URL}")
else:
    logger.info(
        f"Using FRONTEND_BASE_URL from environment: {FRONTEND_BASE_URL}")

logger = logging.getLogger(__name__)

# --- Configuration ---
DEFAULT_TIMEOUT = 10  # seconds
MAX_TIMEOUT = 60      # Maximum allowable timeout
PLOT_FILENAME = "plot.png"
# TEMP_PLOT_BASE_URL = "/api/python/temp_plots/"  # No longer needed

# --- Security Best Practices (Simplified for Initial Implementation) ---
# 1. Run in Subprocess: Isolates from the main server process.
# 2. Timeout: Prevents runaway code execution (DoS).
# 3. No Network (Implicit): Standard library code has access, but we don't explicitly grant more.
# 4. Limited Filesystem (Implicit): Runs as the server user, can access what the server can.
#    *RECOMMENDATION*: For production, run the subprocess (or the whole server)
#      as a dedicated low-privilege user with minimal filesystem access, or use
#      stronger sandboxing like Docker containers per execution or tools like firejail.
# 5. Resource Limits (Not Implemented): Use `resource` module on Unix for CPU/memory limits.
# NOTE: Fetching files from URLs introduces network access for the *server* process
#       during the setup phase. Ensure the URLs passed are trusted or implement
#       strict validation/allowlisting if fetching from external sources.

# --- Matplotlib Setup Code ---
# This code will be prepended to the user's code to configure Matplotlib
# and attempt to capture plots automatically.
MATPLOTLIB_SETUP_CODE = f"""
import sys
import os
# Ensure the backend is set *before* importing pyplot
import matplotlib
matplotlib.use('Agg') # Use non-interactive backend good for saving files
import matplotlib.pyplot as plt

# --- Auto-saving plot ---
_original_show = plt.show
_plot_saved = False

def _save_and_show(*args, **kwargs):
    global _plot_saved
    if not _plot_saved: # Save only the first plot generated
        try:
            # Save the current figure to the predefined path in the CWD
            plt.savefig('{PLOT_FILENAME}')
            _plot_saved = True
            print(f"[Plot saved to {PLOT_FILENAME}]", file=sys.stderr) # Info for debugging
        except Exception as e:
            print(f"Error saving plot: {{e}}", file=sys.stderr)
    # We don't call the original show because we're in a non-GUI environment
    # _original_show(*args, **kwargs)
    plt.close() # Close the plot to free memory

# Monkey-patch plt.show
plt.show = _save_and_show

# --- End Matplotlib Setup ---

"""


def execute_python_code(code: str, input_files: list = [], timeout: int = DEFAULT_TIMEOUT, chat_id: str = None) -> dict:
    """
    Executes Python code, handles input files, saves plots persistently.

    Args:
        code: Python code string.
        input_files: List of {'filename', 'url'}.
        timeout: Execution timeout in seconds.
        chat_id: The chat ID for storing persistent plots.

    Returns:
        Dictionary with stdout, stderr, error, success, and plot_url (to persistent location).
    """
    result = {
        "stdout": "",
        "stderr": "",
        "error": None,
        "success": False,
        "plot_url": None,
    }

    if not chat_id:
        logger.error(
            "chat_id is required for persistent plot storage but was not provided.")
        result["error"] = "Internal configuration error: Missing chat_id for execution."
        # Optionally add to stderr as well? result["stderr"] += "\n[Error: Missing chat_id]"
        return result  # Return early as we can't save plots correctly

    # Validate timeout
    if not isinstance(timeout, (int, float)) or timeout <= 0:
        timeout = DEFAULT_TIMEOUT
        logger.warning(f"Invalid timeout provided, using default: {timeout}s")
    elif timeout > MAX_TIMEOUT:
        timeout = MAX_TIMEOUT
        logger.warning(
            f"Provided timeout exceeded maximum, using max: {timeout}s")

    # Create a temporary directory for execution
    temp_dir_path = None
    try:
        # Create a temporary directory
        temp_dir_path = tempfile.mkdtemp()
        temp_dir_name = os.path.basename(
            temp_dir_path)  # Get the unique dir name
        logger.info(f"Created temporary directory: {temp_dir_path}")

        # --- Fetch and Write Input Files ---
        for file_info in input_files:
            filename = file_info['filename']
            url = file_info['url']
            target_path = os.path.join(temp_dir_path, filename)

            # Basic security: prevent writing outside the temp dir
            if os.path.commonprefix([os.path.abspath(target_path), os.path.abspath(temp_dir_path)]) != os.path.abspath(temp_dir_path):
                logger.error(
                    f"Skipping input file due to invalid path: {filename}")
                result[
                    "stderr"] += f"\n[Warning: Skipped input file with potentially unsafe path: {filename}]"
                continue

            try:
                logger.info(
                    f"Fetching input file '{filename}' from relative path {url}")
                # Construct absolute URL using the configured FRONTEND_BASE_URL
                absolute_url = urljoin(
                    FRONTEND_BASE_URL, url) if url.startswith('/') else url
                logger.debug(f"Absolute URL for fetching: {absolute_url}")

                # Add timeout for fetch
                # Consider adding headers if authentication is needed for the /api/uploads endpoint
                response = requests.get(absolute_url, timeout=10)
                response.raise_for_status()  # Raise HTTPError for bad responses (4xx or 5xx)

                with open(target_path, 'wb') as f:  # Write in binary mode
                    f.write(response.content)
                logger.info(f"Successfully wrote input file to {target_path}")

            except requests.exceptions.RequestException as req_err:
                logger.error(
                    f"Error fetching input file {filename} from {url}: {req_err}")
                result["stderr"] += f"\n[Error fetching input file '{filename}': {req_err}]"
                # Decide if this should be a fatal error? For now, just log stderr.
            except IOError as io_err:
                logger.error(
                    f"Error writing input file {filename} to {target_path}: {io_err}")
                result["stderr"] += f"\n[Error writing input file '{filename}': {io_err}]"
            except Exception as e:
                logger.error(
                    f"Unexpected error handling input file {filename}: {e}", exc_info=True)
                result["stderr"] += f"\n[Unexpected error handling input file '{filename}']"
        # --- End Input File Handling ---

        # Prepare and write the main script
        script_filename = "script.py"
        script_path = os.path.join(temp_dir_path, script_filename)
        # Path where plot is initially saved in the temp dir
        temp_plot_path = os.path.join(temp_dir_path, PLOT_FILENAME)

        full_code = MATPLOTLIB_SETUP_CODE + code
        with open(script_path, 'w', encoding='utf-8') as f:
            f.write(full_code)

        # Command to execute the script file within its directory
        cmd = [sys.executable, script_filename]
        logger.info(
            f"Executing code in subprocess within {temp_dir_path} with timeout {timeout}s.")

        # Run the subprocess
        process = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            encoding='utf-8',
            errors='replace',
            cwd=temp_dir_path,
        )

        result["stdout"] = process.stdout
        result["stderr"] = process.stderr
        if process.returncode == 0:
            result["success"] = True
            logger.info(f"Code execution successful in {temp_dir_path}.")
        else:
            result["error"] = f"Code execution failed with return code {process.returncode}"
            if process.stderr:
                filtered_stderr = "\n".join(line for line in process.stderr.splitlines()
                                            if not line.startswith("[Plot saved to"))
                if filtered_stderr.strip():
                    result["error"] += f"\nStderr:\n{filtered_stderr.strip()}"
            logger.warning(
                f"Code execution failed in {temp_dir_path}: {result['error']}")

        # --- Check for plot, move it, and create URL ---
        if os.path.exists(temp_plot_path):
            try:
                # Define persistent storage location
                persistent_upload_dir = os.path.join(UPLOADS_DIR, chat_id)
                unique_plot_filename = f"plot_{uuid.uuid4()}.png"
                persistent_plot_path = os.path.join(
                    persistent_upload_dir, unique_plot_filename)

                # Ensure persistent directory exists
                os.makedirs(persistent_upload_dir, exist_ok=True)

                # Move the plot from temp to persistent storage
                shutil.move(temp_plot_path, persistent_plot_path)
                logger.info(
                    f"Moved plot from {temp_plot_path} to {persistent_plot_path}")

                # Construct the final serving URL (relative to web server root)
                result["plot_url"] = f"/api/uploads/{chat_id}/{unique_plot_filename}"
                logger.info(
                    f"Plot generated. Accessible at URL path: {result['plot_url']}")

            except Exception as e:
                logger.error(
                    f"Error moving/processing plot file {temp_plot_path}: {e}", exc_info=True)
                result["stderr"] += f"\n[Error processing generated plot: {e}]"
                # Plot wasn't successfully moved, so no URL
                result["plot_url"] = None

    except subprocess.TimeoutExpired:
        result["error"] = f"Code execution timed out after {timeout} seconds."
        # Attempt to include any output captured before timeout
        # Note: stdout/stderr might be None or partial in TimeoutExpired in some Python versions/cases
        # process variable might not be defined if timeout happened during setup
        captured_stdout = getattr(process, 'stdout', None)
        captured_stderr = getattr(process, 'stderr', None)
        if captured_stdout:
            result["stdout"] = captured_stdout
        if captured_stderr:
            # Keep potential plot saved message
            result["stderr"] = captured_stderr
        logger.warning(result["error"])
    except FileNotFoundError:
        result["error"] = f"Error: Python interpreter not found at {sys.executable}"
        logger.error(result["error"], exc_info=True)
    except Exception as e:
        result["error"] = f"An unexpected error occurred during code execution: {str(e)}"
        logger.error(result["error"], exc_info=True)
    finally:
        # --- Cleanup the temporary directory --- Always cleanup now
        if temp_dir_path and os.path.exists(temp_dir_path):
            try:
                shutil.rmtree(temp_dir_path)
                logger.info(f"Cleaned up temporary directory: {temp_dir_path}")
            except Exception as e:
                logger.error(
                    f"Error cleaning up temporary directory {temp_dir_path}: {e}")

    return result
