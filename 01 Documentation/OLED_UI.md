# OLED UI

This document describes every screen, menu, and interaction on the LogicPad OLED display. The firmware source of truth is `03 Firmware/Firmware/Core/Src/ui.c`.

---

## Display Hardware

The display is a 0.96-inch SSD1306 with 128×64 pixels. It is a **dual-color** panel: the top portion is blue and the bottom 16 rows are yellow. The yellow strip is physically fixed at the bottom of the enclosure — it cannot be moved or resized in software.

| Band | Framebuffer rows | Typical use |
|------|------------------|-------------|
| Blue | 0–47 | Menus, values, key grids, main content |
| Yellow | 48–63 | Page titles, status indicators (`*` dirty flag, USB dot), short hints |

The default orientation (`SEG A0` + `COM C0`) keeps text upright relative to the physical keys. The **Screen → Flip** setting rotates the display 180° if the pad is mounted upside-down.

### Fonts

The yellow band uses the 6×8 pixel font (Font_6x8). The blue band uses a doubled 12×16 font for list rows — three rows of 16 pixels fill the entire 48-pixel blue area. The key-press toast also uses 12×16 glyphs: names of 10 characters or fewer appear on a single centered line; longer names (up to 12 characters) are split across two lines, breaking at a space if one exists, otherwise at the midpoint.

---

## Controls

### Live mode

In live mode (the normal operating state), pressing any of the nine pad keys (0–8) fires that key's macro sequence. Factory-fresh pads have no macros assigned. The **SEL** button below the grid has two functions:

- **Short press** opens the main menu.
- **Long press** (500 ms) returns to the home screen.

### Home screen

The home screen adapts based on USB and host state:

- **USB connected and PC session active:** the blue band shows a 3×3 grid of key labels (drawn from each key's title), and the yellow band shows the active profile name.
- **USB disconnected, suspended, or PC session locked/logged off:** the display switches to a standby clock showing `HH:MM:SS` and a date line (`16 Aug 2026` by default). The yellow band plays an animated band effect (see Screen settings below).

Until the host sends a `SET_TIME` command, the clock starts at 16 August 2026 00:00:00. After the first sync, the pad keeps time on its own STM32 RTC for as long as it has USB power. The companion app can also trigger a live clock preview on the home screen using the `PREVIEW_CLOCK` command, which temporarily overrides the normal display for 2.5 seconds.

### Sleep

When the sleep timeout expires (configurable, default 1 minute), the pad enters sleep mode. The display stays on showing the same idle home screen — it does not blank. A key press wakes the pad and the triggering key still performs its normal action: SEL opens the menu, pad keys fire their macros.

### Menu navigation

Menus use the nine-key grid as a d-pad. The four corner keys are unused except for `+` (key 2) and `−` (key 8) on the macro list screen.

```
[ ] [1 Up]   [2 +]
[3 L] [4 OK]   [5 R]
[ ] [7 Down] [8 −]
       [SEL Back / hold Home]
```

Navigation rules:

- **Key 1** moves up, **key 7** moves down, **key 3** moves left, **key 5** moves right. **Key 4** is OK / confirm.
- **SEL short press** goes Back (one level up), not Left.
- Lists do not wrap around — scrolling stops at the first and last items.
- At most three large rows are visible in the blue band at once. The highlight stays in the center row while the list scrolls around it.
- **Value screens** show the current value in the blue band (large text) with the setting name and navigation hint in the yellow band.
- **Save prompt:** pressing OK saves changes to flash; pressing SEL discards them.

### Adding macro actions

When editing a key's macro, pressing `+ Add` presents five action kinds:

- **Key** — a letter key (A–Z). After selecting a letter, choose Tap, Hold, or Release.
- **Sys** — a system key: Tab, Win, Alt, Ctrl, Shift, Esc, Enter, Space, or Backspace.
- **Mouse** — Button (left click), Move (10 px right), or Wheel (one tick up).
- **Wait** — a delay in 10 ms increments (50 ms to 250 ms).
- **Text** — plays the key's type-text string, which is edited in the companion app.

### Key picker

The key picker screen (under Keys) displays "Press a key". Pressing any of the nine pad keys selects that key for editing — the key literally picks itself.

---

## Screen Map

The firmware defines 37 screens. Their internal names are:

`boot`, `home`, `toast`, `menu`, `profList`, `profActs`, `profName`, `profReset`, `profDel`, `keyPick`, `keyEdit`, `keyName`, `keyLight`, `macroView`, `addKind`, `addLetter`, `addSend`, `addSys`, `addMouse`, `addWait`, `setup`, `lightsHub`, `lightMode`, `lightBright`, `lightDim`, `screenHub`, `scrContrast`, `scrFlip`, `scrSleep`, `clkStyle`, `clkSpeed`, `clkBar`, `about`, `saved`, `resetAll`, `sleeping`, `savePrompt`.

### Firmware update screens

When the host sends an `ENTER_BOOTLOADER` command, the app firmware draws **FLASH** in blue and **BOOT MODE** in yellow, then resets into the HID bootloader. The bootloader has its own separate screens — **BOOT** / **USB FLASH**, a progress bar, and finally **OK** or **FAIL**. These bootloader screens are part of `LogicPad_factory.hex` (flashed once via ST-Link) and are not included in the application `.bin`.

---

## Menu Structure

The main menu has three entries: **Profiles**, **Keys**, and **Setup**. Setup leads to three sub-menus: **Lights**, **Screen**, and **About**.

### Profiles

The profile list shows all stored profiles with the active one marked by `*`. If flash has room, a **+ New** entry appears at the end. Selecting a profile opens its action menu:

- **Use** — switches to this profile and returns home.
- **Rename** — opens a character-by-character name editor (A–Z, a–z, 0–9, space; up/down scrolls the current character).
- **Reset** — clears all key assignments for this profile (requires confirmation).
- **Delete** — removes the profile entirely (only available when more than one profile exists; requires confirmation, same as Reset).

Empty keys consume no flash space.

### Keys

Selecting **Keys** from the main menu enters the key picker. Pressing a pad key opens that key's edit screen with three options:

- **Name** — sets the 12-character display title shown on the home grid and toast.
- **Light** — sets the per-key LED color (Off, White, Red, Green, Blue).
- **Macro** — opens the action list for that key, where actions can be added, reordered, or deleted.

### Screen settings

The Screen sub-menu has six value screens, each showing one setting at a time:

| Setting | Values | Default |
|---------|--------|---------|
| Contrast | 0–10 (maps to hardware PWM) | 5 |
| Flip | Off / On (180° rotation) | Off |
| Sleep | Never, 15 s, 30 s, 1 min, 5 min | 1 min |
| Style | Bounce, Scan, March, Pulse, Wave, Blocks, Comet, Swing, Fill, Sparkle, Ripple, Rain, Off | Bounce |
| Speed | Slow (32 ms), Normal (16 ms), Fast (8 ms), Rapid (4 ms) | Normal |
| Bar | Off / On (seconds progress bar across the clock band) | On |

The Style, Speed, and Bar settings control the animated band in the yellow strip during the standby clock. The companion app can set all of these remotely via `SET_SCREEN` and preview the clock live with `PREVIEW_CLOCK`.

### Lights settings

The Lights sub-menu has three value screens:

- **Mode** — the LED animation pattern. Fifteen modes are available: Off, Solid, React, Breathe, Wave, Ring, Ripple, Rain, Heart, Cross, Twinkle, Full White, Full Red, Full Green, Full Blue.
- **Bright** — maximum LED intensity (0–10).
- **Dim** — idle LED intensity (0–10).

LED behavior notes:

- Animation shows paint their own colors — they do not require per-key LED assignments.
- **Full White / Full Red / Full Green / Full Blue** illuminate all nine keys plus the selector LED simultaneously without the usual 1/9 scan multiplexing. These modes stay at the Bright level and do not fall back to Dim.
- **React** flashes the pressed key's LED, even if the key has no macro assigned.
- **Ripple** spreads outward from the pressed key, including when SEL is pressed.
- The selector RGB LED sits above key 1 and participates in all animations. In Solid mode it matches key 1's color.
- The companion app's **Key LEDs** grid mirrors the same physical layout. With firmware minor version 7 or later, the app can read live LED colors via `GET_LEDS`.

### About

The About screen shows the USB connection status, a **Save** option (persists all changes to flash), and a **Reset** option (restores factory defaults and saves).

---

## Timing Reference

| Event | Duration |
|-------|----------|
| SEL long-press threshold | 500 ms |
| Key hold-repeat delay | 400 ms, then 12 repeats/sec |
| Boot splash | 900 ms |
| Key-press toast | 700 ms |
| Menu idle timeout | 15 s, 30 s (default), 60 s |
| Live sleep timeout | Never, 15 s, 30 s, 1 min (default), 5 min |
