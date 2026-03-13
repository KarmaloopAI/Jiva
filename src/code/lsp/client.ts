/**
 * LSP Client — JSON-RPC client for language servers.
 * Ported from opencode (https://github.com/sst/opencode), adapted for Node.js.
 */

import path from 'path';
import { pathToFileURL, fileURLToPath } from 'url';
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from 'vscode-jsonrpc/node.js';
import type { Diagnostic } from 'vscode-languageserver-types';
import { getLanguageId } from './language.js';
import type { LspServerHandle } from './server.js';
import { readFileSync } from 'fs';

export type { Diagnostic };

const DIAGNOSTICS_DEBOUNCE_MS = 150;
const WAIT_FOR_DIAGNOSTICS_TIMEOUT = 3000;

export interface LspClientInfo {
  readonly serverId: string;
  readonly root: string;
  notify: {
    open(filePath: string): Promise<void>;
  };
  readonly diagnostics: Map<string, Diagnostic[]>;
  waitForDiagnostics(filePath: string): Promise<void>;
  shutdown(): Promise<void>;
}

/**
 * Format a diagnostic for display.
 */
export function prettyDiagnostic(d: Diagnostic, filePath?: string): string {
  const severityMap: Record<number, string> = {
    1: 'error',
    2: 'warning',
    3: 'information',
    4: 'hint',
  };
  const sev = severityMap[d.severity ?? 1] ?? 'error';
  const loc = `${d.range.start.line + 1}:${d.range.start.character + 1}`;
  const file = filePath ? `${path.basename(filePath)}:` : '';
  return `  ${file}${loc} ${sev}: ${d.message}`;
}

/**
 * Create and initialize an LSP client for the given server handle.
 */
export async function createLspClient(input: {
  serverId: string;
  handle: LspServerHandle;
  root: string;
}): Promise<LspClientInfo> {
  const { serverId, handle, root } = input;

  const connection = createMessageConnection(
    new StreamMessageReader(handle.process.stdout as any),
    new StreamMessageWriter(handle.process.stdin as any),
  );

  const diagnostics = new Map<string, Diagnostic[]>();
  const diagnosticsListeners = new Map<string, Array<() => void>>();

  // Subscribe to diagnostic notifications from the server
  connection.onNotification('textDocument/publishDiagnostics', (params: any) => {
    const filePath = normalizePath(fileURLToPath(params.uri));
    diagnostics.set(filePath, params.diagnostics ?? []);

    // Notify any waiters
    const listeners = diagnosticsListeners.get(filePath);
    if (listeners) {
      for (const fn of listeners) fn();
    }
  });

  // Handle server requests
  connection.onRequest('window/workDoneProgress/create', () => null);
  connection.onRequest('workspace/configuration', async () => [handle.initialization ?? {}]);
  connection.onRequest('client/registerCapability', async () => {});
  connection.onRequest('client/unregisterCapability', async () => {});
  connection.onRequest('workspace/workspaceFolders', async () => [
    { name: 'workspace', uri: pathToFileURL(root).href },
  ]);

  connection.listen();

  // Initialize the language server
  await withTimeout(
    connection.sendRequest('initialize', {
      rootUri: pathToFileURL(root).href,
      processId: handle.process.pid ?? null,
      workspaceFolders: [{ name: 'workspace', uri: pathToFileURL(root).href }],
      initializationOptions: { ...(handle.initialization ?? {}) },
      capabilities: {
        window: { workDoneProgress: true },
        workspace: {
          configuration: true,
          didChangeWatchedFiles: { dynamicRegistration: true },
        },
        textDocument: {
          synchronization: { didOpen: true, didChange: true },
          publishDiagnostics: { versionSupport: true },
        },
      },
    }),
    45_000,
  );

  await connection.sendNotification('initialized', {});

  if (handle.initialization) {
    await connection.sendNotification('workspace/didChangeConfiguration', {
      settings: handle.initialization,
    });
  }

  const openedFiles = new Map<string, number>(); // path → version

  const client: LspClientInfo = {
    serverId,
    root,

    get diagnostics() {
      return diagnostics;
    },

    notify: {
      async open(filePath: string) {
        const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(root, filePath);
        let text: string;
        try {
          text = readFileSync(absPath, 'utf-8');
        } catch {
          return; // File might not exist yet
        }

        const languageId = getLanguageId(absPath);
        const version = openedFiles.get(absPath);

        if (version !== undefined) {
          // File already open — send didChange
          const next = version + 1;
          openedFiles.set(absPath, next);
          await connection.sendNotification('workspace/didChangeWatchedFiles', {
            changes: [{ uri: pathToFileURL(absPath).href, type: 2 }], // Changed
          });
          await connection.sendNotification('textDocument/didChange', {
            textDocument: { uri: pathToFileURL(absPath).href, version: next },
            contentChanges: [{ text }],
          });
        } else {
          // First time — send didOpen
          diagnostics.delete(absPath);
          await connection.sendNotification('workspace/didChangeWatchedFiles', {
            changes: [{ uri: pathToFileURL(absPath).href, type: 1 }], // Created
          });
          await connection.sendNotification('textDocument/didOpen', {
            textDocument: { uri: pathToFileURL(absPath).href, languageId, version: 0, text },
          });
          openedFiles.set(absPath, 0);
        }
      },
    },

    async waitForDiagnostics(filePath: string): Promise<void> {
      const absPath = normalizePath(
        path.isAbsolute(filePath) ? filePath : path.resolve(root, filePath),
      );

      return new Promise<void>((resolve) => {
        let debounceTimer: ReturnType<typeof setTimeout> | undefined;
        let cleanup: (() => void) | undefined;

        const onDiag = () => {
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            cleanup?.();
            resolve();
          }, DIAGNOSTICS_DEBOUNCE_MS);
        };

        const listeners = diagnosticsListeners.get(absPath) ?? [];
        listeners.push(onDiag);
        diagnosticsListeners.set(absPath, listeners);

        cleanup = () => {
          const current = diagnosticsListeners.get(absPath) ?? [];
          const idx = current.indexOf(onDiag);
          if (idx !== -1) current.splice(idx, 1);
          if (debounceTimer) clearTimeout(debounceTimer);
        };

        // Timeout — resolve silently
        setTimeout(() => {
          cleanup?.();
          resolve();
        }, WAIT_FOR_DIAGNOSTICS_TIMEOUT);
      });
    },

    async shutdown() {
      try {
        connection.end();
        connection.dispose();
      } catch {
        // ignore
      }
      try {
        handle.process.kill();
      } catch {
        // ignore
      }
    },
  };

  return client;
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}
