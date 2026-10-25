import assert from "node:assert/strict";
import test from "node:test";
import { buildIdentity } from "../src/build-info.js";

test("build stamp uses Hong Kong time and the S2 vocab shape", () => {
  const { stamp, year } = buildIdentity(new Date("2026-10-23T15:12:26Z"));
  assert.equal(stamp, "v261023-231226");
  assert.equal(year, "2026");
});
