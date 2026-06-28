# DICE · 3D Roller

A sleek, over-the-top 3D dice roller for tabletop RPGs. Real physics, configurable dice, a clean flat UI — no gradients, no pulsing dots.

**Live demo:** https://malachibazar.github.io/dice-roller

## Features

- Configurable sides: **d4, d6, d8, d10, d12, d20, d100**
- Roll 1–12 dice at once
- Real-time 3D physics with [cannon-es](https://github.com/pmndrs/cannon-es) — dice tumble, bounce off the edges of the screen, and come to rest
- Per-face painted numbers and correct opposite-face numbering for every die
- Large total readout + per-die breakdown
- Spacebar to roll
- Flat, minimal UI

## Tech

- [three.js](https://threejs.org/) (renderer + `ConvexHull` for face merging)
- [cannon-es](https://github.com/pmndrs/cannon-es) (rigid-body physics)
- Plain ES modules via importmap — **no build step**
- Static-hosted on GitHub Pages

## Run locally

Any static server works:

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

## Tests (optional)

Headless suites verify geometry, face numbering, and physics:

```bash
npm install        # pulls three + cannon-es for the test environment only
node test/geom.mjs # face counts, opposite sums, up-face detection
node test/phys.mjs # drop/settle simulation per die
```

## Notes

- d10 / d100 use the true polar-dual pentagonal trapezohedron, so kite faces are perfectly planar.
- Face numbering pairs opposites and matches physical dice convention (d10 opposite digits sum to 9, d100 to 90, d20 to 21, etc.).
- The page *is* the landing surface — invisible walls aligned to the camera frustum at ground level contain the dice.