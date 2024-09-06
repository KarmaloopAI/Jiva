# Logging and Monitoring in Jiva Framework

Effective logging and monitoring are crucial for maintaining and debugging the Jiva Framework. This guide explains how to set up and use logging, and how to monitor Jiva's performance.

## Logging

Jiva uses Python's built-in `logging` module for generating logs.

### Log Levels

Jiva uses the following log levels:
- DEBUG: Detailed information, typically of interest only when diagnosing problems.
- INFO: Confirmation that things are working as expected.
- WARNING: An indication that something unexpected happened, or indicative of some problem in the near future.
- ERROR: Due to a more serious problem, the software has not been able to perform some function.
- CRITICAL: A serious error, indicating that the program itself may be unable to continue running.

### Configuring Logging

1. In `main.py`, logging is configured in the `setup_logging` method of the `Agent` class:

   ```python
   def setup_logging(self):
       self.logger = logging.getLogger("Jiva")
       self.logger.setLevel(logging.DEBUG)
       formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
       
       # Console Handler
       ch = logging.StreamHandler()
       ch.setLevel(logging.INFO)
       ch.setFormatter(formatter)
       self.logger.addHandler(ch)
       
       # File Handler
       log_dir = 'logs'
       os.makedirs(log_dir, exist_ok=True)
       fh = RotatingFileHandler(os.path.join(log_dir, 'jiva.log'), maxBytes=10*1024*1024, backupCount=5)
       fh.setLevel(logging.DEBUG)
       fh.setFormatter(formatter)
       self.logger.addHandler(fh)
   ```

2. To adjust log levels, modify the `setLevel` calls in this method.

### Accessing Logs

- Console logs (INFO level and above) are printed to the terminal.
- File logs (all levels) are stored in the `logs/jiva.log` file.

### Best Practices for Logging

1. Use appropriate log levels:
   ```python
   self.logger.debug("Detailed debug information")
   self.logger.info("General information")
   self.logger.warning("Warning message")
   self.logger.error("Error message")
   self.logger.critical("Critical error")
   ```

2. Include contextual information in log messages.
3. Log the start and end of important operations.
4. Use log rotation to manage log file sizes.

## Monitoring

Monitoring involves tracking Jiva's performance and behavior over time.

### Key Metrics to Monitor

1. **Task Execution Time**: Track how long tasks take to execute.
2. **Memory Usage**: Monitor both short-term and long-term memory usage.
3. **LLM Response Time**: Measure how long the LLM takes to generate responses.
4. **Ethical Decisions**: Track the number of tasks approved/rejected by the ethical framework.
5. **Error Rates**: Monitor the frequency of different types of errors.

### Implementing Monitoring

1. Use logging to record key metrics:
   ```python
   import time

   start_time = time.time()
   # Execute task
   execution_time = time.time() - start_time
   self.logger.info(f"Task executed in {execution_time:.2f} seconds")
   ```

2. Consider implementing a metrics collection system:
   - Use a time-series database like Prometheus for storing metrics.
   - Implement a `/metrics` endpoint that exposes current metrics.

3. Visualize metrics using tools like Grafana.

### Setting Up Alerts

1. Define thresholds for critical metrics (e.g., error rates, memory usage).
2. Implement alerting logic to notify administrators when thresholds are exceeded.
3. Use external monitoring services or implement a simple email alert system.

## Debugging with Logs

1. To debug issues, increase the log level to DEBUG:
   ```python
   self.logger.setLevel(logging.DEBUG)
   ```

2. Use log messages to trace the flow of execution:
   ```python
   self.logger.debug(f"Entering method: {method_name}")
   self.logger.debug(f"Method parameters: {params}")
   ```

3. Log important state changes and decision points.

## Monitoring in Docker Environment

When running Jiva in Docker:
1. Use Docker's logging driver to manage logs:
   ```
   docker-compose logs jiva
   ```

2. Consider using Docker monitoring solutions like cAdvisor for container-level metrics.

3. Implement health checks in your Docker configuration to monitor Jiva's overall health.

By effectively using logging and monitoring, you can gain insights into Jiva's performance, quickly identify and resolve issues, and ensure the smooth operation of your AI agent.
