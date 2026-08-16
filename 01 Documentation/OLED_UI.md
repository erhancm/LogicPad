# OLED UI

Firmware `ui.c` is the in-repo look-and-feel source of truth.

## Panel

0.96" SSD1306 128×64 **dual-color** glass. The yellow strip is **physically fixed at the bottom** of the enclosure (not movable in software).

| Band | Framebuffer rows | Use |
|------|------------------|-----|
| Blue | 0–47 | Menus, values, main content |
| Yellow | 48–63 | Titles, status (`*`, USB), short hints |

Default orientation (`SEG A0` + `COM C0`) keeps text upright relative to the keys. Screen → Flip adds an extra 180°.

Fonts: Font_6x8 in yellow; 12×16 (2×) list rows in blue (three rows × 16 px = full blue band).

## Controls

Live: keys 0–8 fire macros (factory: none assigned). SEL short = menu. SEL long = home.

Menus (d-pad; corners unused except +/− on the macro list):

```
[ ] [Up]   [+]
[L] [OK]   [R]
[ ] [Down] [-]
     [SEL Back / hold Home]
```

Key 1 up, key 7 down, key 3 left, key 5 right, key 4 OK. SEL short = Back (not Left). Lists do not wrap. At most three large rows in the blue band; highlight stays center while scrolling. Value screens: value in blue, title/hint in yellow. Save prompt: OK = save, SEL = discard.

Key picker: the nine keys select themselves.

## Screens

`boot`, `home`, `toast`, `menu`, `profList`, `profActs`, `profName`, `profReset`, `keyPick`, `keyEdit`, `keyName`, `keyLight`, `macroView`, `addKind`, `addLetter`, `addSend`, `addMouse`, `addWait`, `setup`, `lightsHub`, `lightMode`, `lightBright`, `lightDim`, `screenHub`, `scrContrast`, `scrFlip`, `scrSleep`, `about`, `saved`, `resetAll`, `sleeping`, `savePrompt`.

Main menu is Profiles / Keys / Setup. Setup is Lights / Screen / About. One setting per value screen.

## Timing

SEL long 500 ms. Hold-repeat 400 ms then 12 Hz. Boot 900 ms. Toast 700 ms. Menu idle default 30 s. Live sleep default 1 minute (first wake key is consumed).
