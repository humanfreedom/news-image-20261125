# The World in One Day — 25 November 2026

Entry for the make.fun bounty
[Sum up 25 November's world news in one image](https://make.fun/bounty/news-image-20261125).

`main.ts` (Node 22, standard library only) draws a newspaper front page
entirely in code — its own PNG encoder, its own 5×7 bitmap font — and
writes one 1024×1024 image to `/output/entry.png`.

The six stories of Wednesday 25 November 2026:

- **Hormuz Strait** — two oil tankers struck naval mines and caught fire.
- **Ukraine war** — drones set two Rosneft refineries in Samara ablaze.
- **Saudi Arabia** — Houthi drone hits a Riyadh tower, 11 injured.
- **Markets** — Dow closes above 50,000 for the first time as Asian stocks tumble.
- **Tech / Courts** — Brooklyn jury convicts Huawei on 10 of 12 counts.
- **Space** — China's Shenzhou-24 docks with Tiangong, first Pakistani in orbit.

Run it:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

Deterministic: two runs write byte-identical PNGs.
