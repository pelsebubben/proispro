# Inventory catalogue

Disc search runs locally against a bundled snapshot. Opening Add Disc and typing
never waits for a third-party API, a debounce, or a local-storage cache. Search
matches mold, manufacturer, plastic and edition, with exact names ranked first.
An unmatched name can always be entered manually.

Refresh the deduplicated mold/flight-number facts with:

```powershell
node scripts\update-disc-catalog.mjs
```

Review the generated `src/data/disc-catalog.ts` diff before committing. Updates
are explicit, not an additional scheduled pipeline. The source is
[DiscIt](https://github.com/DiscIt-API/discit-api), whose data originates in the
Marshall Street flight guide. No third-party photographs or descriptions are
bundled. The snapshot was retrieved on 2026-10-23.

Edition coverage is deliberately curated, not a claim to list every release.
Players can enter any missing edition themselves. Origin's Midnight Prowl
editions are sourced from Discmania's
[Origin collection](https://www.discmania.net/collections/origin) and
[Midnight Prowl 3 product listing](https://www.discmania.net/products/midnight-prowl-3-kyle-klein-signature-series-glow-metal-flake-c-line-origin).
Mold and edition remain separate so either can be searched without losing the
base mold or the player's own flight-number adjustments.

## DiscIt attribution

MIT License

Copyright (c) 2025 Chris Leveille

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
