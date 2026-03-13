import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { execSync } from 'child_process';

export interface LspServerHandle {
  process: ChildProcessWithoutNullStreams;
  initialization?: Record<string, unknown>;
}

/**
 * Find the path of an executable in PATH.
 * Returns undefined if not found.
 */
function which(cmd: string): string | undefined {
  try {
    const result = execSync(`which ${cmd} 2>/dev/null`, { encoding: 'utf-8' }).trim();
    return result || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Per-server configurations: how to detect and launch each language server.
 */
const SERVER_CONFIGS: Record<string, {
  detect: () => string | undefined;
  args: (binary: string) => string[];
  initialization?: Record<string, unknown>;
}> = {
  typescript: {
    detect: () => which('typescript-language-server'),
    args: () => ['--stdio'],
  },
  python: {
    detect: () => which('pylsp') ?? which('pyright-langserver') ?? which('pyls'),
    args: (binary) => binary.endsWith('pyright-langserver') ? ['--stdio'] : [],
  },
  go: {
    detect: () => which('gopls'),
    args: () => ['serve'],
  },
  rust: {
    detect: () => which('rust-analyzer'),
    args: () => [],
  },
  ruby: {
    detect: () => which('solargraph'),
    args: () => ['stdio'],
  },
};

/**
 * Attempt to spawn a language server for the given server ID.
 * Returns the handle if successful, undefined if the server is not installed.
 */
export function spawnLspServer(serverId: string): LspServerHandle | undefined {
  const config = SERVER_CONFIGS[serverId];
  if (!config) return undefined;

  const binary = config.detect();
  if (!binary) return undefined;

  const args = config.args(binary);

  try {
    const proc = spawn(binary, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    // Swallow stderr to avoid polluting Jiva's output
    proc.stderr.resume();

    return {
      process: proc as ChildProcessWithoutNullStreams,
      initialization: config.initialization,
    };
  } catch {
    return undefined;
  }
}

/**
 * Check which language servers are available on this system.
 */
export function getAvailableServers(): string[] {
  return Object.keys(SERVER_CONFIGS).filter((id) => {
    const config = SERVER_CONFIGS[id];
    return config.detect() !== undefined;
  });
}
