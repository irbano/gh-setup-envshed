import * as core from "@actions/core";
import { HttpClient } from "@actions/http-client";
import * as fs from "fs";
import * as path from "path";

export interface EnvshedResponse {
  secrets: Record<string, string>;
  placeholders: string[];
  version: number;
  linkedKeys?: string[];
  decryptErrors?: string[];
}

export interface ActionInputs {
  token: string;
  org: string;
  project: string;
  environment: string;
  apiUrl: string;
  exportTo: string;
  filePath: string;
}

export function getInputs(): ActionInputs {
  return {
    token: core.getInput("token", { required: true }),
    org: core.getInput("org", { required: true }),
    project: core.getInput("project", { required: true }),
    environment: core.getInput("environment") || "production",
    apiUrl: core.getInput("api-url") || "https://app.envshed.com",
    exportTo: core.getInput("export-to") || "env",
    filePath: core.getInput("file-path") || ".env",
  };
}

export function buildUrl(inputs: ActionInputs): string {
  return `${inputs.apiUrl}/api/v1/secrets/${encodeURIComponent(inputs.org)}/${encodeURIComponent(inputs.project)}/${encodeURIComponent(inputs.environment)}`;
}

export function formatEnvFile(secrets: Record<string, string>): string {
  return (
    Object.entries(secrets)
      .map(([key, value]) => {
        const escaped = value
          .replace(/\\/g, "\\\\")
          .replace(/"/g, '\\"')
          .replace(/\n/g, "\\n")
          .replace(/\r/g, "\\r");
        return `${key}="${escaped}"`;
      })
      .join("\n") + "\n"
  );
}

export async function run(): Promise<void> {
  const inputs = getInputs();

  if (inputs.exportTo !== "env" && inputs.exportTo !== "file") {
    throw new Error(
      `Invalid export-to value: "${inputs.exportTo}". Must be "env" or "file".`
    );
  }

  const client = new HttpClient("setup-envshed", undefined, {
    headers: {
      Authorization: `Bearer ${inputs.token}`,
      Accept: "application/json",
    },
  });

  const url = buildUrl(inputs);
  const response = await client.getJson<EnvshedResponse>(url);

  if (response.statusCode !== 200) {
    throw new Error(
      `Failed to fetch secrets from Envshed (HTTP ${response.statusCode}). ` +
        `Verify your token, org, project, and environment are correct.`
    );
  }

  if (!response.result || !response.result.secrets) {
    throw new Error(
      "Unexpected response from Envshed API: missing secrets field."
    );
  }

  const { secrets, decryptErrors } = response.result;

  if (decryptErrors && decryptErrors.length > 0) {
    core.warning(
      `Some secrets could not be decrypted: ${decryptErrors.join(", ")}`
    );
  }

  const entries = Object.entries(secrets);

  if (entries.length === 0) {
    core.warning("No secrets found for the specified environment.");
    return;
  }

  if (inputs.exportTo === "env") {
    for (const [key, value] of entries) {
      if (value !== "") core.setSecret(value);
      core.exportVariable(key, value);
    }
  } else {
    for (const [, value] of entries) {
      if (value !== "") core.setSecret(value);
    }

    const envContent = formatEnvFile(secrets);
    const resolvedPath = path.resolve(inputs.filePath);
    fs.writeFileSync(resolvedPath, envContent, "utf-8");
    core.info(`Wrote secrets to ${resolvedPath}`);
  }

  core.info(
    `Loaded ${entries.length} secret${entries.length === 1 ? "" : "s"} from Envshed (v${response.result.version}).`
  );
}
