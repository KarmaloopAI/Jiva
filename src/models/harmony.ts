/**
 * Harmony Response Format Handler
 *
 * Implements the Harmony format required by gpt-oss-120b models.
 * Handles multi-channel output, tool calling, and structured message formatting.
 *
 * Reference: https://github.com/openai/harmony
 */

import { logger } from '../utils/logger.js';
import { ToolCallError } from '../utils/errors.js';

export interface HarmonyMessage {
  role: 'system' | 'developer' | 'user' | 'assistant' | 'tool';
  content: string | HarmonyContent[];
  name?: string;
  tool_call_id?: string;
}

export interface HarmonyContent {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: {
    url: string;
  };
}

export interface HarmonyToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface HarmonyToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ParsedHarmonyResponse {
  analysis?: string;
  commentary?: string;
  final?: string;
  toolCalls: HarmonyToolCall[];
  rawResponse: string;
}

/**
 * Formats tools into Harmony's TypeScript-like syntax for the developer message
 */
export function formatToolsForHarmony(tools: HarmonyToolDefinition[]): string {
  if (tools.length === 0) return '';

  const toolDefinitions = tools.map(tool => {
    const params = Object.entries(tool.parameters.properties || {})
      .map(([name, schema]: [string, any]) => {
        const required = tool.parameters.required?.includes(name) ? '' : '?';
        const type = schema.type || 'any';
        const description = schema.description ? ` // ${schema.description}` : '';
        return `  ${name}${required}: ${type};${description}`;
      })
      .join('\n');

    return `/**
 * ${tool.description}
 */
function ${tool.name}(params: {
${params}
}): void;`;
  }).join('\n\n');

  return `# Available Tools

You have access to the following tools:

<namespace name="functions">
${toolDefinitions}
</namespace>

## CRITICAL: How to Use Tools

To execute a tool, you MUST use this EXACT format:

<|call|>function_name({"param": "value"})<|return|>

Example:
<|call|>read_file({"path": "/path/to/file"})<|return|>

## Rules:
1. Use the EXACT function names from above (e.g., filesystem__read_file)
2. Parameters MUST be valid JSON
3. Do NOT output markdown code blocks with tool calls
4. Do NOT explain what you're doing - just call the tool
5. Output the tool call directly with the <|call|> and <|return|> markers

WRONG - Do not do this:
\`\`\`json
{"action": "read_file", "parameters": {...}}
\`\`\`

CORRECT - Do this:
<|call|>filesystem__read_file({"path": "/path"})<|return|>`;
}

/**
 * Formats messages into Harmony format
 */
export function formatMessagesForHarmony(
  messages: HarmonyMessage[],
  tools?: HarmonyToolDefinition[]
): HarmonyMessage[] {
  const formattedMessages: HarmonyMessage[] = [];

  // Process messages based on role hierarchy
  for (const msg of messages) {
    if (msg.role === 'developer' && tools && tools.length > 0) {
      // Inject tool definitions into developer message
      const toolSection = formatToolsForHarmony(tools);
      const existingContent = typeof msg.content === 'string' ? msg.content : '';
      formattedMessages.push({
        ...msg,
        content: `${existingContent}\n\n${toolSection}`,
      });
    } else {
      formattedMessages.push(msg);
    }
  }

  return formattedMessages;
}

/**
 * Parses Harmony response with multi-channel support
 *
 * Expected format:
 * <|channel|>analysis
 * [chain of thought content]
 * <|channel|>final
 * [final response]
 * <|call|>function_name({"param": "value"})<|return|>
 */
export function parseHarmonyResponse(response: string): ParsedHarmonyResponse {
  const result: ParsedHarmonyResponse = {
    toolCalls: [],
    rawResponse: response,
  };

  // Parse channels
  const channelRegex = /<\|channel\|>(\w+)\s*([\s\S]*?)(?=<\|channel\|>|<\|call\|>|$)/g;
  let match;

  while ((match = channelRegex.exec(response)) !== null) {
    const channelName = match[1];
    const channelContent = match[2].trim();

    if (channelName === 'analysis') {
      result.analysis = channelContent;
    } else if (channelName === 'commentary') {
      result.commentary = channelContent;
    } else if (channelName === 'final') {
      result.final = channelContent;
    }
  }

  // Parse tool calls
  const toolCallRegex = /<\|call\|>([\s\S]*?)<\|return\|>/g;
  let toolMatch;
  let callId = 0;

  while ((toolMatch = toolCallRegex.exec(response)) !== null) {
    const toolCallContent = toolMatch[1].trim();

    try {
      // Parse function call: function_name({"param": "value"})
      const functionMatch = /^(\w+)\(([\s\S]*)\)$/.exec(toolCallContent);

      if (functionMatch) {
        const functionName = functionMatch[1];
        const argsString = functionMatch[2];

        // Validate JSON
        let parsedArgs;
        try {
          parsedArgs = JSON.parse(argsString);
        } catch (e) {
          logger.warn(`Failed to parse tool call arguments for ${functionName}: ${argsString}`);
          // Try to fix common JSON issues
          const fixedArgs = argsString
            .replace(/'/g, '"')  // Replace single quotes
            .replace(/(\w+):/g, '"$1":');  // Quote unquoted keys

          try {
            parsedArgs = JSON.parse(fixedArgs);
            logger.debug(`Successfully fixed and parsed arguments: ${fixedArgs}`);
          } catch (e2) {
            throw new ToolCallError(
              `Invalid JSON in tool call arguments: ${argsString}`,
              functionName
            );
          }
        }

        result.toolCalls.push({
          id: `call_${callId++}`,
          type: 'function',
          function: {
            name: functionName,
            arguments: JSON.stringify(parsedArgs),
          },
        });
      } else {
        logger.warn(`Failed to parse tool call format: ${toolCallContent}`);
      }
    } catch (error) {
      logger.error('Error parsing tool call', error);
    }
  }

  // If no channels found, treat entire response as final
  if (!result.analysis && !result.commentary && !result.final && result.toolCalls.length === 0) {
    result.final = response.trim();
  }

  return result;
}

/**
 * Extracts assistant message with malformed tool call detection
 * This handles cases where gpt-oss-120b generates incorrect tool call formats
 */
export function extractAssistantMessage(response: string): string {
  // Remove channel markers and tool calls to get clean message
  let cleaned = response
    .replace(/<\|channel\|>\w+/g, '')
    .replace(/<\|call\|>[\s\S]*?<\|return\|>/g, '')
    .replace(/<\|start\|>/g, '')
    .replace(/<\|end\|>/g, '')
    .replace(/<\|message\|>/g, '')
    .trim();

  // Handle malformed patterns like "assistant<|channel|>analysis"
  cleaned = cleaned.replace(/assistant<\|channel\|>\w+/g, '');

  return cleaned;
}

/**
 * Validates tool call against available tools
 */
export function validateToolCall(
  toolCall: HarmonyToolCall,
  availableTools: HarmonyToolDefinition[]
): boolean {
  const tool = availableTools.find(t => t.name === toolCall.function.name);

  if (!tool) {
    logger.warn(`Tool not found: ${toolCall.function.name}`);
    return false;
  }

  try {
    const args = JSON.parse(toolCall.function.arguments);
    const required = tool.parameters.required || [];

    // Check required parameters
    for (const param of required) {
      if (!(param in args)) {
        logger.warn(`Missing required parameter '${param}' for tool ${tool.name}`);
        return false;
      }
    }

    return true;
  } catch (error) {
    logger.error(`Invalid arguments for tool ${tool.name}`, error);
    return false;
  }
}

/**
 * Formats tool result for Harmony format
 */
export function formatToolResult(
  toolCallId: string,
  toolName: string,
  result: any
): HarmonyMessage {
  return {
    role: 'tool',
    name: toolName,
    tool_call_id: toolCallId,
    content: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
  };
}
