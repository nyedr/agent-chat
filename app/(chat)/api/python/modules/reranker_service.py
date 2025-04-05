import os
import logging
from typing import List, Dict
from sentence_transformers import CrossEncoder

logger = logging.getLogger(__name__)


class RerankerService:
    def __init__(self):
        """Initialize the reranker service with a CrossEncoder model"""
        self.model_name = os.environ.get(
            "RERANKER_MODEL", "jinaai/jina-reranker-v2-base-multilingual")
        self.reranker = None
        self._initialize_model()

    def _initialize_model(self):
        """Initialize the CrossEncoder reranker model"""
        try:
            logger.info(f"Loading reranker model: {self.model_name}")
            # Use sentence_transformers CrossEncoder
            # Add `device='cuda'` if GPU is available and desired
            self.reranker = CrossEncoder(self.model_name,
                                         max_length=1024, trust_remote_code=True)
            logger.info(
                f"Reranker model loaded successfully: {self.model_name}")
        except Exception as e:
            logger.error(
                f"Failed to load reranker model '{self.model_name}': {e}", exc_info=True)
            # Keep reranker as None, the endpoint will return an error

    def is_model_loaded(self):
        """Check if the reranker model is properly loaded"""
        return self.reranker is not None

    def rerank_documents(self, query: str, documents: List[Dict], top_k: int = 5):
        """Rerank documents based on a query using the CrossEncoder model"""
        if not self.reranker:
            raise ValueError("Reranker model is not properly loaded")

        # Validate inputs
        if not query or not isinstance(query, str):
            raise ValueError("'query' must be a non-empty string")

        if not documents or not isinstance(documents, list):
            raise ValueError("'documents' must be a non-empty list")

        for doc in documents:
            if not isinstance(doc, dict) or 'id' not in doc or 'text' not in doc or not isinstance(doc['text'], str):
                raise ValueError(
                    "Each document must be an object with 'id' and 'text' (string) properties")

        logger.info(
            f"Reranking {len(documents)} documents for query: '{query[:50]}...' (top_k={top_k})")

        # Prepare pairs for the CrossEncoder: [ [query, doc_text1], [query, doc_text2], ... ]
        sentence_pairs = [[query, doc['text']] for doc in documents]

        # Predict scores
        scores = self.reranker.predict(sentence_pairs, convert_to_tensor=False)

        # Combine scores with original documents and sort
        scored_documents = []
        for i, doc in enumerate(documents):
            scored_documents.append({
                "id": doc['id'],
                "text": doc['text'],
                "score": float(scores[i])  # Ensure score is float
            })

        # Sort documents by score in descending order
        reranked_docs = sorted(
            scored_documents, key=lambda x: x['score'], reverse=True)

        # Select top_k results
        top_results = reranked_docs[:top_k]

        logger.info(
            f"Successfully reranked documents. Returning top {len(top_results)}.")

        return top_results

    def get_model_info(self):
        """Get information about the current reranker model"""
        return {
            "model": self.model_name,
            "loaded": self.is_model_loaded()
        }


# Create a singleton instance
reranker_service = RerankerService()
