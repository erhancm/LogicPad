# LogicPad Showcase Demo

Advertising-ready configuration: **five profiles**, rich macros, PC program launches, and a **complex auto-switch graph** (multi-app OR, AND + running, running-only, else-restore).

## Apply to your connected pad

From PowerShell:

```powershell
& "04 Software\logicpad-app\showcase\Apply-Showcase.ps1"
```

LogicPad restarts, detects the flag, writes the demo to USB flash, and opens the **Auto-switch** tab.

## Profiles

| Profile | Lights | Highlights |
|---------|--------|------------|
| **Create** | Wave / blue keys | Copy, paste, save, typed snippet, launch Cursor |
| **Stream** | Ripple / red | OBS scene hotkeys, media volume, mouse click, launch OBS |
| **Meet** | Solid / green | Mute, camera, share, leave, launch Teams |
| **Browse** | Breathe / white | Tabs, back/forward, reload, typed URL |
| **Play** | Rain / blue | Media transport, multi-step macro |

## Auto-switch graph

1. **Create** — foreground `Cursor.exe`, `Code.exe`, or `Figma.exe`
2. **Stream** — foreground `obs64.exe` **and** `Discord.exe` running
3. **Meet** — foreground `Teams.exe` or `Zoom.exe`
4. **Browse** — foreground Chrome, Edge, or Firefox
5. **Play** — `Spotify.exe` running anywhere
6. **Else** — restore previous profile

## Share as YAML

Import `LogicPad-Showcase.yaml` via **Import…** in LogicPad (includes full auto-switch graph).

Regenerate after editing `src/showcase.ts`:

```powershell
cd "04 Software\logicpad-app"
npx tsx showcase/export-yaml.ts
```
