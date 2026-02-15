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
import { orchestrationLogger } from '../../utils/orchestration-logger.js';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createLocalProvider } from '../../storage/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read package.json for version
const packageJson = JSON.parse(
  readFileSync(join(__dirname, '../../../package.json'), 'utf-8')
);

const program = new Command();
program
  .option('--condensing-threshold <number>', 'Condensing threshold for agent', parseInt);

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
  .option('--show', 'Show current configuration and source')
  .action(async (options) => {
    try {
      if (options.show) {
        // Show current configuration
        const config = configManager.getConfig();
        const configPath = configManager.getConfigPath();
        
        console.log(chalk.bold.cyan('\n∞ Jiva Configuration\n'));
        console.log(chalk.gray('Configuration source:'), chalk.white(configPath));
        console.log();
        
        if (config.models?.reasoning) {
          console.log(chalk.bold('Reasoning Model:'));
          console.log(chalk.gray('  Endpoint:'), config.models.reasoning.endpoint);
          console.log(chalk.gray('  Model:'), config.models.reasoning.defaultModel);
          console.log(chalk.gray('  Harmony Format:'), config.models.reasoning.useHarmonyFormat ? 'Yes' : 'No');
          console.log();
        }
        
        if (config.models?.multimodal) {
          console.log(chalk.bold('Multimodal Model:'));
          console.log(chalk.gray('  Endpoint:'), config.models.multimodal.endpoint);
          console.log(chalk.gray('  Model:'), config.models.multimodal.defaultModel);
          console.log();
        }
        
        const mcpServers = configManager.getMCPServers();
        if (Object.keys(mcpServers).length > 0) {
          console.log(chalk.bold('MCP Servers:'));
          for (const [name, server] of Object.entries(mcpServers)) {
            console.log(chalk.gray(`  ${name}:`), server.enabled ? chalk.green('enabled') : chalk.red('disabled'));
          }
          console.log();
        }
        
        return;
      }
      
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
  .option('--condensing-threshold <number>', 'Condensing threshold for agent', parseInt)
  .description('Start interactive chat with Jiva')
  .option('-c, --config <path>', 'Path to configuration JSON file')
  .option('-w, --workspace <path>', 'Workspace directory', process.cwd())
  .option('-d, --directive <path>', 'Path to jiva-directive.md file')
  .option('--debug', 'Enable debug mode')
  .option('-t, --temperature <value>', 'Model temperature (0-1)', parseFloat)
  .option('--max-iterations <number>', 'Maximum agent iterations', parseInt)
  .action(async (options) => {
    try {
      // Load configuration from file if provided
      let configSource = 'default (~/.config/jiva/config.json)';
      let modelConfig: any;
      let mcpServers: any;
      
      if (options.config) {
        configSource = options.config;
        console.log(chalk.gray(`Loading configuration from: ${configSource}\n`));
        const configFile = await import('fs/promises').then(fs => fs.readFile(options.config, 'utf-8'));
        const config = JSON.parse(configFile);
        modelConfig = config.models;
        mcpServers = config.mcpServers || {};
      } else {
        // Use default ConfigManager
        if (!configManager.isConfigured()) {
          console.log(chalk.yellow('Jiva is not configured. Running setup wizard...\n'));
          await runSetupWizard();
        }
        configManager.validateConfig();
        modelConfig = {
          reasoning: configManager.getReasoningModel(),
          multimodal: configManager.getMultimodalModel(),
        };
        mcpServers = configManager.getMCPServers();
      }

      // Set debug mode if requested
      if (options.debug) {
        logger.setLogLevel(LogLevel.DEBUG);
      } else if (configManager.isDebug()) {
        logger.setLogLevel(LogLevel.DEBUG);
      }

      // Create models from loaded config
      if (!modelConfig?.reasoning) {
        throw new Error('Reasoning model configuration is required');
      }
      const reasoningModelConfig = modelConfig.reasoning;
      const reasoningModel = createKrutrimModel({
        endpoint: reasoningModelConfig.endpoint,
        apiKey: reasoningModelConfig.apiKey,
        model: reasoningModelConfig.defaultModel,
        type: 'reasoning',
        useHarmonyFormat: reasoningModelConfig.useHarmonyFormat,
      });

      let multimodalModel;
      const multimodalModelConfig = modelConfig.multimodal;
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
      // mcpServers already loaded from config above
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

      // Initialize conversation manager with local storage provider
      const storageProvider = await createLocalProvider();
      const conversationManager = new ConversationManager(storageProvider);

      // Create agent (dual-agent architecture)
      const agent = new DualAgent({
        orchestrator,
        mcpManager,
        workspace,
        conversationManager,
        maxSubtasks: 20, // Manager's subtask limit (separate from Worker iterations)
        maxIterations: options.maxIterations || 10, // Worker's iteration limit per subtask
        autoSave: true,
        condensingThreshold: options.condensingThreshold ?? 30,
      });

      // Start REPL
      await startREPL({ agent });

      // Cleanup
      await agent.cleanup();
      orchestrationLogger.close();

      // Show log location
      const logPath = orchestrationLogger.getLogFilePath();
      if (logPath) {
        logger.info(`\nOrchestration log saved to: ${logPath}`);
      }
    } catch (error) {
      logger.error('Chat session failed', error);
      orchestrationLogger.close();
      process.exit(1);
    }
  });

program
  .command('run')
  .option('--condensing-threshold <number>', 'Condensing threshold for agent', parseInt)
  .description('Run Jiva with a single prompt')
  .argument('<prompt>', 'Prompt to execute')
  .option('-c, --config <path>', 'Path to configuration JSON file')
  .option('-w, --workspace <path>', 'Workspace directory', process.cwd())
  .option('-d, --directive <path>', 'Path to jiva-directive.md file')
  .option('--debug', 'Enable debug mode')
  .option('-t, --temperature <value>', 'Model temperature (0-1)', parseFloat)
  .option('--max-iterations <number>', 'Maximum agent iterations', parseInt)
  .action(async (prompt, options) => {
    try {
      // Load configuration from file if provided
      let modelConfig: any;
      let mcpServers: any;
      
      if (options.config) {
        console.log(chalk.gray(`Loading configuration from: ${options.config}\n`));
        const configFile = await import('fs/promises').then(fs => fs.readFile(options.config, 'utf-8'));
        const config = JSON.parse(configFile);
        modelConfig = config.models;
        mcpServers = config.mcpServers || {};
      } else {
        // Use default ConfigManager
        if (!configManager.isConfigured()) {
          console.log(chalk.red('✗ Jiva is not configured. Please run: jiva setup\n'));
          process.exit(1);
        }
        configManager.validateConfig();
        modelConfig = {
          reasoning: configManager.getReasoningModel(),
          multimodal: configManager.getMultimodalModel(),
        };
        mcpServers = configManager.getMCPServers();
      }

      // Set debug mode if requested
      if (options.debug) {
        logger.setLogLevel(LogLevel.DEBUG);
      } else if (configManager.isDebug()) {
        logger.setLogLevel(LogLevel.DEBUG);
      }

      // Create models from loaded config
      if (!modelConfig?.reasoning) {
        throw new Error('Reasoning model configuration is required');
      }
      const reasoningModelConfig = modelConfig.reasoning;
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
      // mcpServers already loaded from config above
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

      // Initialize conversation manager with local storage provider
      const storageProvider = await createLocalProvider();
      const conversationManager = new ConversationManager(storageProvider);

      // Create agent (dual-agent architecture)
      const agent = new DualAgent({
        orchestrator,
        mcpManager,
        workspace,
        conversationManager,
        maxSubtasks: 20, // Manager's subtask limit (separate from Worker iterations)
        maxIterations: options.maxIterations || 10, // Worker's iteration limit per subtask
        autoSave: true,
        condensingThreshold: options.condensingThreshold ?? 30,
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
      orchestrationLogger.close();

      // Show log location
      const logPath = orchestrationLogger.getLogFilePath();
      if (logPath) {
        logger.info(`\nOrchestration log saved to: ${logPath}`);
      }
    } catch (error) {
      logger.error('Execution failed', error);
      orchestrationLogger.close();
      process.exit(1);
    }
  });

// Default command (interactive chat)
program.action(async (options) => {
  // If no command specified, run chat with the same options
  const args = process.argv.slice(2);
  // Insert 'chat' as the command if not already present
  const hasCommand = args.some(arg => ['chat', 'run', 'setup', 'config'].includes(arg));
  const newArgs = hasCommand ? args : ['chat', ...args];
  await program.parseAsync(['node', 'jiva', ...newArgs]);
});

program.parse();
