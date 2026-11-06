# Contributing to Jiva

Contributions are welcome. Please open PRs against the `develop` branch.

## Development Setup

```bash
git clone https://github.com/KarmaloopAI/Jiva.git
cd Jiva
npm install && npm run build && npm link
```

## Build & Test

```bash
npm run build        # compile TypeScript
npm run dev          # watch mode
npm run type-check   # type-check without emit
npm test             # run tests
```

## Guidelines

- All new features must include error handling.
- Update documentation when changing behavior.
- Ensure `npm run build` passes before submitting.
- Add tests for new code paths where practical.

## Documentation Updates

If you change user-facing behavior, update the relevant doc in `docs/user-guides/` or `docs/reference/`. If you add a new feature, consider adding a release note entry.
