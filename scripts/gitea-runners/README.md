# Gitea Actions runners (server-side)

Gitea Actions needs **act_runner** on a machine that can reach your Gitea instance. For LogicPad releases, runners belong on **your Gitea infrastructure** (the server that hosts git.erhancm.com), not on developer PCs.

## What the release workflow needs

[`.gitea/workflows/release.yml`](../../.gitea/workflows/release.yml) uses these `runs-on` labels:

| Label | Build | Where it must run |
|-------|--------|-------------------|
| `ubuntu-22.04` | Linux AppImage + deb | **Linux** (Gitea server is fine) |
| `windows-latest` | Windows NSIS + portable | **Windows** (VM or separate host) |
| `macos-latest` | macOS DMG | **Mac** (optional; job is `continue-on-error`) |

A single Linux Gitea host can run the **Linux** release job immediately. Windows (and macOS) need additional runners on those OSes—often small VMs on the same server/network, still registered to the same Gitea instance.

## Access Unraid (SSH)

SSH is **not** on port 22 publicly. Use Cloudflare Access via `cloudflared`:

```
Host unraid
    HostName ssh.erhancm.com
    User root
    IdentityFile ~/.ssh/id_ed25519_unraid
    IdentitiesOnly yes
    ProxyCommand cloudflared access ssh --hostname %h
```

Key lives at `C:\OrCAD_Data\.ssh\id_ed25519_unraid` (copy to `~/.ssh` with restricted ACLs if OpenSSH rejects permissions).

Then: `ssh unraid`

## Existing runner on Unraid

Docker container **`gitea-actions-runner`** (`gitea/act_runner:latest`) is already registered as **`unraid-runner`** against `http://192.168.1.227:3010` with labels:

- `ubuntu-latest` (Docker)
- `ubuntu-22.04` (Docker)
- `ubuntu-24.04` (Docker)

That covers **Linux** builds in `.gitea/workflows/release.yml`. **Windows** and **macOS** matrix jobs still need separate runners (or make those jobs optional / use manual `Publish-Gitea-Release.ps1` for Windows).

## Windows / macOS runners (optional)

Register separate act_runner installs on:

- A **Windows Server / VM** with label `windows-latest:host`
- A **Mac** with label `macos-latest:host`

Use the same internal Gitea URL if they are on the same LAN as Gitea, or the public URL with Cloudflare **Service Auth** bypass if they are remote.

Until those exist, only the Linux (and optionally Windows if you add it) matrix jobs will produce artifacts; macOS is already optional in the workflow.

## Manual publish (no CI)

To upload Windows builds from a dev machine without using Actions:

```powershell
$env:GITEA_TOKEN = "<personal access token>"
.\scripts\Publish-Gitea-Release.ps1 -Tag v0.1.0 -SkipBuild
```

## Files

| File | Purpose |
|------|---------|
| [`install-on-gitea-server.sh`](install-on-gitea-server.sh) | Linux runner on Gitea host |
| [`config.yaml`](config.yaml) | Default paths and labels |
