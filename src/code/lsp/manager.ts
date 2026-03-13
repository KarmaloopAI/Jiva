/**
 * LspManager — manages language server lifecycle.
 * Lazily starts servers on first use, shares one server per language.
 */

import path from 'path';
import { getLanguageId, getServerIdForLanguage } from './language.js';
import { spawnLspServer } from './server.js';
import { createLspClient, type LspClientInfo, type Diagnostic, prettyDiagnostic } from './client.js';

export type { Diagnostic };

export class LspManager {
  private clients = new Map<string, LspClientInfo>(); // serverId → client
  private starting = new Map<string, Promise<LspClientInfo | null>>(); // prevent double-start
  private enabled: boolean;
  private root: string;

  constructor(options: { root: string; enabled?: boolean }) {
    this.root = options.root;
    this.enabled = options.enabled ?? true;
  }

  /**
   * Notify the LSP server about a file change (open/change).
   * Starts the server lazily if needed.
   * Waits for diagnostics to arrive (up to 3 seconds).
   */
  async touchFile(filePath: string): Promise<void> {
    if (!this.enabled) return;

    const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(this.root, filePath);
    const languageId = getLanguageId(absPath);
    const serverId = getServerIdForLanguage(languageId);

    if (!serverId) return; // No LSP for this language

    const client = await this.getOrStartClient(serverId);
    if (!client) return;

    await client.notify.open(absPath);
    await client.waitForDiagnostics(absPath);
  }

  /**
   * Get merged diagnostics from all running clients.
   * Returns an object mapping normalized file paths to diagnostic arrays.
   */
  getDiagnostics(): Record<string, Diagnostic[]> {
    const result: Record<string, Diagnostic[]> = {};
    for (const client of this.clients.values()) {
      for (const [filePath, diags] of client.diagnostics) {
        if (!result[filePath]) {
          result[filePath] = [];
        }
        result[filePath].push(...diags);
      }
    }
    return result;
  }

  /**
   * Get formatted error diagnostics for a specific file.
   * Returns empty string if no errors.
   */
  getErrorsForFile(filePath: string): string {
    const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(this.root, filePath);
    const normalized = absPath.replace(/\\/g, '/');

    const all = this.getDiagnostics();
    const diags = all[normalized] ?? [];
    const errors = diags.filter((d) => d.severity === 1 || d.severity === undefined);

    if (errors.length === 0) return '';

    const MAX = 20;
    const limited = errors.slice(0, MAX);
    const suffix = errors.length > MAX ? `\n  ... and ${errors.length - MAX} more` : '';
    return limited.map((d) => prettyDiagnostic(d, absPath)).join('\n') + suffix;
  }

  /**
   * Shut down all running language servers.
   */
  async shutdown(): Promise<void> {
    const shutdowns = Array.from(this.clients.values()).map((c) =>
      c.shutdown().catch(() => {}),
    );
    await Promise.all(shutdowns);
    this.clients.clear();
    this.starting.clear();
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private async getOrStartClient(serverId: string): Promise<LspClientInfo | null> {
    const existing = this.clients.get(serverId);
    if (existing) return existing;

    // Prevent concurrent starts for the same server
    let starting = this.starting.get(serverId);
    if (!starting) {
      starting = this.startClient(serverId);
      this.starting.set(serverId, starting);
    }
    const client = await starting;
    this.starting.delete(serverId);
    return client;
  }

  private async startClient(serverId: string): Promise<LspClientInfo | null> {
    try {
      const handle = spawnLspServer(serverId);
      if (!handle) return null; // Server not installed

      const client = await createLspClient({ serverId, handle, root: this.root });
      this.clients.set(serverId, client);
      return client;
    } catch {
      return null; // Failed to start — silently skip LSP for this language
    }
  }
}
