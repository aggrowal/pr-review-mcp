import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const serverEntry = resolve(
  process.cwd(),
  process.argv[2] ?? "dist/index.js"
);

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverEntry],
  stderr: "pipe",
});

if (transport.stderr) {
  transport.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    if (text.trim().length > 0) {
      process.stderr.write(`[server] ${text}`);
    }
  });
}

const client = new Client(
  { name: "pr-review-mcp-smoke", version: "1.0.0" },
  { capabilities: {} }
);

async function main() {
  await client.connect(transport);
  const capabilities = client.getServerCapabilities();
  const toolResult = await client.listTools();
  const toolNames = toolResult.tools.map((tool) => tool.name);

  const expectedTools = ["configure_project", "list_projects", "pr_review"];
  const missing = expectedTools.filter((name) => !toolNames.includes(name));
  if (missing.length > 0) {
    throw new Error(`Missing required tools: ${missing.join(", ")}`);
  }

  console.log("MCP smoke check passed");
  console.log(`Server entry: ${serverEntry}`);
  console.log(`Server capabilities: ${JSON.stringify(capabilities ?? {}, null, 2)}`);
  console.log(`Tools: ${toolNames.join(", ")}`);
}

main()
  .catch((error) => {
    console.error("MCP smoke check failed");
    console.error(String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await transport.close().catch(() => undefined);
  });
