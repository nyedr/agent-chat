import os
import requests
import tempfile
import logging
from urllib.parse import urlparse, urlunparse
import re

from langchain_community.document_loaders import (
    PyMuPDFLoader, TextLoader, UnstructuredWordDocumentLoader,
    UnstructuredPowerPointLoader, UnstructuredExcelLoader,
    UnstructuredMarkdownLoader, BSHTMLLoader
)

logger = logging.getLogger(__name__)

# Map extensions to loaders
LOADER_MAP = {
    "txt": TextLoader,
    "md": UnstructuredMarkdownLoader,
    "html": BSHTMLLoader,
    "htm": BSHTMLLoader,
    "pdf": PyMuPDFLoader,
    "doc": UnstructuredWordDocumentLoader,
    "docx": UnstructuredWordDocumentLoader,
    "pptx": UnstructuredPowerPointLoader,
    "ppt": UnstructuredPowerPointLoader,
    "csv": UnstructuredExcelLoader,
    "xls": UnstructuredExcelLoader,
    "xlsx": UnstructuredExcelLoader,
}


def convert_document_from_url(url):
    """Convert document from URL to text"""
    if not url:
        return {"error": "URL parameter is required"}, 400

    temp_file_path = None
    try:
        logger.info(f"Processing document URL: {url}")

        # --- Resilient Fetch Logic --- #
        response = None
        headers = {
            'User-Agent': 'Mozilla/5.0 (compatible; DeepResearchBot/1.0)'}
        primary_url = url
        try:
            logger.info(f"Attempting primary fetch: {primary_url}")
            response = requests.get(
                primary_url, headers=headers, stream=True, timeout=15)
            response.raise_for_status()
        except requests.exceptions.RequestException as primary_error:
            logger.warning(
                f"Primary fetch failed for {primary_url}: {primary_error}")
            # Attempt fallback for arXiv PDF links
            arxiv_pdf_match = re.match(
                r'(https?://arxiv\.org)/pdf/(.*?)(\.pdf)?$', primary_url, re.IGNORECASE)
            if arxiv_pdf_match:
                base_url, paper_id, _ = arxiv_pdf_match.groups()
                # Try common HTML mirror patterns (ar5iv, openalex-like often use /html/)
                fallback_urls = [
                    f"{base_url}/html/{paper_id}",  # Common pattern
                    # Add other known mirror patterns if needed
                    # f"https://ar5iv.org/abs/{paper_id}" # Example if different domain
                ]
                for fallback_url in fallback_urls:
                    try:
                        logger.info(
                            f"Attempting fallback fetch: {fallback_url}")
                        response = requests.get(
                            fallback_url, headers=headers, stream=True, timeout=15)
                        response.raise_for_status()
                        logger.info(
                            f"Fallback fetch successful for: {fallback_url}")
                        url = fallback_url  # Update the URL if fallback succeeded
                        break  # Stop trying fallbacks
                    except requests.exceptions.RequestException as fallback_error:
                        logger.warning(
                            f"Fallback fetch failed for {fallback_url}: {fallback_error}")
                if not response or not response.ok:
                    raise primary_error  # Re-raise original error if all fallbacks fail
            else:
                raise primary_error  # Re-raise if not arXiv or no fallback succeeded
        # --- End Resilient Fetch Logic --- #

        # Determine file extension from URL or Content-Type
        parsed_url = urlparse(url)
        clean_path_url = urlunparse(parsed_url._replace(query='', fragment=''))
        extension = os.path.splitext(clean_path_url)[1].lower().strip('.')

        if not extension:
            content_type = response.headers.get(
                'Content-Type', '').split(';')[0]
            mime_map = {
                'application/pdf': 'pdf',
                'text/html': 'html',
                'application/msword': 'doc',
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
                'text/plain': 'txt'
            }
            extension = mime_map.get(content_type)

        if not extension:
            return {
                "error": f"Could not determine file type for URL: {url}"
            }, 400

        logger.info(f"Determined file extension: {extension}")

        # Create temporary file with appropriate extension
        with tempfile.NamedTemporaryFile(delete=False, suffix=f'.{extension}') as tmp_file:
            for chunk in response.iter_content(chunk_size=8192):
                tmp_file.write(chunk)
            temp_file_path = tmp_file.name

        # 2. Initialize Loader based on extension
        loader_class = LOADER_MAP.get(extension)
        loader_instance = None

        if not loader_class:
            logger.warning(
                f"Unsupported file type '{extension}'. Attempting to load as plain text.")
            # TextLoader constructor takes file_path and encoding
            # It does NOT take an 'errors' argument here.
            loader_instance = TextLoader(temp_file_path, encoding='utf-8')
        else:
            logger.info(f"Using loader: {loader_class.__name__}")
            try:
                # Initialize the loader without the 'errors' argument
                # Specific loaders might have other relevant args (e.g., encoding)
                if loader_class in [TextLoader, BSHTMLLoader, UnstructuredMarkdownLoader]:
                    loader_instance = loader_class(
                        temp_file_path, encoding='utf-8')
                else:
                    # Most loaders just take the file path
                    loader_instance = loader_class(temp_file_path)
            except Exception as init_error:
                logger.error(
                    f"Failed to initialize loader {loader_class.__name__} for {url}: {str(init_error)}")
                return {"error": f"Failed to initialize document loader for file type {extension}"}, 500

        # 3. Load and Extract Document Content
        docs = []
        content = ""
        try:
            # The .load() method itself might handle errors internally for some loaders
            # We don't pass 'errors' here either.
            docs = loader_instance.load()

            # Filter out potential None values or empty strings from page_content
            content = "\n\n".join(
                [doc.page_content for doc in docs if doc and hasattr(
                    doc, 'page_content') and doc.page_content]
            )

        except Exception as load_error:
            # Log error during loading but try to continue if possible
            logger.warning(
                f"Error during document load for {url} with {loader_instance.__class__.__name__}: {str(load_error)}")
            # Content will remain empty or partially filled if load partially succeeded before error

        if not content:
            logger.warning(
                f"No text content extracted from {url} using {loader_instance.__class__.__name__}. It might be an image-only document or load failed.")
            # Return success but with empty text

        # 4. Extract Title (remains the same)
        title = None
        if docs and hasattr(docs[0], 'metadata') and 'title' in docs[0].metadata:
            title = docs[0].metadata.get('title')
        if not title:
            title = os.path.basename(urlparse(url).path)
            title = os.path.splitext(title)[0]

        logger.info(
            f"Finished processing document. Extracted {len(content)} characters.")

        # 5. Return Result
        return {
            "text": content,  # Could be empty
            "title": title,
            "metadata": {
                "source": url,
                "extension": extension,
                "page_count": len(docs) if docs else 0,
                "content_type": response.headers.get('Content-Type'),
            }
        }

    except requests.exceptions.RequestException as e:
        logger.error(f"Failed to download URL {url}: {str(e)}")
        return {"error": f"Failed to download URL {url}: {str(e)}"}, 500
    except Exception as e:
        logger.error(f"Failed to process document from {url}: {str(e)}")
        return {"error": f"Failed to process document from {url}: {str(e)}"}, 500
    finally:
        # Clean up temp file (remains the same)
        if temp_file_path and os.path.exists(temp_file_path):
            try:
                os.remove(temp_file_path)
                logger.info(f"Removed temporary file: {temp_file_path}")
            except Exception as e:
                logger.warning(
                    f"Failed to remove temporary file {temp_file_path}: {str(e)}")
