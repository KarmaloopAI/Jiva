/**
 * MCP Server Manager
 *
 * Manages lifecycle of MCP servers based on configuration
 */

import { MCPClient } from './client.js';
import { MCPServerConfig } from '../core/config.js';
import { logger } from '../utils/logger.js';
import { MCPError } from '../utils/errors.js';

export class MCPServerManager {
  private mcpClient: MCPClient;
  private serverConfigs: Map<string, MCPServerConfig> = new Map();

  constructor() {
    this.mcpClient = new MCPClient();
  }

  /**
   * Initialize servers from configuration
   */
  async initialize(servers: Record<string, MCPServerConfig>): Promise<void> {
    logger.info('Initializing MCP servers...');

    const serverEntries = Object.entries(servers);
    const enabledServers = serverEntries.filter(([_, config]) => config.enabled);

    logger.info(`Found ${enabledServers.length} enabled MCP servers`);

    // Store configs
    for (const [name, config] of serverEntries) {
      this.serverConfigs.set(name, config);
    }

    // Connect to enabled servers
    const connectionPromises = enabledServers.map(async ([name, config]) => {
      try {
        await this.connectServer(name, config);
        return { name, success: true };
      } catch (error) {
        logger.warn(`Failed to connect to MCP server '${name}': ${error instanceof Error ? error.message : String(error)}`);
        // Continue with other servers even if one fails
        return { name, success: false };
      }
    });

    const results = await Promise.allSettled(connectionPromises);

    const connectedServers = this.mcpClient.getConnectedServers();

    if (connectedServers.length > 0) {
      logger.success(`MCP servers connected: ${connectedServers.join(', ')}`);
    } else if (enabledServers.length > 0) {
      logger.warn('No MCP servers connected. Agent will run without external tools.');
    } else {
      logger.info('No MCP servers enabled. Agent will run without external tools.');
    }
  }

  /**
   * Connect to a specific server (supports both stdio and HTTP/SSE)
   */
  private async connectServer(name: string, config: MCPServerConfig): Promise<void> {
    if (config.url) {
      // HTTP/SSE transport
      await this.mcpClient.connectSSE(
        name,
        config.url,
        config.headers
      );
    } else if (config.command) {
      // Stdio transport
      await this.mcpClient.connect(
        name,
        config.command,
        config.args || [],
        config.env
      );
    } else {
      throw new MCPError(
        `Invalid MCP server configuration for '${name}': must specify either 'command' or 'url'`,
        name
      );
    }
  }

  /**
   * Add and connect to a new server
   */
  async addServer(name: string, config: MCPServerConfig): Promise<void> {
    if (this.serverConfigs.has(name)) {
      throw new MCPError(`Server '${name}' already exists`, name);
    }

    this.serverConfigs.set(name, config);

    if (config.enabled) {
      await this.connectServer(name, config);
    }
  }

  /**
   * Remove and disconnect from a server
   */
  async removeServer(name: string): Promise<void> {
    await this.mcpClient.disconnect(name);
    this.serverConfigs.delete(name);
  }

  /**
   * Enable a server and connect
   */
  async enableServer(name: string): Promise<void> {
    const config = this.serverConfigs.get(name);
    if (!config) {
      throw new MCPError(`Server '${name}' not found in configuration`, name);
    }

    config.enabled = true;

    if (!this.mcpClient.isConnected(name)) {
      await this.connectServer(name, config);
    }
  }

  /**
   * Disable a server and disconnect
   */
  async disableServer(name: string): Promise<void> {
    const config = this.serverConfigs.get(name);
    if (!config) {
      throw new MCPError(`Server '${name}' not found in configuration`, name);
    }

    config.enabled = false;
    await this.mcpClient.disconnect(name);
  }

  /**
   * Get the MCP client instance
   */
  getClient(): MCPClient {
    return this.mcpClient;
  }

  /**
   * Get all server configurations
   */
  getServerConfigs(): Map<string, MCPServerConfig> {
    return new Map(this.serverConfigs);
  }

  /**
   * Cleanup all servers
   */
  async cleanup(): Promise<void> {
    logger.info('Cleaning up MCP servers...');
    await this.mcpClient.disconnectAll();
  }

  /**
   * Get server status
   */
  getServerStatus(): Array<{
    name: string;
    enabled: boolean;
    connected: boolean;
    toolCount: number;
  }> {
    return Array.from(this.serverConfigs.entries()).map(([name, config]) => {
      const connected = this.mcpClient.isConnected(name);
      const tools = connected ? this.mcpClient.getServerTools(name) : [];

      return {
        name,
        enabled: config.enabled,
        connected,
        toolCount: tools.length,
      };
    });
  }
}
