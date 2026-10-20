import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import https from 'node:https';
import { spawn, execSync } from 'node:child_process';
import readline from 'node:readline';

const REPO = 'draigar/flexo';
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
    // 1. Check ~/.flexo/Flexo.app or Applications
    const userFlexoApp = path.join(FLEXO_DIR, 'Flexo.app/Contents/MacOS/Flexo');
    if (fs.existsSync(userFlexoApp)) return userFlexoApp;

    const systemApp = '/Applications/Flexo.app/Contents/MacOS/Flexo';
    const userApp = path.join(os.homedir(), 'Applications/Flexo.app/Contents/MacOS/Flexo');
    if (fs.existsSync(systemApp)) return systemApp;
    if (fs.existsSync(userApp)) return userApp;
  }

  if (platform === 'linux') {
    // 1. Check ~/.flexo/bin/flexo
    const userBin = path.join(BIN_DIR, 'flexo');
    if (fs.existsSync(userBin)) return userBin;

    // 2. Check system PATH and standard AppImage locations
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

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(
      url,
      {
        headers: {
          'User-Agent': 'flexo-cli-installer',
          Accept: 'application/vnd.github.v3+json',
        },
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          fetchJson(res.headers.location).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
          return;
        }
        let body = '';
        res.on('data', (d) => (body += d));
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(e);
          }
        });
      }
    ).on('error', reject);
  });
}

function downloadFile(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    https.get(
      url,
      {
        headers: {
          'User-Agent': 'flexo-cli-installer',
          Accept: 'application/octet-stream',
        },
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          downloadFile(res.headers.location, destPath, onProgress).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Download failed: HTTP ${res.statusCode}`));
          return;
        }

        const total = parseInt(res.headers['content-length'] || '0', 10);
        let downloaded = 0;
        const fileStream = fs.createWriteStream(destPath);

        res.on('data', (chunk) => {
          downloaded += chunk.length;
          if (onProgress && total > 0) {
            onProgress(downloaded, total);
          }
        });

        res.pipe(fileStream);

        fileStream.on('finish', () => {
          fileStream.close(() => resolve(destPath));
        });

        fileStream.on('error', (err) => {
          fs.unlink(destPath, () => {});
          reject(err);
        });
      }
    ).on('error', (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

function renderProgressBar(downloaded, total) {
  const percent = Math.min(100, Math.floor((downloaded / total) * 100));
  const width = 28;
  const filled = Math.floor((width * percent) / 100);
  const bar = '█'.repeat(filled) + '░'.repeat(width - filled);
  const mbDownloaded = (downloaded / (1024 * 1024)).toFixed(1);
  const mbTotal = (total / (1024 * 1024)).toFixed(1);

  process.stdout.write(`\r  \x1b[36m[${bar}]\x1b[0m ${percent}% (${mbDownloaded}/${mbTotal} MB)`);
}

export async function installFlexo() {
  const { platform } = getPlatformInfo();
  console.log(`\n\x1b[1m\x1b[34m→ Fetching latest Flexo release from GitHub (${REPO})...\x1b[0m`);

  const release = await fetchJson(`https://api.github.com/repos/${REPO}/releases/latest`);
  const tag = release.tag_name || 'latest';
  console.log(`\x1b[32m✔ Found release ${tag}\x1b[0m\n`);

  fs.mkdirSync(BIN_DIR, { recursive: true });

  let asset = null;

  if (platform === 'darwin') {
    // Prefer universal tar.gz for frictionless extraction into ~/.flexo/Flexo.app
    asset = release.assets.find((a) => a.name.endsWith('.app.tar.gz')) ||
            release.assets.find((a) => a.name.endsWith('.dmg'));
  } else if (platform === 'win32') {
    asset = release.assets.find((a) => a.name.endsWith('-setup.exe') || a.name.endsWith('.exe'));
  } else {
    // Linux: AppImage runs out of the box on all distros (Fedora, Ubuntu, Arch, etc.)
    asset = release.assets.find((a) => a.name.endsWith('.AppImage'));
  }

  if (!asset) {
    throw new Error(`No matching release asset found for platform '${platform}' in ${tag}`);
  }

  console.log(`Downloading \x1b[33m${asset.name}\x1b[0m...`);
  const tmpFile = path.join(FLEXO_DIR, asset.name);

  await downloadFile(asset.browser_download_url, tmpFile, renderProgressBar);
  console.log('\n\x1b[32m✔ Download complete.\x1b[0m');

  console.log(`\x1b[34m→ Setting up Flexo on ${platform}...\x1b[0m`);

  if (platform === 'darwin') {
    if (asset.name.endsWith('.app.tar.gz')) {
      // Extract Flexo.app into ~/.flexo/
      execSync(`tar -xzf "${tmpFile}" -C "${FLEXO_DIR}"`);
      fs.unlinkSync(tmpFile);
      const appPath = path.join(FLEXO_DIR, 'Flexo.app/Contents/MacOS/Flexo');
      console.log(`\x1b[32m✔ Installed Flexo to:\x1b[0m ${path.join(FLEXO_DIR, 'Flexo.app')}\n`);
      return appPath;
    } else if (asset.name.endsWith('.dmg')) {
      // Mount dmg and copy to ~/.flexo/
      const mountPoint = path.join(os.tmpdir(), `flexo-dmg-${Date.now()}`);
      fs.mkdirSync(mountPoint, { recursive: true });
      execSync(`hdiutil attach "${tmpFile}" -mountpoint "${mountPoint}" -nobrowse -quiet`);
      const mountedApp = path.join(mountPoint, 'Flexo.app');
      if (fs.existsSync(mountedApp)) {
        execSync(`cp -R "${mountedApp}" "${FLEXO_DIR}/"`);
      }
      execSync(`hdiutil detach "${mountPoint}" -quiet`);
      fs.unlinkSync(tmpFile);
      const appPath = path.join(FLEXO_DIR, 'Flexo.app/Contents/MacOS/Flexo');
      console.log(`\x1b[32m✔ Installed Flexo to:\x1b[0m ${path.join(FLEXO_DIR, 'Flexo.app')}\n`);
      return appPath;
    }
  } else if (platform === 'linux') {
    // Make AppImage executable and save as ~/.flexo/bin/flexo
    const targetBin = path.join(BIN_DIR, 'flexo');
    fs.renameSync(tmpFile, targetBin);
    fs.chmodSync(targetBin, 0o755);
    console.log(`\x1b[32m✔ Installed standalone Flexo AppImage to:\x1b[0m ${targetBin}\n`);
    return targetBin;
  } else if (platform === 'win32') {
    // Run setup installer
    console.log('\x1b[33mRunning installer setup...\x1b[0m');
    spawn(tmpFile, [], { detached: true, stdio: 'ignore' }).unref();
    return tmpFile;
  }

  return findInstalledBinary();
}

export async function launchGui(binaryPath) {
  let target = binaryPath || findInstalledBinary();

  if (!target) {
    console.log('\n\x1b[33mFlexo desktop app not found locally.\x1b[0m');
    console.log('\x1b[36mInstalling Flexo automatically...\x1b[0m');
    try {
      target = await installFlexo();
    } catch (err) {
      console.error(`\x1b[31mAutomatic installation failed:\x1b[0m ${err.message}`);
      console.log('You can download installers directly from:');
      console.log('\x1b[36mhttps://github.com/draigar/flexo/releases\x1b[0m\n');
      return false;
    }
  }

  if (!target) return false;

  const { platform } = getPlatformInfo();
  console.log(`\x1b[32m🚀 Launching Flexo...\x1b[0m`);

  if (platform === 'darwin' && target.includes('.app')) {
    const appBundle = target.split('.app')[0] + '.app';
    spawn('open', ['-a', appBundle], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn(target, [], { detached: true, stdio: 'ignore' }).unref();
  }

  return true;
}

export async function triggerDownload(url) {
  // Ensure Flexo is installed before deep-linking
  const binary = findInstalledBinary();
  if (!binary) {
    console.log('\x1b[33mFlexo desktop app not found. Installing first...\x1b[0m');
    await installFlexo();
  }

  console.log(`\n\x1b[36mInitiating download for:\x1b[0m ${url}`);
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

  let binary = findInstalledBinary();
  if (binary) {
    console.log(`\x1b[90mInstalled desktop engine detected at: ${binary}\x1b[0m\n`);
  } else {
    console.log('\x1b[33mFlexo is not yet installed on this machine.\x1b[0m\n');
  }

  console.log('1. Launch Flexo (Auto-installs if missing)');
  console.log('2. Download URL');
  console.log('3. Re-install / Update Flexo Desktop Engine');
  console.log('4. Open GitHub Releases');
  console.log('5. Exit\n');

  const choice = await prompt('Select an option (1-5): ');

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
      try {
        const installed = await installFlexo();
        if (installed) {
          const launchNow = await prompt('Launch Flexo now? (y/N): ');
          if (launchNow.toLowerCase() === 'y') {
            await launchGui(installed);
          }
        }
      } catch (err) {
        console.error(`\x1b[31mInstallation failed:\x1b[0m ${err.message}`);
      }
      break;
    }
    case '4': {
      const releasesUrl = `https://github.com/${REPO}/releases`;
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

  // If `setup` or `install` is passed: `npx flexo setup` or `npx flexo install`
  if (args.includes('setup') || args.includes('install')) {
    await installFlexo();
    await launchGui();
    return;
  }

  // If a URL or specific subcommand is passed directly
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

  // Default behavior when running `npx flexo`:
  // If not installed, automatically install and launch!
  const binary = findInstalledBinary();
  if (!binary) {
    console.log('\n\x1b[1m\x1b[35m=== ⚡ Flexo Multi-Connection Accelerator Setup ===\x1b[0m');
    console.log('\x1b[33mNo local Flexo installation detected. Setting up now...\x1b[0m');
    try {
      const installed = await installFlexo();
      await launchGui(installed);
      return;
    } catch (err) {
      console.error(`\x1b[31mAutomatic installation failed:\x1b[0m ${err.message}`);
    }
  }

  // If installed and interactive terminal: launch menu or app
  if (process.stdin.isTTY) {
    await runInteractive();
  } else {
    await launchGui(binary);
  }
}

