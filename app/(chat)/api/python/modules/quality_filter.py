import logging
import re
from typing import List, Tuple
import fasttext
from huggingface_hub import hf_hub_download

logger = logging.getLogger(__name__)


class QualityFilterService:
    def __init__(self):
        """Initialize the quality filtering service"""
        self.quality_model_path = None
        self.quality_model = None
        self.quality_score_dict = {
            '__label__Low': 0,
            '__label__Mid': 1,
            '__label__High': 2
        }
        self._initialize_model()

    def _initialize_model(self):
        """Initialize the quality filtering model from Hugging Face"""
        try:
            logger.info("Downloading/Loading quality filtering model...")
            self.quality_model_path = hf_hub_download(
                "kenhktsui/llm-data-textbook-quality-fasttext-classifer-v2",
                "model.bin"
            )
            self.quality_model = fasttext.load_model(self.quality_model_path)
            logger.info("Quality filtering model loaded successfully.")
        except Exception as e:
            logger.error(
                f"Failed to load quality filtering model: {e}", exc_info=True)
            # Proceed without quality filtering if model fails
            self.quality_model = None

    def _replace_newlines(self, text: str) -> str:
        """Replace newlines with spaces for model input"""
        return re.sub("\n+", " ", text)

    def predict_educational_value(self, text_list: List[str]) -> List[float]:
        """Predict educational value scores for a list of texts"""
        if not self.quality_model:
            logger.warning(
                "Quality model not loaded, returning default score 0.")
            return [0.0] * len(text_list)

        processed_texts = [self._replace_newlines(text) for text in text_list]
        try:
            pred = self.quality_model.predict(processed_texts, k=-1)
            score_list = []
            for labels, scores in zip(*pred):
                score = sum(self.quality_score_dict.get(l, 0) *
                            s for l, s in zip(labels, scores))
                score_list.append(float(score))
            return score_list
        except Exception as e:
            logger.error(f"Error during quality prediction: {e}")
            return [0.0] * len(text_list)

    def filter_quality_content(self, text: str, min_score: float = 0.2) -> Tuple[str, float]:
        """Filter content based on quality score"""
        if not text.strip():
            return "", 0.0

        quality_score = self.predict_educational_value([text])[0]

        if quality_score >= min_score:
            # Basic cleaning - more sophisticated cleaning might be needed
            cleaned_text = re.sub(r'\s+', ' ', text).strip()
            return cleaned_text, quality_score
        else:
            return "", quality_score

    def is_model_loaded(self):
        """Check if the quality model is properly loaded"""
        return self.quality_model is not None


# Create a singleton instance
quality_filter_service = QualityFilterService()
