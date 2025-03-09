def calculate_1000th_fibonacci():
    # Initialize the first two Fibonacci numbers
    a, b = 0, 1
    
    # We start from the 2nd index and calculate up to the 1000th
    for _ in range(2, 1001):
        a, b = b, a + b  # Calculate the next Fibonacci number
    
    return b

def save_to_file(data, filename):
    try:
        with open(filename, 'w') as f:
            f.write(str(data))
        print(f"The result has been saved to {filename}.")
    except IOError as e:
        print(f"An error occurred while writing to the file: {e}")

def main():
    try:
        result = calculate_1000th_fibonacci()
        save_to_file(result, 'fibonacci_1000.txt')
    except Exception as e:
        print(f"An unexpected error occurred: {e}")

if __name__ == "__main__":
    main()