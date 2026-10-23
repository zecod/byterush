# Releasing Byterush

A release is a `vX.Y.Z` tag. Pushing it runs [`.github/workflows/release.yml`](../.github/workflows/release.yml),
which builds the installers for every platform, attaches them to a GitHub release together with
the browser extension and checksums, and publishes the release once everything is there. The
landing page then offers the new files without being redeployed.

The app, the engine and the browser extension share one version number, written in six places:
`package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`,
`src-tauri/tauri.conf.json` and `extension/manifest.json`. `scripts/version.mjs` keeps them in step,
and CI fails if they ever disagree. Versions are plain `X.Y.Z`: Chrome doesn't accept pre-release
suffixes in an extension version, and Windows Installer allows at most `255.255.65535`.

## Cutting a release

1. Start from an up-to-date `main` whose CI is green.

   ```bash
   git switch main
   git pull
   ```

2. Set the new version everywhere.

   ```bash
   npm run version:set -- 0.3.0      # same as: node scripts/version.mjs 0.3.0
   ```

3. Update [`CHANGELOG.md`](../CHANGELOG.md):
   - move the entries from `## [Unreleased]` into a new `## [0.3.0] - YYYY-MM-DD` section below it
     (today's date), and leave `## [Unreleased]` empty;
   - update the links at the bottom: `[Unreleased]` compares `v0.3.0...HEAD`, and a new `[0.3.0]`
     line compares the previous tag with `v0.3.0`.

   The release notes are this section, word for word. Preview them with:

   ```bash
   npm run version:check
   node scripts/release-notes.mjs 0.3.0
   ```

4. Commit, push and wait for CI to pass on that commit.

   ```bash
   git commit -am "Release 0.3.0"
   git push origin main
   ```

5. Tag that commit and push the tag.

   ```bash
   git tag -a v0.3.0 -m "Byterush 0.3.0"
   git push origin v0.3.0
   ```

6. Follow the run under *Actions → Release*. It takes about half an hour, most of it the
   optimized Rust builds. When it's done, check the
   [release page](https://github.com/zecod/byterush/releases/latest) and the
   [landing page](https://zecod.github.io/byterush/).

## What the workflow does

1. **prepare**: checks that the tag is `vX.Y.Z` and that all six files carry exactly that version,
   takes the `## [X.Y.Z]` section of `CHANGELOG.md` as the release notes (no section, no
   release), and creates a **draft** release for the tag. A draft that already exists for the tag
   is reused; a tag that is already published stops the run.
2. **build**, in parallel, with [tauri-action](https://github.com/tauri-apps/tauri-action), each
   uploading its files to the draft:

   | Runner | Files |
   | --- | --- |
   | `windows-latest` | `Byterush_X.Y.Z_x64-setup.exe` (NSIS), `Byterush_X.Y.Z_x64_en-US.msi` |
   | `macos-latest`, `aarch64-apple-darwin` | `Byterush_X.Y.Z_aarch64.dmg`, `Byterush_X.Y.Z_aarch64.app.tar.gz` |
   | `macos-latest`, `x86_64-apple-darwin` | `Byterush_X.Y.Z_x64.dmg`, `Byterush_X.Y.Z_x64.app.tar.gz` |
   | `ubuntu-22.04` | `Byterush_X.Y.Z_amd64.AppImage`, `Byterush_X.Y.Z_amd64.deb`, `Byterush-X.Y.Z-1.x86_64.rpm` |
   | `ubuntu-22.04-arm` | `Byterush_X.Y.Z_aarch64.AppImage`, `Byterush_X.Y.Z_arm64.deb`, `Byterush-X.Y.Z-1.aarch64.rpm` |

   The Linux builds run on Ubuntu 22.04 so the packages work with glibc 2.35 and newer.
3. **publish**, only if every build succeeded: zips `extension/` into
   `byterush-extension-X.Y.Z.zip` (reproducibly: same commit, same bytes), downloads every file of
   the draft, checks that all the installers above are there, uploads `SHA256SUMS.txt` covering all
   of them, sets the release notes and publishes the release as the latest one.

If any build fails, nothing is published: the draft keeps whatever was uploaded, and nobody but
the maintainers can see it.

### Reviewing a release before it goes out

Set the repository variable `RELEASE_DRAFT_ONLY` to `true` (*Settings → Secrets and variables →
Actions → Variables*) and the workflow stops after the publish job has added the extension and
the checksums, leaving a complete draft. Download and try the files, then publish:

```bash
gh release edit v0.3.0 --draft=false --latest
```

Delete the variable (or set it to `false`) to go back to automatic publishing.

## When something goes wrong

- **A build failed for a flaky reason** (network, runner): open the run and use *Re-run failed
  jobs*. The draft is reused, files with the same name are replaced, and the release is published
  once everything has succeeded.
- **The workflow itself was broken**: fix it on `main`, then run *Actions → Release → Run workflow*
  with the tag (for example `v0.3.0`) as input. The fixed workflow from `main` builds the code of
  the tag and reuses the draft.
- **The code at the tag is broken**: delete the draft release and the tag, fix the code, and tag
  again:

  ```bash
  gh release delete v0.3.0 --yes          # the draft
  git push origin :refs/tags/v0.3.0       # the remote tag
  git tag -d v0.3.0                       # the local tag
  ```

- **A version was published with a problem**: don't replace its files or move its tag; people may
  already have downloaded them. Fix it and release the next patch version (`0.3.1`).
- **"versions differ"** in the prepare job: the tag doesn't match the files. Run
  `npm run version:set -- X.Y.Z`, commit, and tag the new commit.
- **"no ## [X.Y.Z] section"**: add the section to `CHANGELOG.md`, commit, and tag the new commit.

## Code signing

The pipeline works without any secrets. Then:

- **macOS** builds are ad-hoc signed (Apple Silicon refuses to run apps without any signature) but
  not notarized, so on first launch macOS says it can't verify the developer: users open
  *System Settings → Privacy & Security* and click *Open Anyway*.
- **Windows** installers are unsigned, so SmartScreen shows "Windows protected your PC" until
  users click *More info → Run anyway*.
- **Linux** packages aren't signed; users can check them against `SHA256SUMS.txt`.

Signing is switched on by adding repository secrets (*Settings → Secrets and variables → Actions
→ New repository secret*). Each platform's signing is used only when its secrets are present.

### macOS: signing and notarization

You need an Apple Developer Program membership and a *Developer ID Application* certificate.

| Secret | Value |
| --- | --- |
| `APPLE_CERTIFICATE` | the certificate and its private key exported from Keychain Access as `.p12`, base64-encoded: `openssl base64 -A -in certificate.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | the password chosen when exporting the `.p12` |
| `APPLE_SIGNING_IDENTITY` | optional, e.g. `Developer ID Application: Alterbit (TEAMID1234)`; taken from the certificate when not set |
| `APPLE_ID` | the Apple ID email used for notarization |
| `APPLE_PASSWORD` | an [app-specific password](https://support.apple.com/en-us/102654) for that Apple ID |
| `APPLE_TEAM_ID` | the 10-character team ID from the [membership page](https://developer.apple.com/account) |

With only the first two (or three), the app is signed but not notarized, and the run shows a
warning. With all six, Tauri signs, notarizes and staples the app. See Tauri's
[macOS signing guide](https://v2.tauri.app/distribute/sign/macos/).

### Windows: Authenticode signing

| Secret | Value |
| --- | --- |
| `WINDOWS_CERTIFICATE` | the code signing certificate with its private key as `.pfx`, base64-encoded: `openssl base64 -A -in certificate.pfx` (or `[Convert]::ToBase64String([IO.File]::ReadAllBytes("certificate.pfx"))` in PowerShell) |
| `WINDOWS_CERTIFICATE_PASSWORD` | the `.pfx` password |

The workflow imports the certificate on the runner and tells Tauri to sign the app and both
installers with it (SHA-256, timestamped by `http://timestamp.digicert.com`). Certificates issued
since mid-2023 usually live on a hardware token or in a cloud HSM and can't be exported as a
`.pfx`; for those (for example Azure Trusted Signing) set
[`bundle.windows.signCommand`](https://v2.tauri.app/distribute/sign/windows/) in a
`src-tauri/tauri.windows.conf.json` instead and add that service's credentials to the workflow.

## Platforms that aren't built yet

- **Windows on Arm**: a commented-out entry in the build matrix of `release.yml` builds an arm64
  NSIS installer (`Byterush_X.Y.Z_arm64-setup.exe`; WiX can't make arm64 `.msi` packages). It has
  never been built, so try it on a throwaway tag in a fork before enabling it, and add its file
  name to the list the publish job checks.

## How the landing page picks up a release

The landing page (`landing/`, deployed to GitHub Pages by `.github/workflows/pages.yml`) asks the
GitHub API for the [latest release](https://api.github.com/repos/zecod/byterush/releases/latest)
in the visitor's browser and links each download button straight to the matching file. It
recognizes files by tauri-action's default names (`Byterush_0.3.0_x64-setup.exe`,
`Byterush_0.3.0_aarch64.dmg`, `Byterush-0.3.0-1.x86_64.rpm`, …), which is why the publish job
insists on them: changing `productName`, the bundle targets or tauri-action's
`releaseAssetNamePattern` means updating `landing/main.js` too.

Drafts are invisible to that API, so the site switches to a new version the moment the release
is published, with no redeploy. Browsers cache the answer for up to an hour per session; while the
API can't be reached, the buttons point to the releases page.
