/**
 * Mock Envshed API server for testing the GitHub Action locally with `act`.
 *
 * Usage:
 *   node examples/mock-server.mjs
 *
 * Responds to:
 *   GET /api/v1/secrets/:org/:project/:env
 *
 * Validates Bearer token (expects "envshed_test_token").
 * Returns different responses based on the environment slug:
 *   - "production"  → 3 secrets
 *   - "staging"     → 2 secrets + 1 decrypt error
 *   - "empty"       → 0 secrets
 *   - anything else → 404
 */

import { createServer } from "node:http";

const PORT = 9876;
const VALID_TOKEN = "envshed_test_token";

const responses = {
  production: {
    secrets: {
      DATABASE_URL: "postgres://user:pass@db.example.com:5432/myapp",
      API_KEY: "sk_live_abc123xyz",
      NODE_ENV: "production",
    },
    placeholders: [],
    version: 42,
  },
  staging: {
    secrets: {
      DATABASE_URL: "postgres://user:pass@staging-db:5432/myapp",
      DEBUG: "true",
    },
    placeholders: ["DEBUG"],
    version: 7,
    decryptErrors: ["OLD_LEGACY_KEY"],
  },
  empty: {
    secrets: {},
    placeholders: [],
    version: 1,
  },
};

const server = createServer((req, res) => {
  console.log(`${req.method} ${req.url}`);

  // Check auth
  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${VALID_TOKEN}`) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }

  // Parse route: /api/v1/secrets/:org/:project/:env
  const match = req.url?.match(
    /^\/api\/v1\/secrets\/([^/]+)\/([^/]+)\/([^/]+)$/
  );
  if (!match) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
    return;
  }

  const [, org, project, env] = match;
  console.log(`  org=${org} project=${project} env=${env}`);

  const data = responses[env];
  if (!data) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `Environment '${env}' not found` }));
    return;
  }

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
});

server.listen(PORT, () => {
  console.log(`Mock Envshed API running on http://localhost:${PORT}`);
  console.log(`Valid token: ${VALID_TOKEN}`);
  console.log(`Available environments: ${Object.keys(responses).join(", ")}`);
});
