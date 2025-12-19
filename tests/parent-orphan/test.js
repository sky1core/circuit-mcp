#!/usr/bin/env node

/**
 * Test parent orphan scenario - npm exec wrapper case
 *
 * Simulates:
 *   claude (dies) -> wrapper (becomes orphan, ppid=1) -> circuit-mcp (should detect and exit)
 *
 * This tests the isParentOrphaned() check which runs every 10 seconds.
 */

import { spawn, execSync } from 'child_process';
import { setTimeout } from 'timers/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

function log(color, prefix, message) {
  console.log(`${color}[${prefix}]${colors.reset} ${message}`);
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return false;
  }
}

function getParentPid(pid) {
  try {
    const result = execSync(`ps -o ppid= -p ${pid}`, { encoding: 'utf8' });
    return parseInt(result.trim(), 10);
  } catch {
    return -1;
  }
}

async function testParentOrphan() {
  log(colors.cyan, 'TEST', 'Parent Orphan Detection (npm exec wrapper scenario)');

  let wrapperProcess = null;
  let mcpPid = null;

  try {
    log(colors.yellow, 'STEP', 'Starting wrapper process (simulates npm exec)...');

    const mcpPath = path.join(__dirname, '../../packages/web/dist/cli.mjs');

    // Create a wrapper that spawns MCP and keeps running
    // This simulates: npm exec -> node circuit-mcp
    const wrapperScript = `
      const { spawn } = require('child_process');
      const mcpPath = '${mcpPath.replace(/\\/g, '\\\\')}';
      const mcp = spawn('node', [mcpPath], {
        stdio: ['pipe', 'inherit', 'inherit'],
      });

      // Print MCP PID so parent can track it
      console.log('MCP_PID:' + mcp.pid);

      // Keep stdin open by piping to MCP
      process.stdin.pipe(mcp.stdin);

      // Keep wrapper alive
      setInterval(() => {}, 1000);

      // Exit immediately on SIGTERM (simulate abrupt death, don't cleanup child)
      process.on('SIGTERM', () => process.exit(0));
    `;

    wrapperProcess = spawn('node', ['-e', wrapperScript], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Capture MCP PID from wrapper output
    const mcpPidPromise = new Promise((resolve) => {
      wrapperProcess.stdout.on('data', (data) => {
        const match = data.toString().match(/MCP_PID:(\d+)/);
        if (match) {
          resolve(parseInt(match[1], 10));
        }
      });
    });

    wrapperProcess.stderr.on('data', (data) => {
      log(colors.magenta, 'MCP', data.toString().trim());
    });

    // Wait for MCP to start
    mcpPid = await Promise.race([
      mcpPidPromise,
      setTimeout(10000).then(() => null),
    ]);

    if (!mcpPid) {
      log(colors.red, 'ERROR', 'Failed to get MCP PID');
      return false;
    }

    log(colors.green, 'SUCCESS', `Wrapper PID: ${wrapperProcess.pid}, MCP PID: ${mcpPid}`);

    // Wait for MCP to initialize
    await setTimeout(3000);

    // Verify process hierarchy
    const wrapperPpid = getParentPid(wrapperProcess.pid);
    const mcpPpid = getParentPid(mcpPid);

    log(colors.blue, 'INFO', `Process hierarchy:`);
    log(colors.blue, 'INFO', `  This test (PID ${process.pid})`);
    log(colors.blue, 'INFO', `    -> Wrapper (PID ${wrapperProcess.pid}, ppid=${wrapperPpid})`);
    log(colors.blue, 'INFO', `         -> MCP (PID ${mcpPid}, ppid=${mcpPpid})`);

    // Kill wrapper (simulates claude/parent dying)
    log(colors.yellow, 'STEP', 'Killing wrapper process (simulates parent death)...');
    process.kill(wrapperProcess.pid, 'SIGKILL');

    await setTimeout(1000);

    // Verify wrapper is dead and MCP's parent is now orphaned
    if (isProcessAlive(wrapperProcess.pid)) {
      log(colors.red, 'ERROR', 'Wrapper still alive!');
      return false;
    }

    const newWrapperPpid = getParentPid(mcpPid);
    log(colors.blue, 'INFO', `After wrapper death:`);
    log(colors.blue, 'INFO', `  MCP (PID ${mcpPid}) ppid is now ${newWrapperPpid}`);

    if (newWrapperPpid !== 1) {
      log(colors.yellow, 'WARN', `Expected MCP ppid to be 1 (orphaned), got ${newWrapperPpid}`);
      // This is OK - on some systems the grandparent adopts, not init
    }

    // Wait for isParentOrphaned check (runs every 10 seconds)
    log(colors.yellow, 'STEP', 'Waiting for orphan detection (up to 15 seconds)...');
    log(colors.blue, 'INFO', 'isParentOrphaned() checks every 10 seconds');

    const startTime = Date.now();
    const maxWait = 15000;

    while (Date.now() - startTime < maxWait) {
      if (!isProcessAlive(mcpPid)) {
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        log(colors.green, 'PASS', `MCP exited after ${elapsed}s - orphan detection worked!`);
        return true;
      }
      await setTimeout(500);
    }

    // MCP didn't exit
    log(colors.red, 'FAIL', `MCP (PID ${mcpPid}) still alive after ${maxWait/1000}s`);
    log(colors.red, 'CAUSE', 'isParentOrphaned() did not detect orphaned parent');

    // Cleanup
    if (isProcessAlive(mcpPid)) {
      process.kill(mcpPid, 'SIGKILL');
    }

    return false;

  } catch (error) {
    log(colors.red, 'ERROR', error.message);
    return false;
  } finally {
    // Final cleanup
    if (wrapperProcess && isProcessAlive(wrapperProcess.pid)) {
      try { process.kill(wrapperProcess.pid, 'SIGKILL'); } catch (e) {}
    }
    if (mcpPid && isProcessAlive(mcpPid)) {
      try { process.kill(mcpPid, 'SIGKILL'); } catch (e) {}
    }
  }
}

// Run test
log(colors.cyan, 'START', '='.repeat(70));
log(colors.cyan, 'START', 'PARENT ORPHAN TEST - npm exec wrapper scenario');
log(colors.cyan, 'START', '='.repeat(70));
log(colors.blue, 'INFO', 'This tests detection when parent process becomes orphan (ppid=1)');
log(colors.blue, 'INFO', 'Scenario: claude -> npm exec -> circuit-mcp, then claude dies');
log(colors.cyan, 'START', '='.repeat(70));

testParentOrphan().then(passed => {
  log(colors.cyan, 'FINAL', '='.repeat(70));
  if (passed) {
    log(colors.green, 'RESULT', 'PASS - Orphan parent detection works');
    process.exit(0);
  } else {
    log(colors.red, 'RESULT', 'FAIL - Orphan parent not detected');
    process.exit(1);
  }
});
