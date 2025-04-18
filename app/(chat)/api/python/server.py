from flask import Flask, request, jsonify
import os
import logging
import asyncio
import numpy as np

from modules import (
    convert_document_from_url,
    embedding_service,
    reranker_service,
    quality_filter_service,
    ScraperProcessor,
    chunker
)
from modules.code_executor import execute_python_code, MAX_TIMEOUT

# Configure logging
logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

app = Flask(__name__)

# Initialize the scraper processor with quality filter service
scraper_processor = ScraperProcessor(quality_filter_service)

# ============== DOCUMENT CONVERSION ENDPOINT ==============


@app.route('/api/python/convert-document', methods=['GET'])
def convert_document():
    """Convert document from URL to text"""
    url = request.args.get('url')

    result = convert_document_from_url(url)

    # Handle tuple responses with status codes
    if isinstance(result, tuple) and len(result) == 2:
        response, status_code = result
        return jsonify(response), status_code

    # Regular successful response
    return jsonify(result)

# ============== EMBEDDING ENDPOINT ==============


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
            embeddings = embedding_service.generate_embeddings(texts)
            model_info = embedding_service.get_model_info()

            logger.info(f"Successfully generated {len(embeddings)} embeddings")

            return jsonify({
                "embeddings": embeddings,
                "model": model_info["model"],
                "dimensions": model_info["dimensions"],
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

# ============== RERANKING ENDPOINT ==============


@app.route('/api/python/rerank', methods=['POST'])
def rerank_documents():
    """Rerank documents based on a query using a local CrossEncoder model."""
    if not reranker_service.is_model_loaded():
        logger.error("Reranker model failed to load and is unavailable.")
        return jsonify({"error": "Reranking service is unavailable due to model load failure."}), 503

    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "Request body must be JSON."}), 400

        query = data.get('query')
        # Expecting [{'id': str, 'text': str}]
        documents = data.get('documents')
        top_k = data.get('top_k', 5)

        try:
            top_results = reranker_service.rerank_documents(
                query, documents, top_k)
            return jsonify({"reranked_documents": top_results})

        except ValueError as ve:
            # Handle validation errors from the service
            return jsonify({"error": str(ve)}), 400

    except Exception as e:
        logger.error(
            f"Error during reranking request: {str(e)}", exc_info=True)
        logger.error(f"Error Type: {type(e).__name__}")
        return jsonify({"error": f"Failed to rerank documents: {str(e)}"}), 500

# ============== SCRAPING & PROCESSING ENDPOINT ==============


@app.route('/api/python/scrape-process', methods=['POST'])
def scrape_process_urls():
    """Scrape and process URLs, handling PDFs directly and others via ScraperProcessor."""
    try:
        data = request.get_json()
        urls = data.get('urls')
        query = data.get('query')
        extract_top_k_chunks = data.get('extract_top_k_chunks')
        crawling_strategy = data.get(
            'crawling_strategy', 'http')  # Default remains http

        # --- Validation ---
        if not urls or not isinstance(urls, list):
            return jsonify({"error": "'urls' (array of strings) is required."}), 400
        if query and not isinstance(query, str):
            return jsonify({"error": "'query' must be a string if provided."}), 400
        if extract_top_k_chunks and (not isinstance(extract_top_k_chunks, int) or extract_top_k_chunks < 1):
            return jsonify({"error": "'extract_top_k_chunks' must be a positive integer if provided."}), 400
        if extract_top_k_chunks and not query:
            return jsonify({"error": "'query' is required when 'extract_top_k_chunks' is provided."}), 400
        if crawling_strategy not in ['http', 'playwright']:
            return jsonify({"error": "Invalid 'crawling_strategy'. Must be 'http' or 'playwright'."}), 400

        logger.info(
            f"Received scrape-process request for {len(urls)} URLs. Strategy for non-PDFs: {crawling_strategy}. Query: '{query[:50] if query else 'N/A'}...' Chunking: {extract_top_k_chunks}"
        )

        # --- Separate URLs and Process ---
        pdf_urls = []
        other_urls = []
        for url in urls:
            if url and isinstance(url, str) and url.lower().strip().endswith('.pdf'):
                pdf_urls.append(url)
            else:
                other_urls.append(url)

        all_results_dict = {}

        # Process PDFs directly
        if pdf_urls:
            logger.info(f"Processing {len(pdf_urls)} PDF URLs directly...")
            for pdf_url in pdf_urls:
                try:
                    # Call the direct PDF converter
                    conversion_result = convert_document_from_url(pdf_url)

                    if isinstance(conversion_result, tuple):  # Error case
                        response_dict, status_code = conversion_result
                        error_message = response_dict.get(
                            'error', f'Direct PDF conversion failed with status {status_code}')
                        logger.warning(
                            f"Failed to convert PDF {pdf_url}: {error_message}")
                        all_results_dict[pdf_url] = {
                            "url": pdf_url,
                            "success": False,
                            "processed_content": None,
                            "title": None,
                            "error": error_message,
                            "quality_score": None,  # No quality score applicable here
                            "relevant_chunks": None
                        }
                    else:  # Success case
                        logger.info(f"Successfully converted PDF {pdf_url}")
                        all_results_dict[pdf_url] = {
                            "url": pdf_url,
                            "success": True,
                            "processed_content": conversion_result.get('text'),
                            "title": conversion_result.get('title'),
                            "error": None,
                            "quality_score": 1.0,  # Assume high quality for direct conversion
                            "relevant_chunks": None
                        }
                except Exception as pdf_err:
                    logger.error(
                        f"Exception during direct PDF conversion for {pdf_url}: {pdf_err}", exc_info=True)
                    all_results_dict[pdf_url] = {
                        "url": pdf_url,
                        "success": False,
                        "processed_content": None,
                        "title": None,
                        "error": f"Server error during PDF conversion: {str(pdf_err)}",
                        "quality_score": None,
                        "relevant_chunks": None
                    }

        # Process other URLs using ScraperProcessor
        if other_urls:
            logger.info(
                f"Processing {len(other_urls)} non-PDF URLs using ScraperProcessor (strategy: {crawling_strategy})...")
            try:
                scrape_results_dict = asyncio.run(
                    scraper_processor.scrape_urls(other_urls, query, crawling_strategy))
                # Ensure structure consistency (add None for missing fields if necessary)
                for url, result in scrape_results_dict.items():
                    if "quality_score" not in result:
                        result["quality_score"] = None
                    if "relevant_chunks" not in result:
                        result["relevant_chunks"] = None
                    if "processed_content" not in result:
                        result["processed_content"] = None
                    if "title" not in result:
                        result["title"] = None
                    if "error" not in result:
                        result["error"] = None

                all_results_dict.update(scrape_results_dict)
            except Exception as scrape_err:
                logger.error(
                    f"Exception during ScraperProcessor execution for non-PDF URLs: {scrape_err}", exc_info=True)
                # Add error entries for all non-PDF URLs if the batch fails
                for url in other_urls:
                    if url not in all_results_dict:  # Avoid overwriting individual PDF errors
                        all_results_dict[url] = {
                            "url": url,
                            "success": False,
                            "processed_content": None,
                            "title": None,
                            "error": f"Scraping batch failed: {str(scrape_err)}",
                            "quality_score": None,
                            "relevant_chunks": None
                        }

        # Reorder results to match original input order
        ordered_results = [all_results_dict.get(
            url) for url in urls if all_results_dict.get(url)]
        # Add placeholders for any URLs that somehow didn't get processed (shouldn't happen)
        processed_urls = {res['url'] for res in ordered_results}
        for url in urls:
            if url not in processed_urls:
                logger.error(
                    f"URL {url} was in the input but missing from final results dict!")
                # Optionally add a placeholder error result if needed

        # Implement relevance chunking if requested (operates on the ordered combined results)
        if query and extract_top_k_chunks and any(r.get("success") and r.get("processed_content") for r in ordered_results):
            logger.info(
                f"Performing relevance chunking for top {extract_top_k_chunks} chunks on combined results..."
            )
            try:
                # Embed the query once
                query_embedding = np.array(
                    embedding_service.generate_embeddings([query])[0])

                for result in ordered_results:
                    # Ensure relevant_chunks field exists
                    if "relevant_chunks" not in result:
                        result["relevant_chunks"] = None

                    if result.get("success") and result.get("processed_content"):
                        content = result["processed_content"]
                        try:
                            chunks = chunker.split_text(content)
                            if chunks:
                                chunk_embeddings = np.array(
                                    embedding_service.generate_embeddings(chunks))

                                # Calculate cosine similarities
                                similarities = np.dot(chunk_embeddings, query_embedding) / \
                                    (np.linalg.norm(chunk_embeddings, axis=1)
                                     * np.linalg.norm(query_embedding))

                                # Get indices of top k chunks
                                top_k_indices = np.argsort(
                                    similarities)[-extract_top_k_chunks:][::-1]

                                result["relevant_chunks"] = [chunks[i]
                                                             for i in top_k_indices]
                            else:
                                # No chunks generated
                                result["relevant_chunks"] = []
                                logger.warning(
                                    f"No chunks generated for {result['url']} during relevance chunking.")
                        except Exception as chunking_err:
                            logger.error(
                                f"Error during relevance chunking/embedding for {result['url']}: {chunking_err}", exc_info=True)
                            result["relevant_chunks"] = None  # Indicate error

            except Exception as embedding_err:
                logger.error(
                    f"Error embedding query or chunks during relevance selection: {embedding_err}", exc_info=True)
                # Set relevant_chunks to None for all results if query embedding fails
                for res in ordered_results:
                    res["relevant_chunks"] = None

        logger.info(f"Finished scrape-process request for {len(urls)} URLs.")
        # Return the ordered results
        return jsonify({"results": ordered_results})

    except Exception as e:
        logger.error(
            f"Error during scrape-process request: {e}", exc_info=True)
        return jsonify({"error": f"Failed to process scraping request: {str(e)}"}), 500

# ============== CODE EXECUTION ENDPOINT ==============


@app.route('/api/python/execute', methods=['POST'])
def execute_code():
    """Executes Python code securely, handling input files and chatId."""
    try:
        data = request.get_json()
        if not data or 'code' not in data or 'chat_id' not in data:
            return jsonify({"error": "Request body must be JSON with 'code' and 'chat_id' fields."}), 400

        code_to_execute = data['code']
        chat_id = data['chat_id']
        input_files = data.get('input_files', [])
        timeout = data.get('timeout', 10)

        # --- Input Validation ---
        if not isinstance(code_to_execute, str):
            return jsonify({"error": "'code' field must be a string."}), 400
        if not isinstance(chat_id, str) or not chat_id:
            return jsonify({"error": "'chat_id' field must be a non-empty string."}), 400
        if not isinstance(input_files, list):
            return jsonify({"error": "'input_files' field must be an array if provided."}), 400
        for item in input_files:
            if not isinstance(item, dict) or 'filename' not in item or 'url' not in item or \
               not isinstance(item['filename'], str) or not isinstance(item['url'], str):
                return jsonify({"error": "Each item in 'input_files' must be an object with string 'filename' and string 'url'."}), 400
        if timeout is not None and not isinstance(timeout, (int, float)):
            return jsonify({"error": "'timeout' field must be a number if provided."}), 400
        # --- End Validation ---

        logger.info(
            f"Received code execution request for chat_id: {chat_id}. Code length: {len(code_to_execute)}. Timeout: {timeout}. Input files: {len(input_files)}"
        )

        # Call the secure execution function, passing input_files and chat_id
        execution_result = execute_python_code(
            code_to_execute,
            input_files=input_files,
            timeout=timeout,
            chat_id=chat_id
        )

        # Return the result (which now includes plot_url instead of plot_base64)
        return jsonify(execution_result)

    except Exception as e:
        logger.error(
            f"Error during code execution request: {e}", exc_info=True)
        return jsonify({"error": f"Failed to execute code: {str(e)}"}), 500

# ============== SERVER INFORMATION ENDPOINT ==============


@app.route('/', methods=['GET'])
def index():
    """Root endpoint to provide information about the server"""
    embedding_info = embedding_service.get_model_info()
    reranker_info = reranker_service.get_model_info()

    return jsonify({
        "server": "Deep Research Python Services",
        "version": "1.0.0",
        "endpoints": {
            "document_conversion": "/api/python/convert-document",
            "embeddings": "/api/python/embed",
            "rerank": "/api/python/rerank",
            "scrape_process": "/api/python/scrape-process",
            "execute_code": "/api/python/execute"
        },
        "status": "online",
        "embedding_model": embedding_info["model"],
        "embedding_dimensions": embedding_info["dimensions"],
        "reranker_model": reranker_info["model"] if reranker_info["loaded"] else "N/A (Load Failed)",
        "quality_model_loaded": quality_filter_service.is_model_loaded(),
        "code_execution_max_timeout": MAX_TIMEOUT
    })


# For local development
if __name__ == '__main__':
    port = int(os.environ.get("PORT", 5328))
    logger.info(f"Starting Deep Research Python server on port {port}")
    logger.info(
        f"- Document conversion endpoint: http://localhost:{port}/api/python/convert-document")
    logger.info(
        f"- Embedding endpoint: http://localhost:{port}/api/python/embed")
    logger.info(
        f"- Reranking endpoint: http://localhost:{port}/api/python/rerank")
    logger.info(
        f"- Scrape & Process endpoint: http://localhost:{port}/api/python/scrape-process")
    logger.info(
        f"- Code Execution endpoint: http://localhost:{port}/api/python/execute")
    app.run(host='0.0.0.0', port=port)
