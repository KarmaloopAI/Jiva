# actions/file_operations.py

import os
import json
import csv
from typing import Dict, Any, List

def read_file(file_path: str) -> str:
    """Read the contents of a file."""
    with open(file_path, 'r') as file:
        return file.read()

def write_file(file_path: str, content: str) -> str:
    """Write content to a file."""
    with open(file_path, 'w') as file:
        file.write(content)
    return f"File written successfully: {file_path}"

def append_file(file_path: str, content: str) -> str:
    """Append content to a file."""
    with open(file_path, 'a') as file:
        file.write(content)
    return f"Content appended successfully to: {file_path}"

def delete_file(file_path: str) -> str:
    """Delete a file."""
    os.remove(file_path)
    return f"File deleted successfully: {file_path}"

def list_directory(directory_path: str) -> List[str]:
    """List contents of a directory."""
    return os.listdir(directory_path)

def create_directory(directory_path: str) -> str:
    """Create a new directory."""
    os.makedirs(directory_path, exist_ok=True)
    return f"Directory created successfully: {directory_path}"

def read_json(file_path: str) -> Dict[str, Any]:
    """Read a JSON file and return its contents as a dictionary."""
    with open(file_path, 'r') as file:
        return json.load(file)

def write_json(file_path: str, data: Dict[str, Any]) -> str:
    """Write a dictionary to a JSON file."""
    with open(file_path, 'w') as file:
        json.dump(data, file, indent=2)
    return f"JSON file written successfully: {file_path}"

def read_csv(file_path: str) -> List[Dict[str, Any]]:
    """Read a CSV file and return its contents as a list of dictionaries."""
    with open(file_path, 'r') as file:
        reader = csv.DictReader(file)
        return list(reader)

def write_csv(file_path: str, data: List[Dict[str, Any]]) -> str:
    """Write a list of dictionaries to a CSV file."""
    if not data:
        return f"No data to write to CSV file: {file_path}"
    
    fieldnames = data[0].keys()
    with open(file_path, 'w', newline='') as file:
        writer = csv.DictWriter(file, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(data)
    return f"CSV file written successfully: {file_path}"
