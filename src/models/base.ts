/**
 * Base model interfaces and types
 */

export interface Message {
  role: 'system' | 'developer' | 'user' | 'assistant' | 'tool';
  content: string | MessageContent[];
  name?: string;
  tool_call_id?: string;
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
  model: string;
  messages: Message[];
  tools?: Tool[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

export interface IModel {
  chat(options: ChatCompletionOptions): Promise<ModelResponse>;
  supportsVision(): boolean;
  supportsToolCalling(): boolean;
}
