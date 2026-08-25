# OLED UI

Firmware `ui.c` is the in-repo look-and-feel source of truth.

## Panel

0.96" SSD1306 128×64 **dual-color** glass. The yellow strip is **physically fixed at the bottom** of the enclosure (not movable in software).

| Band | Framebuffer rows | Use |
|------|------------------|-----|
| Blue | 0–47 | Menus, values, main content |
| Yellow | 48–63 | Titles, status (`*`, USB), short hints |

Default orientation (`SEG A0` + `COM C0`) keeps text upright relative to the keys. Screen → Flip adds an extra 180°.

Fonts: Font_6x8 in yellow; 12×16 (2×) list rows in blue (three rows × 16 px = full blue band). Key press toast uses the same 12×16 glyphs: one centered line for up to 10 characters, two lines for 11–12 (split on a space, else at the midpoint).

## Controls

Live: keys 0–8 fire macros (factory: none assigned). SEL short = menu. SEL long = home. Home is the clock: 24-hour `HH:MM:SS`, date `16 Aug 2026` until the PC app syncs once; after that the pad keeps time while it has power. Sleep timeout keeps that clock on (display stays on); the first wake key is consumed.

Menus (d-pad; corners unused except +/− on the macro list):

```
[ ] [Up]   [+]
[L] [OK]   [R]
[ ] [Down] [-]
     [SEL Back / hold Home]
```

Key 1 up, key 7 down, key 3 left, key 5 right, key 4 OK. SEL short = Back (not Left). Lists do not wrap. At most three large rows in the blue band; highlight stays center while scrolling. Value screens: value in blue, title/hint in yellow. Save prompt: OK = save, SEL = discard.

Add action kinds: Key, Sys, Mouse, Wait, Text. Sys is Tab / Win / Alt / Ctrl / Shift / Esc / Enter / Space / Bksp. Text plays the key’s pool string (edit the string in the PC app).

Key picker: the nine keys select themselves.

## Screens

`boot`, `home`, `toast`, `menu`, `profList`, `profActs`, `profName`, `profReset`, `profDel`, `keyPick`, `keyEdit`, `keyName`, `keyLight`, `macroView`, `addKind`, `addLetter`, `addSend`, `addSys`, `addMouse`, `addWait`, `setup`, `lightsHub`, `lightMode`, `lightBright`, `lightDim`, `screenHub`, `scrContrast`, `scrFlip`, `scrSleep`, `about`, `saved`, `resetAll`, `sleeping`, `savePrompt`.

In-app firmware update draws **FLASH** (blue) and **BOOT MODE** (yellow) then resets. The 4 KB HID bootloader has its own screens: **BOOT** / **USB FLASH**, a progress bar, then **OK** or **FAIL**. Those bootloader screens ship in `LogicPad_factory.hex` (ST-Link), not in the app `.bin`.

Main menu is Profiles / Keys / Setup. Setup is Lights / Screen / About. One setting per value screen.

Profiles: current list, then **+ New** if fewer than 4. Actions are Use / Rename / Reset, plus Delete when more than one profile remains (confirm like Reset).

Lights → Mode: Off, Solid, React, Breathe, Wave, Ring, Ripple, Rain, Heart, Cross, Twinkle, Full White, Full Red, Full Green, Full Blue. Shows paint their own colors (they do not need per-key LED assignments). **Full White / Full Red / Full Green / Full Blue** light all nine keys plus the selector LED with no 1/9 scan; they stay on Bright (do not fall back to Dim). **React** flashes the pressed key (empty macros still flash). **Ripple** spreads from the pressed key, including SEL. The selector RGB follows animations; in Solid it matches key 7 (the key above it). Bright caps show intensity. Ripple reacts to live key presses.

## Timing

SEL long 500 ms. Hold-repeat 400 ms then 12 Hz. Boot 900 ms. Toast 700 ms. Menu idle default 30 s. Live sleep default 1 minute (clock screensaver; first wake key is consumed).
