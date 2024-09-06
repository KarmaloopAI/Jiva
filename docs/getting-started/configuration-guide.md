# Configuration Guide

The Jiva Framework uses a JSON configuration file to manage its settings. This guide will walk you through the main configuration options.

## Location

The configuration file is located at `config.json` in the root directory of the Jiva Framework.

## Configuration Options

Here's an overview of the main configuration sections:

### Memory

```json
"memory": {
    "qdrant_host": "localhost",
    "qdrant_port": 6333,
    "collection_name": "jiva_memories",
    "max_short_term_memory": 100,
    "vector_size": 1536
}
```

- `qdrant_host` and `qdrant_port`: Qdrant server address
- `collection_name`: Name of the Qdrant collection for storing memories
- `max_short_term_memory`: Maximum number of items in short-term memory
- `vector_size`: Dimension of the embedding vectors

### LLM

```json
"llm": {
    "provider": "ollama",
    "api_base_url": "http://localhost:11434/api",
    "model": "gemma",
    "max_retries": 3,
    "timeout": 90
}
```

- `provider`: LLM provider (e.g., "ollama", "openai")
- `api_base_url`: API endpoint for the LLM
- `model`: Name of the model to use
- `max_retries` and `timeout`: Request parameters

### Ethical Framework

```json
"ethical_framework": {
    "enabled": true,
    "principles": [
        "Do no harm",
        "Respect privacy",
        "Promote fairness"
    ]
}
```

- `enabled`: Whether to use the ethical framework
- `principles`: List of ethical principles to follow

### Sensors

```json
"sensors": {
    "chat_interface": {
        "prompt": "Jiva> "
    }
}
```

Configure various input sensors for Jiva.

### Other Settings

- `memory_consolidation_threshold`: Number of memories before consolidation
- `agent_loop_delay`: Delay between agent loop iterations
- `awake_duration` and `sleep_duration`: Control Jiva's sleep cycle

## Customizing the Configuration

To customize Jiva's behavior:

1. Copy `config.example.json` to `config.json`
2. Edit the values in `config.json` to match your requirements
3. Restart Jiva for the changes to take effect

Remember to never commit your `config.json` file if it contains sensitive information like API keys.
