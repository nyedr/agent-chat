import os
import logging
import asyncio
import re
from typing import List, Dict, Optional
from urllib.parse import urlparse
from bs4 import BeautifulSoup
import wikipediaapi

from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig, CacheMode, HTTPCrawlerConfig
from crawl4ai.async_crawler_strategy import AsyncHTTPCrawlerStrategy
from crawl4ai.extraction_strategy import NoExtractionStrategy
from crawl4ai.content_filter_strategy import PruningContentFilter
from crawl4ai.markdown_generation_strategy import DefaultMarkdownGenerator

logger = logging.getLogger(__name__)

# -- Date Extraction Util --


def extract_date_from_html(html_content: str) -> Optional[str]:
    """Extract publication date from HTML content using various patterns"""
    # Order matters: try more specific/reliable tags first
    patterns = [
        # JSON-LD
        r'<script type="application/ld\+json"[^>]*>.*?"datePublished"\s*:\s*"([^"]+)".*?<\/script>',
        r'<script type="application/ld\+json"[^>]*>.*?"dateModified"\s*:\s*"([^"]+)".*?<\/script>',
        # Meta tags
        r'<meta\s+(?:property|name)=["\'](?:article:published_time|og:published_time|publication_date|publish_date|published|datePublished|date)["\']\s+content=["\']([^"\']+)["\']',
        r'<meta\s+(?:property|name)=["\'](?:article:modified_time|og:updated_time|dateModified|lastmod)["\']\s+content=["\']([^"\']+)["\']',
        # Time tags
        r'<time[^>]+datetime=["\']([^ "\']+)["\'][^>]*>.*?</time>'
    ]

    for pattern in patterns:
        match = re.search(pattern, html_content, re.IGNORECASE | re.DOTALL)
        if match and match.group(1):
            # Basic validation/normalization could be added here
            return match.group(1)
    return None

# -- Wikipedia Util --


def get_wikipedia_content(url: str) -> Optional[str]:
    """Retrieve content from Wikipedia using WikipediaAPI"""
    try:
        wiki = wikipediaapi.Wikipedia(
            user_agent="ODRPythonBackend/1.0", language='en')
        title = url.split('/wiki/')[-1].replace('_', ' ')  # Handle underscores
        page = wiki.page(title)
        if page.exists():
            logger.info(f"Fetched Wikipedia content for: {title}")
            return page.text
        else:
            logger.warning(f"Wikipedia page not found for title: {title}")
            return None
    except Exception as e:
        logger.error(f"Error fetching Wikipedia content for {url}: {e}")
        return None


class ScraperProcessor:
    def __init__(self, quality_filter_service=None):
        """Initialize the scraper processor with optional quality filter service"""
        self.quality_filter_service = quality_filter_service

    def process_scraped_data(self, url: str, scrape_result: object, html_content: Optional[str]) -> Dict:
        """Processes the raw data obtained from crawl4ai or Wikipedia."""
        result_base = {
            "url": url, "success": False, "error": None,
            "title": None, "publishedDate": None, "raw_content": None,
            "quality_score": 0.0, "processed_content": None,
            "relevant_chunks": None
        }
        try:
            if not getattr(scrape_result, 'success', False):
                result_base["error"] = f"crawl4ai failed: {getattr(scrape_result, 'error', 'Unknown error')}"
                logger.warning(
                    f"Scrape failed for {url}: {result_base['error']}")
                return result_base

            # Extract content (prefer markdown, fallback to html)
            raw_content = getattr(scrape_result, 'markdown_v2', None)
            if raw_content:
                raw_content = getattr(raw_content, 'raw_markdown', None)

            if not raw_content and html_content:
                try:
                    soup = BeautifulSoup(html_content, 'html.parser')
                    # Extract text from main content areas if possible, otherwise full text
                    main_content = soup.find('main') or soup.find(
                        'article') or soup.find('body')
                    if main_content:
                        raw_content = main_content.get_text(
                            separator='\n', strip=True)
                    else:
                        raw_content = soup.get_text(separator='\n', strip=True)
                    logger.info(
                        f"Used HTML fallback for content extraction for {url}")
                except Exception as bs_error:
                    logger.warning(
                        f"BeautifulSoup parsing failed for {url}: {bs_error}")
                    raw_content = None  # Ensure raw_content is None if parsing fails

            if not raw_content:
                result_base["error"] = "Failed to extract any content (Markdown or HTML)."
                logger.warning(result_base["error"])
                return result_base

            result_base["raw_content"] = raw_content

            # Extract Title
            # Try scrape_result metadata first, then HTML title, then fallback
            result_base["title"] = getattr(
                scrape_result, 'metadata', {}).get('title')
            if not result_base["title"] and html_content:
                title_match = re.search(
                    r'<title>(.*?)<\/title>', html_content, re.IGNORECASE | re.DOTALL)
                if title_match:
                    result_base["title"] = title_match.group(1).strip()
            if not result_base["title"]:
                result_base["title"] = os.path.basename(
                    urlparse(url).path) or url

            # Extract Date
            if html_content:
                result_base["publishedDate"] = extract_date_from_html(
                    html_content)

            # Quality Filtering
            if self.quality_filter_service:
                processed_content, quality_score = self.quality_filter_service.filter_quality_content(
                    raw_content)
                result_base["processed_content"] = processed_content
                result_base["quality_score"] = quality_score

                if not processed_content:
                    logger.warning(
                        f"Content for {url} filtered out due to low quality ({quality_score:.2f}).")
            else:
                # If no quality filter service, use raw content
                result_base["processed_content"] = raw_content
                result_base["quality_score"] = 1.0  # Default high score

            result_base["success"] = True
            logger.info(f"Successfully processed data for: {url}")
            return result_base

        except Exception as e:
            logger.error(
                f"Exception during processing scrape data for {url}: {e}", exc_info=True)
            result_base["error"] = f"Internal server error during processing: {str(e)}"
            result_base["success"] = False  # Ensure success is false on error
            return result_base

    async def scrape_urls(self,
                          urls: List[str],
                          query: Optional[str] = None,
                          crawling_strategy: str = 'http'
                          ) -> Dict[str, Dict]:
        """Scrape and process multiple URLs using the specified strategy"""
        # Filter out non-HTTP URLs early
        valid_urls = [u for u in urls if isinstance(
            u, str) and u.startswith('http')]
        invalid_urls = [u for u in urls if u not in valid_urls]
        scrape_results_dict = {url: {"url": url, "success": False,
                                     "error": "Invalid URL format", "relevant_chunks": None} for url in invalid_urls}

        # Separate Wikipedia URLs
        wiki_urls = [url for url in valid_urls if 'wikipedia.org/wiki/' in url]
        web_urls = [url for url in valid_urls if url not in wiki_urls]

        # Process Wikipedia URLs directly
        for url in wiki_urls:
            logger.info(f"Processing Wikipedia URL: {url}")
            content = get_wikipedia_content(url)
            # Initialize dictionary for the current URL
            processed_result = {
                "url": url, "success": False, "error": None,
                "title": None, "publishedDate": None, "raw_content": None,
                "quality_score": 0.0, "processed_content": None,
                "relevant_chunks": None
            }
            if content:
                processed_result["success"] = True
                processed_result["raw_content"] = content
                processed_result["processed_content"] = content
                processed_result["title"] = url.split(
                    '/wiki/')[-1].replace('_', ' ')
                processed_result["quality_score"] = 1.0  # Assign high score
                logger.info(f"Successfully processed Wikipedia URL: {url}")
            else:
                processed_result["error"] = "Failed to fetch Wikipedia content."
                logger.warning(processed_result["error"])
            # Assign the processed result for the current URL
            scrape_results_dict[url] = processed_result

        # Process Web URLs using a single crawler instance
        if web_urls:
            logger.info(
                f"Processing {len(web_urls)} web URLs with crawl4ai (Strategy: {crawling_strategy})...")

            # Define common crawler run config
            crawler_config = CrawlerRunConfig(
                cache_mode=CacheMode.BYPASS,
                extraction_strategy=NoExtractionStrategy(),
                markdown_generator=DefaultMarkdownGenerator(
                    content_filter=PruningContentFilter())
            )

            # Define the async task helper function
            async def _scrape_task(crawler, url):
                try:
                    logger.info(f"Starting scrape task for: {url}")
                    raw_scrape_result = await crawler.arun(url=url, config=crawler_config)
                    processed_data = self.process_scraped_data(
                        url, raw_scrape_result, getattr(raw_scrape_result, 'html', None))
                    return processed_data
                except Exception as task_exc:
                    logger.error(
                        f"Exception in scrape task for {url}: {task_exc}", exc_info=True)
                    return {"url": url, "success": False, "error": f"Task-level exception: {str(task_exc)}", "relevant_chunks": None}

            # Define the main async function to run the tasks
            results_list = []
            crawler_instance = None
            try:
                # --- Select Crawler Strategy ---
                if crawling_strategy == 'http':
                    logger.info("Using AsyncHTTPCrawlerStrategy")
                    http_config = HTTPCrawlerConfig(
                        method="GET",
                        headers={
                            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"},
                        follow_redirects=True,
                        verify_ssl=True
                    )
                    crawler_instance = AsyncWebCrawler(
                        crawler_strategy=AsyncHTTPCrawlerStrategy(
                            browser_config=http_config)
                    )

                    # *** Handle PDFs separately for HTTP strategy ***
                    http_web_urls = [
                        url for url in web_urls if not url.lower().endswith('.pdf')]
                    pdf_urls = [
                        url for url in web_urls if url.lower().endswith('.pdf')]

                    # Add error results for PDFs immediately to results_list
                    pdf_error_results = []
                    for pdf_url in pdf_urls:
                        logger.warning(
                            f"HTTP strategy cannot process PDF: {pdf_url}")
                        pdf_error_results.append({
                            "url": pdf_url,
                            "success": False,
                            "error": "HTTP crawler cannot process PDF files directly.",
                            "relevant_chunks": None
                        })
                    # Add PDF errors first
                    results_list.extend(pdf_error_results)

                    # *** Run non-PDF HTTP tasks serially for debugging ***
                    scraped_http_results = []
                    if http_web_urls:
                        logger.info(
                            f"Running {len(http_web_urls)} non-PDF HTTP tasks serially...")
                        async with crawler_instance as crawler:
                            for url in http_web_urls:
                                result = await _scrape_task(crawler, url)
                                scraped_http_results.append(result)
                        logger.info("Finished serial non-PDF HTTP tasks.")
                    else:
                        logger.info(
                            "No non-PDF web URLs to process with HTTP strategy.")
                    # Add scraped results
                    results_list.extend(scraped_http_results)
                    # *** End serial execution block ***

                else:  # Playwright strategy (processes all web_urls, including PDFs)
                    logger.info("Using default AsyncPlaywrightCrawlerStrategy")
                    playwright_config = BrowserConfig(
                        headless=True, verbose=False)
                    crawler_instance = AsyncWebCrawler(
                        config=playwright_config)

                    logger.info(
                        f"Running {len(web_urls)} Playwright tasks concurrently...")
                    async with crawler_instance as crawler:
                        tasks = [_scrape_task(crawler, url)
                                 for url in web_urls]
                        results_list = await asyncio.gather(*tasks)
                    logger.info("Finished concurrent Playwright tasks.")
                # --- End Strategy Selection ---

            except Exception as main_exc:
                logger.error(
                    f"Error during AsyncWebCrawler context or gather/serial execution (Strategy: {crawling_strategy}): {main_exc}", exc_info=True)
                # Create error results for all web_urls if crawler setup/execution fails
                # Combine pre-existing PDF errors with new errors
                existing_errors = {
                    res['url']: res for res in results_list if not res.get('success')}
                final_error_results = list(existing_errors.values())
                for url in web_urls:
                    if url not in existing_errors:
                        final_error_results.append({"url": url, "success": False,
                                                    "error": f"Crawler execution error: {str(main_exc)}", "relevant_chunks": None})
                results_list = final_error_results  # Overwrite results_list with combined errors

            # Add web results to the dictionary
            for res in results_list:
                if res and 'url' in res:
                    # Check if the URL is already in the dict from Wikipedia processing or PDF error handling
                    # Only update if it's not a PDF error we already added
                    if res['url'] not in scrape_results_dict or scrape_results_dict[res['url']].get('error') != "HTTP crawler cannot process PDF files directly.":
                        scrape_results_dict[res['url']] = res
                else:
                    logger.error(
                        f"Received invalid result structure from scrape task: {res}")

        return scrape_results_dict
