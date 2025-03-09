def fib_iterative(n):
    if n < 0:
        raise ValueError("Input should be a non-negative integer.")
    if n in {0, 1}:
        return n  # Base cases: F(0) = 0, F(1) = 1

    a, b = 0, 1  # F(0) = 0, F(1) = 1
    for _ in range(2, n + 1):
        # Calculate F(n) as the sum of the two preceding numbers
        a, b = b, a + b

    return b

# Calculate the 1000th Fibonacci number
try:
    fib_number_1000 = fib_iterative(1000)
    print(f"The 1000th Fibonacci number is: {fib_number_1000}")
except ValueError as e:
    print(e)