import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "careos-test-"));
process.env.CAREOS_DATA_DIR = dir;
delete process.env.CAREOS_URL;
delete process.env.OCR_URL;
delete process.env.CAREOS_MCP_TOKEN;
delete process.env.MCP_AUTH_TOKEN;
delete process.env.MCP_ACTOR;
