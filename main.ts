// Solmar Bay — the entrypoint program (Node 22, standard library only).
//
// It hands the game in: it copies this repository's game/ and screenshots/
// into the output directory and writes dossier.json there, using the
// buildDossier function from the kit's vendored library.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
//
// Outside the grader, MAKEFUN_OUTPUT_DIR stands in for /output; without it
// the program writes to /output. The two runs must write the same bytes,
// so nothing here depends on the time, the machine, or the order files
// happen to be listed in.

import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

// The repository root is the directory this file lives in.
const repoRoot = dirname(fileURLToPath(import.meta.url));

// Where the handed-in entry goes: the environment's override, else /output.
const outputDir = resolve(process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const gameSource = join(repoRoot, 'game');
const shotsSource = join(repoRoot, 'screenshots');

// The caps the gate scores against, taken from the bounty's gate: the
// dossier text cap, the screenshot caps, and the game tree caps. Only the
// text cap shapes the bytes; the others make the program fail exactly
// where the scorer would refuse the entry.
const dossierCaps = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};

function copyTree(from: string, to: string): void {
  mkdirSync(to, { recursive: true });
  cpSync(from, to, { recursive: true });
}

function handIn(): void {
  // Start from a clean output directory so a stale file from an earlier
  // run can never ride along into the entry.
  rmSync(outputDir, { recursive: true, force: true });
  mkdirSync(outputDir, { recursive: true });

  copyTree(gameSource, join(outputDir, 'game'));

  // screenshots/ is optional in the repository but the dossier needs at
  // least one image, so copy it only when it is there.
  if (existsSync(shotsSource)) {
    copyTree(shotsSource, join(outputDir, 'screenshots'));
  }

  const dossier = buildDossier(outputDir, dossierCaps);
  writeFileSync(join(outputDir, 'dossier.json'), dossier);
}

handIn();
console.log(`Solmar Bay handed in to ${outputDir}`);
