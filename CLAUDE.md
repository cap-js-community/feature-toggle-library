# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is the SAP BTP Feature Toggle Library, a Node.js library for the SAP Cloud Application Programming Model (CAP) that enables live-updatable feature toggles via Redis. It acts as a CDS plugin and provides a REST service through the FeatureService.

## Core Architecture

The library has a singleton-based architecture with three main layers:

1. **FeatureToggles** (`src/feature-toggles.js`): Core singleton managing toggle state, configuration, scopes, validations, and change handlers. Handles fallback values when Redis is unavailable.

2. **RedisAdapter** (`src/redis-adapter.js`): Thin wrapper around @redis/client providing:
   - Three integration modes: CF_REDIS_CLUSTER, CF_REDIS, LOCAL_REDIS, NO_REDIS
   - Two Redis clients: main (read/write) and subscriber (pub/sub)
   - Message handlers for toggle updates across instances

3. **CDS Plugin** (`src/plugin.js`): Integrates with CAP framework by:
   - Auto-discovering feature toggles from `/fts/` directories
   - Registering FeatureService REST endpoints
   - Providing CDS feature provider middleware
   - Managing access roles and service configuration

### Key Concepts

- **Scopes**: Toggles can have different values per scope (user, tenant, etc.) using a hierarchical preference system
- **Config Sources**: AUTO (auto-discovered from /fts/), FILE (from .yaml config), RUNTIME (programmatically set)
- **Change Handlers**: Callbacks registered for specific toggles that fire when values change
- **Validations**: Custom validators can be registered per toggle

## Commands

### Testing

```bash
# Run all tests with coverage (requires test-cap-server dependencies)
npm test

# Run tests with HTML coverage report
npm run test:coverage

# Install test-cap-server dependencies (runs automatically with npm test)
npm run test:prepare

# Run single test file
CDS_STRICT_NODE_VERSION=false npx jest test/feature-toggles.test.js

# Run tests matching pattern
CDS_STRICT_NODE_VERSION=false npx jest -t "getFeatureValue"

# Update snapshots
npm run test:resnap
```

Note: Tests use Jest with custom setup in `jest.setupAfterEnv.js`. Mocks for Redis and cf-env are in `test/__mocks__/`.

### Linting

```bash
# Run all linters (prettier, eslint, jsdoc)
npm run lint

# Auto-fix linting issues
npm run lint:fix

# Run individual linters
npm run eslint
npm run prettier
npm run jsdoc
```

ESLint rules enforce:

- No console.log (use logger from `src/shared/logger.js`)
- No eval/implied-eval
- Strict mode
- Curly braces required

### Documentation

```bash
# Serve docs locally (Jekyll site at docs/)
npm run docs

# Install docs dependencies
npm run docs:install
```

### Build & Development

```bash
# Install dependencies
npm install

# Apply patches (runs automatically after install)
npm run patch

# Upgrade dependencies and lock file
npm run upgrade-lock
```

## File Structure

- `src/index.js`: Main export returning FeatureToggles singleton
- `cds-plugin.js`: CDS plugin entry point
- `index.cds`: CDS model import
- `src/service/feature-service.cds`: FeatureService definition
- `src/shared/`: Utilities (cache, logger, cf-env, handler-collection, etc.)
- `test/`: Unit tests with **mocks** for Redis and cf-env
- `test-cap-server/`: CAP integration tests using @cap-js/cds-test
- `example-cap-server/`: Example CAP application demonstrating usage

## Configuration Files

- `package.json`: CDS plugin registered via "cds" section
- `jest.config.js`: Jest with v8 coverage, 70/80/80 thresholds
- `eslint.config.js`: Flat config using @eslint/js, prettier, jest plugin
- `.features.yaml`: Default config file location (configurable via cds.env.featureToggles.configFile)

## Development Notes

- This is a CommonJS module (Node.js >=20.0.0)
- Always use the Logger from `src/shared/logger.js` instead of console.log
- Redis clients auto-close on CDS shutdown via registered hooks
- For CAP feature toggles, directories in `/fts/` are auto-discovered and registered as boolean toggles with `/fts/` prefix
- The library gracefully degrades to fallback values when Redis is unavailable (NO_REDIS mode)
- Tests should mock Redis using `test/__mocks__/redis-adapter.js`
- JSDoc pedantic mode is enforced - all functions must have complete documentation
