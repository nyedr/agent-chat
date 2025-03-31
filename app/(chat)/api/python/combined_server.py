from flask import Flask, request, jsonify
import requests
import tempfile
import os
import logging
from urllib.parse import urlparse, urlunparse
from langchain_community.document_loaders import (
    PyMuPDFLoader, TextLoader, UnstructuredWordDocumentLoader,
    UnstructuredPowerPointLoader, UnstructuredExcelLoader,
    UnstructuredMarkdownLoader, BSHTMLLoader
)
import numpy as np
from sentence_transformers import SentenceTransformer

# Configure logging
logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

app = Flask(__name__)

# ============== DOCUMENT CONVERSION FUNCTIONALITY ==============

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


@app.route('/api/python/convert-document', methods=['GET'])
def convert_document():
    """Convert document from URL to text"""
    url = request.args.get('url')
    if not url:
        return jsonify({"error": "URL parameter is required"}), 400

    temp_file_path = None
    try:
        logger.info(f"Processing document URL: {url}")

        # 1. Download file
        headers = {
            'User-Agent': 'Mozilla/5.0 (compatible; DeepResearchBot/1.0)'}
        response = requests.get(url, headers=headers, stream=True, timeout=30)
        response.raise_for_status()  # Check for download errors

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
            return jsonify({
                "error": f"Could not determine file type for URL: {url}"
            }), 400

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
                return jsonify({"error": f"Failed to initialize document loader for file type {extension}"}), 500

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
        return jsonify({
            "text": content,  # Could be empty
            "title": title,
            "metadata": {
                "source": url,
                "extension": extension,
                "page_count": len(docs) if docs else 0,
                "content_type": response.headers.get('Content-Type'),
            }
        })

    except requests.exceptions.RequestException as e:
        logger.error(f"Failed to download URL {url}: {str(e)}")
        return jsonify({"error": f"Failed to download URL {url}: {str(e)}"}), 500
    except Exception as e:
        logger.error(f"Failed to process document from {url}: {str(e)}")
        return jsonify({"error": f"Failed to process document from {url}: {str(e)}"}), 500
    finally:
        # Clean up temp file (remains the same)
        if temp_file_path and os.path.exists(temp_file_path):
            try:
                os.remove(temp_file_path)
                logger.info(f"Removed temporary file: {temp_file_path}")
            except Exception as e:
                logger.warning(
                    f"Failed to remove temporary file {temp_file_path}: {str(e)}")


# ============== EMBEDDING FUNCTIONALITY ==============

# Load embedding model
model_name = os.environ.get("EMBEDDING_MODEL", "all-MiniLM-L6-v2")
logger.info(f"Loading embedding model: {model_name}")

try:
    embedding_model = SentenceTransformer(model_name)
    logger.info(f"Model loaded successfully: {model_name}")
    model_dimensions = embedding_model.get_sentence_embedding_dimension()
    logger.info(f"Model dimensions: {model_dimensions}")
except Exception as e:
    logger.error(f"Error loading model: {str(e)}")
    # Create a dummy model for development if the real model fails to load

    class DummyModel:
        def __init__(self):
            self.dimension = 384  # Typical dimension for smaller models

        def encode(self, texts, **kwargs):
            # Return random vectors for development purposes
            return np.random.randn(len(texts), self.dimension)

        def get_sentence_embedding_dimension(self):
            return self.dimension

    embedding_model = DummyModel()
    logger.warning("Using dummy embedding model for development")
    model_dimensions = embedding_model.get_sentence_embedding_dimension()


@app.route('/api/python/embed', methods=['POST'])
def get_embeddings():
    """Generate embeddings for a list of texts"""
    try:
        data = request.get_json()

        if not data or 'texts' not in data or not isinstance(data['texts'], list):
            return jsonify({
                "error": "Request body must be JSON with a 'texts' array."
            }), 400

        texts = data['texts']
        logger.info(f"Generating embeddings for {len(texts)} texts")

        if not texts:
            return jsonify({"embeddings": []})

        # Generate embeddings
        try:
            # Convert embeddings to list format for JSON serialization
            embeddings = embedding_model.encode(texts).tolist()

            logger.info(f"Successfully generated {len(embeddings)} embeddings")

            return jsonify({
                "embeddings": embeddings,
                "model": model_name,
                "dimensions": model_dimensions,
                "count": len(embeddings)
            })
        except Exception as e:
            logger.error(f"Error generating embeddings: {str(e)}")
            return jsonify({
                "error": f"Failed to generate embeddings: {str(e)}"
            }), 500

    except Exception as e:
        logger.error(f"Error processing request: {str(e)}")
        return jsonify({"error": f"Error processing request: {str(e)}"}), 500


# ============== SERVER CONFIGURATION ==============

# Root route with server info
@app.route('/', methods=['GET'])
def index():
    """Root endpoint to provide information about the server"""
    return jsonify({
        "server": "Deep Research Python Services",
        "version": "1.0.0",
        "endpoints": {
            "document_conversion": "/api/python/convert-document",
            "embeddings": "/api/python/embed"
        },
        "status": "online",
        "embedding_model": model_name,
        "embedding_dimensions": model_dimensions
    })


# For local development
if __name__ == '__main__':
    # Use a single port (default 5328)
    port = int(os.environ.get("PORT", 5328))
    logger.info(
        f"Starting combined Deep Research Python server on port {port}")
    logger.info(
        f"- Document conversion endpoint: http://localhost:{port}/api/python/convert-document")
    logger.info(
        f"- Embedding endpoint: http://localhost:{port}/api/python/embed")
    app.run(host='0.0.0.0', port=port)
