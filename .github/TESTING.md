# Testing Guide

This document describes how tests are run in GitHub Actions and how to set them up locally.

## Automated Testing

### Integration Tests (Automatic)

Integration tests run automatically on every push to `main` and `develop` branches, and on all pull requests.

**Workflow file:** `.github/workflows/integration-tests.yml`

**What it does:**
- Sets up Node.js 24 and pnpm
- Installs dependencies
- Builds the Docker image
- Runs integration tests using `pnpm test`
- Uploads test artifacts on failure

**Duration:** ~2 minutes

**Status badge:**
```markdown
![Integration Tests](https://github.com/YOUR_ORG/neomount/actions/workflows/integration-tests.yml/badge.svg)
```

### Performance Tests (Manual)

Performance tests require a valid `rclone.conf` file and are triggered manually via GitHub Actions.

**Workflow file:** `.github/workflows/performance-tests.yml`

**To run performance tests:**
1. Go to **Actions** tab in GitHub
2. Select **Performance Tests** workflow
3. Click **Run workflow**
4. (Optional) Specify the Google Drive remote name

**Requirements:**
- Valid `rclone.conf` file in repository root
- Google Drive remote configured (default: `gdrive`)

**Duration:** ~5-10 minutes

**Note:** Performance tests will fail if `rclone.conf` is not present. For security, do not commit `rclone.conf` to the repository. Instead:
- Use GitHub Secrets to store the configuration
- Create `rclone.conf` during workflow execution
- Or manually trigger tests only when needed

## Local Testing

### Prerequisites

- Node.js 24+
- pnpm 10.18.3+
- Docker installed and running
- Linux or macOS (Windows requires WSL2)

### Run All Tests

```bash
pnpm install
pnpm test
```

### Run Integration Tests Only

```bash
pnpm test
```

### Run Performance Tests

Requires `rclone.conf` in project root:

```bash
pnpm test:perf
```

### Watch Mode

```bash
pnpm test:watch
```

### UI Mode

```bash
pnpm test:ui
```

### Clean Test Artifacts

```bash
pnpm clean
```

## Test Architecture

### Integration Tests (`tests/integration.test.ts`)

Tests core neomount functionality:
- Docker image building
- Container startup and health checks
- Rclone mount operations
- MergerFS overlay functionality
- File read/write operations
- Move job functionality
- Service management
- Error handling

**Duration:** ~50-60 seconds

**Key features:**
- Uses local filesystem as mock remote
- No external dependencies required
- Fully deterministic
- Tests run sequentially to ensure proper ordering

### Performance Tests (`tests/performance.test.ts`)

Tests performance with real Google Drive:
- Directory listing performance
- File stat operations
- Read performance (10MB, 50MB, 100MB)
- Write performance
- MergerFS overhead measurement
- File move operations
- Multiple small file moves

**Duration:** ~5-10 minutes (depending on network)

**Requirements:**
- Valid `rclone.conf` with Google Drive remote
- Network connectivity
- Sufficient Google Drive quota

## Docker Client Abstraction

Both test suites use a common `DockerClient` abstraction layer (`tests/docker-client.ts`) that provides:
- Unified Docker API interface
- Command execution in containers
- Mount point waiting
- Health check monitoring
- Performance measurement utilities

This abstraction:
- Reduces code duplication
- Makes tests easier to maintain
- Simplifies adding new tests
- Provides consistent error handling

## Troubleshooting

### Tests fail with "Container not started"

**Cause:** Docker daemon not running or not accessible

**Solution:**
```bash
# Start Docker daemon
sudo systemctl start docker

# Or on macOS
open /Applications/Docker.app
```

### Tests timeout

**Cause:** Container startup taking too long or network issues

**Solution:**
- Increase timeout in workflow (edit `.github/workflows/integration-tests.yml`)
- Check Docker resource allocation
- Verify network connectivity

### Performance tests skip

**Cause:** `rclone.conf` not found

**Solution:**
- Create `rclone.conf` in project root
- Configure Google Drive remote named `gdrive`
- See [rclone documentation](https://rclone.org/drive/) for setup

### Mount failures

**Cause:** FUSE not available or permissions issues

**Solution:**
- Ensure running on Linux or macOS with FUSE support
- Check `/dev/fuse` permissions
- May require `--privileged` flag for Docker

## CI/CD Integration

### GitHub Actions

The workflows are automatically triggered:
- **Integration tests:** On every push/PR to main/develop
- **Performance tests:** Manual trigger via Actions tab

### Adding to Other CI Systems

The tests can be integrated into other CI systems:

```bash
# Install dependencies
pnpm install

# Build Docker image
docker build -t neomount:test .

# Run tests
pnpm test

# Or run performance tests (requires rclone.conf)
pnpm test:perf
```

## Best Practices

1. **Always run tests locally before pushing**
   ```bash
   pnpm test
   ```

2. **Use watch mode during development**
   ```bash
   pnpm test:watch
   ```

3. **Clean up test artifacts**
   ```bash
   pnpm clean
   ```

4. **Never commit rclone.conf**
   - Add to `.gitignore` (already done)
   - Use GitHub Secrets for CI/CD

5. **Monitor test performance**
   - Integration tests should complete in ~60 seconds
   - If slower, check Docker resource allocation
   - Performance tests are expected to be slower

## Debugging Failed Tests

### View detailed logs

```bash
# Run with verbose output
pnpm test -- --reporter=verbose
```

### Keep test containers for inspection

```bash
# Modify docker-client.ts to skip cleanup
# Or manually inspect containers
docker ps -a
docker logs <container-id>
```

### Check Docker image

```bash
# Verify image exists
docker images | grep neomount

# Rebuild if needed
docker build -t neomount:test .
```

## Performance Benchmarks

Expected performance on modern hardware:

| Operation | Expected Time |
|-----------|---------------|
| Image build | 30-60s |
| Container startup | 5-10s |
| Integration tests | 50-60s |
| Performance tests | 5-10 min |
| Total CI run | ~2 min |

## Contributing

When adding new tests:
1. Use the `DockerClient` abstraction
2. Follow existing test patterns
3. Add descriptive test names
4. Update this documentation
5. Ensure tests pass locally before pushing
