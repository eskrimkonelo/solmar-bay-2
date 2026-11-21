# Solmar Bay

[![Make GTA 6](https://make.fun/badge/gta6-01.svg)](https://make.fun/c/gta6-01)
[![Rank](https://make.fun/badge/gta6-01/eskrimkonelo/solmar-bay/rank.svg)](https://make.fun/c/gta6-01)
[![Reward](https://make.fun/badge/gta6-01/eskrimkonelo/solmar-bay/reward.svg)](https://make.fun/c/gta6-01)

An open-world crime game for the [Make GTA 6](https://make.fun/c/gta6-01) bounty on
make.fun, built as plain static files that play offline in a desktop browser — no
libraries, no build step, no network requests.

## The game

Solmar Bay is a fictional sun-soaked coastal city: downtown towers, a beachfront
boardwalk, a working harbor, quiet residential streets, a ring highway, and small
parks around a blue bay. You play a courier driver new to the city who takes one
last job — and the city takes notice.

- **Explore on foot and by car.** Walk, run, and drive through a deterministic city
  built once from a fixed seed, so the same streets appear on every load.
- **Traffic and pedestrians.** Computer-driven cars keep to their lanes and park
  along the streets; walkers use the sidewalks and run from gunfire and speeding cars.
- **Steal cars.** Take a parked car, or pull a driver out of one — but the police notice.
- **Wanted level.** Stealing, shooting, hitting pedestrians, and ramming police raise
  your stars from zero to five. Police cars and officers on foot pursue you, and the
  heat falls only when you stay out of trouble and out of sight.
- **Six story missions.** Drive to a marked place, pick up and deliver a package, chase
  a target, escape the police, survive a shootout. Each mission pays money and unlocks
  the next.
- **Combat.** Aim with the mouse, click to shoot, collect health packs and ammunition.
  Cars smoke, catch fire, and explode when badly damaged.
- **HUD and minimap.** Health, money, wanted stars, the current objective, your speed
  while driving, and a minimap showing the city, the player, the mission marker, the
  police, and nearby cars.
- **Start and save.** A title screen with the story intro and controls, a pause menu,
  and progress saved to the browser's local storage.
- **Sound.** Every sound is synthesized with WebAudio — engine hum, sirens, gunshots,
  collisions, pickups, interface clicks, and a simple music loop. M mutes.
- **Polish.** Dust, smoke, muzzle flashes and sparks, skid marks, screen shake on
  explosions, soft shadows, and a camera that follows with a slight lag.

## Controls

| Key | Action |
| --- | --- |
| WASD / arrow keys | Move on foot, drive |
| Mouse | Aim |
| Click | Shoot |
| E | Enter or leave a car |
| Shift | Run |
| P or Escape | Pause |
| M | Mute |

## Play it

Serve the game folder and open it in a desktop browser:

```sh
node serve.ts
# then open http://localhost:8080
```

The game is the static files under `game/` — `game/index.html` is the page, and the
scripts under `game/src/` load in order: config, random, input, city, world, missions,
render, audio, shots, main.

## Screenshots

Four scenes, staged deterministically through the `?shot=` query parameter:

- `cover.jpg` — driving downtown with traffic, pedestrians, and the minimap
- `chase.jpg` — a police pursuit at three wanted stars
- `mission.jpg` — an active mission with its marker and objective
- `title.jpg` — the title screen over a quiet street

## Handing it in

`main.ts` (Node 22, standard library only) copies `game/` and `screenshots/` to the
output directory and writes `dossier.json` with the kit's vendored library:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

## License

MIT — see [LICENSE](LICENSE).
