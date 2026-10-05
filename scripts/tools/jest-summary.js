#!/usr/bin/env node
// jest-summary — ย่อผล `jest --json` ให้เหลือสิ่งที่เทียบกันได้ระหว่างสองรอบ (Node 20 vs 24 · jest 29 vs 30)
// ตัวเลขทุกตัวมาจาก jest เอง · failedFiles เรียงแล้ว path ตัดเหลือหลัง apps/<app>/ ให้เทียบข้ามworktree ได้
// ใช้: node scripts/tools/jest-summary.js <jest-json>  → พิมพ์ JSON (diff สองไฟล์นี้ตรงๆ ได้)
const path = require('path');
const j = require(path.resolve(process.argv[2]));
const short = (n) => n.replace(/^.*?\/apps\/(backend|web-app)\//, '');
console.log(JSON.stringify({
  suites: j.numTotalTestSuites,
  suitesFailed: j.numFailedTestSuites,
  suitesSkipped: j.numPendingTestSuites,
  suitesRuntimeError: j.numRuntimeErrorTestSuites,
  tests: j.numTotalTests,
  passed: j.numPassedTests,
  failed: j.numFailedTests,
  skipped: j.numPendingTests,
  todo: j.numTodoTests,
  failedFiles: j.testResults.filter((r) => r.status === 'failed').map((r) => short(r.name)).sort(),
}, null, 1));
