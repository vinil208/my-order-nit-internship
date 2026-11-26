import { Factory } from "./domain.js";
import { mkdirSync } from "node:fs";
mkdirSync("data", { recursive: true });
const f = new Factory("data/factory.sqlite");
console.log(
  "Benchmark masters and opening balances are ready. Existing transactions preserved.",
);
f.db.close();
