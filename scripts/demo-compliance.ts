import { careos } from "../src/careos/client.js";
import { checkComplianceGaps } from "../src/pipelines/compliance.js";
import { isDirectRun } from "../src/shared/entrypoint.js";

export async function main(): Promise<void> {
  await careos.health();
  const report = await checkComplianceGaps();
  console.log(JSON.stringify(report, null, 2));
}

export function reportCliError(err: unknown): void {
  console.error(err);
  process.exit(1);
}

if (isDirectRun(import.meta.url)) {
  main().catch(reportCliError);
}
