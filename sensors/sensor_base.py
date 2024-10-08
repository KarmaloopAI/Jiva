# sensors/sensor_base.py

from abc import ABC, abstractmethod
from typing import Any


class Sensor(ABC):
    def __init__(self, config: dict):
        self.config = config

    @abstractmethod
    def get_input(self) -> Any:
        """
        Abstract method to be implemented by all sensors.
        This method should return the input received by the sensor.
        """
        pass

    @abstractmethod
    def process_input(self, input_data: Any) -> Any:
        """
        Abstract method to be implemented by all sensors.
        This method should process the raw input data and return it in a format
        suitable for the agent to use.
        """
        pass
