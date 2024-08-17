# main.py

import os
from typing import Dict, Any
from core.agent import Agent
from actions.action_registry import get_file_actions

def load_config() -> Dict[str, Any]:
    return {
        'memory': {
            'qdrant_host': 'localhost',
            'qdrant_port': 6333,
            'collection_name': 'jiva_memories',
            'max_short_term_memory': 100
        },
        'llm': {
            'api_base_url': 'http://localhost:11434/api',
            'model': 'gemma',
            'max_retries': 3,
            'timeout': 30
        },
        'sensors': {
            'chat_interface': {
                'prompt': "Jiva> "
            }
        },
        'actions': {},
        'agent_loop_delay': 0.1,
        'awake_duration': 80,  # 80% of the time awake
        'sleep_duration': 20,  # 20% of the time asleep
    }

def setup_environment():
    # Create necessary directories
    os.makedirs('data', exist_ok=True)
    os.makedirs('logs', exist_ok=True)

def main():
    print("Initializing Jiva Framework...")
    setup_environment()
    config = load_config()
    
    print("Creating Agent...")
    agent = Agent(config)
    
    # Register file actions
    file_actions = get_file_actions()
    for action_name, action_func in file_actions.items():
        agent.action_manager.register_action(action_name, action_func)
    
    print("Jiva is ready. Starting main loop...")
    try:
        agent.run()
    except KeyboardInterrupt:
        print("\nShutting down Jiva...")
    finally:
        # Perform any cleanup if necessary
        pass

if __name__ == "__main__":
    main()