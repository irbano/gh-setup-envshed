# Setup Envshed

A GitHub Action that injects [Envshed](https://envshed.com) secrets into your GitHub Actions workflow. Secrets are pulled from Envshed and exported as masked environment variables (or written to a `.env` file).

## Usage

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: irbano/gh-setup-envshed@v1
    with:
      token: ${{ secrets.ENVSHED_TOKEN }}
      org: my-company
      project: backend
      environment: production
  - run: npm run deploy
```

All secrets from the specified environment are exported as environment variables and masked in workflow logs.

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `token` | Yes | — | Envshed API token. Store as a [GitHub secret](https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions). |
| `org` | Yes | — | Organization slug |
| `project` | Yes | — | Project slug |
| `environment` | No | `production` | Environment slug |
| `api-url` | No | `https://app.envshed.com` | Envshed API URL |
| `export-to` | No | `env` | Where to export secrets: `env` (environment variables) or `file` (`.env` file) |
| `file-path` | No | `.env` | Path to write `.env` file (only used with `export-to: file`) |

## Examples

### Export as environment variables (default)

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: irbano/gh-setup-envshed@v1
        with:
          token: ${{ secrets.ENVSHED_TOKEN }}
          org: my-company
          project: backend
          environment: production
      - run: npm run deploy
```

### Write to a `.env` file

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: irbano/gh-setup-envshed@v1
        with:
          token: ${{ secrets.ENVSHED_TOKEN }}
          org: my-company
          project: backend
          environment: staging
          export-to: file
          file-path: .env.local
      - run: npm test
```

### Multi-environment deploy

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        env: [staging, production]
    steps:
      - uses: actions/checkout@v4
      - uses: irbano/gh-setup-envshed@v1
        with:
          token: ${{ secrets.ENVSHED_TOKEN }}
          org: my-company
          project: backend
          environment: ${{ matrix.env }}
      - run: npm run deploy
```

### Docker build with secrets

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: irbano/gh-setup-envshed@v1
        with:
          token: ${{ secrets.ENVSHED_TOKEN }}
          org: my-company
          project: backend
          environment: production
          export-to: file
          file-path: .env
      - run: docker build -t my-app .
```

## How it works

1. The action calls the Envshed API to fetch decrypted secrets for the specified organization, project, and environment.
2. Each secret value is registered with `core.setSecret()` so it is automatically masked in workflow logs.
3. Depending on `export-to`:
   - **`env`** (default): Secrets are exported as environment variables available to subsequent steps.
   - **`file`**: Secrets are written to a `.env` file at the specified path.

## Security

- **Never hardcode your Envshed token** in workflow files. Always use [GitHub encrypted secrets](https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions).
- All secret values are masked in GitHub Actions logs via `core.setSecret()`.
- The action communicates with the Envshed API over HTTPS.

## License

MIT
