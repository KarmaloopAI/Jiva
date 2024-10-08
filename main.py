# main.py

import json
import os
import time
from typing import Dict, Any
from core.agent import Agent
from actions.action_registry import get_action_registry


def load_config(config_file: str = "config.json") -> Dict[str, Any]:
    """
    Load configuration from a JSON file, with fallback to default values.

    Args:
    config_file (str): Path to the configuration JSON file. Defaults to 'config.json'.

    Returns:
    Dict[str, Any]: A dictionary containing the configuration.
    """
    # Default configuration
    default_config = {
        "memory": {
            "qdrant_host": "localhost",
            "qdrant_port": 6333,
            "collection_name": "jiva_memories",
            "max_short_term_memory": 100,
        },
        "llm": {
            "api_base_url": "http://localhost:11434/api",
            "model": "gemma2",
            "max_retries": 3,
            "timeout": 90,
        },
        "sensors": {"chat_interface": {"prompt": "Jiva> "}},
        "memory_consolidation_threshold": 2,
        "actions": {},
        "agent_loop_delay": 0.1,
        "awake_duration": 80,
        "sleep_duration": 20,
    }

    # Load configuration from file if it exists
    if os.path.exists(config_file):
        try:
            with open(config_file, "r") as f:
                file_config = json.load(f)

            # Deep update of default config with file config
            config = deep_update(default_config, file_config)
            print(f"Configuration loaded from {config_file}")
        except json.JSONDecodeError as e:
            print(f"Error decoding {config_file}: {e}. Using default configuration.")
            config = default_config
        except Exception as e:
            print(f"Error reading {config_file}: {e}. Using default configuration.")
            config = default_config
    else:
        print(
            f"Configuration file {config_file} not found. Using default configuration."
        )
        config = default_config

    return config


def deep_update(d: Dict[str, Any], u: Dict[str, Any]) -> Dict[str, Any]:
    """
    Perform a deep update of one dictionary with another.

    Args:
    d (Dict[str, Any]): The original dictionary to update.
    u (Dict[str, Any]): The dictionary with updates.

    Returns:
    Dict[str, Any]: The updated dictionary.
    """
    for k, v in u.items():
        if isinstance(v, dict):
            d[k] = deep_update(d.get(k, {}), v)
        else:
            d[k] = v
    return d


def setup_environment():
    # Create necessary directories
    os.makedirs("data", exist_ok=True)
    os.makedirs("logs", exist_ok=True)


def print_welcome_message():
    infinity_symbol = """
      @@@@@@              @@@@@@        
    @@      @@          @@      @@      
  @@          @@      @@          @@    
 @@            @@    @@            @@   
@@              @@  @@              @@  
@@               @@@@               @@  
@@              @@  @@              @@  
 @@            @@    @@            @@   
  @@          @@      @@          @@    
    @@      @@          @@      @@      
      @@@@@@              @@@@@@        
"""
    print(infinity_symbol)
    print("Welcome to the Jiva Framework!")
    print("Embracing the infinite potential of ethical AI")
    print("--------------------------------------------")


def main():
    print("Initializing Jiva Framework...")
    setup_environment()
    config = load_config()

    print("Creating Agent...")
    agent = Agent(config)

    # Register file actions
    actions = get_action_registry(agent.llm_interface, agent.memory)
    for action_name, action_func in actions.items():
        print(f"Discovered action: {action_name}")

    print_welcome_message()
    print("Jiva is ready. Starting main loop...")
    print("(Press CTRL+C to exit)")
    try:
        agent.run()
        time.sleep(0.1)
    except KeyboardInterrupt:
        print("\nShutting down Jiva...")
    finally:
        # Perform any cleanup if necessary
        pass


if __name__ == "__main__":
    main()
