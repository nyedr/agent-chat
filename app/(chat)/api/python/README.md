# Deep Research Python Backend

This directory contains the Python backend services for the Deep Research application.

## Overview

The Python backend provides several key services:

- Document conversion from URLs to text
- Text embedding generation
- Document reranking based on queries
- Web scraping and content processing

## Modular Architecture

The codebase is organized into modular components:

```
app/(chat)/api/python/
├── modules/
│   ├── __init__.py             # Module exports
│   ├── document_converter.py   # Document URL to text conversion
│   ├── embedding_service.py    # Text embedding generation
│   ├── reranker_service.py     # Document reranking based on queries
│   ├── scraper_processor.py    # Web scraping and content extraction
│   ├── quality_filter.py       # Content quality filtering
│   └── chunker.py              # Text chunking for processing
├── server.py                   # Flask server with API endpoints
├── combined_server.py          # Legacy monolithic implementation
├── environment.yml             # Conda environment definition
└── requirements.txt            # Python package requirements
```

## Endpoints

The server exposes the following endpoints:

1. **Document Conversion**

   - `GET /api/python/convert-document?url=<document_url>`
   - Converts documents from URLs to text

2. **Text Embedding**

   - `POST /api/python/embed`
   - Generates embeddings for a list of texts

3. **Document Reranking**

   - `POST /api/python/rerank`
   - Reranks documents based on a query

4. **Web Scraping & Processing**
   - `POST /api/python/scrape-process`
   - Scrapes and processes web content from URLs

## Setup & Running

1. Create a Conda environment:

   ```
   conda env create -f environment.yml
   ```

2. Activate the environment:

   ```
   conda activate deep-research-python
   ```

3. Run the server:
   ```
   python server.py
   ```

The server will start on port 5328 by default (configurable with the PORT environment variable).

## Migration from Monolithic to Modular Architecture

The original monolithic implementation (`combined_server.py`) has been refactored into modular components for better maintainability and extensibility. To migrate from the monolithic to the modular architecture:

1. **Update startup script**: Change any scripts or processes that run `combined_server.py` to use `server.py` instead.

2. **Environment compatibility**: Both servers use the same environment and dependencies, so no changes to the environment are needed.

3. **API compatibility**: The modular implementation maintains the same API endpoints and response formats as the monolithic version, ensuring backward compatibility.

If you encounter any issues with the modular implementation, you can temporarily switch back to the monolithic version until the issues are resolved.

## Development

To modify or extend the server:

1. **Add a new module**: Create a new Python file in the `modules/` directory
2. **Export the module**: Update `modules/__init__.py` to export new functionality
3. **Add an endpoint**: Add a new route to `server.py` that uses your module

### Benefits of the Modular Architecture

- **Separation of concerns**: Each module handles a specific aspect of the system
- **Code reusability**: Modules can be used independently in different contexts
- **Easier testing**: Isolated components can be tested more effectively
- **Improved maintainability**: Changes to one module have minimal impact on others
- **Better collaboration**: Team members can work on different modules simultaneously
