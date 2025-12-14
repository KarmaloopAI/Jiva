/**
 * MCP Client Implementation
 *
 * Manages connections to MCP servers and provides tool discovery/execution.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  CallToolResultSchema,
  ListToolsResultSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { MCPError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { Tool } from '../models/base.js';

export interface MCPServerConnection {
  name: string;
  client: Client;
  transport: StdioClientTransport;
  tools: Tool[];
}

export class MCPClient {
  private connections: Map<string, MCPServerConnection> = new Map();

  /**
   * Connect to an MCP server
   */
  async connect(
    name: string,
    command: string,
    args: string[] = [],
    env?: Record<string, string>
  ): Promise<void> {
    try {
      logger.info(`Connecting to MCP server: ${name}`);
      logger.debug(`Command: ${command}`);
      logger.debug(`Args: ${JSON.stringify(args)}`);
      logger.debug(`Args length: ${args.length}, values: ${args.map((a, i) => `[${i}]="${a}"`).join(', ')}`);

      const transport = new StdioClientTransport({
        command,
        args,
        env: env || {},
      });

      const client = new Client(
        {
          name: 'jiva-agent',
          version: '0.1.0',
        },
        {
          capabilities: {},
        }
      );

      await client.connect(transport);

      // List available tools
      const toolsResult = await client.listTools();
      const tools = this.convertMCPTools(toolsResult.tools || []);

      this.connections.set(name, {
        name,
        client,
        transport,
        tools,
      });

      logger.success(`Connected to MCP server: ${name} (${tools.length} tools available)`);
    } catch (error) {
      throw new MCPError(
        `Failed to connect to MCP server '${name}': ${error instanceof Error ? error.message : String(error)}`,
        name
      );
    }
  }

  /**
   * Disconnect from an MCP server
   */
  async disconnect(name: string): Promise<void> {
    const connection = this.connections.get(name);
    if (!connection) {
      logger.warn(`MCP server '${name}' not connected`);
      return;
    }

    try {
      await connection.client.close();
      this.connections.delete(name);
      logger.info(`Disconnected from MCP server: ${name}`);
    } catch (error) {
      logger.error(`Error disconnecting from MCP server '${name}'`, error);
    }
  }

  /**
   * Disconnect from all MCP servers
   */
  async disconnectAll(): Promise<void> {
    const names = Array.from(this.connections.keys());
    await Promise.all(names.map(name => this.disconnect(name)));
  }

  /**
   * Get all available tools from all connected servers
   */
  getAllTools(): Tool[] {
    const allTools: Tool[] = [];

    for (const connection of this.connections.values()) {
      // Prefix tool names with server name to avoid conflicts
      const prefixedTools = connection.tools.map(tool => ({
        ...tool,
        name: `${connection.name}__${tool.name}`,
        description: `[${connection.name}] ${tool.description}`,
      }));
      allTools.push(...prefixedTools);
    }

    return allTools;
  }

  /**
   * Get tools from a specific server
   */
  getServerTools(serverName: string): Tool[] {
    const connection = this.connections.get(serverName);
    if (!connection) {
      return [];
    }

    return connection.tools.map(tool => ({
      ...tool,
      name: `${serverName}__${tool.name}`,
      description: `[${serverName}] ${tool.description}`,
    }));
  }

  /**
   * Execute a tool call
   */
  async executeTool(toolName: string, args: Record<string, any>): Promise<any> {
    // Parse server name and actual tool name
    const [serverName, ...toolParts] = toolName.split('__');
    const actualToolName = toolParts.join('__');

    const connection = this.connections.get(serverName);
    if (!connection) {
      throw new MCPError(`MCP server '${serverName}' not connected`, serverName);
    }

    try {
      logger.debug(`Executing tool: ${toolName}`, args);

      const result = await connection.client.callTool({
        name: actualToolName,
        arguments: args,
      });

      logger.debug(`Tool result from ${toolName}:`, result);

      // Extract content from MCP response (both text and images)
      if (result.content && Array.isArray(result.content)) {
        const textContent = result.content
          .filter((c: any) => c.type === 'text')
          .map((c: any) => c.text)
          .join('\n');

        const imageContent = result.content
          .filter((c: any) => c.type === 'image')
          .map((c: any) => ({
            base64: c.data,
            mimeType: c.mimeType || 'image/png'
          }));

        // Return both text and images if images present
        if (imageContent.length > 0) {
          logger.debug(`  Tool returned ${imageContent.length} image(s)`);
          return {
            text: textContent,
            images: imageContent
          };
        }

        return textContent || result;
      }

      return result;
    } catch (error) {
      throw new MCPError(
        `Failed to execute tool '${toolName}': ${error instanceof Error ? error.message : String(error)}`,
        serverName
      );
    }
  }

  /**
   * Convert MCP tool definitions to our internal Tool format
   */
  private convertMCPTools(mcpTools: any[]): Tool[] {
    return mcpTools.map(tool => ({
      name: tool.name,
      description: tool.description || tool.name,
      parameters: tool.inputSchema || {
        type: 'object',
        properties: {},
      },
    }));
  }

  /**
   * Check if a server is connected
   */
  isConnected(serverName: string): boolean {
    return this.connections.has(serverName);
  }

  /**
   * Get list of connected server names
   */
  getConnectedServers(): string[] {
    return Array.from(this.connections.keys());
  }

  /**
   * Refresh tools from a specific server
   */
  async refreshTools(serverName: string): Promise<void> {
    const connection = this.connections.get(serverName);
    if (!connection) {
      throw new MCPError(`MCP server '${serverName}' not connected`, serverName);
    }

    try {
      const toolsResult = await connection.client.listTools();
      connection.tools = this.convertMCPTools(toolsResult.tools || []);
      logger.info(`Refreshed tools for MCP server: ${serverName} (${connection.tools.length} tools)`);
    } catch (error) {
      throw new MCPError(
        `Failed to refresh tools for '${serverName}': ${error instanceof Error ? error.message : String(error)}`,
        serverName
      );
    }
  }
}
