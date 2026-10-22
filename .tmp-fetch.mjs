import { readFileSync } from "node:fs";
const data = JSON.parse(readFileSync(".tmp-plugins.json", "utf8"));
const list = Array.isArray(data) ? data : data.plugins ?? data.items ?? [];
const wf = list.filter((p) => p.category === "workflow").sort((a, b) => (b.stars ?? 0) - (a.stars ?? 0));
console.log("workflow entries:", wf.length);
for (const p of wf.slice(0, 6)) {
  console.log("\n---", p.name, "| stars", p.stars);
  console.log("EN:", p.description?.en);
}
