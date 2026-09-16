# The desktop pet

Porcupine can keep a small pixel creature on your desktop that shows what the agent is doing.
It is off by default and nothing runs until you ask for it.

```
/pet start        install and build if needed, then put it on screen
/pet status       is it installed, running, which species
/pet quit         stop it
/pet say | rest | curl | freeze | unfreeze
```

The default species is the **porcupine**. `/pet start` builds it into
`~/.porcupine/agent/pet` from the sources in `packages/pet`, which needs Xcode Command Line
Tools for `swiftc`. The macaw is the other species and can be selected from the pet's
right-click menu.

## What it does

Click it and a pixel **think box** opens for five seconds showing live session state: status
and elapsed time, the model and provider, the current interaction mode and thinking level,
how many sub-agents are running, the literal last prompt you wrote, and what the agent is
doing right now. Drag it to move it; right-click for the menu.

| Species | Behaviour |
|---|---|
| porcupine | Walks the bottom of the screen, curls into a ball in a corner to rest, eats from a bowl, squirms when you pick it up |
| macaw | Flies, perches on a plank it materialises, eats, takes off |

The pet reflects the session through small request files it polls (`speak-request`,
`rest-request`, `curl-request`, `motion-freeze`), so it has no socket, no daemon, and no
network access. Quitting it leaves nothing running. Tools: `pet_status`, `pet_say`,
`pet_rest`, `pet_curl`, `pet_freeze`.

## Screen cost

It draws one small window (about 110x100 pt for the porcupine) and reads Porcupine's own
session files. It does **not** capture the screen, does not need Screen Recording permission,
and does not read other applications.

## Known limits of the shipped art

The artwork comes from generated sheets and carries their flaws: the porcupine's walk has no
foot lift in any frame, so it waddles rather than steps; the macaw's tail is cropped by the
source tiles in 16 of its 21 sheets; and one sheet per set contains a prop that the generator
left blank, so those sheets are excluded. `packages/pet/scripts/check-art.mjs` validates the
shipped clips in CI.

## Building it by hand

```
cd packages/pet
sh ./build.sh          # writes ./build/Pet.app
open -g ./build/Pet.app
```

The app resolves its art from `PORCUPINE_PET_HOME` if set, otherwise from the folder
containing the app bundle, otherwise from `~/wallpaper-lab/pet`.
