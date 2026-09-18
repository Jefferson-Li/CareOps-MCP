/**
 * Exercise CareOps MCP over stdio (same path Cursor uses via .cursor/mcp.json).
 * Requires CareOS (:3847) + OCR (:3850).
 */
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

function cleanEnv(extra: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === "string") out[k] = v;
  }
  return { ...out, ...extra };
}

async function main() {
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", "src/mcp/index.ts"],
    cwd: process.cwd(),
    stderr: "pipe",
    env: cleanEnv({
      CAREOS_URL: process.env.CAREOS_URL ?? "http://127.0.0.1:3847",
      OCR_URL: process.env.OCR_URL ?? "http://127.0.0.1:3850",
      MCP_ACTOR: "mcp-client-demo",
    }),
  });

  const client = new Client({ name: "careops-demo-client", version: "1.0.0" });
  await client.connect(transport);

  const tools = await client.listTools();
  console.log(
    "Tools:",
    tools.tools.map((t) => t.name).join(", "),
  );

  const compliance = await client.callTool({
    name: "check_compliance_gaps",
    arguments: { severity: "high" },
  });
  console.log("\n=== check_compliance_gaps ===");
  console.log(JSON.stringify(compliance, null, 2));

  const ocr = await client.callTool({
    name: "ocr_care_document",
    arguments: { image_path: "samples/gp-letter-aisha.png" },
  });
  console.log("\n=== ocr_care_document ===");
  console.log(JSON.stringify(ocr, null, 2));

  await client.close();
  console.log("\nMCP stdio demo OK (same transport Cursor uses)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
