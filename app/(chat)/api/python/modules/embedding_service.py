import os
import logging
import numpy as np
from sentence_transformers import SentenceTransformer

logger = logging.getLogger(__name__)


class EmbeddingService:
    def __init__(self):
        """Initialize the embedding service with a model"""
        self.model_name = os.environ.get("EMBEDDING_MODEL", "all-MiniLM-L6-v2")
        self.embedding_model = None
        self.model_dimensions = None
        self._initialize_model()

    def _initialize_model(self):
        """Initialize the embedding model"""
        logger.info(f"Loading embedding model: {self.model_name}")

        try:
            self.embedding_model = SentenceTransformer(self.model_name)
            logger.info(f"Model loaded successfully: {self.model_name}")
            self.model_dimensions = self.embedding_model.get_sentence_embedding_dimension()
            logger.info(f"Model dimensions: {self.model_dimensions}")
        except Exception as e:
            logger.error(f"Error loading model: {str(e)}")
            # Create a dummy model for development if the real model fails to load
            self.embedding_model = self._create_dummy_model()
            logger.warning("Using dummy embedding model for development")
            self.model_dimensions = self.embedding_model.get_sentence_embedding_dimension()

    def _create_dummy_model(self):
        """Create a dummy model for development purposes"""
        class DummyModel:
            def __init__(self):
                self.dimension = 384  # Typical dimension for smaller models

            def encode(self, texts, **kwargs):
                # Return random vectors for development purposes
                return np.random.randn(len(texts), self.dimension)

            def get_sentence_embedding_dimension(self):
                return self.dimension

        return DummyModel()

    def generate_embeddings(self, texts):
        """Generate embeddings for a list of texts"""
        if not texts:
            return []

        try:
            # Generate embeddings
            embeddings = self.embedding_model.encode(texts).tolist()
            logger.info(f"Successfully generated {len(embeddings)} embeddings")
            return embeddings
        except Exception as e:
            logger.error(f"Error generating embeddings: {str(e)}")
            raise

    def get_model_info(self):
        """Get information about the current embedding model"""
        return {
            "model": self.model_name,
            "dimensions": self.model_dimensions
        }


# Create a singleton instance
embedding_service = EmbeddingService()
