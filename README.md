# gitid — Git identity manager

[中文文档](./README.zh-CN.md)

Manage multiple git identities (`user.name` / `user.email` / `user.signingkey` / `commit.gpgsign` / `gpg.format` / extra keys) and apply one to **global** or **per-repo local** config — so a work email never lands on a personal repo. **CLI + Electron desktop** share one identity store.

The CLI is a zero-dependency Node (≥ 18) tool. Profiles live in `~/.config/gitid/config.json`. Git itself is the source of truth; there is no daemon and no hooks.

## Install

```bash
npm install -g ./cli        # registers both gitid and git-id (git id also works)
```

## Quick start

```bash
gitid import                                   # import the current global git identity
gitid add personal --name tony --email tony@me.dev
gitid add work     --name Ada --email ada@corp.com --signingkey KEY123 --gpgsign --format ssh

gitid use work                                 # switch the global identity
gitid use personal --local                     # local override for this repo only
gitid current                                  # effective identity and per-key source
gitid scan ~/Projects                          # audit identities under a tree
gitid scan ~/Projects --save                   # remember that tree as the default scan root
gitid scan ~/Projects --format csv --output report.csv
gitid import --scan ~/Projects                 # import unmatched (⚠) local identities
gitid use work --repos ~/a --repos ~/b         # apply locally to several repos
gitid audit --expect work                      # author histogram + mailmap suggestion
gitid doctor                                   # environment checks (no tokens, no auto-fix)
gitid remote mirror https://gitee.com/<user>/<repo>.git
```

## Commands

| Command | Purpose |
|---------|---------|
| `add <id> --name --email [--signingkey] [--gpgsign] [--format openpgp\|ssh\|x509] [--set k=v]` | Create/update a profile. Omit `--format` so the profile does not declare `gpg.format` (apply will unset it). |
| `list` | List identities (★ global ◆ local override) |
| `use <id> [--local] [--repos <path>…]` / `local <id>` | Apply an identity. Default is global; `--local` or `--repos` writes each repo’s local config with full overwrite. |
| `current` | Effective identity and the source of each key (local overrides global) |
| `unset [--local\|--global]` | Clear identity keys (default `--local`, including `gpg.format`) |
| `remove <id>` | Delete a profile (does not touch already-written git config) |
| `import [--as <id>] [--scan [dir]]` | Import the current global identity, or import ⚠ unmatched scan rows |
| `scan [dir] [--depth N] [--save] [--format json\|markdown\|csv]` | Audit repos (✓ ok / ✗ missing / ⚠ unknown / ◆ local / ⊕ push mirror). `--save` is shared with the desktop app. |
| `audit [repo] [--expect <id>]` | Aggregate authors; optional pollution vs an expected identity; print a mailmap suggestion (does **not** write `.mailmap`) |
| `doctor` | Read-only environment check: git version, credential helper, SSH vs insteadOf, insteadOf conflicts |
| `completion <bash\|zsh\|fish\|pwsh>` | Print a static completion script |
| `remote [list \| mirror <url> \| unmirror] [--remote <name>]` | Per-repo push mirrors via multiple `pushurl`s. Fetch and credentials (GCM/SSH) are untouched. |
| `credential [list \| login <host> \| set <host> <user> \| remove <host>]` | Credential pipe: tokens go stdin → git credential protocol → helper. gitid never stores or echoes them. Prefer `login` (GCM’s own window). |

Identities may carry `--insteadOf original=replacement` (repeatable) URL rewrites (mirrors, SSH aliases, HTTPS-with-username). They apply with `use` and are cleared when you switch away (ADR-016). `--account host=username` (repeatable) is a credential selector: GCM looks up that username; switching identities clears it too (ADR-017).

## Multiple accounts and push mirrors

**HTTPS + GCM** (the token stays in the keychain; gitid never holds it):

```bash
gitid credential login github.com            # GCM prompt (recommended)
gitid credential set github.com corp-ada     # or paste a PAT (hidden input)
gitid add work --name Ada --email ada@corp.com --account github.com=corp-ada
gitid use work                               # push uses corp-ada’s credential
```

**SSH** (keys belong to `~/.ssh/config` host aliases; gitid only writes rewrite rules):

```bash
gitid add work --name Ada --email ada@corp.com \
  --insteadOf git@github.com:=git@github.com-work:
```

Full help: `gitid help`.

## Design notes

- **Profiles and git config are separate.** “Current identity” is a stateless name+email match against the store, so the UI cannot drift from git (ADR-002). There is no “already applied” flag and no background switcher.
- **`use` is a full overwrite.** Switching to an identity without a signing key unsets `user.signingkey` / `commit.gpgsign` / `gpg.format`. extras, insteadOf rewrites and account selectors are cleared the same way (ADR-003/016/017).
- **Credentials are a pipe, not a vault.** Tokens travel stdin → git credential protocol → helper/keychain. They never land in `config.json`, logs, or IPC payloads. Profiles only store “which account to pick” (ADR-017).
- **Atomic writes.** The store is written via tmp+rename, mode 0600 (ADR-007).

See [docs/design-decisions.md](./docs/design-decisions.md), [docs/object-model.md](./docs/object-model.md), and [docs/architecture.md](./docs/architecture.md).

## Development

```bash
cd cli && npm test          # 29 sandbox e2e tests; isolated HOME, never touches real ~/.gitconfig
cd desktop && npm test      # core byte-identity + sandbox apply
cd desktop && npm run build:renderer
```

## Desktop (Electron + Vue 3 + Ant Design Vue)

The desktop app uses the same store (`~/.config/gitid/config.json`). CLI changes show up live (file watch + broadcast). The tray can switch the global identity without opening the window.

```bash
cd desktop
npm install
npm start          # production-shaped run
npm run dev        # vite HMR + electron
npm run package     # offline linux-arm64 AppImage + assembled deb → desktop/dist/
npm run dist:linux  # linux x64+arm64 × AppImage/deb/rpm
npm run package:win # Windows x64 + arm64 NSIS → desktop/dist/
```

Store path: Linux/macOS `~/.config/gitid/config.json` (XDG), Windows `%APPDATA%\gitid\config.json`. `$GITID_CONFIG` overrides it. Both shapes require `git` on PATH.

| Feature | Notes |
|---------|--------|
| Identities | Create/edit/delete (insteadOf + account selectors; optional `gpg.format`). One-click global switch with the same overwrite semantics as `gitid use`. |
| Repo audit | Scan a tree; see ok / missing / unknown, remotes, mirrors. Per-row inherit-global vs local identity. Multi-select: import unknowns, batch-apply (default “missing only”), export json/markdown/csv. Row **History** opens an author drawer + mailmap suggestion (read-only, no rewrite). |
| Credentials | GCM login, PAT save/overwrite/delete. Tokens never persist in the renderer. Layout unchanged; doctor lives in the header. |
| Header | Language zh/en (saved as `settings.locale`), environment doctor modal (re-run / close, no auto-fix, no tokens), update banner from GitHub Releases. Dark mode still follows the OS. |
| Tray | List all identities; click to switch global. The tray stays after the window is closed. |

Architecture: `desktop/main/` (window / tray / IPC / watchers) + `desktop/renderer/` (Vue 3 + AntD 4). Business logic lives only in `cli/lib/core.js` and is copied at build time (`scripts/sync-core.mjs`). Auto-update uses electron-updater against GitHub Releases and is **not** part of core. Unpackaged / offline checks return `{updateAvailable:false}` instead of a product error.

## Release pipeline

Tag a version and push to both remotes:

```bash
git tag v0.1.0 && git push github v0.1.0 && git push origin v0.1.0
```

- **GitHub Actions** (`.github/workflows/release.yml`): sandbox tests (CLI e2e + desktop, including xvfb) → **linux x64/arm64 × AppImage/deb/rpm** and a **combined win x64/arm64 NSIS** → GitHub Release with artifacts (including `latest*.yml` for auto-update).
- **Gitee**: code and tags only (no Release mirror). Optional Gitee Go pipeline (`.workflow/release.yml`).
- **CI** (`.github/workflows/ci.yml`): sandbox tests on ubuntu and windows.

## Repository layout

| What | Where |
|------|--------|
| CLI | `cli/` (`bin/` + shared `lib/core.js` + tests) |
| Desktop | `desktop/` (`main/` + Vue renderer + `scripts/`) |
| Design docs | `docs/` (ADR-001–017 / object model / architecture) |
| CI/CD | `.github/workflows/` + `.workflow/` (Gitee Go) |

## License

[MIT](./LICENSE) © Xinyi Zhang
