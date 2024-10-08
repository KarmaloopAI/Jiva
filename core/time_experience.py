# core/time_experience.py

import time
from datetime import datetime, timedelta


class TimeExperience:
    def __init__(self):
        self.start_time = datetime.now()
        self.current_time = self.start_time
        self.time_scale = 1.0

    def update(self):
        real_elapsed = datetime.now() - self.start_time
        scaled_elapsed = real_elapsed * self.time_scale
        self.current_time = self.start_time + scaled_elapsed

    def get_current_time(self) -> datetime:
        return self.current_time

    def get_elapsed_time(self) -> timedelta:
        """Get the elapsed time since the start."""
        return self.current_time - self.start_time

    def set_time_scale(self, scale: float):
        """Set the time scale factor."""
        if scale <= 0:
            raise ValueError("Time scale must be positive")
        self.time_scale = scale

    def sleep(self, duration: float):
        """Sleep for a specified duration in seconds."""
        time.sleep(duration / self.time_scale)

    def format_time(self, format_string: str = "%Y-%m-%d %H:%M:%S") -> str:
        """Format the current time as a string."""
        return self.current_time.strftime(format_string)

    def is_daytime(self) -> bool:
        """Check if it's currently daytime (between 6 AM and 6 PM)."""
        hour = self.current_time.hour
        return 6 <= hour < 18


if __name__ == "__main__":
    # This allows us to run some basic tests
    te = TimeExperience()
    print(f"Start time: {te.format_time()}")

    te.sleep(3600)  # Sleep for an hour
    te.update()
    print(f"After 1 hour: {te.format_time()}")
    print(f"Elapsed time: {te.get_elapsed_time()}")

    te.set_time_scale(24)  # Speed up time (1 real second = 24 experienced seconds)
    te.sleep(3600)  # Sleep for an hour of experienced time (150 real seconds)
    te.update()
    print(f"After 1 more hour (accelerated): {te.format_time()}")
    print(f"Elapsed time: {te.get_elapsed_time()}")
    print(f"Is it daytime? {te.is_daytime()}")
