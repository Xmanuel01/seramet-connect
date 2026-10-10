import { performance } from "node:perf_hooks";
import { handleScannerInternalApi } from "../src/server/scanner-internal-api";

const iterations = 25_000;
const request = new Request("https://seramet.test/api/seramet/health/live");
const samples: number[] = [];

for (let index = 0; index < 1_000; index += 1) {
  await handleScannerInternalApi(request, {});
}
for (let index = 0; index < iterations; index += 1) {
  const start = performance.now();
  const response = await handleScannerInternalApi(request, {});
  samples.push(performance.now() - start);
  if (response !== null)
    throw new Error("A normal request was intercepted by the scanner boundary");
}

samples.sort((left, right) => left - right);
const total = samples.reduce((sum, value) => sum + value, 0);
const report = {
  iterations,
  meanMilliseconds: total / samples.length,
  p95Milliseconds: samples[Math.floor(samples.length * 0.95)] ?? 0,
  p99Milliseconds: samples[Math.floor(samples.length * 0.99)] ?? 0,
};
console.log(JSON.stringify(report));
