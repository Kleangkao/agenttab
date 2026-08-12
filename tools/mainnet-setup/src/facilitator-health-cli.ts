/**
 * Read-only Mainnet facilitator health probe (no funds, no settle).
 *
 *   pnpm mainnet:facilitators
 */
import { checkFacilitatorHealth } from "@agenttab/gateway";

const prefer = process.env.FACILITATOR_URL;
const report = await checkFacilitatorHealth({
  ...(prefer ? { preferUrl: prefer } : {})
});

console.log(JSON.stringify(report, null, 2));
process.exit(report.recommendedUrl ? 0 : 2);
