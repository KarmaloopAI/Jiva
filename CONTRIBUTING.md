# Contributing to Jiva

Thank you for your interest in contributing to Jiva! This document provides guidelines for contributing to the project.

## Code of Conduct

Be respectful and constructive in your interactions with other contributors.

## Getting Started

1. **Fork the repository** on GitHub
2. **Clone your fork:**
   ```bash
   git clone https://github.com/YOUR_USERNAME/Jiva.git
   cd Jiva
   ```
3. **Install dependencies:**
   ```bash
   npm install
   ```
4. **Build the project:**
   ```bash
   npm run build
   ```

## Development Workflow

See [docs/guides/DEV_WORKFLOW.md](docs/guides/DEV_WORKFLOW.md) for detailed development instructions.

### Quick Commands

```bash
npm run build              # Compile TypeScript
npm run dev               # Watch mode for development
npm run type-check        # Check TypeScript types
npm test                  # Run tests (when available)
```

## Making Changes

1. **Create a feature branch:**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes** following the coding standards

3. **Test your changes:**
   ```bash
   npm run build
   npm link  # Test CLI globally
   jiva chat  # Verify functionality
   ```

4. **Commit with clear messages:**
   ```bash
   git commit -m "feat: add new feature X"
   ```

## Coding Standards

- **TypeScript**: All code must be in TypeScript
- **Formatting**: Follow existing code style
- **Error Handling**: All functions should handle errors gracefully
- **Logging**: Use the logger utility for consistent logging
- **Documentation**: Update docs for new features

## Pull Request Process

1. **Update documentation** for any changed functionality
2. **Update README.md** if adding new features
3. **Add release notes** in `docs/release_notes/` if applicable
4. **Create pull request** with clear description of changes
5. **Link related issues** in the PR description

## Areas for Contribution

- Bug fixes
- New MCP server integrations
- Documentation improvements
- Performance optimizations
- Test coverage
- Storage provider implementations (S3, Redis, etc.)
- UI/UX improvements for CLI interface

## Questions?

Open an issue on GitHub for any questions about contributing.

## License

By contributing to Jiva, you agree that your contributions will be licensed under the MIT License.
