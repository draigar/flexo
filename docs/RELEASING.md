# Release & Versioning Guide

Flexo uses an automated multi-layer versioning and continuous release system. This ensures that every commit is uniquely versioned and traceable, while production releases are synchronized across both the Rust engine and the React/Tauri host.

---

## 1. Automated Release Pipeline

### A. Production Tagged Releases (`v*`)

Triggered automatically whenever a version tag (e.g., `v0.1.0`, `v0.2.0`) is pushed to GitHub, or dispatched manually via GitHub Actions.

- **Workflow**: `.github/workflows/release.yml`
- **Platforms Built**:
  - **macOS**: Universal binary (`.dmg`, `.app.tar.gz`) supporting both Apple Silicon (`aarch64`) and Intel (`x86_64`).
  - **Windows**: Windows installer (`.msi`, `setup.exe`).
  - **Linux**: Debian package (`.deb`) and standalone `.AppImage`.
- **Outputs**: Official GitHub Release containing the cross-platform binaries, release notes, and SHA256 checksums.

### B. Continuous Build & Release for Every Commit

Triggered automatically on every `push` to the `main` branch.

- **Workflow**: `.github/workflows/continuous-build.yml`
- **Output**: A rolling GitHub pre-release tagged `continuous` with newly packaged binaries for macOS, Windows, and Linux on every single commit.

---

## 2. One-Command Version Bumping (`scripts/bump-version.mjs`)

Flexo spans multiple packages that must remain synchronized:

1. `package.json`
2. `src-tauri/tauri.conf.json`
3. `src-tauri/Cargo.toml`
4. `crates/flexo-engine/Cargo.toml`

To bump versions across the entire codebase, run:

```bash
# Bump patch version (e.g. 0.1.0 -> 0.1.1)
npm run release:patch

# Bump minor version (e.g. 0.1.0 -> 0.2.0)
npm run release:minor

# Bump major version (e.g. 0.1.0 -> 1.0.0)
npm run release:major

# Or specify a custom version
npm run release 0.2.5
```

### What `npm run release:*` does:

1. Updates versions across `package.json`, `tauri.conf.json`, and all `Cargo.toml` files.
2. Runs `cargo check` to regenerate `Cargo.lock` with the matching version numbers.
3. Inserts a new section into `CHANGELOG.md`.
4. Stages modified files and creates a Git commit: `chore(release): vX.Y.Z`.
5. Creates an annotated Git tag: `vX.Y.Z`.
6. Prepares the tag for push (`git push origin main && git push origin vX.Y.Z`), which automatically triggers the GitHub Actions release workflow.

---

## 3. In-App Commit & Build Tracing

Every build embeds compile-time metadata into the client bundle:

- **`__APP_VERSION__`**: Current semantic version from `package.json`.
- **`__COMMIT_HASH__`**: Git commit SHA (e.g. `8eeb8ff`) captured at build time.
- **`__BUILD_TIME__`**: ISO date when the build was generated.

These values are visible inside the Flexo desktop application under **Settings → About**.
