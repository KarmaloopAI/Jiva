# main.py

import os
import time
from typing import Dict, Any
from core.agent import Agent
from actions.action_registry import get_action_registry

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
    actions = get_action_registry(agent.llm_interface, agent.memory)
    for action_name, action_func in actions.items():
        print(f"Discovered action: {action_name}")
    
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