#!/usr/bin/env node
/**
 * validate-workflow-paths.js
 *
 * TOMBSTONE (2026-08-14) — this script guards a machine that is switched off.
 * It validates script references inside `.github/workflows/*`, and those
 * workflows can never execute: the operator ruled on 2026-08-14 that GitHub
 * Actions will not be paid for (the change log 2026-08-14). Its own only
 * invoker was `.github/workflows/ci.yml:302`, so it is doubly dead. Kept, not
 * deleted, because `.github/workflows/ci.yml:302` and
 * `docs/ci/preventive-controls.md` still name it and removing the file alone
 * would just leave dangling references (reports/rules-audit/wave1-notes.md).
 * The live equivalent of the bug class it caught — a runbook telling an
 * operator to run a script that no longer exists — has no checker yet.
 *
 * Preventive control (Tier 2 / Control 2 — docs/ci/preventive-controls.md).
 *
 * Walks every .github/workflows/*.{yml,yaml} file and, for every `run:` step
 * that invokes a script via `node scripts/...`, `bash scripts/...`, or
 * `./scripts/...`, verifies the referenced script exists on disk relative to
 * the working-directory in effect for that step (defaults: repo root).
 *
 * Exit codes:
 *   0  every reference resolves
 *   1  one or more references are broken (each printed with workflow:line)
 *
 * Why it was written: a stale `node scripts/foo.js` reference silently passes
 * YAML lint, then fails at runtime — sometimes only on push to main (e.g.
 * deploy-staging.sh that broke after a rename). It caught that at PR time, back
 * when there were PR runs.
 *
 * No third-party deps — uses a small line-oriented scanner. Workflow YAML is
 * regular enough for this to be reliable: we only look for shell command
 * patterns inside `run:` blocks, with a minimal awareness of indentation and
 * `working-directory:` to handle the common case of monorepo subprojects.
 *
 * Limitations (acceptable for a Tier-2 preventive control):
 *   - Does not resolve `${{ ... }}` expressions; references containing template
 *     expressions are skipped.
 *   - Does not follow `defaults.run.working-directory` at the job level beyond
 *     a simple per-step override; the most common pattern (per-step
 *     working-directory) is fully handled.
 *   - Treats only references that begin with "scripts/" or "./scripts/" — the
 *     bug class we care about.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const WORKFLOWS_DIR = path.join(REPO_ROOT, '.github', 'workflows');

// Patterns we consider "a script invocation":
//   node <path>
//   bash <path>
//   sh <path>
//   ./<path>
// where <path> starts with "scripts/" (or "./scripts/").
const INVOCATION_PATTERNS = [
  /\b(?:node|bash|sh)\s+(\.\/)?(scripts\/[^\s'"`|<>;&$\\]+)/g,
  /(?:^|\s)\.\/(scripts\/[^\s'"`|<>;&$\\]+)/g,
];

function listWorkflowFiles() {
  if (!fs.existsSync(WORKFLOWS_DIR)) return [];
  return fs
    .readdirSync(WORKFLOWS_DIR)
    .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
    .map((name) => path.join(WORKFLOWS_DIR, name));
}

function indentOf(line) {
  const m = line.match(/^(\s*)/);
  return m ? m[1].length : 0;
}

/**
 * Walk a workflow file line-by-line. For each line that contains a script
 * invocation, determine the working-directory in effect for the enclosing
 * step by scanning backwards for the nearest `working-directory:` at the
 * same indentation level as the step's other properties (i.e. indentation
 * matching the `- name:` / `- run:` step boundary).
 *
 * This is a heuristic, not a real YAML parser, but it is deterministic and
 * matches the patterns actually used in this repo.
 */
function extractScriptReferences(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const refs = [];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    // Strip YAML inline comments (cheap heuristic — splits on " #").
    const codePart = rawLine.split(/\s#/)[0];

    let foundOnThisLine = false;
    for (const pattern of INVOCATION_PATTERNS) {
      pattern.lastIndex = 0;
      let m;
      while ((m = pattern.exec(codePart)) !== null) {
        const scriptPath = (m[2] || m[1] || '').replace(/[)\]}>'",;]+$/, '');
        if (!scriptPath || !scriptPath.startsWith('scripts/')) continue;
        // Skip if the path contains a GitHub expression — cannot statically resolve.
        if (scriptPath.includes('${{') || scriptPath.includes('}}')) continue;
        refs.push({
          file: filePath,
          line: i + 1,
          scriptPath,
          workingDirectory: findStepWorkingDirectory(lines, i),
        });
        foundOnThisLine = true;
      }
    }
    // Avoid re-running both patterns redundantly (already done above).
    void foundOnThisLine;
  }

  return refs;
}

/**
 * Find `working-directory:` for the step containing the given line.
 *
 * Strategy: scan backwards. The step starts at the first line whose
 * indentation is less than or equal to the current line's indentation AND
 * begins with "- " (the YAML list marker). We accept any
 * `working-directory:` we see between the current line and that boundary.
 */
function findStepWorkingDirectory(lines, currentIdx) {
  const startLine = lines[currentIdx];
  const startIndent = indentOf(startLine);

  for (let j = currentIdx - 1; j >= 0; j--) {
    const line = lines[j];
    const trimmed = line.trim();
    if (!trimmed) continue;

    const indent = indentOf(line);

    // Found a working-directory at or shallower than start indent — that's
    // the one in effect for this step.
    const wdMatch = trimmed.match(/^working-directory:\s*(.+?)\s*$/);
    if (wdMatch && indent <= startIndent) {
      // Strip surrounding quotes if present.
      let value = wdMatch[1].replace(/^['"]|['"]$/g, '');
      // Drop trailing comments.
      value = value.split(/\s+#/)[0].trim();
      return value;
    }

    // If we hit a new step boundary (`- ` at shallower indent than start),
    // stop searching — anything before that belongs to a previous step.
    if (line.match(/^\s*-\s/) && indent < startIndent) {
      return null;
    }
  }
  return null;
}

function resolveScriptPath(ref) {
  const wd = ref.workingDirectory ? ref.workingDirectory.replace(/^\.\//, '') : '';
  if (wd) {
    return path.join(REPO_ROOT, wd, ref.scriptPath);
  }
  return path.join(REPO_ROOT, ref.scriptPath);
}

function main() {
  const workflowFiles = listWorkflowFiles();
  if (workflowFiles.length === 0) {
    console.log('No workflow files found under .github/workflows/.');
    return 0;
  }

  const broken = [];
  let totalRefs = 0;

  for (const wf of workflowFiles) {
    const refs = extractScriptReferences(wf);
    totalRefs += refs.length;
    for (const ref of refs) {
      const abs = resolveScriptPath(ref);
      if (!fs.existsSync(abs)) {
        broken.push(ref);
      }
    }
  }

  const rel = (p) => path.relative(REPO_ROOT, p).replace(/\\/g, '/');

  if (broken.length > 0) {
    console.error(
      `\nWorkflow path validator: ${broken.length} broken reference(s) found ` +
        `(scanned ${totalRefs} invocation(s) across ${workflowFiles.length} workflow(s)).\n`,
    );
    for (const b of broken) {
      const wd = b.workingDirectory ? `  [working-directory: ${b.workingDirectory}]` : '';
      console.error(`  - ${rel(b.file)}:${b.line}  ->  ${b.scriptPath}${wd}  (NOT FOUND)`);
    }
    console.error(
      '\nFix: update the workflow to point at the correct script path, or restore the missing file.',
    );
    return 1;
  }

  console.log(
    `Workflow path validator: OK — all ${totalRefs} script reference(s) across ` +
      `${workflowFiles.length} workflow(s) resolve.`,
  );
  return 0;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { extractScriptReferences, listWorkflowFiles, resolveScriptPath };
