# Cadence

A rhythm sword game for WebXR. Play it at https://camodeny.github.io/vr_game/ (Quest browser → **Enter VR**). It also runs on desktop for testing.

Every action is judged against the beat: **PERFECT** (±70 ms), **GOOD** (±150 ms) or **OFF**. On-beat actions build your combo and Cadence ⚡. The music adds layers as your combo climbs, and the blade's rune channel shows how much ⚡ you have.

| | VR | Desktop |
|---|---|---|
| Slash | swing the sword (right hand) | move the mouse |
| Beam (costs ⚡) | hold the sword trigger, then swing on the beat | hold left click, then flick |
| Element | A / B | E, 1–3 |
| Grab → throw | off-hand trigger, flick and release | hold Q, release |
| Push (costs ⚡) | off-hand grip | F |
| Block / parry | hold or swing the blade across the red attack | — |
| Move / turn | left stick / right stick | WASD / ← → or right-drag |
| Reload page | squeeze both grips together for 1 s | browser refresh |

- **Reactions:** hit an enemy with one element, then a different one: Fire + Ice = **Shatter**, Ice + Volt = **Superconduct**, Volt + Fire = **Overload**.
- **Interrupts:** red arcs telegraph a strike two beats ahead. Block it, step out of reach, or land a PERFECT hit to interrupt it.
- **Ring outs:** an on-beat push launches enemies off the platform.
- **Aiming beams:** while charged, point the blade at an enemy (desktop: the cursor) to lock it; spinning arcs appear underneath and a lane runs along the floor. A charged swing on the beat sends the crescent to the lock. With no lock, it flies where the blade pointed at the fastest point of the swing. Raising or drawing back the blade never fires.
- Add `?lefty` to the URL to swap hands.

## Training hall

You start in a hub. Slash a crystal to choose a mode (on desktop, use the buttons at the top left):

- **PLAY**: the full wave-based game.
- **RHYTHM**: an early/late timing chart for every hit. Press **Y** (desktop **T**) to calibrate your input offset; it's saved in the browser.
- **BEAM**: explains every swing (not charged, too slow, too short, off beat, connected in melee) with speed and arc meters.
- **FORCE**: dummies at the platform edge for grab, throw and push practice, including ring-outs.
- **ELEMENTS**: three dummies for mixing reactions.
- **PARRY**: a grunt that attacks every bar; counts parries, blocks, interrupts and dodges.
- **DEFLECT**: a caster throwing an orb every bar, with timing feedback on each deflect.

In the stations, ⚡ is infinite, you can't die, and dummies respawn. **Y** (desktop **T**) switches beat judging off so you can feel a mechanic on its own. Hold **X** (desktop **Esc**) to return to the hub.

## Code

Plain ES modules with no build step; three.js is loaded from a CDN.

- `src/config.js`: every tuning number (tempo, timing windows, costs, damage, grip angle)
- `src/audio.js`: procedural soundtrack, the beat clock (music time, latency-compensated) and all sound effects
- `src/game.js`: rules, combat, force, elements, waves
- `src/enemies.js`: grunt and caster behavior
- `src/player.js`: XR and desktop input, blade tracking, locomotion, haptics
- `src/sandbox.js`: the hub and training stations
- `src/models.js`, `src/world.js`, `src/fx.js`, `src/hud.js`: everything you see

`?xremu` loads Meta's IWER WebXR emulator, so the VR code path can be exercised on a desktop browser.
