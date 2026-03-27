/**
 * Debug script — tests SET update patterns on Graphmind.
 */
import { config as loadDotenv } from "dotenv";
import { GraphmindClient } from "graphmind-sdk";

loadDotenv();

async function main() {
  const client = new GraphmindClient({
    url: process.env.GRAPHMIND_URL ?? "http://localhost:8080",
  });
  const graph = "cg_skills_demo";

  // Read a trace
  const read1 = await client.queryReadonly(
    "MATCH (t:DecisionTrace) RETURN id(t) AS id, t.status AS status, t.justification_confidence AS conf LIMIT 1",
    graph
  );
  const traceId = read1.records[0][0];
  console.log(`Trace ${traceId}: status="${read1.records[0][1]}", conf=${read1.records[0][2]}`);

  // Test 1: Simple SET (already proven not to work)
  console.log("\n--- Test 1: SET t.status = 'test1' ---");
  await client.query(
    "MATCH (t:DecisionTrace) WHERE id(t) = $id SET t.status = 'test1' RETURN t.status",
    graph,
    { id: traceId }
  );
  let r = await client.queryReadonly("MATCH (t:DecisionTrace) WHERE id(t) = $id RETURN t.status", graph, { id: traceId });
  console.log(`  Result: ${r.records[0][0]}`);

  // Test 2: Map merge SET +=
  console.log("\n--- Test 2: SET t += {status: 'test2'} ---");
  await client.query(
    "MATCH (t:DecisionTrace) WHERE id(t) = $id SET t += {status: 'test2'} RETURN t.status",
    graph,
    { id: traceId }
  );
  r = await client.queryReadonly("MATCH (t:DecisionTrace) WHERE id(t) = $id RETURN t.status", graph, { id: traceId });
  console.log(`  Result: ${r.records[0][0]}`);

  // Test 3: Map replace SET =
  console.log("\n--- Test 3: SET t = {status: 'test3'} ---");
  try {
    await client.query(
      "MATCH (t:DecisionTrace) WHERE id(t) = $id SET t = {status: 'test3'} RETURN t.status",
      graph,
      { id: traceId }
    );
    r = await client.queryReadonly("MATCH (t:DecisionTrace) WHERE id(t) = $id RETURN t.status", graph, { id: traceId });
    console.log(`  Result: ${r.records[0][0]}`);
  } catch (e) {
    console.log(`  Error: ${(e as Error).message}`);
  }

  // Test 4: REMOVE then SET
  console.log("\n--- Test 4: REMOVE t.status then SET t.status = 'test4' ---");
  try {
    await client.query(
      "MATCH (t:DecisionTrace) WHERE id(t) = $id REMOVE t.status",
      graph,
      { id: traceId }
    );
    await client.query(
      "MATCH (t:DecisionTrace) WHERE id(t) = $id SET t.status = 'test4' RETURN t.status",
      graph,
      { id: traceId }
    );
    r = await client.queryReadonly("MATCH (t:DecisionTrace) WHERE id(t) = $id RETURN t.status", graph, { id: traceId });
    console.log(`  Result: ${r.records[0][0]}`);
  } catch (e) {
    console.log(`  Error: ${(e as Error).message}`);
  }

  // Test 5: Create a fresh node, then SET
  console.log("\n--- Test 5: Fresh node CREATE then SET ---");
  const cr = await client.query(
    "CREATE (x:TestNode {val: 'original'}) RETURN id(x) AS xid, x.val",
    graph
  );
  const xid = cr.records[0][0];
  console.log(`  Created TestNode ${xid}: val="${cr.records[0][1]}"`);
  await client.query(
    "MATCH (x:TestNode) WHERE id(x) = $xid SET x.val = 'updated' RETURN x.val",
    graph,
    { xid }
  );
  r = await client.queryReadonly("MATCH (x:TestNode) WHERE id(x) = $xid RETURN x.val", graph, { xid });
  console.log(`  After SET: val="${r.records[0][0]}"`);
  // Cleanup
  await client.query("MATCH (x:TestNode) WHERE id(x) = $xid DELETE x", graph, { xid });
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
