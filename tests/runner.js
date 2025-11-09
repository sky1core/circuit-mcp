#!/usr/bin/env node

import { spawn, execSync } from 'child_process';
import { readdirSync, existsSync, statSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

// Tests to skip in CI environment (headless, no GUI)
const CI_SKIP_TESTS = [
  'stdin-close',  // Requires Electron GUI
];

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(color, prefix, message) {
  console.log(`${color}[${prefix}]${colors.reset} ${message}`);
}

function checkBuildExists() {
  const electronDist = path.join(rootDir, 'packages/electron/dist/cli.mjs');
  const webDist = path.join(rootDir, 'packages/web/dist/cli.mjs');
  return existsSync(electronDist) && existsSync(webDist);
}

function runBuild() {
  log(colors.cyan, 'BUILD', 'Running build...');
  try {
    execSync('pnpm build', { cwd: rootDir, stdio: 'inherit' });
    log(colors.green, 'BUILD', 'Build complete');
  } catch (error) {
    log(colors.red, 'ERROR', 'Build failed');
    process.exit(1);
  }
}

function findTests() {
  const testsDir = __dirname;
  const entries = readdirSync(testsDir);

  return entries
    .filter(entry => {
      const fullPath = path.join(testsDir, entry);
      return statSync(fullPath).isDirectory() &&
             existsSync(path.join(fullPath, 'test.js'));
    })
    .map(entry => ({
      name: entry,
      path: path.join(testsDir, entry, 'test.js')
    }));
}

function runTest(testPath) {
  return new Promise((resolve) => {
    const proc = spawn('node', [testPath], {
      stdio: 'inherit',
      env: { ...process.env }
    });

    proc.on('close', (code) => {
      resolve(code === 0);
    });

    proc.on('error', (err) => {
      log(colors.red, 'ERROR', `Failed to run test: ${err.message}`);
      resolve(false);
    });
  });
}

async function main() {
  const testArg = process.argv[2];

  // Check build
  if (!checkBuildExists()) {
    log(colors.yellow, 'BUILD', 'Build artifacts not found');
    runBuild();
  }

  // Find tests
  const allTests = findTests();

  if (allTests.length === 0) {
    log(colors.yellow, 'WARN', 'No tests found');
    return;
  }

  let testsToRun;

  if (testArg) {
    // Run specific test
    const test = allTests.find(t => t.name === testArg);
    if (!test) {
      log(colors.red, 'ERROR', `Test '${testArg}' not found`);
      log(colors.blue, 'INFO', `Available tests: ${allTests.map(t => t.name).join(', ')}`);
      process.exit(1);
    }
    testsToRun = [test];
  } else {
    // Run all tests
    testsToRun = allTests;
  }

  // Filter out tests that should be skipped in CI
  if (process.env.CI) {
    const filtered = testsToRun.filter(test => !CI_SKIP_TESTS.includes(test.name));
    const skipped = testsToRun.filter(test => CI_SKIP_TESTS.includes(test.name));

    if (skipped.length > 0) {
      log(colors.yellow, 'CI', `Skipping ${skipped.length} test(s) in CI environment:`);
      skipped.forEach(test => {
        log(colors.yellow, 'SKIP', test.name);
      });
      console.log();
    }

    testsToRun = filtered;
  }

  if (testsToRun.length === 0) {
    log(colors.yellow, 'WARN', 'No tests to run');
    return;
  }

  log(colors.cyan, 'TEST', `Running ${testsToRun.length} test(s)...`);
  console.log();

  const results = [];

  for (const test of testsToRun) {
    log(colors.blue, 'RUN', `${test.name}`);
    const passed = await runTest(test.path);
    results.push({ name: test.name, passed });
    console.log();
  }

  // Summary
  log(colors.cyan, 'SUMMARY', '='.repeat(70));
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  results.forEach(r => {
    const color = r.passed ? colors.green : colors.red;
    const status = r.passed ? 'PASS' : 'FAIL';
    log(color, status, r.name);
  });

  log(colors.cyan, 'SUMMARY', '='.repeat(70));
  log(passed > 0 ? colors.green : colors.reset, 'RESULT', `${passed} passed, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  log(colors.red, 'ERROR', err.message);
  process.exit(1);
});
