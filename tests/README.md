# Neomount Tests

This directory contains integration and performance tests for the neomount Docker container using **Node.js 24**, **Vitest**, and **TypeScript**.

## Test Suites

### Integration Tests (`integration.test.ts`)

Tests the core functionality of neomount with a local test setup using Docker-in-Docker.

**Run with:**
```bash
pnpm test
```

### Performance Tests (`performance.test.ts`)

Tests Google Drive performance with your actual rclone.conf configuration.

**Prerequisites:**
- A valid `rclone.conf` file in the project root
- Google Drive remote configured (named `gdrive`)
- Docker running

**Run with:**
```bash
pnpm test:perf
```

**What it tests:**
- Directory listing performance
- File stat operations
- Read performance
- Write performance to local storage
- MergerFS overhead
- API quota usage information

## Test Files

- **`integration.test.ts`** - Comprehensive integration tests using Vitest and dockerode
- **`performance.test.ts`** - Performance tests using Vitest and dockerode

## Prerequisites

- Node.js 24+ installed
- Docker installed and running
- Sufficient permissions to run Docker containers

## Installation

```bash
# Install dependencies
pnpm install
```

## Running Tests

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run with UI
pnpm test:ui

# Clean test artifacts
pnpm clean
```

## Test Coverage

The integration tests cover:

1. **Docker Image Build** - Verifies image builds successfully using dockerode
2. **Container Start** - Validates container starts with proper config
3. **Rclone Mount** - Tests rclone mount functionality
4. **MergerFS Mount** - Tests merged filesystem overlay
5. **Write to Local** - Verifies writes go to local storage only
6. **Read Priority** - Tests local files override remote files
7. **Subdirectory Operations** - Tests nested directory handling
8. **Move Job** - Tests file transfer from local to remote with --fast-list
9. **Logging** - Verifies supervisor logs are created
10. **Cron Configuration** - Tests scheduled job setup
11. **Error Handling** - Tests missing config and invalid remote scenarios

## Features

✅ **Native Docker Integration** - Uses dockerode for direct Docker API access  
✅ **TypeScript** - Full type safety and IDE support  
✅ **Vitest** - Fast, modern test framework with great DX  
✅ **Automatic Cleanup** - Removes containers and test data after tests  
✅ **Detailed Assertions** - Clear test output with Vitest's reporter  

## Test Architecture

The tests use:
- **dockerode** - Official Docker API client for Node.js
- **Vitest** - Fast, Vite-powered test framework
- **TypeScript** - Full type safety with ES modules
- **Native fs module** - For file system operations

## CI/CD Integration

Add to your CI pipeline:

```yaml
# Example GitHub Actions
- name: Setup Node.js
  uses: actions/setup-node@v4
  with:
    node-version: '24'

- name: Setup pnpm
  uses: pnpm/action-setup@v4
  with:
    version: 9

- name: Install Dependencies
  run: pnpm install

- name: Run Integration Tests
  run: pnpm test
```

## Cleanup

Tests automatically clean up:
- Test containers (stopped and removed)
- Test data directories
- Temporary files

Manual cleanup if needed:
```bash
docker rm -f neomount-test neomount-test-noconfig neomount-test-badremote
rm -rf tests/test_data
```
