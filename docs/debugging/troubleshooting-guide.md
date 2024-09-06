# Troubleshooting Guide for Jiva Framework

This guide provides step-by-step instructions for diagnosing and resolving issues in the Jiva Framework.

## General Troubleshooting Process

1. Identify the problem: Gather information about the issue, including error messages and unexpected behaviors.
2. Check logs: Review Jiva's log files for relevant error messages or warnings.
3. Isolate the issue: Determine which component of Jiva is causing the problem.
4. Test and verify: After applying a fix, test thoroughly to ensure the issue is resolved.

## Specific Issues and Solutions

### 1. Jiva Fails to Start

#### Symptoms
- Error messages when launching Jiva
- Immediate exit of the Jiva process

#### Troubleshooting Steps
1. Check the console output for error messages.
2. Review the log files in the `logs/` directory.
3. Verify the `config.json` file for any misconfigurations.
4. Ensure all required dependencies are installed:
   ```
   pip install -r requirements.txt
   ```
5. Check if required services (e.g., Qdrant, Ollama) are running.

### 2. LLM Not Responding

#### Symptoms
- Timeout errors when Jiva tries to generate responses
- Empty or incomplete responses from Jiva

#### Troubleshooting Steps
1. Check the LLM service status (e.g., Ollama):
   ```
   docker ps | grep ollama
   ```
2. Verify the LLM configuration in `config.json`.
3. Test the LLM connection directly:
   ```python
   from core.llm_interface import LLMInterface
   llm = LLMInterface(config['llm'])
   response = llm.generate("Hello, world!")
   print(response)
   ```
4. Check for any network issues between Jiva and the LLM service.

### 3. Memory-Related Issues

#### Symptoms
- Errors related to Qdrant operations
- Jiva forgetting recent interactions

#### Troubleshooting Steps
1. Verify Qdrant is running:
   ```
   docker ps | grep qdrant
   ```
2. Check Qdrant logs for any errors:
   ```
   docker logs qdrant_container_name
   ```
3. Test Qdrant connection directly:
   ```python
   from qdrant_client import QdrantClient
   client = QdrantClient("localhost", port=6333)
   print(client.get_collections())
   ```
4. Review memory configuration in `config.json`.

### 4. Task Execution Failures

#### Symptoms
- Tasks acknowledged but not executed
- Error messages during task execution

#### Troubleshooting Steps
1. Check the task queue status in logs.
2. Verify all required actions are registered in `action_registry.py`.
3. Test individual actions directly:
   ```python
   from actions.action_registry import get_action_registry
   actions = get_action_registry(llm_interface, memory)
   result = actions['action_name'](parameters)
   print(result)
   ```
4. Review the ethical framework configuration if tasks are being rejected.

### 5. Sensor Input Issues

#### Symptoms
- Jiva not responding to expected inputs
- Errors related to sensor operations

#### Troubleshooting Steps
1. Check sensor initialization in `sensor_manager.py`.
2. Verify sensor configurations in `config.json`.
3. Test sensors individually:
   ```python
   from sensors.your_sensor import YourSensor
   sensor = YourSensor(config)
   input_data = sensor.get_input()
   processed_data = sensor.process_input(input_data)
   print(processed_data)
   ```
4. Ensure required permissions for sensors (e.g., file access, API keys).

### 6. Performance Issues

#### Symptoms
- Slow response times
- High CPU or memory usage

#### Troubleshooting Steps
1. Monitor system resources:
   ```
   top -pid $(pgrep -f "python main.py")
   ```
2. Profile the Jiva process:
   ```python
   import cProfile
   cProfile.run('agent.run()')
   ```
3. Check for memory leaks using tools like `memory_profiler`.
4. Optimize database queries and LLM calls.

### 7. Docker-Related Issues

#### Symptoms
- Container fails to start or crashes
- Networking issues between containers

#### Troubleshooting Steps
1. Check Docker logs:
   ```
   docker logs jiva_container_name
   ```
2. Verify Docker network configuration:
   ```
   docker network inspect jiva_network
   ```
3. Ensure all required environment variables are set in `docker-compose.yml`.
4. Rebuild the Docker image to ensure all changes are included:
   ```
   docker-compose build --no-cache
   ```

## Advanced Debugging Techniques

1. Use Python's `pdb` for step-by-step debugging:
   ```python
   import pdb; pdb.set_trace()
   ```
2. Implement detailed logging for specific components you're troubleshooting.
3. Use mock objects to isolate and test specific components.

## Getting Help

If you're unable to resolve an issue:
1. Check the GitHub Issues page for similar problems and solutions.
2. Provide detailed information when seeking help:
   - Jiva version
   - Full error message and stack trace
   - Steps to reproduce the issue
   - Relevant parts of the configuration and logs

By following this troubleshooting guide, you should be able to diagnose and resolve most issues encountered while working with the Jiva Framework. Remember to always backup your data and configuration before making significant changes during the troubleshooting process.
