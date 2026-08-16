# OLED UI

Pixel-true review mockup: `oled-ui-mockup.canvas.tsx` in the Cursor project canvases folder. Firmware `ui.c` implements the same screens.

Display: SSD1306 128×64, Font_6x8, 12×16 (2×) for list rows. Yellow-on-black look is the panel; framebuffer is 1-bit.

## Controls

Live: keys 0–8 fire macros. SEL short = menu. SEL long = home.

Menus:

```
[ ] [Up] [+]
[Back] [OK] [Right]
[ ] [Down] [-]
     [SEL Back / hold Home]
```

Left (key 3) = Back. Lists do not wrap. At most three large rows; highlight stays center while scrolling. Value screens: one value, Up/Down change, Left/SEL back.

Key picker: the nine keys select themselves.

## Screens

`boot`, `home`, `toast`, `menu`, `profList`, `profActs`, `profName`, `profReset`, `keyPick`, `keyEdit`, `keyName`, `keyLight`, `macroView`, `addKind`, `addLetter`, `addSend`, `addMouse`, `addWait`, `setup`, `lightsHub`, `lightMode`, `lightBright`, `lightDim`, `screenHub`, `scrContrast`, `scrFlip`, `scrSleep`, `about`, `saved`, `resetAll`, `sleeping`, `savePrompt`.

Main menu is Profiles / Keys / Setup. Setup is Lights / Screen / About. One setting per value screen.

## Timing

SEL long 500 ms. Hold-repeat 400 ms then 12 Hz. Boot 900 ms. Toast 700 ms. Menu idle default 30 s. Live sleep default 1 minute (first wake key is consumed).
