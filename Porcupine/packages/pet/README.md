# @porcupineai/pet

An optional desktop pet for macOS that reports live Porcupine session status in a pixel
think box. Driven by the built-in `pet` extension in `packages/coding-agent`; nothing here
runs on its own.

```
/pet start        install and build if needed, then put it on screen
/pet quit         stop it
```

Default species is the **porcupine**. The macaw is selectable from the pet's right-click menu.

## Layout

```
src/main.swift        the app: window, motion, behaviours, species
src/thinkbox.swift     the pixel font and the think box drawing
src/pet-status.py      builds the box's rows from Porcupine's session files
resources/pet/<species>/   clips: NN frames + clip.json (anchor, size, frame count)
scripts/check-art.mjs  validates the art without a GUI (CI-safe)
build.sh               builds build/Pet.app
```

Each clip folder holds frames (`w-NN.png` for the walkers, `r-NN.png` for the macaw's perch
clips) and a `clip.json` the app uses for placement and scaling. A clip is scaled so its body
width (walkers) or bird height (macaw) maps to a target in points, so changing the art
resolution does not change the drawn size.

## Building and checking by hand

```
sh ./build.sh                 # -> build/Pet.app
node scripts/check-art.mjs    # validates clip metadata, frame counts and canvas sizes
open -g ./build/Pet.app
```

Needs Xcode Command Line Tools for `swiftc`. The app resolves its art from
`PORCUPINE_PET_HOME`, else the folder holding the app bundle, else `~/wallpaper-lab/pet`.

## Known limits of the shipped art

The porcupine's walk has no foot lift in any source frame, so it waddles rather than steps.
The macaw's tail is cropped by its source tiles in 16 of its 21 sheets. One sheet per species
contains a prop the generator left blank, so those sheets are excluded.
