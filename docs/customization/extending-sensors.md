# Extending Sensors in Jiva

Sensors in the Jiva Framework are responsible for gathering input from various sources. This guide explains how to extend Jiva's sensory capabilities by adding new sensors.

## Understanding Sensors in Jiva

Sensors are implemented as classes that inherit from the `Sensor` base class, defined in `sensors/sensor_base.py`. Each sensor is responsible for gathering specific types of input and processing it into a format that Jiva can understand.

## Steps to Add a New Sensor

1. **Create a New Sensor File**:
   In the `sensors/` directory, create a new Python file for your sensor, e.g., `weather_sensor.py`.

2. **Import the Base Sensor Class**:
   ```python
   from .sensor_base import Sensor
   from typing import Any, Dict
   ```

3. **Define Your Sensor Class**:
   Create a new class that inherits from `Sensor`:

   ```python
   class WeatherSensor(Sensor):
       def __init__(self, config: Dict[str, Any]):
           super().__init__(config)
           # Initialize any specific attributes for your sensor
           self.api_key = config.get('api_key', '')
           self.location = config.get('location', 'London')

       def get_input(self) -> str:
           # Implement the logic to fetch weather data
           # This is a placeholder implementation
           return f"Fetching weather for {self.location}..."

       def process_input(self, input_data: str) -> Dict[str, Any]:
           # Process the raw input into a structured format
           return {
               "type": "weather",
               "content": input_data,
               "timestamp": self.get_timestamp(),
               "location": self.location
           }
   ```

4. **Implement Sensor Logic**:
   Fill in the `get_input` and `process_input` methods with your sensor's specific logic.

5. **Register the New Sensor**:
   Update `core/sensor_manager.py` to include your new sensor:

   ```python
   from sensors.weather_sensor import WeatherSensor

   class SensorManager:
       def initialize_sensors(self, config: Dict[str, Any]):
           # ... existing code ...
           if 'weather_sensor' in config:
               self.sensors['weather'] = WeatherSensor(config['weather_sensor'])
   ```

6. **Update Configuration**:
   Add configuration for your new sensor in `config.json`:

   ```json
   {
     "sensors": {
       "weather_sensor": {
         "api_key": "your_api_key_here",
         "location": "New York"
       }
     }
   }
   ```

## Best Practices for Sensor Development

1. **Error Handling**: Implement robust error handling in your sensor, especially for external API calls or file operations.

2. **Rate Limiting**: If your sensor interacts with external APIs, implement rate limiting to avoid overloading the service.

3. **Configurability**: Make your sensor configurable through the `config.json` file to allow easy customization.

4. **Data Validation**: Validate and sanitize the input data in the `process_input` method to ensure data quality.

5. **Logging**: Implement appropriate logging in your sensor for debugging and monitoring purposes.

6. **Testing**: Write unit tests for your sensor to ensure it functions correctly under various conditions.

## Example: Implementing a File Watcher Sensor

Here's an example of a sensor that watches a directory for new files:

```python
import os
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
from .sensor_base import Sensor

class FileWatcherSensor(Sensor, FileSystemEventHandler):
    def __init__(self, config: Dict[str, Any]):
        super().__init__(config)
        self.watch_directory = config.get('watch_directory', '.')
        self.observer = Observer()
        self.observer.schedule(self, self.watch_directory, recursive=False)
        self.observer.start()
        self.new_files = []

    def get_input(self) -> List[str]:
        new_files = self.new_files.copy()
        self.new_files.clear()
        return new_files

    def process_input(self, input_data: List[str]) -> Dict[str, Any]:
        return {
            "type": "new_files",
            "content": input_data,
            "timestamp": self.get_timestamp(),
            "directory": self.watch_directory
        }

    def on_created(self, event):
        if not event.is_directory:
            self.new_files.append(event.src_path)

    def __del__(self):
        self.observer.stop()
        self.observer.join()
```

This sensor watches a specified directory for new files and reports them to Jiva. You would need to install the `watchdog` library to use this sensor.

By following these guidelines and examples, you can extend Jiva's sensory capabilities to interact with a wide range of input sources, enhancing its ability to perceive and respond to its environment.
