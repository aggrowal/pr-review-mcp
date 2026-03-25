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
  const prReviewTool = toolResult.tools.find((tool) => tool.name === "pr_review");

  const expectedTools = ["configure_project", "list_projects", "pr_review"];
  const missing = expectedTools.filter((name) => !toolNames.includes(name));
  if (missing.length > 0) {
    throw new Error(`Missing required tools: ${missing.join(", ")}`);
  }

  if (!prReviewTool) {
    throw new Error("Missing pr_review tool definition.");
  }

  const prReviewProperties = prReviewTool.inputSchema?.properties ?? {};
  for (const requiredProperty of ["branch", "sessionId", "draftReport"]) {
    if (!(requiredProperty in prReviewProperties)) {
      throw new Error(
        `pr_review schema missing expected property: ${requiredProperty}`
      );
    }
  }

  // Validate-stage contract check: should return structured error when session is unknown.
  const validateCallResult = await client.callTool({
    name: "pr_review",
    arguments: {
      sessionId: "smoke-session",
      draftReport: "{}",
    },
  });
  const validateEnvelope = parseToolJsonEnvelope(
    validateCallResult,
    "validate-stage contract check"
  );
  if (validateEnvelope.ok !== false) {
    throw new Error(
      "Expected validate-stage contract check to return ok=false for unknown session."
    );
  }
  if (validateEnvelope.meta?.stage !== "error") {
    throw new Error(
      "Expected validate-stage contract check to return meta.stage=error."
    );
  }
  if (validateEnvelope.error?.code !== "session_not_found") {
    throw new Error(
      `Expected error.code=session_not_found, got ${String(validateEnvelope.error?.code)}`
    );
  }
  if (!validateEnvelope.meta?.contractVersion) {
    throw new Error("Expected stage attestation contractVersion in error envelope.");
  }

  // Optional end-to-end prepare contract check. Enable when smoke environment provides a branch.
  const smokeBranch = process.env.PR_REVIEW_SMOKE_BRANCH;
  if (smokeBranch) {
    const prepareCallResult = await client.callTool({
      name: "pr_review",
      arguments: {
        branch: smokeBranch,
        cwd: process.env.PR_REVIEW_SMOKE_CWD ?? process.cwd(),
        format: "json",
      },
    });
    const prepareEnvelope = parseToolJsonEnvelope(
      prepareCallResult,
      "prepare-stage contract check"
    );
    if (prepareEnvelope.ok !== true || prepareEnvelope.stage !== "prepare") {
      throw new Error(
        `Expected prepare-stage success envelope, got: ${JSON.stringify(prepareEnvelope, null, 2)}`
      );
    }
    if (prepareEnvelope.meta?.stage !== "prepare") {
      throw new Error("Expected prepare envelope meta.stage=prepare.");
    }
    const callTemplate = prepareEnvelope.nextAction?.callTemplate;
    if (callTemplate?.tool !== "pr_review") {
      throw new Error("Expected nextAction.callTemplate.tool=pr_review.");
    }
    if (callTemplate?.arguments?.sessionId !== prepareEnvelope.session?.sessionId) {
      throw new Error(
        "Expected nextAction.callTemplate.arguments.sessionId to match session.sessionId."
      );
    }
    if (typeof callTemplate?.arguments?.draftReport !== "string") {
      throw new Error("Expected nextAction.callTemplate.arguments.draftReport placeholder string.");
    }
  }

  console.log("MCP smoke check passed");
  console.log(`Server entry: ${serverEntry}`);
  console.log(`Server capabilities: ${JSON.stringify(capabilities ?? {}, null, 2)}`);
  console.log(`Tools: ${toolNames.join(", ")}`);
  console.log("Validated staged contract: validate error envelope");
  if (process.env.PR_REVIEW_SMOKE_BRANCH) {
    console.log(
      `Validated staged contract: prepare envelope for branch ${process.env.PR_REVIEW_SMOKE_BRANCH}`
    );
  } else {
    console.log(
      "Skipped prepare-stage smoke (set PR_REVIEW_SMOKE_BRANCH to enable full staged check)"
    );
  }
}

function parseToolJsonEnvelope(result, label) {
  const textEntry = result?.content?.find((entry) => entry?.type === "text");
  if (!textEntry || typeof textEntry.text !== "string") {
    throw new Error(`${label} did not return text content.`);
  }
  try {
    return JSON.parse(textEntry.text);
  } catch (error) {
    throw new Error(
      `${label} returned non-JSON text: ${String(error)}\nPayload:\n${textEntry.text}`
    );
  }
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
