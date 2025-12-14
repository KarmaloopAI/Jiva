#!/usr/bin/env node

/**
 * Jiva CLI Entry Point
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { configManager } from '../../core/config.js';
import { createKrutrimModel } from '../../models/krutrim.js';
import { ModelOrchestrator } from '../../models/orchestrator.js';
import { MCPServerManager } from '../../mcp/server-manager.js';
import { WorkspaceManager } from '../../core/workspace.js';
import { ConversationManager } from '../../core/conversation-manager.js';
import { DualAgent } from '../../core/dual-agent.js';
import { runSetupWizard, updateConfiguration } from './setup-wizard.js';
import { startREPL } from './repl.js';
import { logger, LogLevel } from '../../utils/logger.js';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read package.json for version
const packageJson = JSON.parse(
  readFileSync(join(__dirname, '../../../package.json'), 'utf-8')
);

const program = new Command();

program
  .name('jiva')
  .description('Versatile autonomous AI agent powered by gpt-oss-120b')
  .version(packageJson.version);

program
  .command('setup')
  .description('Run the setup wizard to configure Jiva')
  .action(async () => {
    try {
      await runSetupWizard();
    } catch (error) {
      logger.error('Setup failed', error);
      process.exit(1);
    }
  });

program
  .command('config')
  .description('Update Jiva configuration')
  .action(async () => {
    try {
      if (!configManager.isConfigured()) {
        console.log(chalk.yellow('Jiva is not configured. Running setup wizard...\n'));
        await runSetupWizard();
      } else {
        await updateConfiguration();
      }
    } catch (error) {
      logger.error('Configuration update failed', error);
      process.exit(1);
    }
  });

program
  .command('chat')
  .description('Start interactive chat with Jiva')
  .option('-w, --workspace <path>', 'Workspace directory', process.cwd())
  .option('-d, --directive <path>', 'Path to jiva-directive.md file')
  .option('--debug', 'Enable debug mode')
  .option('-t, --temperature <value>', 'Model temperature (0-1)', parseFloat)
  .option('--max-iterations <number>', 'Maximum agent iterations', parseInt)
  .action(async (options) => {
    try {
      // Check configuration
      if (!configManager.isConfigured()) {
        console.log(chalk.yellow('Jiva is not configured. Running setup wizard...\n'));
        await runSetupWizard();
      }

      // Set debug mode if requested
      if (options.debug) {
        logger.setLogLevel(LogLevel.DEBUG);
      } else if (configManager.isDebug()) {
        logger.setLogLevel(LogLevel.DEBUG);
      }

      // Validate configuration
      configManager.validateConfig();

      // Create models
      const reasoningModelConfig = configManager.getReasoningModel()!;
      const reasoningModel = createKrutrimModel({
        endpoint: reasoningModelConfig.endpoint,
        apiKey: reasoningModelConfig.apiKey,
        model: reasoningModelConfig.defaultModel,
        type: 'reasoning',
        useHarmonyFormat: reasoningModelConfig.useHarmonyFormat,
      });

      let multimodalModel;
      const multimodalModelConfig = configManager.getMultimodalModel();
      if (multimodalModelConfig) {
        multimodalModel = createKrutrimModel({
          endpoint: multimodalModelConfig.endpoint,
          apiKey: multimodalModelConfig.apiKey,
          model: multimodalModelConfig.defaultModel,
          type: 'multimodal',
        });
      }

      // Test model connectivity before proceeding
      console.log(chalk.gray('Testing model connectivity...\n'));

      const reasoningTest = await reasoningModel.testConnectivity();
      if (!reasoningTest.success) {
        console.log(chalk.red('✗ Reasoning model connection failed'));
        console.log(chalk.gray(`  Endpoint: ${reasoningModelConfig.endpoint}`));
        console.log(chalk.gray(`  Model: ${reasoningModelConfig.defaultModel}`));
        console.log(chalk.red(`  Error: ${reasoningTest.error}\n`));
        console.log(chalk.yellow('Please check your configuration with:'), chalk.cyan('jiva config\n'));
        process.exit(1);
      }
      console.log(chalk.green(`✓ Reasoning model connected (${reasoningTest.latency}ms)`));

      if (multimodalModel) {
        const multimodalTest = await multimodalModel.testConnectivity();
        if (!multimodalTest.success) {
          console.log(chalk.yellow('⚠ Multimodal model connection failed (continuing without vision support)'));
          console.log(chalk.gray(`  Error: ${multimodalTest.error}`));
          multimodalModel = undefined; // Disable multimodal
        } else {
          console.log(chalk.green(`✓ Multimodal model connected (${multimodalTest.latency}ms)`));
        }
      }

      console.log(''); // Empty line for spacing

      // Create orchestrator
      const orchestrator = new ModelOrchestrator({
        reasoningModel,
        multimodalModel,
      });

      // Determine workspace directory first
      const workspaceDir = options.workspace || process.cwd();

      // Update filesystem MCP server to allow broad filesystem access
      // The workspace is the default working area, but Jiva can access any files
      // subject to OS permissions
      const mcpServers = configManager.getMCPServers();
      if (mcpServers['filesystem']) {
        // Note: The filesystem MCP server rejects "/" as a security measure
        // Use /Users on macOS/Linux to allow access to all user directories
        // Use C:\Users on Windows
        const allowedPath = process.platform === 'win32' ? 'C:\\Users' : '/Users';
        mcpServers['filesystem'].args = [
          '-y',
          '@modelcontextprotocol/server-filesystem',
          allowedPath
        ];
        logger.debug(`Filesystem server args set to: ${JSON.stringify(mcpServers['filesystem'].args)}`);
        logger.debug(`Allowed path: "${allowedPath}"`);
      }

      // Initialize MCP servers with updated paths
      const mcpManager = new MCPServerManager();
      await mcpManager.initialize(mcpServers);

      // Initialize workspace
      const workspace = new WorkspaceManager({
        workspaceDir,
        directivePath: options.directive,
      });
      await workspace.initialize();

      // Initialize conversation manager
      const conversationManager = new ConversationManager();
      await conversationManager.initialize();

      // Create agent (dual-agent architecture)
      const agent = new DualAgent({
        orchestrator,
        mcpManager,
        workspace,
        conversationManager,
        maxSubtasks: options.maxIterations || 10,
        autoSave: true,
        condensingThreshold: 30,
      });

      // Start REPL
      await startREPL({ agent });

      // Cleanup
      await agent.cleanup();
    } catch (error) {
      logger.error('Chat session failed', error);
      process.exit(1);
    }
  });

program
  .command('run')
  .description('Run Jiva with a single prompt')
  .argument('<prompt>', 'Prompt to execute')
  .option('-w, --workspace <path>', 'Workspace directory', process.cwd())
  .option('-d, --directive <path>', 'Path to jiva-directive.md file')
  .option('--debug', 'Enable debug mode')
  .option('-t, --temperature <value>', 'Model temperature (0-1)', parseFloat)
  .option('--max-iterations <number>', 'Maximum agent iterations', parseInt)
  .action(async (prompt, options) => {
    try {
      // Check configuration
      if (!configManager.isConfigured()) {
        console.log(chalk.red('✗ Jiva is not configured. Please run: jiva setup\n'));
        process.exit(1);
      }

      // Set debug mode if requested
      if (options.debug) {
        logger.setLogLevel(LogLevel.DEBUG);
      } else if (configManager.isDebug()) {
        logger.setLogLevel(LogLevel.DEBUG);
      }

      // Validate configuration
      configManager.validateConfig();

      // Create models
      const reasoningModelConfig = configManager.getReasoningModel()!;
      const reasoningModel = createKrutrimModel({
        endpoint: reasoningModelConfig.endpoint,
        apiKey: reasoningModelConfig.apiKey,
        model: reasoningModelConfig.defaultModel,
        type: 'reasoning',
        useHarmonyFormat: reasoningModelConfig.useHarmonyFormat,
      });

      let multimodalModel;
      const multimodalModelConfig = configManager.getMultimodalModel();
      if (multimodalModelConfig) {
        multimodalModel = createKrutrimModel({
          endpoint: multimodalModelConfig.endpoint,
          apiKey: multimodalModelConfig.apiKey,
          model: multimodalModelConfig.defaultModel,
          type: 'multimodal',
        });
      }

      // Test model connectivity before proceeding
      console.log(chalk.gray('Testing model connectivity...\n'));

      const reasoningTest = await reasoningModel.testConnectivity();
      if (!reasoningTest.success) {
        console.log(chalk.red('✗ Reasoning model connection failed'));
        console.log(chalk.gray(`  Endpoint: ${reasoningModelConfig.endpoint}`));
        console.log(chalk.gray(`  Model: ${reasoningModelConfig.defaultModel}`));
        console.log(chalk.red(`  Error: ${reasoningTest.error}\n`));
        console.log(chalk.yellow('Please check your configuration with:'), chalk.cyan('jiva config\n'));
        process.exit(1);
      }
      console.log(chalk.green(`✓ Reasoning model connected (${reasoningTest.latency}ms)`));

      if (multimodalModel) {
        const multimodalTest = await multimodalModel.testConnectivity();
        if (!multimodalTest.success) {
          console.log(chalk.yellow('⚠ Multimodal model connection failed (continuing without vision support)'));
          console.log(chalk.gray(`  Error: ${multimodalTest.error}`));
          multimodalModel = undefined; // Disable multimodal
        } else {
          console.log(chalk.green(`✓ Multimodal model connected (${multimodalTest.latency}ms)`));
        }
      }

      console.log(''); // Empty line for spacing

      // Create orchestrator
      const orchestrator = new ModelOrchestrator({
        reasoningModel,
        multimodalModel,
      });

      // Determine workspace directory first
      const workspaceDir = options.workspace || process.cwd();

      // Update filesystem MCP server to allow broad filesystem access
      // The workspace is the default working area, but Jiva can access any files
      // subject to OS permissions
      const mcpServers = configManager.getMCPServers();
      if (mcpServers['filesystem']) {
        // Note: The filesystem MCP server rejects "/" as a security measure
        // Use /Users on macOS/Linux to allow access to all user directories
        // Use C:\Users on Windows
        const allowedPath = process.platform === 'win32' ? 'C:\\Users' : '/Users';
        mcpServers['filesystem'].args = [
          '-y',
          '@modelcontextprotocol/server-filesystem',
          allowedPath
        ];
        logger.debug(`Filesystem server args set to: ${JSON.stringify(mcpServers['filesystem'].args)}`);
        logger.debug(`Allowed path: "${allowedPath}"`);
      }

      // Initialize MCP servers with updated paths
      const mcpManager = new MCPServerManager();
      await mcpManager.initialize(mcpServers);

      // Initialize workspace
      const workspace = new WorkspaceManager({
        workspaceDir,
        directivePath: options.directive,
      });
      await workspace.initialize();

      // Initialize conversation manager
      const conversationManager = new ConversationManager();
      await conversationManager.initialize();

      // Create agent (dual-agent architecture)
      const agent = new DualAgent({
        orchestrator,
        mcpManager,
        workspace,
        conversationManager,
        maxSubtasks: options.maxIterations || 10,
        autoSave: true,
        condensingThreshold: 30,
      });

      // Execute prompt
      logger.info('Executing prompt...');
      const response = await agent.chat(prompt);

      // Import and use markdown formatter
      const { formatForCLI } = await import('../../utils/markdown.js');
      const formattedContent = formatForCLI(response.content);

      console.log('\n' + formattedContent + '\n');

      if (response.toolsUsed.length > 0) {
        logger.info(`Tools used: ${response.toolsUsed.join(', ')}`);
      }

      logger.info(`Completed in ${response.iterations} iteration(s)`);

      // Cleanup
      await agent.cleanup();
    } catch (error) {
      logger.error('Execution failed', error);
      process.exit(1);
    }
  });

// Default command (interactive chat)
program.action(async (options) => {
  // If no command specified, run chat
  await program.parseAsync(['', '', 'chat']);
});

program.parse();
