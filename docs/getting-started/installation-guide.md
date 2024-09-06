# Installation Guide

## Prerequisites

Before installing the Jiva Framework, ensure you have the following:

- Python 3.7 or higher
- Docker and Docker Compose (for containerized deployment)
- Git (for cloning the repository)

## Installation Steps

1. Clone the Jiva Framework repository:
   ```bash
   git clone https://github.com/KarmaloopAI/Jiva.git
   cd Jiva
   ```

2. Set up a virtual environment (optional but recommended):
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows, use `venv\Scripts\activate`
   ```

3. Install the required dependencies:
   ```bash
   pip install -r requirements.txt
   ```

4. Set up Ollama (if using local LLMs):
   - Follow the [Ollama installation guide](https://github.com/jmorganca/ollama#installation)

5. Set up Qdrant (for vector storage):
   - Follow the [Qdrant installation guide](https://qdrant.tech/documentation/install/)

6. Configure Jiva:
   - Copy `config.example.json` to `config.json`
   - Edit `config.json` to match your environment and preferences

## Docker Installation

For a containerized setup:

1. Ensure Docker and Docker Compose are installed on your system.

2. Build the Docker images:
   ```bash
   docker-compose build
   ```

3. Start the Jiva services:
   ```bash
   docker-compose up -d
   ```

This will start Jiva along with Qdrant and Ollama (if configured).

## Verifying the Installation

To verify your installation:

1. Run the Jiva CLI:
   ```bash
   python main.py
   ```

2. You should see the Jiva welcome message and be able to interact with the agent.

If you encounter any issues, please refer to the troubleshooting guide or open an issue on the GitHub repository.
