import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";

// Use vi.hoisted so mocks are available in vi.mock factories (which get hoisted)
const { mockCore, mockGetJson, mockHttpClientConstructorArgs } = vi.hoisted(
  () => {
    const mockGetJson = vi.fn();
    return {
      mockCore: {
        getInput: vi.fn(),
        setSecret: vi.fn(),
        exportVariable: vi.fn(),
        setFailed: vi.fn(),
        info: vi.fn(),
        warning: vi.fn(),
      },
      mockGetJson,
      mockHttpClientConstructorArgs: [] as unknown[][],
    };
  }
);

vi.mock("@actions/core", () => mockCore);
vi.mock("@actions/http-client", () => ({
  HttpClient: class MockHttpClient {
    constructor(...args: unknown[]) {
      mockHttpClientConstructorArgs.push(args);
    }
    getJson = mockGetJson;
  },
}));

import { run, buildUrl, formatEnvFile, getInputs } from "../src/main";

function setInputs(overrides: Record<string, string> = {}) {
  const defaults: Record<string, string> = {
    token: "envshed_test_token_abc123",
    org: "my-org",
    project: "my-project",
    environment: "production",
    "api-url": "https://app.envshed.com",
    "export-to": "env",
    "file-path": ".env",
  };
  const merged = { ...defaults, ...overrides };

  mockCore.getInput.mockImplementation(
    (name: string, opts?: { required?: boolean }) => {
      const val = merged[name] ?? "";
      if (opts?.required && !val) {
        throw new Error(`Input required and not supplied: ${name}`);
      }
      return val;
    }
  );
}

function mockApiResponse(statusCode: number, result: unknown) {
  mockGetJson.mockResolvedValue({ statusCode, result });
}

describe("buildUrl", () => {
  it("builds the correct API URL", () => {
    const url = buildUrl({
      token: "t",
      org: "my-org",
      project: "backend",
      environment: "staging",
      apiUrl: "https://app.envshed.com",
      exportTo: "env",
      filePath: ".env",
    });
    expect(url).toBe(
      "https://app.envshed.com/api/v1/secrets/my-org/backend/staging"
    );
  });

  it("encodes special characters in slugs", () => {
    const url = buildUrl({
      token: "t",
      org: "org with spaces",
      project: "project/slash",
      environment: "env&special",
      apiUrl: "https://app.envshed.com",
      exportTo: "env",
      filePath: ".env",
    });
    expect(url).toBe(
      "https://app.envshed.com/api/v1/secrets/org%20with%20spaces/project%2Fslash/env%26special"
    );
  });
});

describe("formatEnvFile", () => {
  it("formats key=value pairs with quotes", () => {
    const result = formatEnvFile({
      DB_URL: "postgres://localhost:5432/db",
      API_KEY: "sk_test_123",
    });
    expect(result).toBe(
      'DB_URL="postgres://localhost:5432/db"\nAPI_KEY="sk_test_123"\n'
    );
  });

  it("escapes double quotes in values", () => {
    const result = formatEnvFile({
      JSON_VALUE: '{"key":"value"}',
    });
    expect(result).toBe('JSON_VALUE="{\\"key\\":\\"value\\"}"\n');
  });

  it("escapes backslashes in values", () => {
    const result = formatEnvFile({
      PATH_VALUE: "C:\\Users\\test",
    });
    expect(result).toBe('PATH_VALUE="C:\\\\Users\\\\test"\n');
  });

  it("escapes newlines and carriage returns in values", () => {
    const result = formatEnvFile({
      MULTI_LINE: "line1\nline2\r\nline3",
    });
    expect(result).toBe('MULTI_LINE="line1\\nline2\\r\\nline3"\n');
  });

  it("handles empty secrets object", () => {
    const result = formatEnvFile({});
    expect(result).toBe("\n");
  });
});

describe("run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHttpClientConstructorArgs.length = 0;
  });

  afterEach(() => {
    const testEnvPath = path.resolve(".env.test-output");
    if (fs.existsSync(testEnvPath)) {
      fs.unlinkSync(testEnvPath);
    }
  });

  it("exports secrets as environment variables", async () => {
    setInputs();
    mockApiResponse(200, {
      secrets: {
        DATABASE_URL: "postgres://user:pass@host:5432/db",
        API_KEY: "sk_live_secret_key",
      },
      placeholders: [],
      version: 5,
    });

    await run();

    expect(mockCore.setSecret).toHaveBeenCalledWith(
      "postgres://user:pass@host:5432/db"
    );
    expect(mockCore.setSecret).toHaveBeenCalledWith("sk_live_secret_key");

    expect(mockCore.exportVariable).toHaveBeenCalledWith(
      "DATABASE_URL",
      "postgres://user:pass@host:5432/db"
    );
    expect(mockCore.exportVariable).toHaveBeenCalledWith(
      "API_KEY",
      "sk_live_secret_key"
    );

    expect(mockCore.info).toHaveBeenCalledWith(
      "Loaded 2 secrets from Envshed (v5)."
    );
  });

  it("writes secrets to .env file when export-to is file", async () => {
    const testFilePath = ".env.test-output";
    setInputs({ "export-to": "file", "file-path": testFilePath });
    mockApiResponse(200, {
      secrets: {
        DB_URL: "postgres://localhost/db",
        SECRET: "my-secret",
      },
      placeholders: [],
      version: 1,
    });

    await run();

    const resolvedPath = path.resolve(testFilePath);
    const content = fs.readFileSync(resolvedPath, "utf-8");
    expect(content).toBe(
      'DB_URL="postgres://localhost/db"\nSECRET="my-secret"\n'
    );

    // Verify ALL values are masked even in file mode
    expect(mockCore.setSecret).toHaveBeenCalledWith("postgres://localhost/db");
    expect(mockCore.setSecret).toHaveBeenCalledWith("my-secret");
  });

  it("masks ALL secret values", async () => {
    setInputs();
    mockApiResponse(200, {
      secrets: {
        KEY1: "value1",
        KEY2: "value2",
        KEY3: "value3",
      },
      placeholders: [],
      version: 1,
    });

    await run();

    expect(mockCore.setSecret).toHaveBeenCalledTimes(3);
    expect(mockCore.setSecret).toHaveBeenCalledWith("value1");
    expect(mockCore.setSecret).toHaveBeenCalledWith("value2");
    expect(mockCore.setSecret).toHaveBeenCalledWith("value3");
  });

  it("sends authorization header with token", async () => {
    setInputs({ token: "envshed_my_super_secret_token" });
    mockApiResponse(200, {
      secrets: { A: "b" },
      placeholders: [],
      version: 1,
    });

    await run();

    expect(mockHttpClientConstructorArgs[0]).toEqual([
      "setup-envshed",
      undefined,
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer envshed_my_super_secret_token",
        }),
      }),
    ]);
  });

  it("fails with descriptive error on HTTP 401", async () => {
    setInputs();
    mockApiResponse(401, null);

    await expect(run()).rejects.toThrow(
      "Failed to fetch secrets from Envshed (HTTP 401)"
    );
  });

  it("fails with descriptive error on HTTP 403", async () => {
    setInputs();
    mockApiResponse(403, null);

    await expect(run()).rejects.toThrow(
      "Failed to fetch secrets from Envshed (HTTP 403)"
    );
  });

  it("fails with descriptive error on HTTP 404", async () => {
    setInputs();
    mockApiResponse(404, null);

    await expect(run()).rejects.toThrow(
      "Failed to fetch secrets from Envshed (HTTP 404)"
    );
  });

  it("fails when response body is missing secrets field", async () => {
    setInputs();
    mockApiResponse(200, { version: 1 });

    await expect(run()).rejects.toThrow(
      "Unexpected response from Envshed API: missing secrets field"
    );
  });

  it("fails when response body is null", async () => {
    setInputs();
    mockApiResponse(200, null);

    await expect(run()).rejects.toThrow(
      "Unexpected response from Envshed API: missing secrets field"
    );
  });

  it("warns about decrypt errors but continues", async () => {
    setInputs();
    mockApiResponse(200, {
      secrets: { GOOD_KEY: "good_value" },
      placeholders: [],
      version: 3,
      decryptErrors: ["BAD_KEY_1", "BAD_KEY_2"],
    });

    await run();

    expect(mockCore.warning).toHaveBeenCalledWith(
      "Some secrets could not be decrypted: BAD_KEY_1, BAD_KEY_2"
    );
    expect(mockCore.exportVariable).toHaveBeenCalledWith(
      "GOOD_KEY",
      "good_value"
    );
  });

  it("warns when no secrets are found", async () => {
    setInputs();
    mockApiResponse(200, {
      secrets: {},
      placeholders: [],
      version: 1,
    });

    await run();

    expect(mockCore.warning).toHaveBeenCalledWith(
      "No secrets found for the specified environment."
    );
    expect(mockCore.exportVariable).not.toHaveBeenCalled();
  });

  it("throws on invalid export-to value", async () => {
    setInputs({ "export-to": "stdout" });

    await expect(run()).rejects.toThrow(
      'Invalid export-to value: "stdout". Must be "env" or "file".'
    );
  });

  it("handles singular secret count in message", async () => {
    setInputs();
    mockApiResponse(200, {
      secrets: { ONLY_ONE: "value" },
      placeholders: [],
      version: 7,
    });

    await run();

    expect(mockCore.info).toHaveBeenCalledWith(
      "Loaded 1 secret from Envshed (v7)."
    );
  });
});

describe("security: no sensitive data leaks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHttpClientConstructorArgs.length = 0;
  });

  afterEach(() => {
    const testEnvPath = path.resolve(".env.test-output");
    if (fs.existsSync(testEnvPath)) {
      fs.unlinkSync(testEnvPath);
    }
  });

  it("does not log secret values in info messages", async () => {
    setInputs();
    const secretValue = "super_sensitive_password_123";
    mockApiResponse(200, {
      secrets: { PASSWORD: secretValue },
      placeholders: [],
      version: 1,
    });

    await run();

    for (const call of mockCore.info.mock.calls) {
      expect(call[0]).not.toContain(secretValue);
    }
    for (const call of mockCore.warning.mock.calls) {
      expect(call[0]).not.toContain(secretValue);
    }
  });

  it("does not include token in the API URL", async () => {
    const token = "envshed_super_secret_token_xyz";
    setInputs({ token });
    mockApiResponse(200, {
      secrets: { A: "b" },
      placeholders: [],
      version: 1,
    });

    await run();

    const urlArg = mockGetJson.mock.calls[0][0];
    expect(urlArg).not.toContain(token);
  });

  it("calls setSecret before exportVariable for every secret", async () => {
    setInputs();
    const callOrder: string[] = [];
    mockCore.setSecret.mockImplementation(() =>
      callOrder.push("setSecret")
    );
    mockCore.exportVariable.mockImplementation(() =>
      callOrder.push("exportVariable")
    );

    mockApiResponse(200, {
      secrets: {
        KEY1: "val1",
        KEY2: "val2",
      },
      placeholders: [],
      version: 1,
    });

    await run();

    // For each secret, setSecret must come before exportVariable
    for (let i = 0; i < callOrder.length; i += 2) {
      expect(callOrder[i]).toBe("setSecret");
      expect(callOrder[i + 1]).toBe("exportVariable");
    }
  });

  it("masks all values in file mode before writing", async () => {
    const testFilePath = ".env.test-output";
    setInputs({ "export-to": "file", "file-path": testFilePath });

    const maskedValues: string[] = [];
    mockCore.setSecret.mockImplementation((v: string) =>
      maskedValues.push(v)
    );

    mockApiResponse(200, {
      secrets: {
        SECRET1: "hidden_value_1",
        SECRET2: "hidden_value_2",
      },
      placeholders: [],
      version: 1,
    });

    await run();

    expect(maskedValues).toContain("hidden_value_1");
    expect(maskedValues).toContain("hidden_value_2");
  });

  it("does not expose the API token in error messages", async () => {
    const token = "envshed_top_secret_token_never_expose";
    setInputs({ token });
    mockApiResponse(401, null);

    try {
      await run();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).not.toContain(token);
    }
  });

  it("does not expose secret values in warning messages", async () => {
    setInputs();
    mockApiResponse(200, {
      secrets: { GOOD: "visible_value" },
      placeholders: [],
      version: 1,
      decryptErrors: ["BAD_KEY"],
    });

    await run();

    for (const call of mockCore.warning.mock.calls) {
      expect(call[0]).not.toContain("visible_value");
    }
  });

  it("uses HTTPS in the default API URL", () => {
    setInputs();
    const inputs = getInputs();
    expect(inputs.apiUrl).toMatch(/^https:\/\//);
  });
});
