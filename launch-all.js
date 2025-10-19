#!/usr/bin/env node

const { spawn } = require('child_process');

const projectRoot = __dirname;
const serverUrl = process.env.TIME_AUCTION_URL || 'http://localhost:3000';

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

async function ensureDependencies() {
  console.log('Installing dependencies (npm install)...');
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  await runCommand(npmCmd, ['install'], { cwd: projectRoot });
}

function startServer() {
  console.log('Starting game server...');
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const child = spawn(npmCmd, ['start'], { cwd: projectRoot, stdio: 'inherit' });
  child.on('error', (err) => {
    console.error('Failed to start server:', err);
    process.exitCode = 1;
  });
  return child;
}

async function waitForServer(url, timeoutMs = 20000, intervalMs = 500) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const res = await fetch(url, { method: 'GET' });
      if (res.status < 500) {
        res.body?.cancel?.();
        return;
      }
    } catch (err) {
      // ignore until timeout
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out waiting for server at ${url}`);
}

async function openBrowser(url) {
  const platform = process.platform;
  let command;
  let args = [];

  if (platform === 'darwin') {
    command = 'open';
    args = [url];
  } else if (platform === 'win32') {
    command = 'cmd';
    args = ['/c', 'start', '', url];
  } else {
    command = 'xdg-open';
    args = [url];
  }

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'ignore', detached: true });
    child.on('error', reject);
    child.unref();
    resolve();
  });
}

async function main() {
  try {
    await ensureDependencies();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
    return;
  }

  const serverProcess = startServer();
  const serverExitPromise = new Promise((resolve, reject) => {
    serverProcess.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Server exited with code ${code}`));
    });
    serverProcess.once('error', reject);
  });

  try {
    await waitForServer(serverUrl);
    console.log(`Server is ready at ${serverUrl}. Launching browser...`);
    await openBrowser(serverUrl);
  } catch (err) {
    console.warn(`Could not automatically open browser: ${err.message}`);
    console.warn(`Please open ${serverUrl} manually.`);
  }

  try {
    await serverExitPromise;
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}

main();
