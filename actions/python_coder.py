import asyncio
import ast
import re
import sys
import os
import subprocess
import logging
from typing import Dict, List, Any, Optional

from core.llm_interface import LLMInterface
from actions.file_operations import read_file, write_file

logger = logging.getLogger(__name__)
llm_interface: Optional[LLMInterface] = None

def set_llm_interface(llm: LLMInterface):
    """Set the LLM interface for code generation functions."""
    global llm_interface
    llm_interface = llm

def extract_python_code(llm_response: str) -> str:
    """
    Extract Python code from an LLM response that contains markdown code blocks.
    
    Args:
        llm_response (str): The full response from the LLM
        
    Returns:
        str: The extracted Python code, or empty string if no code found
    """
    # Find Python code blocks (```python ... ```)
    python_blocks = re.findall(r'```(?:python)?\s*([\s\S]*?)\s*```', llm_response)
    
    if not python_blocks:
        # If no code blocks with backticks, try to find the entire code
        # This is a fallback in case the LLM didn't format with code blocks
        if "def " in llm_response and ":" in llm_response:
            # Try to extract what looks like a function definition
            return llm_response
        return ""
    
    # Join multiple code blocks if present
    return "\n\n".join(python_blocks)

async def generate_python_code(prompt: str, context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    Generate Python code based on a prompt. This uses the LLM to create code
    and extracts just the Python code from the response.
    
    Args:
        prompt (str): Instruction for what code to generate
        context (Optional[Dict[str, Any]]): Additional context
        
    Returns:
        Dict[str, Any]: Result containing the generated code and explanation
    """
    if not llm_interface:
        return {"success": False, "error": "LLM interface not set. Cannot generate code."}
    
    enhanced_prompt = f"""
    Write Python code for the following:
    {prompt}
    
    Your response should include:
    1. A brief explanation of your approach
    2. Complete, working Python code that addresses the requirement
    3. Comments explaining any complex parts
    
    Present your code in a ```python code block and ensure it's functional and correct.
    Make sure your code handles errors appropriately and follows best practices.
    """
    
    if context:
        enhanced_prompt += f"\n\nAdditional context:\n{context}"
    
    try:
        llm_response = await llm_interface.generate(enhanced_prompt)
        
        # Extract the code
        code = extract_python_code(llm_response)
        
        if not code:
            return {
                "success": False,
                "error": "Failed to extract Python code from the LLM response",
                "full_response": llm_response
            }
        
        # Get the explanation (everything before the first code block)
        explanation_match = re.match(r'(.*?)```', llm_response, re.DOTALL)
        explanation = explanation_match.group(1).strip() if explanation_match else ""
        
        return {
            "success": True,
            "code": code,
            "explanation": explanation,
            "full_response": llm_response
        }
    except Exception as e:
        logger.error(f"Error generating Python code: {str(e)}")
        return {"success": False, "error": f"Failed to generate code: {str(e)}"}

async def write_python_code(file_path: str, code: str, description: str = "") -> Dict[str, Any]:
    """
    Write Python code to a file. Validates syntax before writing.
    
    Args:
        file_path (str): Path where the Python file should be created
        code (str): Python code to write
        description (str): Optional description of what the code does
        
    Returns:
        Dict[str, Any]: Result indicating success or failure with details
    """
    # Handle the case where code is a dictionary from generate_python_code
    if isinstance(code, dict):
        if 'code' in code:
            code = code['code']
        elif 'success' in code and not code.get('success', False):
            return {
                "success": False,
                "error": f"Cannot write Python code: {code.get('error', 'Unknown error')}"
            }
    
    # Create directory if it doesn't exist
    dir_path = os.path.dirname(file_path)
    if dir_path and not os.path.exists(dir_path):
        os.makedirs(dir_path, exist_ok=True)
    
    # Validate Python syntax
    try:
        ast.parse(code)
    except SyntaxError as e:
        return {
            "success": False,
            "error": f"Python code has syntax errors: {str(e)}",
            "line": e.lineno,
            "offset": e.offset,
            "text": e.text
        }
    
    # Add description as doc comment if provided
    if description:
        doc_comment = f'"""\n{description}\n"""\n\n'
        if not code.startswith('"""'):
            code = doc_comment + code
    
    # Write the code to file
    try:
        with open(file_path, 'w') as f:
            f.write(code)
        
        return {
            "success": True,
            "message": f"Python code written to {file_path}",
            "file_path": file_path,
            "code_length": len(code)
        }
    except Exception as e:
        return {
            "success": False,
            "error": f"Failed to write Python code: {str(e)}"
        }

async def execute_python_code(file_path: str, args: List[str] = None, timeout: int = 30) -> Dict[str, Any]:
    """
    Execute a Python file and return the output.
    
    Args:
        file_path (str): Path to the Python file to execute
        args (List[str]): Optional command line arguments
        timeout (int): Maximum execution time in seconds
        
    Returns:
        Dict[str, Any]: The execution results including stdout, stderr, and return code
    """
    if not os.path.exists(file_path):
        return {
            "success": False,
            "error": f"File not found: {file_path}"
        }
    
    # Check if the file contains valid Python code
    try:
        with open(file_path, 'r') as f:
            code = f.read()
        
        # Check if it looks like a serialized object
        if code.strip().startswith('{') and ('code' in code or 'success' in code):
            # Try to extract actual Python code
            try:
                import json
                data = json.loads(code)
                if isinstance(data, dict) and 'code' in data:
                    # Extract and save the actual code
                    extracted_code = data['code']
                    with open(file_path, 'w') as f:
                        f.write(extracted_code)
                    logger.info(f"Fixed malformed Python file: {file_path}")
                else:
                    # Try regex as a fallback
                    import re
                    code_match = re.search(r"'code':\s*'([^']+)'", code)
                    if code_match:
                        # Extract and save the actual code
                        extracted_code = code_match.group(1).replace('\\n', '\n').replace('\\t', '\t')
                        with open(file_path, 'w') as f:
                            f.write(extracted_code)
                        logger.info(f"Fixed malformed Python file with regex: {file_path}")
                    else:
                        return {
                            "success": False,
                            "error": f"File contains a serialized object, not valid Python code"
                        }
            except Exception as e:
                logger.warning(f"Error fixing Python file content: {e}")
                return {
                    "success": False,
                    "error": f"File appears to contain invalid content: {str(e)}"
                }
    except Exception as e:
        logger.warning(f"Error checking Python file: {str(e)}")
    
    # Execute the file
    cmd = [sys.executable, file_path]
    if args:
        cmd.extend(args)
    
    try:
        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            limit=1024 * 1024  # 1MB limit for output
        )
        
        try:
            stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=timeout)
            stdout_str = stdout.decode('utf-8', errors='replace')
            stderr_str = stderr.decode('utf-8', errors='replace')
            
            if process.returncode != 0:
                return {
                    "success": False,
                    "stdout": stdout_str,
                    "stderr": stderr_str,
                    "returncode": process.returncode,
                    "error": f"Process exited with code {process.returncode}"
                }
            
            return {
                "success": True,
                "stdout": stdout_str,
                "stderr": stderr_str,
                "returncode": process.returncode
            }
            
        except asyncio.TimeoutError:
            try:
                process.kill()
            except:
                pass
            return {
                "success": False,
                "error": f"Execution timed out after {timeout} seconds"
            }
            
    except Exception as e:
        return {
            "success": False,
            "error": f"Error executing Python code: {str(e)}"
        }

async def analyze_python_code(file_path: str) -> Dict[str, Any]:
    """
    Analyze Python code for errors, potential improvements, and best practices.
    
    Args:
        file_path (str): Path to the Python file to analyze
        
    Returns:
        Dict[str, Any]: Analysis results with suggestions
    """
    if not llm_interface:
        return {"error": "LLM interface not set. Cannot analyze code."}
    
    if not os.path.exists(file_path):
        return {"error": f"File not found: {file_path}"}
    
    try:
        code = await read_file(file_path)
        if isinstance(code, dict) and 'error' in code:
            return {"error": f"Failed to read file: {code['error']}"}
        
        # Check syntax
        try:
            ast.parse(code)
        except SyntaxError as e:
            return {
                "success": False,
                "has_syntax_errors": True,
                "error": f"Syntax error at line {e.lineno}, column {e.offset}: {e.msg}",
                "line": e.lineno,
                "text": e.text
            }
        
        # Use LLM to analyze the code
        prompt = f"""
        Analyze the following Python code for:
        1. Potential bugs or errors
        2. Performance improvements
        3. Best practices and PEP8 compliance
        4. Security concerns
        5. Overall code quality

        Provide specific suggestions for improvements.

        Python code to analyze:
        ```python
        {code}
        ```
        
        Format your response as a detailed analysis with sections for each category.
        Include line numbers when referring to specific code.
        """
        
        analysis = await llm_interface.generate(prompt)
        
        return {
            "success": True,
            "has_syntax_errors": False,
            "analysis": analysis,
            "code": code
        }
        
    except Exception as e:
        return {"error": f"Error analyzing Python code: {str(e)}"}

async def test_python_function(file_path: str, function_name: str, test_cases: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Test a Python function with multiple test cases.
    
    Args:
        file_path (str): Path to the Python file containing the function
        function_name (str): Name of the function to test
        test_cases (List[Dict[str, Any]]): List of test cases, each with 'inputs' and 'expected_output'
        
    Returns:
        Dict[str, Any]: Test results for each test case
    """
    if not os.path.exists(file_path):
        return {"error": f"File not found: {file_path}"}
    
    # Create a temporary test file
    import tempfile
    
    try:
        module_name = os.path.basename(file_path).replace('.py', '')
        
        with tempfile.NamedTemporaryFile(suffix='.py', mode='w', delete=False) as test_file:
            test_file_path = test_file.name
            
            # Write test code
            test_code = f"""
import sys
import json
import traceback
from pathlib import Path

# Add the directory containing the module to Python path
file_dir = Path(r'{os.path.dirname(os.path.abspath(file_path))}')
if str(file_dir) not in sys.path:
    sys.path.insert(0, str(file_dir))

try:
    # Import the function
    from {module_name} import {function_name}
    
    # Run test cases
    results = []
    
    test_cases = {test_cases}
    
    for i, test_case in enumerate(test_cases):
        try:
            inputs = test_case['inputs']
            expected = test_case['expected_output']
            
            # Handle different input types
            if isinstance(inputs, list):
                actual = {function_name}(*inputs)
            elif isinstance(inputs, dict):
                actual = {function_name}(**inputs)
            else:
                actual = {function_name}(inputs)
            
            success = actual == expected
            
            results.append({{
                'test_case': i + 1,
                'inputs': inputs,
                'expected': expected,
                'actual': actual,
                'success': success
            }})
        except Exception as e:
            results.append({{
                'test_case': i + 1,
                'inputs': inputs,
                'error': str(e),
                'traceback': traceback.format_exc(),
                'success': False
            }})
    
    print(json.dumps(results))
    
except Exception as e:
    print(json.dumps({{
        'error': str(e),
        'traceback': traceback.format_exc()
    }}))
"""
            test_file.write(test_code)
        
        # Execute the test file
        result = await execute_python_code(test_file_path)
        
        # Clean up the temporary file
        try:
            os.unlink(test_file_path)
        except:
            pass
        
        if not result['success']:
            return {
                "success": False,
                "error": f"Error running tests: {result.get('stderr', result.get('error', 'Unknown error'))}"
            }
        
        # Parse the test results
        try:
            test_results = json.loads(result['stdout'])
            
            # Check if there was an error importing the function
            if 'error' in test_results and 'traceback' in test_results:
                return {
                    "success": False,
                    "error": test_results['error'],
                    "traceback": test_results['traceback']
                }
            
            # Count successes
            successful_tests = sum(1 for r in test_results if r.get('success', False))
            
            return {
                "success": True,
                "total_tests": len(test_results),
                "successful_tests": successful_tests,
                "test_results": test_results
            }
            
        except json.JSONDecodeError:
            return {
                "success": False,
                "error": "Failed to parse test results",
                "stdout": result['stdout']
            }
            
    except Exception as e:
        return {"error": f"Error testing Python function: {str(e)}"}
    

async def execute_inline_python_code(code: str, timeout: int = 10) -> Dict[str, Any]:
    """
    Execute Python code provided as a string and return the results.
    
    Args:
        code (str): Python code to execute
        timeout (int): Maximum execution time in seconds
        
    Returns:
        Dict[str, Any]: The execution results including stdout, stderr, and return code
    """
    if not code or not isinstance(code, str):
        return {
            "success": False,
            "error": "No code provided or invalid code type"
        }
    
    # Extract code if it's a dictionary result from generate_python_code
    if isinstance(code, dict) and 'code' in code:
        code = code['code']
    
    # Create a temporary file to hold the code
    import tempfile
    import os
    
    try:
        with tempfile.NamedTemporaryFile(suffix='.py', mode='w', delete=False) as temp_file:
            temp_file_path = temp_file.name
            temp_file.write(code)
        
        # Execute the temporary file
        result = await execute_python_code(temp_file_path, [], timeout)
        
        # Clean up the temporary file
        try:
            os.unlink(temp_file_path)
        except Exception as e:
            logger.warning(f"Error cleaning up temporary file: {str(e)}")
        
        return result
    except Exception as e:
        return {
            "success": False,
            "error": f"Error executing inline Python code: {str(e)}"
        }
