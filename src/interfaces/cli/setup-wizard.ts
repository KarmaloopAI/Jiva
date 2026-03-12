/**
 * Setup Wizard for first-time configuration
 */

import inquirer from 'inquirer';
import { configManager } from '../../core/config.js';
import { logger } from '../../utils/logger.js';
import chalk from 'chalk';

export async function runSetupWizard(): Promise<void> {
  console.log(chalk.bold.cyan('\n∞ Welcome to Jiva Setup Wizard\n'));
  console.log('This wizard will help you configure Jiva for the first time.\n');

  // Reasoning Model Configuration
  console.log(chalk.bold('Reasoning Model Configuration (gpt-oss-120b)'));
  console.log(chalk.gray('This model will be used for reasoning and tool calling.\n'));

  const reasoningAnswers = await inquirer.prompt([
    {
      type: 'input',
      name: 'endpoint',
      message: 'API Endpoint URL:',
      default: 'https://cloud.olakrutrim.com/v1/chat/completions',
      validate: (input: string) => {
        try {
          new URL(input);
          return true;
        } catch {
          return 'Please enter a valid URL';
        }
      },
    },
    {
      type: 'password',
      name: 'apiKey',
      message: 'API Key:',
      validate: (input: string) => input.length > 0 || 'API key is required',
    },
    {
      type: 'input',
      name: 'model',
      message: 'Model name:',
      default: 'gpt-oss-120b',
    },
  ]);

  // Detect if Harmony format should be used based on model name
  const isKrutrimModel = reasoningAnswers.model.includes('gpt-oss-120b');
  const defaultUseHarmony = isKrutrimModel;

  console.log(chalk.gray('\nTool Format Configuration'));
  console.log(chalk.gray('Different providers use different formats for tool calling.\n'));

  const { useHarmonyFormat } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'useHarmonyFormat',
      message: 'Use Harmony format for tool calling?',
      default: defaultUseHarmony,
      when: () => {
        // Show this prompt for all models, but provide smart default
        console.log(chalk.gray(`  Recommended: ${defaultUseHarmony ? 'Yes' : 'No'} (${isKrutrimModel ? 'Krutrim uses Harmony format' : 'Standard OpenAI format'})`));
        return true;
      },
    },
  ]);

  configManager.setReasoningModel({
    name: 'reasoning',
    endpoint: reasoningAnswers.endpoint,
    apiKey: reasoningAnswers.apiKey,
    type: 'reasoning',
    defaultModel: reasoningAnswers.model,
    useHarmonyFormat,
  });

  logger.success('Reasoning model configured');

  // Multimodal Model Configuration (Optional)
  console.log(chalk.bold('\nMultimodal Model Configuration (Optional)'));
  console.log(chalk.gray('This model will be used for understanding images.\n'));

  const { configureMultimodal } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'configureMultimodal',
      message: 'Would you like to configure a multimodal model?',
      default: true,
    },
  ]);

  if (configureMultimodal) {
    const multimodalAnswers = await inquirer.prompt([
      {
        type: 'input',
        name: 'endpoint',
        message: 'Multimodal API Endpoint URL:',
        default: 'https://cloud.olakrutrim.com/v1/chat/completions',
        validate: (input: string) => {
          try {
            new URL(input);
            return true;
          } catch {
            return 'Please enter a valid URL';
          }
        },
      },
      {
        type: 'password',
        name: 'apiKey',
        message: 'Multimodal API Key:',
        default: reasoningAnswers.apiKey,
        validate: (input: string) => input.length > 0 || 'API key is required',
      },
      {
        type: 'input',
        name: 'model',
        message: 'Multimodal model name:',
        default: 'Llama-4-Maverick-17B-128E-Instruct',
      },
    ]);

    configManager.setMultimodalModel({
      name: 'multimodal',
      endpoint: multimodalAnswers.endpoint,
      apiKey: multimodalAnswers.apiKey,
      type: 'multimodal',
      defaultModel: multimodalAnswers.model,
    });

    logger.success('Multimodal model configured');
  }

  // ── Tool-Calling Model ────────────────────────────────────────────────────
  console.log(chalk.bold('\nTool-Calling Model Configuration (Optional)'));
  console.log(chalk.gray('A dedicated model that reliably formats tool calls as standard JSON.'));
  console.log(chalk.gray('When configured it is used as the PRIMARY model for tool execution,'));
  console.log(chalk.gray('with the reasoning model acting as a secondary fallback.\n'));

  const { configureToolCalling } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'configureToolCalling',
      message: 'Would you like to configure a tool-calling model?',
      default: false,
    },
  ]);

  if (configureToolCalling) {
    const toolCallingAnswers = await inquirer.prompt([
      {
        type: 'input',
        name: 'endpoint',
        message: 'Tool-Calling API Endpoint URL:',
        default: 'https://cloud.olakrutrim.com/v1/chat/completions',
        validate: (input: string) => {
          try {
            new URL(input);
            return true;
          } catch {
            return 'Please enter a valid URL';
          }
        },
      },
      {
        type: 'password',
        name: 'apiKey',
        message: 'Tool-Calling API Key:',
        default: reasoningAnswers.apiKey,
        validate: (input: string) => input.length > 0 || 'API key is required',
      },
      {
        type: 'input',
        name: 'model',
        message: 'Tool-Calling model name:',
        default: 'gpt-4o-mini',
      },
    ]);

    configManager.setToolCallingModel({
      name: 'tool-calling',
      endpoint: toolCallingAnswers.endpoint,
      apiKey: toolCallingAnswers.apiKey,
      type: 'tool-calling',
      defaultModel: toolCallingAnswers.model,
      useHarmonyFormat: false,
    });

    logger.success('Tool-calling model configured');
  }

  // MCP Servers Configuration
  console.log(chalk.bold('\nMCP Servers Configuration'));
  console.log(chalk.gray('Setting up default MCP servers (filesystem, mcp-shell-server)...\n'));

  configManager.initializeDefaultServers();
  logger.success('Default MCP servers configured');

  // Debug Mode
  const { enableDebug } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'enableDebug',
      message: 'Enable debug mode?',
      default: false,
    },
  ]);

  configManager.setDebug(enableDebug);

  console.log(chalk.bold.green('\n✓ Setup complete!\n'));
  console.log(`Configuration saved to: ${chalk.cyan(configManager.getConfigPath())}`);
  console.log('\nYou can now run:', chalk.cyan('jiva'));
  console.log('');
}

/**
 * Update existing configuration interactively
 */
export async function updateConfiguration(): Promise<void> {
  console.log(chalk.bold.cyan('\n🔧 Update Jiva Configuration\n'));

  const { choice } = await inquirer.prompt([
    {
      type: 'list',
      name: 'choice',
      message: 'What would you like to update?',
      choices: [
        { name: 'Reasoning Model', value: 'reasoning' },
        { name: 'Multimodal Model', value: 'multimodal' },
        { name: 'Tool-Calling Model', value: 'tool-calling' },
        { name: 'MCP Servers', value: 'mcp' },
        { name: 'Debug Mode', value: 'debug' },
        { name: 'View Configuration', value: 'view' },
        { name: 'Reset All', value: 'reset' },
        { name: 'Cancel', value: 'cancel' },
      ],
    },
  ]);

  switch (choice) {
    case 'reasoning':
      await updateReasoningModel();
      break;
    case 'multimodal':
      await updateMultimodalModel();
      break;
    case 'tool-calling':
      await updateToolCallingModel();
      break;
    case 'mcp':
      await manageMCPServers();
      break;
    case 'debug':
      await toggleDebugMode();
      break;
    case 'view':
      viewConfiguration();
      break;
    case 'reset':
      await resetConfiguration();
      break;
    case 'cancel':
      console.log('Cancelled');
      break;
  }
}

async function updateReasoningModel() {
  const current = configManager.getReasoningModel();

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'endpoint',
      message: 'API Endpoint URL:',
      default: current?.endpoint,
    },
    {
      type: 'password',
      name: 'apiKey',
      message: 'API Key:',
      default: current?.apiKey,
    },
    {
      type: 'input',
      name: 'model',
      message: 'Model name:',
      default: current?.defaultModel,
    },
  ]);

  // Detect if Harmony format should be used based on model name
  const isKrutrimModel = answers.model.includes('gpt-oss-120b');
  const defaultUseHarmony = isKrutrimModel;

  console.log(chalk.gray('\nTool Format Configuration'));
  console.log(chalk.gray('Different providers use different formats for tool calling.\n'));

  const { useHarmonyFormat } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'useHarmonyFormat',
      message: 'Use Harmony format for tool calling?',
      default: current?.useHarmonyFormat ?? defaultUseHarmony,
      when: () => {
        // Show this prompt for all models, but provide smart default
        console.log(chalk.gray(`  Recommended: ${defaultUseHarmony ? 'Yes' : 'No'} (${isKrutrimModel ? 'Krutrim uses Harmony format' : 'Standard OpenAI format'})`));
        return true;
      },
    },
  ]);

  configManager.setReasoningModel({
    name: 'reasoning',
    endpoint: answers.endpoint,
    apiKey: answers.apiKey,
    type: 'reasoning',
    defaultModel: answers.model,
    useHarmonyFormat,
  });

  logger.success('Reasoning model updated');
}

async function updateMultimodalModel() {
  const current = configManager.getMultimodalModel();

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'endpoint',
      message: 'Multimodal API Endpoint URL:',
      default: current?.endpoint || 'https://cloud.olakrutrim.com/v1/chat/completions',
    },
    {
      type: 'password',
      name: 'apiKey',
      message: 'Multimodal API Key:',
      default: current?.apiKey,
    },
    {
      type: 'input',
      name: 'model',
      message: 'Multimodal model name:',
      default: current?.defaultModel || 'Llama-4-Maverick-17B-128E-Instruct',
    },
  ]);

  configManager.setMultimodalModel({
    name: 'multimodal',
    endpoint: answers.endpoint,
    apiKey: answers.apiKey,
    type: 'multimodal',
    defaultModel: answers.model,
  });

  logger.success('Multimodal model updated');
}

async function updateToolCallingModel() {
  const current = configManager.getToolCallingModel();

  console.log(chalk.gray('\nA dedicated tool-calling model is used as the PRIMARY model for tool'));
  console.log(chalk.gray('execution. The reasoning model acts as the secondary fallback.\n'));

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'endpoint',
      message: 'Tool-Calling API Endpoint URL:',
      default: current?.endpoint || 'https://cloud.olakrutrim.com/v1/chat/completions',
    },
    {
      type: 'password',
      name: 'apiKey',
      message: 'Tool-Calling API Key:',
      default: current?.apiKey,
    },
    {
      type: 'input',
      name: 'model',
      message: 'Tool-Calling model name:',
      default: current?.defaultModel || 'gpt-4o-mini',
    },
  ]);

  configManager.setToolCallingModel({
    name: 'tool-calling',
    endpoint: answers.endpoint,
    apiKey: answers.apiKey,
    type: 'tool-calling',
    defaultModel: answers.model,
    useHarmonyFormat: false,
  });

  logger.success('Tool-calling model updated');
}

async function manageMCPServers() {
  const servers = configManager.getMCPServers();
  const serverNames = Object.keys(servers);

  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: 'MCP Server Action:',
      choices: [
        { name: 'List Servers', value: 'list' },
        { name: 'Add Server', value: 'add' },
        { name: 'Remove Server', value: 'remove' },
        { name: 'Back', value: 'back' },
      ],
    },
  ]);

  if (action === 'list') {
    console.log('\nConfigured MCP Servers:');
    Object.entries(servers).forEach(([name, config]) => {
      console.log(`  ${config.enabled ? '✓' : '✗'} ${name}: ${config.command} ${config.args?.join(' ') || ''}`);
    });
  } else if (action === 'add') {
    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'name',
        message: 'Server name:',
      },
      {
        type: 'input',
        name: 'command',
        message: 'Command:',
      },
      {
        type: 'input',
        name: 'args',
        message: 'Arguments (space-separated):',
      },
    ]);

    configManager.addMCPServer(answers.name, {
      command: answers.command,
      args: answers.args ? answers.args.split(' ') : [],
      enabled: true,
    });

    logger.success(`MCP server '${answers.name}' added`);
  } else if (action === 'remove' && serverNames.length > 0) {
    const { serverName } = await inquirer.prompt([
      {
        type: 'list',
        name: 'serverName',
        message: 'Select server to remove:',
        choices: serverNames,
      },
    ]);

    configManager.removeMCPServer(serverName);
    logger.success(`MCP server '${serverName}' removed`);
  }
}

async function toggleDebugMode() {
  const current = configManager.isDebug();

  const { enabled } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'enabled',
      message: 'Enable debug mode?',
      default: current,
    },
  ]);

  configManager.setDebug(enabled);
  logger.success(`Debug mode ${enabled ? 'enabled' : 'disabled'}`);
}

function viewConfiguration() {
  const config = configManager.getConfig();
  console.log('\nCurrent Configuration:');
  console.log(JSON.stringify(config, null, 2));
}

async function resetConfiguration() {
  const { confirm } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirm',
      message: chalk.red('Are you sure you want to reset all configuration?'),
      default: false,
    },
  ]);

  if (confirm) {
    configManager.reset();
    logger.success('Configuration reset');
  }
}
