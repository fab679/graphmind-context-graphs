/**
 * Utility: Clear a context graph namespace.
 *
 * Usage:
 *   GRAPH=cg_dev_team npx tsx examples/clear-graph.ts
 *   npx tsx examples/clear-graph.ts          # defaults to cg_dev_team
 */

import { config as loadDotenv } from "dotenv";
import { GraphmindClient } from "graphmind-sdk";

loadDotenv();

const graph = process.env.GRAPH ?? "cg_dev_team";
const url = process.env.GRAPHMIND_URL ?? "http://localhost:8080";

async function main() {
  const client = new GraphmindClient({ url });

  console.log(`Clearing graph: ${graph} at ${url}`);

  // Delete all nodes and relationships
  await client.query("MATCH (n) DETACH DELETE n", graph);

  console.log("Done. Graph is empty.");
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
