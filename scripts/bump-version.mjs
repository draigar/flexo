#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = resolve(__dirname, '..')

const PACKAGE_JSON = resolve(ROOT_DIR, 'package.json')
const PACKAGE_LOCK = resolve(ROOT_DIR, 'package-lock.json')
const TAURI_CONF = resolve(ROOT_DIR, 'src-tauri/tauri.conf.json')
const TAURI_CARGO = resolve(ROOT_DIR, 'src-tauri/Cargo.toml')
const ENGINE_CARGO = resolve(ROOT_DIR, 'crates/flexo-engine/Cargo.toml')
const EXTENSION_MANIFEST = resolve(ROOT_DIR, 'extensions/browser/manifest.json')
const CHANGELOG = resolve(ROOT_DIR, 'CHANGELOG.md')

function run(cmd, opts = {}) {
  return execSync(cmd, { cwd: ROOT_DIR, stdio: 'inherit', ...opts })
}

function parseSemver(versionStr) {
  const match = versionStr.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/)
  if (!match) {
    throw new Error(`Invalid semver: ${versionStr}`)
  }
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    prerelease: match[4] || null
  }
}

function computeNextVersion(currentVersion, bumpType) {
  const parsed = parseSemver(currentVersion)
  switch (bumpType) {
    case 'major':
      return `${parsed.major + 1}.0.0`
    case 'minor':
      return `${parsed.major}.${parsed.minor + 1}.0`
    case 'patch':
      return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`
    default:
      if (/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(bumpType)) {
        return bumpType
      }
      throw new Error(
        `Unknown bump type or invalid version: ${bumpType}. Use patch, minor, major, or explicit X.Y.Z`
      )
  }
}

function updateJsonFile(filePath, updater) {
  const raw = readFileSync(filePath, 'utf-8')
  const data = JSON.parse(raw)
  updater(data)
  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8')
}

function updateCargoVersion(filePath, newVersion) {
  let content = readFileSync(filePath, 'utf-8')
  // Match version = "..." under [package]
  content = content.replace(/(\[package\][\s\S]*?\nversion\s*=\s*")([^"]+)(")/, `$1${newVersion}$3`)
  writeFileSync(filePath, content, 'utf-8')
}

function updateChangelog(newVersion) {
  if (!readFileSync(CHANGELOG, 'utf-8').includes(`## [${newVersion}]`)) {
    const today = new Date().toISOString().split('T')[0]
    const content = readFileSync(CHANGELOG, 'utf-8')
    const insertHeader = `## [${newVersion}] - ${today}\n\n### Changed\n- Maintenance and version bump to ${newVersion}.\n\n`

    // Insert right after the initial description/separator
    const delimiter = '---\n\n'
    if (content.includes(delimiter)) {
      const parts = content.split(delimiter)
      const updated = parts[0] + delimiter + insertHeader + parts.slice(1).join(delimiter)
      writeFileSync(CHANGELOG, updated, 'utf-8')
    }
  }
}

function main() {
  const bumpArg = process.argv[2] || 'patch'

  // Read current package.json version
  const pkg = JSON.parse(readFileSync(PACKAGE_JSON, 'utf-8'))
  const currentVersion = pkg.version
  const nextVersion = computeNextVersion(currentVersion, bumpArg)

  console.log(`\n🚀 Bumping Flexo version: ${currentVersion} -> ${nextVersion}\n`)

  // 1. Update package.json & package-lock.json
  console.log(`• Updating ${PACKAGE_JSON}...`)
  updateJsonFile(PACKAGE_JSON, (data) => {
    data.version = nextVersion
  })
  console.log(`• Updating ${PACKAGE_LOCK}...`)
  updateJsonFile(PACKAGE_LOCK, (data) => {
    data.version = nextVersion
    if (data.packages && data.packages['']) {
      data.packages[''].version = nextVersion
    }
  })

  // 2. Update src-tauri/tauri.conf.json
  console.log(`• Updating ${TAURI_CONF}...`)
  updateJsonFile(TAURI_CONF, (data) => {
    data.version = nextVersion
  })

  // 3. Update Cargo.toml files
  console.log(`• Updating ${TAURI_CARGO}...`)
  updateCargoVersion(TAURI_CARGO, nextVersion)

  console.log(`• Updating ${ENGINE_CARGO}...`)
  updateCargoVersion(ENGINE_CARGO, nextVersion)

  // 4. Update browser extension manifest
  console.log(`• Updating ${EXTENSION_MANIFEST}...`)
  updateJsonFile(EXTENSION_MANIFEST, (data) => {
    data.version = nextVersion
  })

  // 5. Run cargo check to update Cargo.lock
  console.log(`• Updating Cargo.lock with cargo check...`)
  try {
    run('cargo check --workspace --quiet')
  } catch (err) {
    console.warn('⚠️ cargo check completed with warnings or error:', err.message)
  }

  // 6. Update CHANGELOG.md if needed
  console.log(`• Checking ${CHANGELOG}...`)
  updateChangelog(nextVersion)

  // 7. Git commit & tag
  console.log(`\n📦 Staging and committing changes...`)
  run(
    'git add package.json package-lock.json src-tauri/tauri.conf.json src-tauri/Cargo.toml crates/flexo-engine/Cargo.toml Cargo.lock extensions/browser/manifest.json CHANGELOG.md README.md RELEASE_NOTES.md scripts/bump-version.mjs'
  )

  const commitMsg = `chore(release): v${nextVersion}`
  run(`git commit -m "${commitMsg}"`)

  const tagName = `v${nextVersion}`
  console.log(`🏷️ Creating annotated tag ${tagName}...`)
  run(`git tag -a ${tagName} -m "Release ${tagName}"`)

  console.log(`\n✅ Successfully released and tagged ${tagName}!`)
  console.log(`\nTo publish this release to GitHub, run:`)
  console.log(`  git push origin main && git push origin ${tagName}\n`)
}

main()
