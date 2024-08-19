# actions/file_operations.py

import os
import json
import csv
from typing import Dict, Any, List
from pathlib import Path

def expand_user_path(file_path: str) -> str:
    """Expand user path (e.g., ~/) to full path."""
    return os.path.expanduser(file_path)

def ensure_directory_exists(file_path: str) -> None:
    """Ensure the directory for the given file path exists."""
    directory = os.path.dirname(file_path)
    os.makedirs(directory, exist_ok=True)

def read_file(file_path: str) -> str:
    """Read the contents of a file."""
    try:
        with open(expand_user_path(file_path), 'r') as file:
            return file.read()
    except FileNotFoundError:
        return f"Error: File not found at {file_path}"
    except IOError as e:
        return f"Error reading file: {str(e)}"

def write_file(file_path: str, content: str) -> str:
    """Write content to a file."""
    try:
        full_path = expand_user_path(file_path)
        ensure_directory_exists(full_path)
        with open(full_path, 'w') as file:
            file.write(content)
        return f"File written successfully: {full_path}"
    except IOError as e:
        return f"Error writing to file: {str(e)}"

def append_file(file_path: str, content: str) -> str:
    """Append content to a file."""
    try:
        full_path = expand_user_path(file_path)
        ensure_directory_exists(full_path)
        with open(full_path, 'a') as file:
            file.write(content)
        return f"Content appended successfully to: {full_path}"
    except IOError as e:
        return f"Error appending to file: {str(e)}"

def delete_file(file_path: str) -> str:
    """Delete a file."""
    try:
        full_path = expand_user_path(file_path)
        os.remove(full_path)
        return f"File deleted successfully: {full_path}"
    except FileNotFoundError:
        return f"File not found: {file_path}"
    except IOError as e:
        return f"Error deleting file: {str(e)}"

def list_directory(directory_path: str) -> List[str]:
    """List contents of a directory."""
    try:
        full_path = expand_user_path(directory_path)
        return os.listdir(full_path)
    except FileNotFoundError:
        return [f"Error: Directory not found at {directory_path}"]
    except IOError as e:
        return [f"Error listing directory: {str(e)}"]

def create_directory(directory_path: str) -> str:
    """Create a new directory."""
    try:
        full_path = expand_user_path(directory_path)
        os.makedirs(full_path, exist_ok=True)
        return f"Directory created successfully: {full_path}"
    except IOError as e:
        return f"Error creating directory: {str(e)}"

def read_json(file_path: str) -> Dict[str, Any]:
    """Read a JSON file and return its contents as a dictionary."""
    try:
        with open(expand_user_path(file_path), 'r') as file:
            return json.load(file)
    except FileNotFoundError:
        return {"error": f"File not found at {file_path}"}
    except json.JSONDecodeError:
        return {"error": f"Invalid JSON in file: {file_path}"}
    except IOError as e:
        return {"error": f"Error reading JSON file: {str(e)}"}

def write_json(file_path: str, data: Dict[str, Any]) -> str:
    """Write a dictionary to a JSON file."""
    try:
        full_path = expand_user_path(file_path)
        ensure_directory_exists(full_path)
        with open(full_path, 'w') as file:
            json.dump(data, file, indent=2)
        return f"JSON file written successfully: {full_path}"
    except IOError as e:
        return f"Error writing JSON file: {str(e)}"

def read_csv(file_path: str) -> List[Dict[str, Any]]:
    """Read a CSV file and return its contents as a list of dictionaries."""
    try:
        with open(expand_user_path(file_path), 'r') as file:
            reader = csv.DictReader(file)
            return list(reader)
    except FileNotFoundError:
        return [{"error": f"File not found at {file_path}"}]
    except csv.Error as e:
        return [{"error": f"Error reading CSV file: {str(e)}"}]
    except IOError as e:
        return [{"error": f"Error reading CSV file: {str(e)}"}]

def write_csv(file_path: str, data: List[Dict[str, Any]]) -> str:
    """Write a list of dictionaries to a CSV file."""
    if not data:
        return f"No data to write to CSV file: {file_path}"
    
    try:
        full_path = expand_user_path(file_path)
        ensure_directory_exists(full_path)
        fieldnames = data[0].keys()
        with open(full_path, 'w', newline='') as file:
            writer = csv.DictWriter(file, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(data)
        return f"CSV file written successfully: {full_path}"
    except IOError as e:
        return f"Error writing CSV file: {str(e)}"
