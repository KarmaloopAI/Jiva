// Language extension to LSP language ID mapping
// Ported from opencode (https://github.com/sst/opencode)
export const LANGUAGE_EXTENSIONS: Record<string, string> = {
  '.abap': 'abap',
  '.bat': 'bat',
  '.bib': 'bibtex',
  '.bibtex': 'bibtex',
  '.clj': 'clojure',
  '.cljs': 'clojure',
  '.cljc': 'clojure',
  '.edn': 'clojure',
  '.coffee': 'coffeescript',
  '.c': 'c',
  '.cpp': 'cpp',
  '.cxx': 'cpp',
  '.cc': 'cpp',
  '.c++': 'cpp',
  '.cs': 'csharp',
  '.css': 'css',
  '.d': 'd',
  '.pas': 'pascal',
  '.pascal': 'pascal',
  '.diff': 'diff',
  '.patch': 'diff',
  '.dart': 'dart',
  '.dockerfile': 'dockerfile',
  '.ex': 'elixir',
  '.exs': 'elixir',
  '.erl': 'erlang',
  '.ets': 'typescript',
  '.hrl': 'erlang',
  '.fs': 'fsharp',
  '.fsi': 'fsharp',
  '.fsx': 'fsharp',
  '.fsscript': 'fsharp',
  '.go': 'go',
  '.groovy': 'groovy',
  '.gleam': 'gleam',
  '.hbs': 'handlebars',
  '.handlebars': 'handlebars',
  '.hs': 'haskell',
  '.lhs': 'haskell',
  '.html': 'html',
  '.htm': 'html',
  '.ini': 'ini',
  '.java': 'java',
  '.jl': 'julia',
  '.js': 'javascript',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.jsx': 'javascriptreact',
  '.json': 'json',
  '.tex': 'latex',
  '.latex': 'latex',
  '.less': 'less',
  '.lua': 'lua',
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.m': 'objective-c',
  '.mm': 'objective-cpp',
  '.pl': 'perl',
  '.pm': 'perl',
  '.pm6': 'perl6',
  '.php': 'php',
  '.ps1': 'powershell',
  '.psm1': 'powershell',
  '.pug': 'jade',
  '.jade': 'jade',
  '.py': 'python',
  '.r': 'r',
  '.cshtml': 'razor',
  '.razor': 'razor',
  '.rb': 'ruby',
  '.rake': 'ruby',
  '.gemspec': 'ruby',
  '.ru': 'ruby',
  '.erb': 'erb',
  '.rs': 'rust',
  '.scss': 'scss',
  '.sass': 'sass',
  '.scala': 'scala',
  '.sh': 'shellscript',
  '.bash': 'shellscript',
  '.zsh': 'shellscript',
  '.ksh': 'shellscript',
  '.sql': 'sql',
  '.svelte': 'svelte',
  '.swift': 'swift',
  '.ts': 'typescript',
  '.tsx': 'typescriptreact',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.mtsx': 'typescriptreact',
  '.ctsx': 'typescriptreact',
  '.xml': 'xml',
  '.xsl': 'xsl',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.vue': 'vue',
  '.zig': 'zig',
  '.zon': 'zig',
  '.astro': 'astro',
  '.ml': 'ocaml',
  '.mli': 'ocaml',
  '.tf': 'terraform',
  '.tfvars': 'terraform-vars',
  '.hcl': 'hcl',
  '.nix': 'nix',
  '.typ': 'typst',
  '.typc': 'typst',
} as const;

/**
 * Get LSP language ID from a file path's extension.
 * Returns 'plaintext' if the extension is not recognized.
 */
export function getLanguageId(filePath: string): string {
  const ext = filePath.substring(filePath.lastIndexOf('.')).toLowerCase();
  return LANGUAGE_EXTENSIONS[ext] ?? 'plaintext';
}

/**
 * Get the LSP server ID (language family) for a given language ID.
 * Multiple language IDs map to the same server (e.g. typescript + typescriptreact → 'typescript').
 */
export function getServerIdForLanguage(languageId: string): string | undefined {
  switch (languageId) {
    case 'typescript':
    case 'typescriptreact':
    case 'javascript':
    case 'javascriptreact':
      return 'typescript';
    case 'python':
      return 'python';
    case 'go':
      return 'go';
    case 'rust':
      return 'rust';
    case 'ruby':
      return 'ruby';
    default:
      return undefined; // No LSP available for this language
  }
}
