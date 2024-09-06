# Quick Start Guide

This guide will help you get Jiva up and running quickly.

## Prerequisites

Ensure you have completed the installation process as described in the Installation Guide.

## Running Jiva

### With Docker Compose

1. Start Jiva and its dependencies:
   ```bash
   docker-compose up -d
   ```

2. Access the Jiva CLI:
   ```bash
   docker-compose run jiva
   ```

### Without Docker

1. Ensure Qdrant and Ollama (if using) are running.

2. Start the Jiva CLI:
   ```bash
   python main.py
   ```

## First Interaction

Once Jiva is running, you'll see a welcome message and the Jiva prompt:

```
Welcome to the Jiva Framework!
Embracing the infinite potential of ethical AI
--------------------------------------------
Jiva> 
```

Try giving Jiva a simple task:

```
Jiva> Can you help me write a short story about a robot learning to be human?
```

Jiva will process your request, potentially breaking it down into subtasks, and provide a response.

## Basic Commands

- To exit Jiva, type `exit` or use Ctrl+C.
- To see available actions, type `help` (if implemented).

## Next Steps

- Explore the User Guide for more detailed usage instructions.
- Check the Customization Guide to learn how to extend Jiva's capabilities.
- If you encounter any issues, refer to the Troubleshooting Guide.

Enjoy exploring the possibilities with Jiva!
