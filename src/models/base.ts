/**
 * Base model interfaces and types
 */

export interface Message {
  role: 'system' | 'developer' | 'user' | 'assistant' | 'tool';
  /** Text content. May be null/empty when the message contains only tool_calls. */
  content: string | MessageContent[] | null;
  name?: string;
  tool_call_id?: string;
  /**
   * Standard OpenAI tool call array. Present on assistant messages in standard
   * (non-Harmony) tool-calling mode. Must be preserved in the message history so
   * subsequent role:'tool' results can be matched by tool_call_id.
   */
  tool_calls?: ToolCall[];
}

export interface MessageContent {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: {
    url: string;
  };
}

export interface ModelResponse {
  content: string;
  toolCalls?: ToolCall[];
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  raw?: any;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface Tool {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface ChatCompletionOptions {
  model?: string; // Optional - uses configured model if not specified
  messages: Message[];
  tools?: Tool[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  /**
   * Controls how much reasoning the model applies before responding.
   * Supported by gpt-oss-120b and other reasoning-class models.
   * "low"    — fast, minimal reasoning (good for connectivity tests / simple tasks)
   * "medium" — balanced (good for tool-execution workers)
   * "high"   — most thorough (best for planning, complex code changes, orchestration)
   */
  reasoningEffort?: 'low' | 'medium' | 'high';
}

export interface IModel {
  chat(options: ChatCompletionOptions): Promise<ModelResponse>;
  supportsVision(): boolean;
  supportsToolCalling(): boolean;
}
