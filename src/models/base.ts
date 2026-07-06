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
  /**
   * Raw Harmony-format response string (set only when useHarmonyFormat is true).
   * When present, this must be used as the assistant message content in conversation
   * history instead of the cleaned `content`, because Harmony providers (Vertex AI,
   * Krutrim) expect the raw Harmony tokens in history to continue tool-call sequences.
   * When rawHarmonyContent is present, do NOT add tool_calls to the history message.
   */
  rawHarmonyContent?: string;
  toolCalls?: ToolCall[];
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  /**
   * The API's own reason the completion stopped, e.g. 'stop' | 'length' | 'tool_calls'.
   * 'length' means the completion hit its max_tokens ceiling — if content and toolCalls
   * are both empty with finishReason 'length', the model ran out of budget while still
   * "thinking" and never got to emit anything, which looks identical to a genuine empty
   * response but needs a different fix (more budget / less context), not just a nudge.
   */
  finishReason?: string;
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
