# main.py

import json
import logging
import os
import asyncio
import uvicorn
from api.main import app
from typing import Dict, Any
from core.agent import Agent
from actions.action_registry import get_action_registry

logger = logging.getLogger("Jiva.Main")

def load_config(config_file: str = 'config.json') -> Dict[str, Any]:
    """
    Load configuration from a JSON file, with fallback to default values.
    
    Args:
    config_file (str): Path to the configuration JSON file. Defaults to 'config.json'.
    
    Returns:
    Dict[str, Any]: A dictionary containing the configuration.
    """
    # Default configuration
    default_config = {
        'memory': {
            'qdrant_host': 'localhost',
            'qdrant_port': 6333,
            'collection_name': 'jiva_memories',
            'max_short_term_memory': 100
        },
        'llm': {
            'api_base_url': 'http://localhost:11434/api',
            'model': 'gemma2',
            'max_retries': 3,
            'timeout': 90
        },
        'sensors': {
            'chat_interface': {
                'prompt': "Jiva> "
            }
        },
        'memory_consolidation_threshold': 2,
        'actions': {},
        'agent_loop_delay': 0.1,
        'awake_duration': 80,
        'sleep_duration': 20,
    }
    
    # Load configuration from file if it exists
    if os.path.exists(config_file):
        try:
            with open(config_file, 'r') as f:
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
        print(f"Configuration file {config_file} not found. Using default configuration.")
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
    os.makedirs('data', exist_ok=True)
    os.makedirs('logs', exist_ok=True)

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

async def run_agent_and_api(agent: Agent, host: str = "0.0.0.0", port: int = 8000):
    """
    Run both the Jiva agent and the API server concurrently.
    
    Args:
        agent (Agent): The Jiva agent instance
        host (str): Host address to bind the API server
        port (int): Port number for the API server
    """
    # Store agent instance in FastAPI app state
    app.state.agent = agent
    
    # Configure the uvicorn server
    config = uvicorn.Config(
        app,
        host=host,
        port=port,
        loop="asyncio",
        log_level="info"
    )
    server = uvicorn.Server(config)
    
    # Create shutdown event
    shutdown_event = asyncio.Event()
    
    async def run_until_shutdown():
        try:
            await asyncio.gather(
                agent.run(),
                server.serve()
            )
        except asyncio.CancelledError:
            logger.info("\nShutting down Jiva...")
            server.should_exit = True
            # Give the server a moment to shutdown
            await asyncio.sleep(0.5)
    
    try:
        await run_until_shutdown()
    except KeyboardInterrupt:
        logger.info("\nShutdown complete")

def main():
    print("Initializing Jiva Framework...")
    setup_environment()
    config = load_config()

    # Get API configuration from environment or config
    host = os.environ.get('API_HOST', config.get('api', {}).get('host', '0.0.0.0'))
    port = int(os.environ.get('API_PORT', config.get('api', {}).get('port', 8000)))
    
    logger.info("Creating Agent...")
    agent = Agent(config)
    
    # Register file actions
    actions = get_action_registry(agent.llm_interface, agent.memory)
    for action_name, action_func in actions.items():
        print(f"Discovered action: {action_name}")
    
    print_welcome_message()
    print("Jiva is ready. Starting main loop...")
    logger.info(f"Starting main loop and API server on {host}:{port}...")
    print("(Press CTRL+C to exit)")
    try:
        asyncio.run(run_agent_and_api(agent, host, port))
    except KeyboardInterrupt:
        logger.info("\nShutting down Jiva...")
    finally:
        # Perform any cleanup if necessary
        pass

if __name__ == "__main__":
    main()
