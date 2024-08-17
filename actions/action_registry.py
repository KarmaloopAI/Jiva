from typing import Dict, Callable
from .file_operations import (
    read_file, write_file, append_file, delete_file,
    list_directory, create_directory,
    read_json, write_json,
    read_csv, write_csv
)

def get_file_actions() -> Dict[str, Callable]:
    return {
        "read_file": read_file,
        "write_file": write_file,
        "append_file": append_file,
        "delete_file": delete_file,
        "list_directory": list_directory,
        "create_directory": create_directory,
        "read_json": read_json,
        "write_json": write_json,
        "read_csv": read_csv,
        "write_csv": write_csv
    }
