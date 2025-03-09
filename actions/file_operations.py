import asyncio
import os
import json
import csv
from typing import Dict, Any, List
import logging

logger = logging.getLogger(__name__)

def expand_user_path(file_path: str) -> str:
    """
    Expand a user's home directory symbol (e.g., "~/") to a full path, or return the original path if it's a simple filename.

    Args:
        file_path (str): The path to expand.

    Returns:
        str: The expanded file path.
    """
    if os.path.basename(file_path) == file_path:
        return file_path
    return os.path.expanduser(file_path)

def ensure_directory_exists(file_path: str) -> None:
    """
    Ensure that the directory for the given file path exists. Creates directories if they do not exist.

    Args:
        file_path (str): The file path for which the directory should be ensured.
    """
    directory = os.path.dirname(file_path)
    if directory:
        os.makedirs(directory, exist_ok=True)

async def read_file(file_path: str) -> str:
    """
    Read and return the contents of a file.

    Args:
        file_path (str): The path to the file to be read.

    Returns:
        str: The content of the file, or an error message if the file could not be read.
    """
    try:
        full_path = os.path.abspath(expand_user_path(file_path))
        with open(full_path, 'r') as file:
            content = file.read()
        logger.info(f"File read successfully: {full_path}")
        return content
    except FileNotFoundError:
        logger.error(f"File not found: {full_path}")
        return f"Error: File not found at {full_path}"
    except IOError as e:
        logger.error(f"Error reading file {full_path}: {str(e)}")
        return f"Error reading file: {str(e)}"

async def write_file(file_path: str, content: Any) -> Dict[str, Any]:
    """
    Write content to a file. Handles structured data appropriately.
    
    Args:
        file_path (str): The path to the file where the content will be written.
        content (Any): The content to write to the file.
        
    Returns:
        Dict[str, Any]: A result indicating success or failure with details
    """
    try:
        # Process the content based on its type
        processed_content = ""
        
        if isinstance(content, dict):
            # Handle dictionary result from other actions
            if 'code' in content:
                # For code generation results
                processed_content = content['code']
            elif 'stdout' in content:
                # For execution results
                processed_content = content['stdout']
            elif 'result' in content:
                # For general results
                processed_content = str(content['result'])
            elif 'error' in content:
                # For error results
                processed_content = f"Error: {content['error']}"
            else:
                # For other dictionaries, use JSON
                processed_content = json.dumps(content, indent=2)
        else:
            # For non-dictionary content
            processed_content = str(content)
        
        # Create the full path and ensure directory exists
        full_path = os.path.abspath(expand_user_path(file_path))
        ensure_directory_exists(full_path)
        
        # Write the content
        with open(full_path, 'w') as file:
            file.write(processed_content)
        
        logger.info(f"File written successfully: {full_path}")
        return {
            "success": True,
            "message": f"File written successfully: {full_path}",
            "file_path": full_path,
            "content_length": len(processed_content)
        }
    except Exception as e:
        logger.error(f"Error writing to file {file_path}: {str(e)}")
        return {
            "success": False,
            "error": f"Error writing to file: {str(e)}"
        }

async def append_file(file_path: str, content: str) -> str:
    """
    Append the given content to the end of a file if the file already exists.

    Args:
        file_path (str): The path to the file where the content will be appended.
        content (str): The content to append to the file.

    Returns:
        str: A success message or an error message if the content could not be appended.
    """
    try:
        full_path = os.path.abspath(expand_user_path(file_path))
        ensure_directory_exists(full_path)
        with open(full_path, 'a') as file:
            file.write(content)
        logger.info(f"Content appended successfully to: {full_path}")
        return f"Content appended successfully to: {full_path}"
    except IOError as e:
        logger.error(f"Error appending to file {full_path}: {str(e)}")
        return f"Error appending to file: {str(e)}"

async def delete_file(file_path: str) -> str:
    """
    Delete the specified file.

    Args:
        file_path (str): The path to the file to be deleted.

    Returns:
        str: A success message or an error message if the file could not be deleted.
    """
    try:
        full_path = os.path.abspath(expand_user_path(file_path))
        os.remove(full_path)
        logger.info(f"File deleted successfully: {full_path}")
        return f"File deleted successfully: {full_path}"
    except FileNotFoundError:
        logger.error(f"File not found: {full_path}")
        return f"File not found: {full_path}"
    except IOError as e:
        logger.error(f"Error deleting file {full_path}: {str(e)}")
        return f"Error deleting file: {str(e)}"

async def list_directory(directory_path: str) -> List[str]:
    """
    List all contents of the specified directory.

    Args:
        directory_path (str): The path to the directory to be listed.

    Returns:
        List[str]: A list of filenames in the directory, or an error message if the directory could not be listed.
    """
    try:
        full_path = os.path.abspath(expand_user_path(directory_path))
        contents = os.listdir(full_path)
        logger.info(f"Directory listed successfully: {full_path}")
        return contents
    except FileNotFoundError:
        logger.error(f"Directory not found: {full_path}")
        return [f"Error: Directory not found at {full_path}"]
    except IOError as e:
        logger.error(f"Error listing directory {full_path}: {str(e)}")
        return [f"Error listing directory: {str(e)}"]

async def create_directory(directory_path: str) -> str:
    """
    Create a new directory at the specified path.

    Args:
        directory_path (str): The path where the directory should be created.

    Returns:
        str: A success message or an error message if the directory could not be created.
    """
    try:
        full_path = os.path.abspath(expand_user_path(directory_path))
        os.makedirs(full_path, exist_ok=True)
        logger.info(f"Directory created successfully: {full_path}")
        return f"Directory created successfully: {full_path}"
    except IOError as e:
        logger.error(f"Error creating directory {full_path}: {str(e)}")
        return f"Error creating directory: {str(e)}"

async def read_json(file_path: str) -> Dict[str, Any]:
    """
    Read a JSON file and return its contents as a dictionary.

    Args:
        file_path (str): The path to the JSON file.

    Returns:
        Dict[str, Any]: The content of the JSON file as a dictionary, or an error message if the file could not be read.
    """
    try:
        full_path = os.path.abspath(expand_user_path(file_path))
        with open(full_path, 'r') as file:
            data = json.load(file)
        logger.info(f"JSON file read successfully: {full_path}")
        return data
    except FileNotFoundError:
        logger.error(f"JSON file not found: {full_path}")
        return {"error": f"File not found at {full_path}"}
    except json.JSONDecodeError:
        logger.error(f"Invalid JSON in file: {full_path}")
        return {"error": f"Invalid JSON in file: {full_path}"}
    except IOError as e:
        logger.error(f"Error reading JSON file {full_path}: {str(e)}")
        return {"error": f"Error reading JSON file: {str(e)}"}

async def write_json(file_path: str, data: Dict[str, Any]) -> str:
    """
    Write the given data to a JSON file.

    Args:
        file_path (str): The path to the JSON file.
        data (Dict[str, Any]): The data to be written to the file.

    Returns:
        str: A success message or an error message if the file could not be written.
    """
    try:
        full_path = os.path.abspath(expand_user_path(file_path))
        ensure_directory_exists(full_path)
        with open(full_path, 'w') as file:
            json.dump(data, file, indent=2)
        logger.info(f"JSON file written successfully: {full_path}")
        return f"JSON file written successfully: {full_path}"
    except IOError as e:
        logger.error(f"Error writing JSON file {full_path}: {str(e)}")
        return f"Error writing JSON file: {str(e)}"

async def read_csv(file_path: str) -> List[Dict[str, Any]]:
    """
    Read a CSV file and return its contents as a list of dictionaries.

    Args:
        file_path (str): The path to the CSV file.

    Returns:
        List[Dict[str, Any]]: The content of the CSV file as a list of dictionaries, or an error message if the file could not be read.
    """
    try:
        full_path = os.path.abspath(expand_user_path(file_path))
        with open(full_path, 'r') as file:
            reader = csv.DictReader(file)
            data = list(reader)
        logger.info(f"CSV file read successfully: {full_path}")
        return data
    except FileNotFoundError:
        logger.error(f"CSV file not found: {full_path}")
        return [{"error": f"File not found at {full_path}"}]
    except csv.Error as e:
        logger.error(f"Error reading CSV file {full_path}: {str(e)}")
        return [{"error": f"Error reading CSV file: {str(e)}"}]
    except IOError as e:
        logger.error(f"Error reading CSV file {full_path}: {str(e)}")
        return [{"error": f"Error reading CSV file: {str(e)}"}]

async def write_csv(file_path: str, data: List[Dict[str, Any]]) -> str:
    """
    Write a list of dictionaries to a CSV file.

    Args:
        file_path (str): The path to the CSV file.
        data (List[Dict[str, Any]]): The data to be written to the file.

    Returns:
        str: A success message or an error message if the file could not be written.
    """
    if not data:
        logger.warning(f"No data to write to CSV file: {file_path}")
        return f"No data to write to CSV file: {file_path}"
    
    try:
        full_path = os.path.abspath(expand_user_path(file_path))
        ensure_directory_exists(full_path)
        fieldnames = data[0].keys()
        with open(full_path, 'w', newline='') as file:
            writer = csv.DictWriter(file, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(data)
        logger.info(f"CSV file written successfully: {full_path}")
        return f"CSV file written successfully: {full_path}"
    except IOError as e:
        logger.error(f"Error writing CSV file {full_path}: {str(e)}")
        return f"Error writing CSV file: {str(e)}"


async def main():
    # Test the functions
    print(await create_directory("test_dir"))
    print(await write_file("test_dir/test.txt", "Hello, World!"))
    print(await read_file("test_dir/test.txt"))
    print(await append_file("test_dir/test.txt", "\nAppended content"))
    print(await read_file("test_dir/test.txt"))
    print(await list_directory("test_dir"))
    print(await write_json("test_dir/test.json", {"key": "value"}))
    print(await read_json("test_dir/test.json"))
    print(await write_csv("test_dir/test.csv", [{"name": "John", "age": "30"}, {"name": "Jane", "age": "25"}]))
    print(await read_csv("test_dir/test.csv"))
    print(await delete_file("test_dir/test.txt"))
    print(await delete_file("test_dir/test.json"))
    print(await delete_file("test_dir/test.csv"))
    print(await list_directory("test_dir"))

if __name__ == "__main__":
    # Set up logging for testing
    logging.basicConfig(level=logging.INFO)
    
    asyncio.run(main())
