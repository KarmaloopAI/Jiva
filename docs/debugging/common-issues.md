# Common Issues in Jiva Framework

This document outlines common issues that users might encounter when working with the Jiva Framework, along with their solutions.

## 1. Configuration Issues

### Problem: Jiva fails to start due to configuration errors
**Symptoms**: Error messages mentioning "KeyError" or "ValueError" when starting Jiva.

**Solution**:
- Verify that your `config.json` file exists and is properly formatted.
- Check for typos in configuration keys.
- Ensure all required fields are present.

### Problem: LLM connection fails
**Symptoms**: Error messages about failing to connect to the LLM service.

**Solution**:
- Check if the LLM service (e.g., Ollama) is running.
- Verify the `api_base_url` in the LLM configuration.
- Ensure the correct model name is specified in the config.

## 2. Memory-Related Issues

### Problem: Qdrant connection errors
**Symptoms**: Error messages about failing to connect to Qdrant.

**Solution**:
- Verify that Qdrant is running and accessible.
- Check the `qdrant_host` and `qdrant_port` in the memory configuration.
- Ensure Qdrant is initialized with the correct collection name.

### Problem: Out of memory errors
**Symptoms**: Jiva crashes with memory-related error messages.

**Solution**:
- Increase the `max_short_term_memory` value in the configuration.
- Implement more frequent memory consolidation.
- Check for memory leaks in custom actions or sensors.

## 3. Task Execution Issues

### Problem: Tasks not being executed
**Symptoms**: Jiva acknowledges tasks but doesn't seem to execute them.

**Solution**:
- Check the task queue in the logs.
- Verify that the action manager is properly initialized.
- Ensure all necessary actions are registered in the action registry.

### Problem: Ethical framework blocking too many tasks
**Symptoms**: Many tasks are being rejected due to ethical concerns.

**Solution**:
- Review and adjust the ethical principles in the configuration.
- Check the implementation of `evaluate_task` in the ethical framework.
- Consider logging rejected tasks for analysis.

## 4. Sensor-Related Issues

### Problem: Sensors not receiving input
**Symptoms**: Jiva doesn't react to expected inputs.

**Solution**:
- Verify that sensors are properly initialized in the sensor manager.
- Check sensor configurations in `config.json`.
- Ensure the `get_input` method of each sensor is implemented correctly.

## 5. Performance Issues

### Problem: Jiva responds slowly
**Symptoms**: Long delays between user input and Jiva's response.

**Solution**:
- Check the LLM response times.
- Optimize database queries in the memory module.
- Consider adjusting the `agent_loop_delay` in the configuration.

## 6. Docker-Related Issues

### Problem: Container fails to start
**Symptoms**: Docker container exits immediately after starting.

**Solution**:
- Check Docker logs for error messages.
- Verify that all required environment variables are set.
- Ensure all necessary ports are properly mapped.

If you encounter issues not listed here, please refer to the Troubleshooting Guide for more detailed diagnostics and solutions.
