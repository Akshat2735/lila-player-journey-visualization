# Player Journey Visualization Tool

A gameplay telemetry visualization tool for LILA Games' Level Design use case. It turns the supplied player telemetry into an interactive minimap view of player journeys, human and bot activity, gameplay events, heatmaps, and match playback.

## The problem

Raw gameplay telemetry contains useful information about movement and events, but is difficult to interpret as rows of data. This tool places recorded activity on the game minimap so Level Designers can explore it in match context.

## What the tool provides

- Interactive minimaps for Ambrose Valley, Grand Rift, and Lockdown
- Player and bot journey paths, with distinct line styles and roster labels
- Separate kill, death, loot, and storm-death markers
- Map, source-date, and match filters
- Match playback with play/pause, timeline seeking, restart, and playback speed controls
- Player-traffic, kill-location, and death-location heatmaps, each independently toggleable
- Match and player details, event counts, loading and retry states, empty-result messaging, and reset controls

## Why it is useful

The map-led view helps designers investigate where recorded movement and combat events occur, how paths vary between matches or maps, and which areas may merit a closer look for traffic or underuse. The telemetry shows where recorded activity occurred; it does not establish why players chose a route or area.

## Data

The tool uses the supplied Parquet telemetry. Each record provides a `user_id`, `match_id`, `map_id`, world coordinates (`x`, `y`, `z`), a timestamp value (`ts`), and an event. The processor decodes the binary event field, derives human/bot identity from the documented ID format, validates the records, and writes static JSON manifest and map/date journey shards. The browser filters those records and draws them on the matching minimap.

**Flow:** Parquet telemetry → validation and processing → map/date/match filtering → coordinate transformation → paths, events, heatmaps, and playback.

Event records do not include attacker/victim identifiers or item names. The UI therefore does not claim to pair combat participants or identify loot types.

## Coordinate mapping

Gameplay world coordinates are transformed into minimap/image coordinates before paths and event markers are rendered. The implementation follows the supplied dataset documentation and uses world X/Z for top-down placement; world Y is elevation. **Landmark-level alignment has not been independently verified.**

## Architecture

```text
Parquet telemetry
        ↓
Data processing
        ↓
Filtering / transformation
        ↓
World-to-minimap coordinate mapping
        ↓
Visualization
        ↓
Paths + Events + Heatmaps + Playback
```

For the detailed architecture and coordinate-mapping explanation, see [ARCHITECTURE.md](ARCHITECTURE.md).

## Key insights

In the provided snapshot, the busiest 96×96 traffic cell on each map contains about 0.5–0.6% of that map's movement samples; bot-involved combat codes account for 3,109 rows versus 6 human-versus-human-coded rows; and Ambrose Valley contributes 68.4% of retained rows while Grand Rift contributes 7.7%. These are observations about this dataset, not universal gameplay conclusions. See [INSIGHTS.md](INSIGHTS.md) for the supporting denominators, interpretations, and design implications.

## Limitations

- Landmark-level minimap alignment has not been independently verified against known in-game coordinates.
- The supplied timestamp unit is unresolved. Playback uses ordering and relative progress, and displays raw timestamp units where applicable; date filtering uses the source-folder partitions.
- Deployment to a named host has not been completed or verified.

## Run locally

### Requirements

- Node.js `^20.19.0` or `>=22.12.0` (required by the installed Vite version)
- npm (a `package-lock.json` is provided)
- Python 3.10+ and PyArrow only if regenerating the processed assets

The generated `public/data/` and `public/maps/` assets are included, so Python is not required to run the existing snapshot.

### Start the app

From the project root in PowerShell:

```powershell
npm ci
npm run dev
```

Open the local address printed by Vite (normally `http://127.0.0.1:5173/`). You can also run `npm start`; it starts the same Vite development server.

### Regenerate data (optional)

Place the supplied `player_data/` folder at the project root. Then run:

```powershell
py -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python scripts\preprocess.py
```

The processor reads the original Parquet files and writes generated shards to `public/data/` and minimap copies to `public/maps/`; it does not modify the raw source files. Run it again if the source dataset changes.

### Production build and local preview

```powershell
npm run build
npm run preview
```

The static site is written to `dist/` and can be deployed to a root-path static host. No application server or database is required at runtime. A named-host deployment has not yet been verified.

## Project structure

```text
src/                 React interface, data contracts, and Canvas map rendering
scripts/             PyArrow Parquet preprocessing
player_data/         Supplied raw telemetry and minimap documentation/assets
public/data/          Generated manifest and map/date JSON shards
public/maps/          Minimap assets used by the browser
ARCHITECTURE.md       Architecture and coordinate transformation details
DATA_ANALYSIS.md      Dataset schema, semantics, and validation notes
INSIGHTS.md           Evidence-backed gameplay observations
```

## Tech stack

- React and TypeScript for the browser interface
- Vite for development and static production builds
- Python and PyArrow for build-time Parquet processing
- Canvas 2D for journey paths, event markers, and heatmap overlays
- Static JSON assets for browser data loading
