import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { spawn, execSync } from 'node:child_process';
import readline from 'node:readline';

const FLEXO_DIR = path.join(os.homedir(), '.flexo');
const BIN_DIR = path.join(FLEXO_DIR, 'bin');

export function getPlatformInfo() {
  const platform = os.platform(); // 'darwin', 'win32', 'linux'
  const arch = os.arch(); // 'x64', 'arm64'
  return { platform, arch };
}

export function findInstalledBinary() {
  const { platform } = getPlatformInfo();

  if (platform === 'darwin') {
    // Check Applications
    const systemApp = '/Applications/Flexo.app/Contents/MacOS/Flexo';
    const userApp = path.join(os.homedir(), 'Applications/Flexo.app/Contents/MacOS/Flexo');
    if (fs.existsSync(systemApp)) return systemApp;
    if (fs.existsSync(userApp)) return userApp;
  }

  if (platform === 'linux') {
    // 1. Check system PATH for package installations (/usr/bin/flexo, /usr/local/bin/flexo)
    const candidates = [
      'flexo',
      'Flexo',
      '/usr/bin/flexo',
      '/usr/local/bin/flexo',
      '/opt/Flexo/flexo',
      path.join(os.homedir(), '.local/bin/flexo'),
      path.join(os.homedir(), 'Applications/Flexo.AppImage')
    ];

    for (const candidate of candidates) {
      if (candidate.startsWith('/')) {
        if (fs.existsSync(candidate)) return candidate;
      } else {
        try {
          const resolved = execSync(`which ${candidate} 2>/dev/null`, { encoding: 'utf8' }).trim();
          if (resolved && fs.existsSync(resolved)) return resolved;
        } catch {
          // ignore which failure
        }
      }
    }
  }

  // Check ~/.flexo/bin/Flexo or Flexo.exe
  const binName = platform === 'win32' ? 'Flexo.exe' : 'Flexo';
  const cachedBin = path.join(BIN_DIR, binName);
  if (fs.existsSync(cachedBin)) return cachedBin;

  return null;
}

export async function launchGui(binaryPath) {
  const target = binaryPath || findInstalledBinary();
  if (!target) {
    console.log('\n\x1b[33mFlexo desktop app not found locally.\x1b[0m');
    console.log('You can download installers directly from:');
    console.log('\x1b[36mhttps://github.com/draigar/flexo/releases\x1b[0m\n');
    return false;
  }

  const { platform } = getPlatformInfo();
  console.log(`\x1b[32mLaunching Flexo GUI from:\x1b[0m ${target}`);

  if (platform === 'darwin' && target.includes('.app')) {
    const appBundle = target.split('.app')[0] + '.app';
    spawn('open', ['-a', appBundle], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn(target, [], { detached: true, stdio: 'ignore' }).unref();
  }

  return true;
}

export async function triggerDownload(url) {
  console.log(`\n\x1b[36mInitiating download for:\x1b[0m ${url}`);
  // Dispatch via flexo:// deep link scheme or CLI launcher
  const deepLink = `flexo://download?url=${encodeURIComponent(url)}`;
  const { platform } = getPlatformInfo();

  if (platform === 'darwin') {
    spawn('open', [deepLink], { detached: true, stdio: 'ignore' }).unref();
    console.log('\x1b[32mDispatched to Flexo via deep link.\x1b[0m');
  } else if (platform === 'win32') {
    spawn('cmd', ['/c', 'start', deepLink], { detached: true, stdio: 'ignore' }).unref();
    console.log('\x1b[32mDispatched to Flexo via deep link.\x1b[0m');
  } else {
    spawn('xdg-open', [deepLink], { detached: true, stdio: 'ignore' }).unref();
    console.log('\x1b[32mDispatched to Flexo via deep link.\x1b[0m');
  }
}

function prompt(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) =>
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans.trim());
    })
  );
}

export async function runInteractive() {
  console.log('\n\x1b[1m\x1b[35m=== ⚡ Flexo Multi-Connection Accelerator ===\x1b[0m\n');

  const binary = findInstalledBinary();
  if (binary) {
    console.log(`\x1b[90mInstalled desktop engine detected at: ${binary}\x1b[0m\n`);
  } else {
    console.log('\x1b[33mNote: Flexo Desktop is not installed in standard app paths.\x1b[0m\n');
  }

  console.log('1. Launch Flexo GUI App');
  console.log('2. Download URL');
  console.log('3. Open Releases / Download Installer');
  console.log('4. Exit\n');

  const choice = await prompt('Select an option (1-4): ');

  switch (choice) {
    case '1':
      await launchGui(binary);
      break;
    case '2': {
      const url = await prompt('\nEnter download URL: ');
      if (url) {
        await triggerDownload(url);
      } else {
        console.log('\x1b[31mNo URL provided.\x1b[0m');
      }
      break;
    }
    case '3': {
      const releasesUrl = 'https://github.com/draigar/flexo/releases';
      console.log(`\nOpening ${releasesUrl}...`);
      const { platform } = getPlatformInfo();
      if (platform === 'darwin') spawn('open', [releasesUrl]);
      else if (platform === 'win32') spawn('cmd', ['/c', 'start', releasesUrl]);
      else spawn('xdg-open', [releasesUrl]);
      break;
    }
    default:
      console.log('Goodbye!');
      break;
  }
}

export async function main() {
  const args = process.argv.slice(2);

  // If a URL or specific subcommand is passed directly: e.g. `npx flexo https://...` or `npx flexo download <url>`
  if (args.length > 0) {
    if (args[0] === 'gui' || args[0] === 'open') {
      await launchGui();
      return;
    }
    if (args[0] === 'download' && args[1]) {
      await triggerDownload(args[1]);
      return;
    }
    if (args[0].startsWith('http://') || args[0].startsWith('https://')) {
      await triggerDownload(args[0]);
      return;
    }
  }

  // If running in an interactive terminal, launch menu
  if (process.stdin.isTTY) {
    await runInteractive();
  } else {
    // Non-interactive fallback: launch GUI
    await launchGui();
  }
}
