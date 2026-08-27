---
name: logicpad-qa-loop
description: >-
  Drives the installed LogicPad Windows app in a use-test-fix loop: native
  window resize, Auto-switch graph, YAML pack Save as/Import, OS drag-drop onto
  keys, and firmware when HID/OLED/store needs it. Use when the user wants QA,
  UX iteration, interact with the PC program, Windows-MCP, templates, or a
  use-fix loop.
---

# LogicPad use–fix loop

Stay in the **local** Agent chat. Cloud Automations cannot see this PC’s USB pad or `LogicPad.exe`.

## Which tools

| Job | Use |
|-----|-----|
| Resize/move the LogicPad window, click, type, drag, screenshot, launch the exe | **windows-mcp** (enable in Cursor Settings → MCP if the tools are missing) |
| React-only layout in Vite | **cursor-ide-browser** on `http://localhost:1420` |
| OS file drop onto a key | **windows-mcp** on the installed exe — HTML5 drops in the browser never hit Tauri `onDragDropEvent` |
| Figma / Datadog | Not this loop |

Daily binary: `%LOCALAPPDATA%\LogicPad\LogicPad.exe`. Do not treat `npm run tauri dev` as the product.

Window chrome to hit: default **1280×840**, min **1080×700** (`tauri.conf.json`). Also maximize and one other legal size. Look for clipped tabs, key grid, Auto-switch canvas, and dialogs.

## Loop (default 3 cycles)

Stop after one clean pass or the cap.

1. Launch or focus LogicPad. If windows-mcp is connected, use it; do not click Cursor.
2. Exercise **all** of:
   - **Resize** (min, default, maximize, one extra size).
   - **YAML packs** (the templates): **Save as…** / **Import…**.
   - **Auto-switch**: add Foreground is / Running is, drag yellow ports through AND/OR into Set profile / Set lights / Restore. Empty-input Restore is ELSE and must not steal a matching Set profile. Window-picker thumbnails and Browse `.exe`.
   - **Drag-drop**: OS-drop a real `.exe` onto a key (app must be running; mapping is local JSON). Drag one pad key onto another to swap.
3. Note bugs and friction. Firmware changes **are allowed** when HID, OLED, or the flash store is the right fix.
4. Patch, then reinstall: close `LogicPad.exe`, `npm run build:app` in `04 Software/logicpad-app`, silent-install `LogicPad_0.1.0_x64-setup.exe /S`, reopen the Start-menu copy. If firmware changed, **Update firmware** with `LogicPad.bin`.
5. Re-test the broken flow plus neighbors that share that state.

Do not wait forever on `GetWindowText` / `PrintWindow`. Do not enumerate every window on the HID tick.

## Report

What you tried, window sizes, what you changed (app vs firmware), what you could not verify (physical keys, OLED feel).
