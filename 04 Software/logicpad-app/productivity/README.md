# Productivity profile pack

Example YAML setup: **Office**, **Files**, **Browse**, **CAD**, **Outlook**, **Teams**, and a **Media** fallback when no productivity app is focused.

## Apply to a connected pad

From PowerShell (LogicPad installed):

```powershell
& "04 Software\logicpad-app\productivity\Apply-Productivity.ps1"
```

LogicPad restarts, queues the setup, writes to USB flash when the pad connects, and opens the **Auto-switch** tab.

## Import manually

**Import…** in the companion app with `LogicPad-Productivity.yaml`.

## Regenerate after editing sources

```powershell
cd "04 Software/logicpad-app"
npx tsx productivity/export-yaml.ts
```

Profile and auto-switch definitions live in `src/productivity.ts` and `src/productivityGraph.ts`.
