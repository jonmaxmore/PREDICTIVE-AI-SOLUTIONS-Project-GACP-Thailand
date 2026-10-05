#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const scorecardArg = process.argv[2] || 'docs/deployment/provider-evaluation-scorecard.csv';
const requireComplete = process.argv.includes('--require-complete');
const scorecardPath = path.resolve(process.cwd(), scorecardArg);

function parseCsv(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.split(',').map((cell) => cell.trim()));
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

if (!fs.existsSync(scorecardPath)) {
  console.error(`Missing scorecard: ${scorecardPath}`);
  process.exit(1);
}

const rows = parseCsv(fs.readFileSync(scorecardPath, 'utf8'));
if (rows.length < 2) {
  console.error('Scorecard is empty');
  process.exit(1);
}

const [header, ...dataRows] = rows;
const providerColumns = header.slice(4, header.length - 1);

if (providerColumns.length === 0) {
  console.error('No provider columns found in scorecard');
  process.exit(1);
}

const providerSummaries = Object.fromEntries(
  providerColumns.map((provider) => [
    provider,
    {
      weightedScore: 0,
      weightedMax: 0,
      missing: [],
      blockers: [],
      criteriaCount: 0,
      completedCount: 0,
    },
  ]),
);

for (const row of dataRows) {
  if (row.length !== header.length) {
    console.error(`Malformed row: expected ${header.length} columns, got ${row.length}`);
    console.error(row.join(','));
    process.exit(1);
  }

  const [criterion, category, weightRaw, minScoreRaw] = row;
  const weight = toNumber(weightRaw);
  const minScore = toNumber(minScoreRaw);
  if (weight === null || minScore === null) {
    console.error(`Invalid weight/min_score for criterion: ${criterion}`);
    process.exit(1);
  }

  providerColumns.forEach((provider, index) => {
    const providerValue = row[index + 4];
    const summary = providerSummaries[provider];
    summary.criteriaCount += 1;
    summary.weightedMax += weight * 5;

    if (providerValue === '') {
      summary.missing.push(`${criterion} (${category})`);
      return;
    }

    const score = toNumber(providerValue);
    if (score === null || score < 1 || score > 5) {
      console.error(`Invalid score for ${provider} on ${criterion}: ${providerValue}`);
      process.exit(1);
    }

    summary.completedCount += 1;
    summary.weightedScore += weight * score;
    if (score < minScore) {
      summary.blockers.push(`${criterion}=${score} < min ${minScore}`);
    }
  });
}

console.log(`Provider evaluation summary: ${scorecardPath}`);
console.log('');

let hasMissing = false;
let hasBlockers = false;

for (const provider of providerColumns) {
  const summary = providerSummaries[provider];
  const percent = summary.weightedMax === 0
    ? 0
    : ((summary.weightedScore / summary.weightedMax) * 100).toFixed(1);

  console.log(`${provider}`);
  console.log(`  completed: ${summary.completedCount}/${summary.criteriaCount}`);
  console.log(`  weighted score: ${summary.weightedScore.toFixed(1)}/${summary.weightedMax.toFixed(1)} (${percent}%)`);

  if (summary.blockers.length > 0) {
    hasBlockers = true;
    console.log(`  blockers: ${summary.blockers.join('; ')}`);
  } else {
    console.log('  blockers: none');
  }

  if (summary.missing.length > 0) {
    hasMissing = true;
    console.log(`  missing: ${summary.missing.join('; ')}`);
  } else {
    console.log('  missing: none');
  }

  console.log('');
}

if (requireComplete && (hasMissing || hasBlockers)) {
  process.exit(1);
}
