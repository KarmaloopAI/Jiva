# ♾️ Jiva Framework

## AI Autonomous Agent for Open Source LLMs

Jiva Framework was born out of the need to run autonomous goal-based agents that could run with Open Source LLMs like Llama, Gemma, Mistral and Phi locally on your machine using Ollama. This eliminates the cost concern that we would otherwise have when running against closed source proprietary models - specially when running autonomously.
You could easily tweak it to act as your AutoLlama or AutoGemma to autonomously complete basic tasks.

Does your machine not have a GPU powerful enough to run LLMs locally? No problem! You can still run with proprietary LLMs like OpenAi by simply tweaking Jiva's ```config.json``` file.

## Quick Demo

![Jiva in action](jiva_demo.gif)

## 🚀 Getting Started

### Quick start with Docker Compose

#### Using Ollama

Jiva depends on Qdrant for long term memory and uses Ollama to run open source LLMs locally on your machine. If you would rather like to use a more powerful LLM like ```gpt-4o```, then you do not need Ollama.

1. Clone the repository:

   ```bash
   git clone https://github.com/KarmaloopAI/Jiva.git
   cd Jiva
   ```

2. Docker Compose Build

   ```bash
   docker compose build
   ```

3. Run Jiva with Ollama

   If you are running with Ollama - use the below command to first bring up Qdrant and Ollama and then run Jiva

   ```bash
   docker-compose up -d qdrant ollama && docker-compose run jiva
   ```

#### Using OpenAI models (like ```GPT-4o```)

You will need to change the ```config.json``` to use OpenAI

1. Clone the repository:

   ```bash
   git clone https://github.com/KarmaloopAI/Jiva.git
   cd Jiva
   ```

2. Change the ```config.json``` configuration to set the LLM provider as OpenAI and your favourite GPT model

   ```json
   "llm": {
        "provider": "openai",
        "api_key": "<YOUR OPENAI API KEY>",
        "model": "gpt-4o",
        "max_retries": 3,
        "timeout": 90
    },
   ```

3. Docker Compose Build

   ```bash
   docker compose build
   ```

4. Run Jiva

   In this case, we will skip running the ```ollama``` service

   ```bash
   docker-compose up -d qdrant && docker-compose run jiva
   ```

### Running locally

#### Prerequisites

- Python 3.7+
- [Ollama](https://ollama.ai/) (for LLM support)
- [Qdrant](https://qdrant.tech/) (for vector database)

#### Installation

1. Clone the repository:

   ```
   git clone https://github.com/KarmaloopAI/Jiva.git
   cd Jiva
   ```

2. Install the required dependencies:

   ```
   pip install -r requirements.txt
   ```

3. Set up Ollama and Qdrant:
   - Follow the [Ollama installation guide](https://github.com/jmorganca/ollama#installation)
   - Follow the [Qdrant installation guide](https://qdrant.tech/documentation/install/)

4. Configure the Jiva Framework:
   - Copy `config.example.json` to `config.json`
   - Adjust the settings in `config.json` to match your environment and preferences

#### Running Jiva

To start the Jiva agent, run:

```
python main.py
```

## Ready to customize and extend Jiva?

### Head over to our documentation

[Jiva Framework Documentation](docs/documentation-index.md)

## An AI Agent with Temporal Awareness and Ethical Decision-Making

Jiva Framework is an innovative open-source project aimed at creating an AI agent that experiences time, forms memories, and operates based on ethical principles. This framework provides a unique approach to AI development, incorporating concepts such as cyclical time perception, ethical decision-making, and continuous learning.

## 🌟 Key Features

- **Temporal Awareness**: Jiva operates on a day/night cycle, allowing for a more human-like perception of time.
- **Memory Systems**: Utilizes both short-term and long-term memory, powered by vector databases for efficient storage and retrieval.
- **Ethical Framework**: Incorporates ethical principles into decision-making processes, ensuring responsible AI behavior.
- **Task Management**: Autonomously generates, prioritizes, and executes tasks to achieve given goals.
- **Adaptive Learning**: Engages in cyclical learning and refinement of knowledge through regular "sleep" cycles. There is more to come on this, see below.
- **Sensor Integration**: Modular design allows for easy integration of various input sensors. Supports only human-input as of now.
- **Action Management**: Actions registry is meant to continually grow and become richer as development continues.

### Long-term goals for Adaptive Learning

A key goal of the project is to allow for the agent to sleep and fine-tune its underlying LLModel by consolidating its thoughts and actions throughout the day.

## 📚 Documentation

For detailed documentation on the Jiva Framework's architecture, components, and usage, please refer to the [Wiki](https://github.com/your-username/jiva-framework/wiki) (to-be-done).

## 🤝 Contributing

We welcome contributions to the Jiva Framework! Please see our [Contributing Guidelines](CONTRIBUTING.md) for more information on how to get involved.

## 📜 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- The Jiva Framework is inspired by ethical principles and modern AI research.
- Special thanks to the open-source communities behind Ollama and Qdrant.

## 📞 Contact

You can reach out to me via LinkedIn here - [Abi Chatterjee](https://www.linkedin.com/in/abi-chatterjee/)

For questions, suggestions, or discussions about the Jiva Framework, please [open an issue](https://github.com/KarmaloopAI/Jiva/issues).

---

⭐ If you find Jiva Framework interesting or useful, please consider giving it a star on GitHub! ⭐
