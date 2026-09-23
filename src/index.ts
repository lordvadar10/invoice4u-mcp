/**
 * Entry point.
 *
 * Startup order matters and is the whole safety story:
 *
 *   1. Load and validate configuration.
 *   2. Resolve the API key (Keychain, or env for CI).
 *   3. Authenticate and identify the organisation.
 *   4. Assert it matches INVOICE4U_EXPECT_ORG.
 *   5. Only then register tools and serve.
 *
 * A failure anywhere before step 5 means no tools exist at all, so a misfiled
 * key can refuse to start but can never act on the wrong company.
 */

import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { loadConfig } from "./config.js";
import { Invoice4uError } from "./invoice4u/errors.js";
import { connect } from "./invoice4u/session.js";
import { createLogger } from "./log.js";
import { registerTools } from "./tools/register.js";

const VERSION = "0.1.0";

async function main(): Promise<void> {
  const config = await loadConfig();
  const log = createLogger(config.logLevel, config.apiKey);

  log.info(`starting ${VERSION} against ${config.env} (${config.baseUrl})`);
  log.debug(`api key source: ${config.keySource}`);

  const connection = await connect(config, log);

  const server = new McpServer({ name: "invoice4u", version: VERSION });
  const tools = registerTools(server, connection, config);

  if (!config.allowWrites) {
    log.info("read-only mode — no write tools are registered");
  }
  log.info(`serving ${tools.length} tools for ${connection.org.label}`);

  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  const message =
    error instanceof Invoice4uError
      ? error.message
      : error instanceof Error
        ? error.message
        : String(error);
  process.stderr.write(`[invoice4u-mcp] fatal: ${message}\n`);
  process.exit(1);
});
