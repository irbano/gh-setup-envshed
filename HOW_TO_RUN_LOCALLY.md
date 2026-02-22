# How to Run Locally

This guide explains how to test the `setup-envshed` GitHub Action on your machine using [nektos/act](https://github.com/nektos/act).

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) running
- [act](https://github.com/nektos/act) installed:
  ```bash
  brew install act
  ```
- Node.js 20+

## 1. Unit Tests

```bash
npm install
npm test
```

This runs the vitest suite (27 tests) covering functionality and security checks.

## 2. Integration Tests with `act`

These workflows run the action inside Docker containers, simulating a real GitHub Actions environment.

### Start the mock API server

The mock server simulates the Envshed API on `localhost:9876`. It accepts the token `envshed_test_token` and serves three environments:

| Environment  | Behavior                                     |
|--------------|----------------------------------------------|
| `production` | Returns 3 secrets (`DATABASE_URL`, `API_KEY`, `NODE_ENV`) |
| `staging`    | Returns 2 secrets + 1 decrypt error warning  |
| `empty`      | Returns 0 secrets (triggers warning)         |

```bash
node examples/mock-server.mjs &
```

### Run all workflows

```bash
act push \
  -s ENVSHED_TOKEN=envshed_test_token \
  -s API_URL=http://host.docker.internal:9876 \
  --container-architecture linux/amd64
```

### Run a single workflow

```bash
# Env var export
act push \
  -W .github/workflows/test-env-export.yml \
  -s ENVSHED_TOKEN=envshed_test_token \
  -s API_URL=http://host.docker.internal:9876 \
  --container-architecture linux/amd64

# File export
act push \
  -W .github/workflows/test-file-export.yml \
  -s ENVSHED_TOKEN=envshed_test_token \
  -s API_URL=http://host.docker.internal:9876 \
  --container-architecture linux/amd64

# Error handling (invalid token, decrypt errors, empty env)
act push \
  -W .github/workflows/test-error-handling.yml \
  -s ENVSHED_TOKEN=envshed_test_token \
  -s API_URL=http://host.docker.internal:9876 \
  --container-architecture linux/amd64
```

### Stop the mock server

```bash
kill $(lsof -ti:9876)
```

## 3. Workflows Overview

| Workflow | Jobs | What it tests |
|----------|------|---------------|
| `test-env-export.yml` | 1 | Secrets exported as env vars, verified with shell checks |
| `test-file-export.yml` | 1 | Secrets written to `.env.local`, file existence and format verified |
| `test-error-handling.yml` | 3 | Invalid token (401), decrypt warnings (staging), empty environment |

## 4. Rebuilding After Changes

If you modify `src/`, rebuild the bundled action before running `act`:

```bash
npm run build
```

This produces `dist/index.js` via `@vercel/ncc`.

## Notes

- `act` uses `host.docker.internal` to reach the mock server running on the host machine.
- The `--container-architecture linux/amd64` flag is needed on Apple Silicon Macs.
- On first run, `act` may prompt you to choose a Docker image size. Select **Medium** (~500MB).
- The "unable to get git ref" warnings from `act` are harmless — they appear because the repo may not have tags/releases yet.
