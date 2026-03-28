/**
 * Setup Wizard for first-time configuration
 *
 * Provider-aware: Krutrim, Groq, Sarvam, OpenAI-Compatible
 * - Auto-fills endpoints and model defaults per provider
 * - Asks API key only once per provider (reuses across model roles)
 * - Sets useHarmonyFormat, reasoningEffortStrategy, defaultMaxTokens automatically
 */

import inquirer from 'inquirer';
import { configManager } from '../../core/config.js';
import { logger } from '../../utils/logger.js';
import chalk from 'chalk';
import type { ModelConfig } from '../../core/config.js';

// ── Provider registry ──────────────────────────────────────────────────────

type ProviderKey = 'krutrim' | 'groq' | 'sarvam' | 'openai-compatible';

interface ProviderPreset {
  label: string;
  endpoint: string;
  reasoningModel: string;
  multimodalModel: string | null; // null = not supported
  toolCallingModel: string;
  useHarmonyFormat: boolean;
  reasoningEffortStrategy: 'api_param' | 'system_prompt' | 'both';
  defaultMaxTokens?: number;
  hasMultimodal: boolean;
  note?: string; // shown during setup
}

const PROVIDERS: Record<ProviderKey, ProviderPreset> = {
  krutrim: {
    label: 'Krutrim',
    endpoint: 'https://cloud.olakrutrim.com/v1/chat/completions',
    reasoningModel: 'gpt-oss-120b',
    multimodalModel: 'Llama-4-Maverick-17B-128E-Instruct',
    toolCallingModel: 'gpt-oss-120b',
    useHarmonyFormat: true,
    reasoningEffortStrategy: 'system_prompt',
    hasMultimodal: true,
  },
  groq: {
    label: 'Groq',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    reasoningModel: 'openai/gpt-oss-120b',
    multimodalModel: 'meta-llama/llama-4-maverick-17b-128e-instruct',
    toolCallingModel: 'meta-llama/llama-4-maverick-17b-128e-instruct',
    useHarmonyFormat: false,
    reasoningEffortStrategy: 'api_param',
    hasMultimodal: true,
  },
  sarvam: {
    label: 'Sarvam',
    endpoint: 'https://api.sarvam.ai/v1/chat/completions',
    reasoningModel: 'sarvam-105b',
    multimodalModel: null, // Sarvam has no multimodal model
    toolCallingModel: 'sarvam-105b',
    useHarmonyFormat: false,
    reasoningEffortStrategy: 'api_param',
    defaultMaxTokens: 8192,
    hasMultimodal: false,
    note: 'Sarvam does not offer a multimodal model. You will need to pick a separate provider for multimodal.',
  },
  'openai-compatible': {
    label: 'OpenAI-Compatible',
    endpoint: '',
    reasoningModel: '',
    multimodalModel: '',
    toolCallingModel: '',
    useHarmonyFormat: false,
    reasoningEffortStrategy: 'both',
    hasMultimodal: true,
  },
};

const PROVIDER_CHOICES = Object.entries(PROVIDERS).map(([value, p]) => ({
  name: p.label,
  value: value as ProviderKey,
}));

const MULTIMODAL_PROVIDER_CHOICES = PROVIDER_CHOICES.filter(c => c.value !== 'sarvam');

// ── Helpers ────────────────────────────────────────────────────────────────

async function askApiKey(provider: ProviderKey, collectedKeys: Map<ProviderKey, string>): Promise<string> {
  if (collectedKeys.has(provider)) {
    console.log(chalk.gray(`  Using ${PROVIDERS[provider].label} API key already entered.\n`));
    return collectedKeys.get(provider)!;
  }
  const { apiKey } = await inquirer.prompt([
    {
      type: 'password',
      name: 'apiKey',
      message: `${PROVIDERS[provider].label} API Key:`,
      validate: (input: string) => input.length > 0 || 'API key is required',
    },
  ]);
  collectedKeys.set(provider, apiKey);
  return apiKey;
}

async function askEndpointAndKey(collectedKeys: Map<ProviderKey, string>): Promise<{ endpoint: string; apiKey: string }> {
  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'endpoint',
      message: 'API Endpoint URL:',
      validate: (input: string) => {
        try { new URL(input); return true; } catch { return 'Please enter a valid URL'; }
      },
    },
    {
      type: 'password',
      name: 'apiKey',
      message: 'API Key:',
      validate: (input: string) => input.length > 0 || 'API key is required',
    },
  ]);
  collectedKeys.set('openai-compatible', answers.apiKey);
  return answers;
}

// ── Reasoning model setup ──────────────────────────────────────────────────

async function setupReasoningModel(collectedKeys: Map<ProviderKey, string>): Promise<{ config: ModelConfig; provider: ProviderKey }> {
  console.log(chalk.bold('\n● Reasoning Model'));
  console.log(chalk.gray('Used for planning and tool calling.\n'));

  const { provider } = await inquirer.prompt([
    {
      type: 'list',
      name: 'provider',
      message: 'Select provider:',
      choices: PROVIDER_CHOICES,
    },
  ]);

  const preset = PROVIDERS[provider as ProviderKey];

  if (preset.note) {
    console.log(chalk.yellow(`\n  ⚠  ${preset.note}\n`));
  }

  let endpoint = preset.endpoint;
  let apiKey: string;

  if (provider === 'openai-compatible') {
    const custom = await askEndpointAndKey(collectedKeys);
    endpoint = custom.endpoint;
    apiKey = custom.apiKey;
  } else {
    console.log(chalk.gray(`  Endpoint: ${endpoint}\n`));
    apiKey = await askApiKey(provider as ProviderKey, collectedKeys);
  }

  const { model } = await inquirer.prompt([
    {
      type: 'input',
      name: 'model',
      message: 'Model name:',
      default: preset.reasoningModel || undefined,
    },
  ]);

  const config: ModelConfig = {
    name: 'reasoning',
    endpoint,
    apiKey,
    type: 'reasoning',
    defaultModel: model,
    useHarmonyFormat: preset.useHarmonyFormat,
    reasoningEffortStrategy: preset.reasoningEffortStrategy,
    ...(preset.defaultMaxTokens ? { defaultMaxTokens: preset.defaultMaxTokens } : {}),
  };

  return { config, provider: provider as ProviderKey };
}

// ── Multimodal model setup ─────────────────────────────────────────────────

async function setupMultimodalModel(
  reasoningProvider: ProviderKey,
  collectedKeys: Map<ProviderKey, string>
): Promise<ModelConfig | null> {
  console.log(chalk.bold('\n● Multimodal Model') + chalk.gray(' (optional)'));
  console.log(chalk.gray('Used for understanding images.\n'));

  if (reasoningProvider === 'sarvam') {
    console.log(chalk.yellow('  ⚠  Sarvam does not have a multimodal model.'));
    console.log(chalk.gray('     Please select a different provider below.\n'));
  }

  const { configure } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'configure',
      message: 'Configure a multimodal model?',
      default: true,
    },
  ]);

  if (!configure) return null;

  const { provider } = await inquirer.prompt([
    {
      type: 'list',
      name: 'provider',
      message: 'Select provider:',
      choices: MULTIMODAL_PROVIDER_CHOICES,
      default: reasoningProvider !== 'sarvam' ? reasoningProvider : 'groq',
    },
  ]);

  const preset = PROVIDERS[provider as ProviderKey];
  let endpoint = preset.endpoint;
  let apiKey: string;

  if (provider === 'openai-compatible') {
    const custom = await askEndpointAndKey(collectedKeys);
    endpoint = custom.endpoint;
    apiKey = custom.apiKey;
  } else {
    console.log(chalk.gray(`  Endpoint: ${endpoint}\n`));
    apiKey = await askApiKey(provider as ProviderKey, collectedKeys);
  }

  const { model } = await inquirer.prompt([
    {
      type: 'input',
      name: 'model',
      message: 'Multimodal model name:',
      default: preset.multimodalModel || undefined,
    },
  ]);

  return {
    name: 'multimodal',
    endpoint,
    apiKey,
    type: 'multimodal',
    defaultModel: model,
  };
}

// ── Tool-calling model setup ───────────────────────────────────────────────

async function setupToolCallingModel(
  reasoningProvider: ProviderKey,
  collectedKeys: Map<ProviderKey, string>
): Promise<ModelConfig | null> {
  console.log(chalk.bold('\n● Tool-Calling Model') + chalk.gray(' (optional)'));
  console.log(chalk.gray('A dedicated model that reliably formats tool calls as standard JSON.'));
  console.log(chalk.gray('When configured it is the PRIMARY model for tool execution;\nthe reasoning model is the fallback.\n'));

  const { configure } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'configure',
      message: 'Configure a dedicated tool-calling model?',
      default: false,
    },
  ]);

  if (!configure) return null;

  const { provider } = await inquirer.prompt([
    {
      type: 'list',
      name: 'provider',
      message: 'Select provider:',
      choices: PROVIDER_CHOICES,
      default: reasoningProvider,
    },
  ]);

  const preset = PROVIDERS[provider as ProviderKey];
  let endpoint = preset.endpoint;
  let apiKey: string;

  if (provider === 'openai-compatible') {
    const custom = await askEndpointAndKey(collectedKeys);
    endpoint = custom.endpoint;
    apiKey = custom.apiKey;
  } else {
    console.log(chalk.gray(`  Endpoint: ${endpoint}\n`));
    apiKey = await askApiKey(provider as ProviderKey, collectedKeys);
  }

  const { model } = await inquirer.prompt([
    {
      type: 'input',
      name: 'model',
      message: 'Tool-calling model name:',
      default: preset.toolCallingModel || undefined,
    },
  ]);

  return {
    name: 'tool-calling',
    endpoint,
    apiKey,
    type: 'tool-calling',
    defaultModel: model,
    useHarmonyFormat: false, // always standard format for tool-calling models
  };
}

// ── Main wizard ────────────────────────────────────────────────────────────

export async function runSetupWizard(): Promise<void> {
  console.log(chalk.bold.cyan('\n∞ Welcome to Jiva Setup Wizard\n'));
  console.log('This wizard will configure your AI providers.\n');
  console.log(chalk.gray('API keys for the same provider are only asked once.\n'));

  // Track API keys keyed by provider so we never ask twice
  const collectedKeys = new Map<ProviderKey, string>();

  // 1. Reasoning model
  const { config: reasoningConfig, provider: reasoningProvider } = await setupReasoningModel(collectedKeys);
  configManager.setReasoningModel(reasoningConfig);
  logger.success('Reasoning model configured');

  // 2. Multimodal model (optional)
  const multimodalConfig = await setupMultimodalModel(reasoningProvider, collectedKeys);
  if (multimodalConfig) {
    configManager.setMultimodalModel(multimodalConfig);
    logger.success('Multimodal model configured');
  }

  // 3. Tool-calling model (optional)
  const toolCallingConfig = await setupToolCallingModel(reasoningProvider, collectedKeys);
  if (toolCallingConfig) {
    configManager.setToolCallingModel(toolCallingConfig);
    logger.success('Tool-calling model configured');
  }

  // 4. MCP Servers
  console.log(chalk.bold('\n● MCP Servers'));
  console.log(chalk.gray('Setting up default MCP servers (filesystem, mcp-shell-server)...\n'));
  configManager.initializeDefaultServers();
  logger.success('Default MCP servers configured');

  // 5. Debug mode
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

// ── Update existing configuration ─────────────────────────────────────────

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

  const collectedKeys = new Map<ProviderKey, string>();

  switch (choice) {
    case 'reasoning': {
      const { config } = await setupReasoningModel(collectedKeys);
      configManager.setReasoningModel(config);
      logger.success('Reasoning model updated');
      break;
    }
    case 'multimodal': {
      const config = await setupMultimodalModel('groq', collectedKeys);
      if (config) { configManager.setMultimodalModel(config); logger.success('Multimodal model updated'); }
      break;
    }
    case 'tool-calling': {
      const config = await setupToolCallingModel('groq', collectedKeys);
      if (config) { configManager.setToolCallingModel(config); logger.success('Tool-calling model updated'); }
      break;
    }
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

// ── Sub-functions (MCP, debug, view, reset) ────────────────────────────────

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
      { type: 'input', name: 'name', message: 'Server name:' },
      { type: 'input', name: 'command', message: 'Command:' },
      { type: 'input', name: 'args', message: 'Arguments (space-separated):' },
    ]);
    configManager.addMCPServer(answers.name, {
      command: answers.command,
      args: answers.args ? answers.args.split(' ') : [],
      enabled: true,
    });
    logger.success(`MCP server '${answers.name}' added`);
  } else if (action === 'remove' && serverNames.length > 0) {
    const { serverName } = await inquirer.prompt([
      { type: 'list', name: 'serverName', message: 'Select server to remove:', choices: serverNames },
    ]);
    configManager.removeMCPServer(serverName);
    logger.success(`MCP server '${serverName}' removed`);
  }
}

async function toggleDebugMode() {
  const { enabled } = await inquirer.prompt([
    { type: 'confirm', name: 'enabled', message: 'Enable debug mode?', default: configManager.isDebug() },
  ]);
  configManager.setDebug(enabled);
  logger.success(`Debug mode ${enabled ? 'enabled' : 'disabled'}`);
}

function viewConfiguration() {
  console.log('\nCurrent Configuration:');
  console.log(JSON.stringify(configManager.getConfig(), null, 2));
}

async function resetConfiguration() {
  const { confirm } = await inquirer.prompt([
    { type: 'confirm', name: 'confirm', message: chalk.red('Are you sure you want to reset all configuration?'), default: false },
  ]);
  if (confirm) {
    configManager.reset();
    logger.success('Configuration reset');
  }
}
