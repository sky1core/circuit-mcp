#!/usr/bin/env node

/**
 * Test stdin close scenario - the REAL problem case
 * This simulates when the parent process (Claude Desktop) dies unexpectedly
 */

import { spawn } from 'child_process';
import { setTimeout } from 'timers/promises';
import { execSync } from 'child_process';
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

function getProcessChildren(pid) {
  try {
    const result = execSync(`pgrep -P ${pid}`, { encoding: 'utf8' });
    return result.trim().split('\n').filter(Boolean).map(Number);
  } catch (error) {
    return [];
  }
}

function getAllDescendants(pid) {
  const children = getProcessChildren(pid);
  let descendants = [...children];
  for (const childPid of children) {
    descendants = descendants.concat(getAllDescendants(childPid));
  }
  return descendants;
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return false;
  }
}

async function testStdinClose(testName) {
  log(colors.cyan, 'TEST', testName);

  let mcpProcess = null;
  let childProcesses = [];

  try {
    log(colors.yellow, 'STEP', 'Starting Electron MCP server...');

    // Use MCP_PATH env var to test different versions, default to current directory
    const mcpPath = process.env.MCP_PATH || './packages/electron/dist/esm/cli.js';
    log(colors.blue, 'INFO', `Using MCP: ${mcpPath}`);

    mcpProcess = spawn('node', [mcpPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    mcpProcess.stderr.on('data', (data) => {
      log(colors.magenta, 'MCP', data.toString().trim());
    });

    await setTimeout(2000);

    log(colors.green, 'SUCCESS', `MCP started with PID ${mcpProcess.pid}`);

    // Initialize
    const initReq = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0.0' }
      }
    };
    mcpProcess.stdin.write(JSON.stringify(initReq) + '\n');
    await setTimeout(1000);

    // Launch Electron app
    log(colors.yellow, 'STEP', 'Launching Electron app...');
    const launchReq = {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'app_launch',
        arguments: {
          app: path.join(__dirname, 'electron-app'),
          mode: 'development',
          timeout: 30000
        }
      }
    };
    mcpProcess.stdin.write(JSON.stringify(launchReq) + '\n');
    await setTimeout(6000);

    // Get child processes
    childProcesses = getAllDescendants(mcpProcess.pid);
    log(colors.blue, 'INFO', `Found ${childProcesses.length} child processes before stdin close`);

    // Verify Electron actually launched
    if (childProcesses.length === 0) {
      log(colors.red, 'ERROR', 'Electron app failed to launch - no child processes found');
      log(colors.red, 'ERROR', 'Cannot test orphan cleanup without running processes');
      return false;
    }

    // === THE KEY DIFFERENCE TEST ===
    log(colors.yellow, 'STEP', 'Closing stdin (simulating parent process death)...');
    log(colors.yellow, 'INFO', 'Before fix: MCP will say "keeping process alive"');
    log(colors.yellow, 'INFO', 'After fix: MCP will shutdown and cleanup');
    mcpProcess.stdin.end();

    // Wait for cleanup
    await setTimeout(4000);

    // Check orphans
    log(colors.yellow, 'STEP', 'Checking for orphaned processes...');
    const orphans = childProcesses.filter(pid => isProcessAlive(pid));

    if (orphans.length > 0) {
      log(colors.red, 'FAIL', `Found ${orphans.length} ORPHANED processes!`);
      log(colors.red, 'CAUSE', 'MCP did not shutdown when stdin closed');

      // Cleanup orphans
      for (const pid of orphans) {
        try {
          log(colors.yellow, 'CLEANUP', `Killing orphan PID ${pid}`);
          process.kill(pid, 'SIGKILL');
        } catch (e) {}
      }

      // Cleanup MCP if still alive
      if (isProcessAlive(mcpProcess.pid)) {
        log(colors.yellow, 'CLEANUP', `MCP still alive! PID ${mcpProcess.pid}`);
        process.kill(mcpProcess.pid, 'SIGKILL');
      }

      return false;
    } else {
      log(colors.green, 'PASS', 'No orphans! MCP cleaned up properly on stdin close');
      return true;
    }

  } catch (error) {
    log(colors.red, 'ERROR', error.message);
    return false;
  } finally {
    // Final cleanup
    if (mcpProcess && isProcessAlive(mcpProcess.pid)) {
      process.kill(mcpProcess.pid, 'SIGKILL');
    }
    for (const pid of childProcesses) {
      if (isProcessAlive(pid)) {
        try { process.kill(pid, 'SIGKILL'); } catch (e) {}
      }
    }
    try {
      const remaining = execSync('pgrep -f "test-electron-app"', { encoding: 'utf8' }).trim();
      if (remaining) {
        for (const pid of remaining.split('\n')) {
          try { process.kill(Number(pid), 'SIGKILL'); } catch (e) {}
        }
      }
    } catch (e) {}
  }
}

// Run test
log(colors.cyan, 'START', '='.repeat(70));
log(colors.cyan, 'START', 'STDIN CLOSE TEST - The Real Problem Scenario');
log(colors.cyan, 'START', '='.repeat(70));
log(colors.blue, 'INFO', 'This tests what happens when parent process dies unexpectedly');
log(colors.blue, 'INFO', '(e.g., Claude Desktop crash, IDE shutdown, etc.)');
log(colors.cyan, 'START', '='.repeat(70));

testStdinClose('Electron MCP - stdin close').then(passed => {
  log(colors.cyan, 'FINAL', '='.repeat(70));
  if (passed) {
    log(colors.green, 'RESULT', '✓ PASS - Cleanup works correctly');
    process.exit(0);
  } else {
    log(colors.red, 'RESULT', '✗ FAIL - Orphans detected (code needs the fix!)');
    process.exit(1);
  }
});
