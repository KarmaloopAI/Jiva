# core/sensor_manager.py

from typing import Dict, Any, List
from sensors.sensor_base import Sensor
from sensors.chat_interface import ChatInterface


class SensorManager:
    def __init__(self, config: Dict[str, Any]):
        self.sensors: Dict[str, Sensor] = {}
        self.initialize_sensors(config)

    def initialize_sensors(self, config: Dict[str, Any]):
        if "chat_interface" in config:
            self.sensors["chat"] = ChatInterface(config["chat_interface"])
        # Add more sensors here as they are implemented

    def register_sensor(self, name: str, sensor: Sensor):
        self.sensors[name] = sensor

    def get_input(self) -> List[Dict[str, Any]]:
        inputs = []
        for sensor_name, sensor in self.sensors.items():
            raw_input = sensor.get_input()
            if raw_input:
                processed_input = sensor.process_input(raw_input)
                processed_input["sensor"] = sensor_name
                inputs.append(processed_input)
        return inputs

    def get_available_sensors(self) -> List[str]:
        return list(self.sensors.keys())


if __name__ == "__main__":
    # This allows us to run some basic tests
    config = {"chat_interface": {"prompt": "Jiva> "}}
    sensor_manager = SensorManager(config)

    print("Available sensors:", sensor_manager.get_available_sensors())

    print("Waiting for input. Press Ctrl+C to exit.")
    try:
        while True:
            inputs = sensor_manager.get_input()
            for input_data in inputs:
                print(f"Received input from {input_data['sensor']}:")
                print(input_data)
    except KeyboardInterrupt:
        print("\nExiting...")
