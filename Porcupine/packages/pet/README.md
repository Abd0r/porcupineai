# Porcupine Pet

A small desktop pet for macOS that lives on the screen and shows what Porcupine is doing.

Three species, picked from the pet's right-click menu and remembered in `species.txt`:

| Species | Behaviour |
|---|---|
| **porcupine** (default) | Walks the bottom of the screen, curls up when startled, eats from its bowl |
| hedgehog | Walks, sits for a while, opens its think box on click |
| macaw | Flies, perches on a plank it materialises, eats, takes off |

Click it and it opens a **think box**: a pixel bubble showing live session state, `STATUS`,
the model and provider, `MODE` (Ask/Normal/Auto), `THINKING`, how many sub-agents are
running, the literal last prompt you wrote, and what the agent is doing right now. It stays
for five seconds and folds away. Drag it to move it, right-click for the menu.

## Running it

```
open -g ~/wallpaper-lab/pet/Pet.app      # -g so it does not steal focus
```

Stop it with `pkill -f "Pet.app/Contents/MacOS/Pet"`, or right-click → Quit. To rebuild
after a source change:

```
cd ~/wallpaper-lab/pet
export TMPDIR=$HOME/wallpaper-lab/tmp
swiftc -O -module-cache-path $HOME/wallpaper-lab/mcache -o Pet.app/Contents/MacOS/Pet main.swift thinkbox.swift
pkill -f "Pet.app/Contents/MacOS/Pet" ; open -g Pet.app
```

The pet is an ordinary app: it has no daemon, no network access, and nothing runs when it
is not launched.

## Driving it from Porcupine

Either call the tools from a session (`pet_say`, `pet_rest`, `pet_curl`, `pet_freeze`,
`pet_status`) or use the command:

```
/pet status | say | rest | curl | freeze | unfreeze
```

Under the hood those write small files in this directory, which the app polls every 0.4
seconds. You can do the same thing by hand:

| File | Effect |
|---|---|
| `speak-request` | Opens the think box for five seconds |
| `rest-request` | Porcupine/hog: a snack or a sit. Macaw: a full perch visit |
| `curl-request` | Startled: the porcupine curls up, the macaw ruffles |
| `motion-freeze` | Parks the pet where it is until the file is removed |

A request file is consumed within half a second, so its absence after a test means it
worked, not that nothing happened.

## If it looks broken

Three states look like a bug and are not:

1. **"Sit on the desktop"** (right-click menu) puts the pet *behind* normal windows. It is
   still there; choose "Always on top" to bring it back.
2. **A screenshot shows the frontmost window**, not the pet. To capture the pet itself, use
   its window id: `screencapture -x -o -l <winid>`, with `winid` from `./windowlist`.
3. **`ps` shows nothing for other processes from an agent shell**, so "not in ps" is not
   evidence of death. `pgrep -f Pet.app` and `kill -0 <pid>` answer that question.

Ground truth for the think box: the app appends to `pet-speak.log` whenever it sees a
channel, opens the box, or folds it. The pet also writes `pet-screen.txt` (geometry it
detected) and `pet-badge.txt` (the Dock badge it is setting) at launch.

## How the art works

Frames are cut from 4x2 magenta sheets (`#FF00FF`) by:

- `build-clip.py` for the macaw: keys the magenta, anchors on the plank's bottom edge so
  the perch never moves, writes `clip.json` next to the frames.
- `build-walker.py` for the ground walkers: anchors on the feet, normalises the sprite's
  body width, and puts every frame of a clip on **one shared canvas** (per-frame canvases
  break animation: the app draws each frame into a single rect, so taller frames get
  squashed).
- `shape-register.py`, `fix-size.py`, `cleanup.py`: re-register clips by shape, normalise
  the drawn size, and remove stray fragments the generator left behind.

Every clip directory has a `clip.json` describing its anchor, frame count, size, and how
big the animal is, so the app can place and scale it without guessing.

Known limits of the current art, all from the source sheets rather than the processing:
the macaw's tail is cropped at the bottom of 16 of its 21 sheets, and the porcupine's script
sheet 10_24_15-6/7 contain a prop that the generator rendered as a blank grey slab (the
animal touches it, so it cannot be separated and those sheets are excluded). The porcupine
WALK comes from one sheet that genuinely articulates its legs (sheet-10_23_57-3); the other
porcupine sheets are near-identical standing poses and drive the idle. There is no foot
LIFT anywhere in the porcupine art -- the paw's lowest pixel is the sprite's lowest pixel in
every frame -- so the walk spreads and closes the legs rather than lifting a foot.
