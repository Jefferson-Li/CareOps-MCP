import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { appendAudit, hashArgs } from "../shared/db.js";
import { assertToken } from "../security/pii.js";
import { careos } from "../careos/client.js";
import { checkComplianceGaps, searchClientContext } from "../pipelines/compliance.js";
import { ingestCareDocument, ocrCareDocument, proposeAddressUpdate } from "../pipelines/document-ingest.js";
import { optimizeWeeklyRoster } from "../pipelines/roster.js";

function text(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function errorText(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true as const,
  };
}

async function audited<T>(tool: string, args: unknown, fn: () => Promise<T>) {
  assertToken();
  try {
    const result = await fn();
    appendAudit({
      actor: process.env.MCP_ACTOR ?? "claude",
      tool,
      args_hash: hashArgs(args),
      status: "ok",
    });
    return text(result);
  } catch (err) {
    appendAudit({
      actor: process.env.MCP_ACTOR ?? "claude",
      tool,
      args_hash: hashArgs(args),
      status: "error",
      detail: err instanceof Error ? err.message : String(err),
    });
    return errorText(err);
  }
}

function createServer(): McpServer {
  const server = new McpServer({
    name: "careops-mcp",
    version: "1.0.0",
  });

  server.registerTool(
    "search_client_context",
    {
      description:
        "Search CareOS clients by name, id, suburb, or notes. Returns PII-masked summaries safe for LLM context.",
      inputSchema: {
        query: z.string().min(1).describe("Name, client id, suburb, or keyword"),
      },
    },
    async (args) => audited("search_client_context", args, () => searchClientContext(args.query)),
  );

  server.registerTool(
    "check_compliance_gaps",
    {
      description:
        "List open healthcare compliance checklist items, optionally filtered by severity. Read-only.",
      inputSchema: {
        severity: z.enum(["low", "medium", "high"]).optional(),
      },
    },
    async (args) =>
      audited("check_compliance_gaps", args, () => checkComplianceGaps(args.severity)),
  );

  server.registerTool(
    "ingest_care_document",
    {
      description:
        "Extract structured fields from a CareOS document (e.g. GP letter). Does not write client records.",
      inputSchema: {
        doc_id: z.string().describe("Document id, e.g. DOC-1"),
      },
    },
    async (args) => audited("ingest_care_document", args, () => ingestCareDocument(args.doc_id)),
  );

  server.registerTool(
    "ocr_care_document",
    {
      description:
        "Run the Python OCR worker on a scanned clinical letter image, extract address/MRN fields, and match a CareOS client. Does not write.",
      inputSchema: {
        image_path: z
          .string()
          .describe("Path to image, e.g. samples/gp-letter-aisha.png"),
      },
    },
    async (args) => audited("ocr_care_document", args, () => ocrCareDocument(args.image_path)),
  );

  server.registerTool(
    "update_client_address",
    {
      description:
        "Propose or apply a client address update. confirm=false creates a pending change; confirm=true applies after review.",
      inputSchema: {
        cl_id: z.string(),
        addr_line1: z.string(),
        addr_suburb: z.string(),
        addr_postcode: z.string().regex(/^\d{4}$/),
        addr_state: z.string().default("NSW"),
        doc_id: z.string().optional(),
        confirm: z.boolean().default(false),
      },
    },
    async (args) => audited("update_client_address", args, () => proposeAddressUpdate(args)),
  );

  server.registerTool(
    "apply_pending_change",
    {
      description: "Apply a previously created pending change after human confirmation.",
      inputSchema: {
        change_id: z.string().uuid(),
      },
    },
    async (args) =>
      audited("apply_pending_change", args, () => careos.applyPendingChange(args.change_id)),
  );

  server.registerTool(
    "optimize_weekly_roster",
    {
      description:
        "Detect carer schedule conflicts and suggest shifts. Dry-run only — does not mutate CareOS.",
      inputSchema: {
        zone: z.string().optional().describe("e.g. Eastwood"),
      },
    },
    async (args) =>
      audited("optimize_weekly_roster", args, () => optimizeWeeklyRoster(args.zone)),
  );

  server.registerTool(
    "run_sync_pipeline",
    {
      description:
        "Run a lightweight sync health check between CareOps and CareOS (connectivity + open counts).",
      inputSchema: {
        dry_run: z.boolean().default(true),
      },
    },
    async (args) =>
      audited("run_sync_pipeline", args, async () => {
        const health = await careos.health();
        const [clients, visits, gaps, docs] = await Promise.all([
          careos.listClients(),
          careos.listVisits(),
          careos.listCompliance(true),
          careos.listDocuments(),
        ]);
        return {
          dry_run: args.dry_run,
          careos: health,
          counts: {
            clients: clients.items.length,
            visits: visits.items.length,
            open_compliance: gaps.items.length,
            documents: docs.items.length,
          },
          actions_taken: args.dry_run
            ? []
            : ["Would enqueue document extract for unprocessed docs (demo: none auto-applied)"],
        };
      }),
  );

  server.registerResource(
    "careos-system-map",
    "careops://docs/system-map",
    {
      description: "Reverse-engineered CareOS workflow map for rapid onboarding",
      mimeType: "text/markdown",
    },
    async () => ({
      contents: [
        {
          uri: "careops://docs/system-map",
          mimeType: "text/markdown",
          text: SYSTEM_MAP,
        },
      ],
    }),
  );

  return server;
}

const SYSTEM_MAP = `# CareOS system map (reverse-engineered)

## Entities
- **clients** (\`cl_id\`): patient / consumer demographics + address
- **visits** (\`slot_id\`): clinician roster slots with zone + status
- **compliance**: checklist items tied to healthcare quality obligations
- **documents**: inbound GP letters / plans awaiting extraction
- **pending_changes**: human-in-the-loop write queue

## Critical workflows
1. Address change: GP letter → extract → pending change → apply
2. Compliance: open checklist → coordinator follow-up
3. Rostering: detect overlapping carer slots → suggest shift (dry-run)

## API base
\`http://127.0.0.1:3847\` — see \`docs/system-map.md\` for full routes.
`;

void serveStdio(createServer);
console.error("CareOps MCP server running on stdio (expects CareOS at CAREOS_URL)");
