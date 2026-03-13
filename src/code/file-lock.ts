/**
 * FileLock — async per-path mutex.
 * Prevents concurrent edits to the same file within a session.
 * Mirrors opencode's FileTime.withLock pattern, simplified for Node.js.
 */

export class FileLock {
  private locks = new Map<string, Promise<void>>();

  /**
   * Acquire a lock for filePath, execute fn, then release.
   * Concurrent calls for the same path are serialized.
   */
  async withLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
    const key = normalizePath(filePath);
    const prev = this.locks.get(key) ?? Promise.resolve();

    let resolve!: () => void;
    const next = new Promise<void>((r) => { resolve = r; });
    this.locks.set(key, next);

    await prev;
    try {
      return await fn();
    } finally {
      resolve();
      // If our lock is still the current one, clean up
      if (this.locks.get(key) === next) {
        this.locks.delete(key);
      }
    }
  }
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

// Singleton for use across all code tools in a session
export const fileLock = new FileLock();
