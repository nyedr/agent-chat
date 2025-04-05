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
    """Scrape and process URLs with optional relevance chunking"""
    try:
        data = request.get_json()
        urls = data.get('urls')
        query = data.get('query')
        extract_top_k_chunks = data.get('extract_top_k_chunks')
        # Get crawling strategy from request, default to 'http'
        crawling_strategy = data.get('crawling_strategy', 'http')

        # --- Validation --- (Includes strategy validation)
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
            f"Received scrape-process request for {len(urls)} URLs. Strategy: {crawling_strategy}. Query: '{query[:50] if query else 'N/A'}...' Chunking: {extract_top_k_chunks}"
        )

        # Scrape URLs using the ScraperProcessor, passing the strategy
        scrape_results_dict = asyncio.run(
            scraper_processor.scrape_urls(urls, query, crawling_strategy))

        # Convert dict to list for the response
        final_results_list = list(scrape_results_dict.values())

        # Implement relevance chunking if requested
        if query and extract_top_k_chunks and any(r.get("success") and r.get("processed_content") for r in final_results_list):
            logger.info(
                f"Performing relevance chunking for top {extract_top_k_chunks} chunks...")
            try:
                # Embed the query once
                query_embedding = np.array(
                    embedding_service.generate_embeddings([query])[0])

                for result in final_results_list:
                    if result.get("success") and result.get("processed_content"):
                        content = result["processed_content"]
                        try:
                            chunks = chunker.split_text(content)
                            if chunks:
                                chunk_embeddings = np.array(
                                    embedding_service.generate_embeddings(chunks))

                                # Calculate cosine similarities
                                # Ensure embeddings are numpy arrays for dot product
                                similarities = np.dot(chunk_embeddings, query_embedding) / \
                                    (np.linalg.norm(chunk_embeddings, axis=1)
                                     * np.linalg.norm(query_embedding))

                                # Get indices of top k chunks
                                top_k_indices = np.argsort(
                                    similarities)[-extract_top_k_chunks:][::-1]

                                # Store top chunks (consider storing scores too if needed)
                                result["relevant_chunks"] = [chunks[i]
                                                             for i in top_k_indices]
                                # logger.debug(f"Top {extract_top_k_chunks} chunks extracted for {result['url']}")
                            else:
                                # No chunks generated
                                result["relevant_chunks"] = []
                                logger.warning(
                                    f"No chunks generated for {result['url']}")
                        except Exception as chunking_err:
                            logger.error(
                                f"Error during chunking/embedding for {result['url']}: {chunking_err}", exc_info=True)
                            result["relevant_chunks"] = None  # Indicate error
                    else:
                        # Ensure field exists even if not processed
                        result["relevant_chunks"] = None

            except Exception as embedding_err:
                logger.error(
                    f"Error embedding query or chunks during relevance selection: {embedding_err}", exc_info=True)
                # Set relevant_chunks to None for all results if query embedding fails
                for res in final_results_list:
                    res["relevant_chunks"] = None
        else:
            # Ensure field exists if chunking is not performed
            for res in final_results_list:
                if "relevant_chunks" not in res:
                    res["relevant_chunks"] = None

        logger.info(f"Finished scrape-process request for {len(urls)} URLs.")
        return jsonify({"results": final_results_list})

    except Exception as e:
        logger.error(
            f"Error during scrape-process request: {e}", exc_info=True)
        return jsonify({"error": f"Failed to process scraping request: {str(e)}"}), 500

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
            "scrape_process": "/api/python/scrape-process"
        },
        "status": "online",
        "embedding_model": embedding_info["model"],
        "embedding_dimensions": embedding_info["dimensions"],
        "reranker_model": reranker_info["model"] if reranker_info["loaded"] else "N/A (Load Failed)",
        "quality_model_loaded": quality_filter_service.is_model_loaded()
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
    app.run(host='0.0.0.0', port=port)
