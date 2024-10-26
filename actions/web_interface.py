# actions/web_interface.py

from typing import Dict, Any, List
from bs4 import BeautifulSoup
from playwright.async_api import async_playwright, TimeoutError
import aiohttp
from googlesearch import search
from markdownify import markdownify as md
import logging
import asyncio

from core.llm_interface import LLMInterface

logger = logging.getLogger(__name__)
llm_interface: LLMInterface = None

def set_llm_interface(llm: LLMInterface):
    global llm_interface
    llm_interface = llm

async def web_search(query: str, num_results: int = 5) -> List[Dict[str, str]]:
    """
    Perform a web search and return a list of results.

    Args:
        query (str): The search query.
        num_results (int): The number of search results to return. Defaults to 5.

    Returns:
        List[Dict[str, str]]: A list of dictionaries containing 'title', 'url', 'description' and 'relevant_content' for each result.
    """
    try:
        search_results = []
        async with aiohttp.ClientSession() as session:
            for result in search(query, num_results=num_results):
                try:
                    async with session.get(result, timeout=5) as response:
                        html = await response.text()
                        soup = BeautifulSoup(html, 'html.parser')
                        title = soup.title.string if soup.title else result
                        description = soup.find('meta', attrs={'name': 'description'})
                        description = description['content'] if description else "No description available."

                        page_content = await visit_page(result)
                        relevant_content = await extract_relevant_content(page_content, query)
                        
                        search_results.append({
                            'url': result,
                            'title': title[:100],  # Truncate long titles
                            'description': description[:200],  # Truncate long descriptions
                            'relevant_content': relevant_content
                        })
                except Exception as e:
                    logger.error(f"Error fetching details for {result}: {str(e)}")
                    search_results.append({
                        'url': result,
                        'title': result,
                        'description': "Unable to fetch details"
                    })
    except Exception as e:
        logger.error(f"Error in web search: {str(e)}")
        return []
    return search_results

async def visit_page(url: str, wait_for_selector: str = None, timeout: int = 30000) -> str:
    """
    Visit a web page and return its content as markdown.

    Args:
        url (str): The URL of the page to visit.
        wait_for_selector (str, optional): A CSS selector to wait for before considering the page loaded.
        timeout (int): Maximum time to wait for the page to load, in milliseconds. Defaults to 30000 (30 seconds).

    Returns:
        str: The page content converted to markdown.
    """
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch()
            page = await browser.new_page()
            await page.goto(url, wait_until="networkidle", timeout=timeout)
            
            if wait_for_selector:
                try:
                    await page.wait_for_selector(wait_for_selector, timeout=timeout)
                except TimeoutError:
                    logger.warning(f"Timeout waiting for selector '{wait_for_selector}' on {url}")
            
            content = await page.content()
            await browser.close()
        
        return md(content)
    except Exception as e:
        logger.error(f"Error visiting page {url}: {str(e)}")
        return f"Error: Unable to visit page {url}"
    
async def extract_relevant_content(markdown_content: str, query: str) -> str:
    """
    Use the LLM to extract the most relevant content from the markdown based on the search query.

    Args:
        markdown_content (str): The full page content in markdown format.
        query (str): The original search query.
        llm_interface (Any): An interface to the language model for content extraction.

    Returns:
        str: The most relevant content extracted from the page.
    """
    global llm_interface

    # Prepare the prompt for the LLM
    prompt = f"""
    Given the following web page content and a search query, extract the most relevant information that answers the query. 
    Provide a concise summary (about 3-4 paragraphs) of the relevant information, maintaining the original markdown formatting where appropriate.

    Search Query: {query}

    Web Page Content:
    {markdown_content[:8000]}  # Limit content to avoid exceeding token limits

    Relevant Information (in markdown format):
    """

    # Use the LLM to extract relevant content
    try:
        relevant_content = await llm_interface.generate(prompt)
    except Exception as e:
        logger.error(f"Error using LLM for content extraction: {str(e)}")
        relevant_content = "Error: Unable to extract relevant content using LLM"

    return relevant_content

async def find_links(url: str, timeout: int = 30000) -> List[Dict[str, str]]:
    """
    Find relevant links on a given web page.

    Args:
        url (str): The URL of the page to analyze.
        timeout (int): Maximum time to wait for the page to load, in milliseconds. Defaults to 30000 (30 seconds).

    Returns:
        List[Dict[str, str]]: A list of dictionaries containing 'text' and 'href' for each link found.
    """
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch()
            page = await browser.new_page()
            await page.goto(url, wait_until="networkidle", timeout=timeout)
            links = await page.evaluate("""
                () => Array.from(document.querySelectorAll('a')).map(a => ({
                    text: a.innerText,
                    href: a.href
                }))
            """)
            await browser.close()
        
        return links
    except Exception as e:
        logger.error(f"Error finding links on page {url}: {str(e)}")
        return []

# Example usage with async/await:
"""
async def example():
    # Search results
    results = await web_search("Artificial Intelligence")
    
    # Visit a page
    content = await visit_page("https://www.example.com")
    
    # Visit a page with specific element
    content_with_element = await visit_page(
        "https://www.example.com", 
        wait_for_selector="#specific-element"
    )
    
    # Find links
    page_links = await find_links("https://www.example.com")
"""
