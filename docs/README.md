# Jiva Documentation

Welcome to the Jiva documentation! This guide will help you find the information you need.

## Getting Started

New to Jiva? Start here:

- **[Quick Start Guide](guides/QUICKSTART.md)** - Get up and running in 30 seconds
- **[Quick Start for New Features](guides/QUICK_START.md)** - Try the latest v0.3.1 features
- **[Configuration Guide](guides/CONFIGURATION.md)** - Set up models, MCP servers, and storage

## Deployment

Learn how to deploy Jiva:

- **[Cloud Run Deployment](deployment/CLOUD_RUN_DEPLOYMENT.md)** - Deploy to Google Cloud Run (production)
- **[Cloud Run Implementation](deployment/CLOUD_RUN_IMPLEMENTATION.md)** - Technical details of the Cloud Run architecture
- **[Deployment Summary](deployment/CLOUD_RUN_DEPLOYMENT_SUMMARY.md)** - Complete deployment example and test results
- **[Build Instructions](guides/BUILD.md)** - Build from source for development

## Guides

Step-by-step guides for common tasks:

- **[Configuration](guides/CONFIGURATION.md)** - Model providers, MCP servers, authentication, storage
- **[Development Workflow](guides/DEV_WORKFLOW.md)** - Contributing and development setup
- **[Troubleshooting](guides/TROUBLESHOOTING.md)** - Common issues and solutions

## Architecture

Deep dives into Jiva's design:

- **[Three-Agent Architecture](architecture/NEW_FEATURES.md)** - Manager, Worker, and Client agents
- **[Implementation Summary](architecture/IMPLEMENTATION_SUMMARY.md)** - Core design decisions
- **[Improvements Summary](architecture/IMPROVEMENTS_SUMMARY.md)** - Evolution of the architecture
- **[Filesystem Access](architecture/FILESYSTEM_ACCESS.md)** - MCP filesystem server details
- **[Max Token Fix](architecture/MAXTOKEN_FIX.md)** - Token management and condensing strategies

## Release Notes

- **[v0.3.1](release_notes/v0.3.1.md)** - Current release (Cloud deployment + three-agent architecture)
- **[v0.2.1](release_notes/v0.2.1.md)** - Previous release

## Quick Links by Use Case

### I want to...

#### Use Jiva (Basic)
→ [Quick Start Guide](guides/QUICKSTART.md)  
→ [Configuration Guide](guides/CONFIGURATION.md)

#### Deploy to Production
→ [Cloud Run Deployment](deployment/CLOUD_RUN_DEPLOYMENT.md)  
→ [Configuration Guide](guides/CONFIGURATION.md) (for auth & storage)

#### Develop / Contribute
→ [Build Instructions](guides/BUILD.md)  
→ [Development Workflow](guides/DEV_WORKFLOW.md)  
→ [Architecture Docs](architecture/)

#### Troubleshoot Issues
→ [Troubleshooting Guide](guides/TROUBLESHOOTING.md)  
→ [GitHub Issues](https://github.com/KarmaloopAI/Jiva/issues)

#### Understand the Architecture
→ [Three-Agent Architecture](architecture/NEW_FEATURES.md)  
→ [Implementation Summary](architecture/IMPLEMENTATION_SUMMARY.md)  
→ [Cloud Run Implementation](deployment/CLOUD_RUN_IMPLEMENTATION.md)

## Documentation Structure

```
docs/
├── README.md (you are here)
├── guides/
│   ├── QUICKSTART.md           # Getting started (CLI)
│   ├── QUICK_START.md          # New features quick start
│   ├── CONFIGURATION.md        # Configuration reference
│   ├── BUILD.md                # Building from source
│   ├── DEV_WORKFLOW.md         # Development guide
│   └── TROUBLESHOOTING.md      # Common issues
├── deployment/
│   ├── CLOUD_RUN_DEPLOYMENT.md          # Complete deployment guide
│   ├── CLOUD_RUN_IMPLEMENTATION.md      # Technical implementation
│   └── CLOUD_RUN_DEPLOYMENT_SUMMARY.md  # Example deployment
├── architecture/
│   ├── NEW_FEATURES.md            # Three-agent architecture
│   ├── IMPLEMENTATION_SUMMARY.md  # Design overview
│   ├── IMPROVEMENTS_SUMMARY.md    # Evolution history
│   ├── FILESYSTEM_ACCESS.md       # MCP filesystem details
│   └── MAXTOKEN_FIX.md           # Token management
└── release_notes/
    ├── v0.3.1.md                  # Current release
    └── v0.2.1.md                  # Previous release
```

## Feature Matrix

| Feature | CLI Mode | Cloud Run | Status |
|---------|----------|-----------|--------|
| Interactive Chat | ✅ | ✅ | Stable |
| Conversation Saving | ✅ | ✅ | Stable |
| MCP Server Support | ✅ | ✅ | Stable |
| Three-Agent Architecture | ✅ | ✅ | Stable |
| Local File Storage | ✅ | ⚠️ | Stable |
| GCS Storage | ➖ | ✅ | Beta |
| WebSocket API | ➖ | ✅ | Stable |
| REST API | ➖ | ✅ | Stable |
| Multi-Tenancy | ➖ | ✅ | Stable |
| Authentication | ➖ | ✅ | Stable |
| Auto-Scaling | ➖ | ✅ | Stable |

Legend: ✅ Supported | ⚠️ Partial | ➖ Not applicable | 🚧 In development

## Version Information

**Current Version:** 0.3.1  
**Release Date:** February 15, 2026  
**Node Version Required:** 20.0.0+

## Support

- **GitHub Issues:** [https://github.com/KarmaloopAI/Jiva/issues](https://github.com/KarmaloopAI/Jiva/issues)
- **GitHub Repository:** [https://github.com/KarmaloopAI/Jiva](https://github.com/KarmaloopAI/Jiva)
- **npm Package:** [https://www.npmjs.com/package/jiva-core](https://www.npmjs.com/package/jiva-core)

## Contributing

We welcome contributions! See [Development Workflow](guides/DEV_WORKFLOW.md) for guidelines.

## License

MIT License - see [LICENSE](../LICENSE) file for details.
