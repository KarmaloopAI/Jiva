/**
 * Platform-specific utility functions
 */

/**
 * Returns the default filesystem allowed path for the MCP filesystem server
 * based on the current platform.
 *
 * - Windows: C:\Users
 * - macOS:   /Users
 * - Linux:   /home
 */
export function getDefaultFilesystemAllowedPath(): string {
  switch (process.platform) {
    case 'win32':
      return 'C:\\Users';
    case 'darwin':
      return '/Users';
    default:
      // Linux and other Unix-like systems use /home
      return '/home';
  }
}
