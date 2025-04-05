import logging
from typing import List
from langchain_text_splitters import RecursiveCharacterTextSplitter

logger = logging.getLogger(__name__)


class Chunker:
    def __init__(self, chunk_size: int = 500, chunk_overlap: int = 100):
        """Initialize the text chunker with size and overlap parameters"""
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap
        self.splitter = RecursiveCharacterTextSplitter(
            separators=["\n\n", "\n", ". ", " "],  # More robust separators
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
            length_function=len
        )
        logger.info(
            f"Initialized chunker with size={chunk_size}, overlap={chunk_overlap}")

    def split_text(self, text: str) -> List[str]:
        """Split text into chunks using the configured splitter"""
        if not text or not text.strip():
            logger.warning("Attempted to chunk empty text")
            return []

        chunks = self.splitter.split_text(text)
        logger.info(f"Split text into {len(chunks)} chunks")
        return chunks

    def update_parameters(self, chunk_size: int = None, chunk_overlap: int = None):
        """Update chunker parameters and reinitialize the splitter"""
        if chunk_size is not None:
            self.chunk_size = chunk_size
        if chunk_overlap is not None:
            self.chunk_overlap = chunk_overlap

        self.splitter = RecursiveCharacterTextSplitter(
            separators=["\n\n", "\n", ". ", " "],
            chunk_size=self.chunk_size,
            chunk_overlap=self.chunk_overlap,
            length_function=len
        )
        logger.info(
            f"Updated chunker parameters: size={self.chunk_size}, overlap={self.chunk_overlap}")


# Create a singleton instance with default parameters
chunker = Chunker()
