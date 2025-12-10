#!/bin/bash

# Jiva Setup Script

set -e

echo "∞ Setting up Jiva..."
echo ""

# 1. Install dependencies
echo "📦 Installing dependencies..."
npm install

# 2. Build
echo "🔨 Building project..."
npm run build

# 3. Link globally
echo "🔗 Linking globally..."
npm link

# 4. Check PATH
echo ""
echo "✅ Build complete!"
echo ""

NPM_PREFIX=$(npm config get prefix)
NPM_BIN="$NPM_PREFIX/bin"

if [[ ":$PATH:" != *":$NPM_BIN:"* ]]; then
    echo "⚠️  Warning: $NPM_BIN is not in your PATH"
    echo ""
    echo "To use 'jiva' command, add this to your shell config:"
    echo ""

    # Detect shell
    if [ -n "$ZSH_VERSION" ]; then
        SHELL_CONFIG="$HOME/.zshrc"
        echo "  echo 'export PATH=\"$NPM_BIN:\$PATH\"' >> ~/.zshrc"
        echo "  source ~/.zshrc"
    elif [ -n "$BASH_VERSION" ]; then
        SHELL_CONFIG="$HOME/.bashrc"
        echo "  echo 'export PATH=\"$NPM_BIN:\$PATH\"' >> ~/.bashrc"
        echo "  source ~/.bashrc"
    else
        echo "  export PATH=\"$NPM_BIN:\$PATH\""
        echo "  # Add the above to your shell config file"
    fi

    echo ""
    echo "Or run jiva using the full path:"
    echo "  $NPM_BIN/jiva --help"
    echo ""
    echo "Or use npx:"
    echo "  npx jiva --help"
else
    echo "✅ PATH is configured correctly"
    echo ""
    echo "You can now run:"
    echo "  jiva --help"
    echo "  jiva setup"
fi

echo ""
echo "📚 For more information, see BUILD.md"
