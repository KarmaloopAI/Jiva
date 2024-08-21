# main.py

import os
import time
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
        'awake_duration': 80,  # 80% of the time awake
        'sleep_duration': 20,  # 20% of the time asleep
    }

def setup_environment():
    # Create necessary directories
    os.makedirs('data', exist_ok=True)
    os.makedirs('logs', exist_ok=True)

def print_welcome_message():
    infinity_symbol = """
      @@@@@@              @@@@@@                    ||              ||         ||                       ||            ||
    @@      @@          @@      @@                  ||              ||         ||                       ||           || ||
  @@          @@      @@          @@                ||              ||          \\                     //           ||   ||
 @@            @@    @@            @@               ||              ||            \\                  //           ||     ||
@@              @@  @@              @@              ||              ||              ||               ||           ||       ||     
@@               @@@@               @@              ||              ||               \\              //          ||         ||
@@              @@  @@              @@              ||              ||                 ||           ||          |||||||||||||||
 @@            @@    @@            @@               ||              ||                  \\         //          ||             ||
  @@          @@      @@          @@                //              ||                   ||       ||          ||               ||
    @@      @@          @@      @@       \\        //               ||                    \\     //          ||                 ||
      @@@@@@              @@@@@@            =======                 ||                      =====           ||                   ||
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
    file_actions = get_file_actions()
    for action_name, action_func in file_actions.items():
        print(f"Registering action: {action_name}")
        agent.action_manager.register_action(action_name, action_func)
    
    print_welcome_message()
    print("Jiva is ready. Starting main loop...")
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