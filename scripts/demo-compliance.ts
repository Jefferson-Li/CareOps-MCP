import { careos } from "../src/careos/client.js";
import { checkComplianceGaps } from "../src/pipelines/compliance.js";

async function main() {
  await careos.health();
  const report = await checkComplianceGaps();
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
