# Player Journey Explorer Architecture

## Product shape

Build a static browser application for exploring the supplied LILA BLACK telemetry. Use React and TypeScript for the interface, Vite for the build, a small Python/PyArrow preprocessing script for Parquet, and Canvas 2D for map overlays. Vercel is the intended static host, but deployment has not been completed or verified. There is no runtime API or database: the raw input has 89,104 rows; preprocessing removes one byte-identical 88-row file copy, leaving 89,016 rows across 1,242 canonical journeys for the browser.

This keeps deployment and operations simple while preserving a reproducible data pipeline. The interface loads only the selected minimap and relevant data shards, then caches them in memory for responsive filtering and playback.

## Chosen stack

| Layer | Choice | Reason |
|---|---|---|
| UI | React + TypeScript | Fast to build a polished single page explorer; typed records and filter state make data contracts clear. |
| Build/dev server | Vite | Small configuration surface and static output suitable for a shareable deployment. |
| Parquet ingestion | Python + PyArrow, build-time only | Reads the extensionless `.nakama-0` files directly and handles their shared Parquet schema, Snappy pages, and dictionary encodings. |
| Map and overlays | HTML image + Canvas 2D overlay | Keeps map image scaling crisp and draws many paths/markers without creating tens of thousands of DOM nodes. |
| Heatmaps | Preprocessed or in-browser normalized UV grid + Canvas | Simple to implement for this dataset size; no map-tile service or visualization framework is needed. |
| Hosting | Root-path static hosting (Vercel intended) | Serves the compiled app, minimaps, manifest, and JSON shards without a server process or runtime data store. Host deployment remains unverified. |

## Frontend architecture

The shipped single-page layout gives the map most of the available space. Map/date/match filters, entity and event visibility, heatmap controls, match details, and playback remain close to the map. Legends use line pattern, color, marker shape, labels, and counts. The current match, human/bot counts, row count, event counts, and relative replay position come from the manifest and selected telemetry.

The current implementation is intentionally compact:

- `src/App.tsx` owns manifest/shard loading, map/date/match filters, player visibility, event layers, heatmap state, match statistics, and timeline playback.
- `src/data.ts` defines the manifest and journey contracts, caches map/date fetch promises, and merges canonical journeys when multiple date shards are selected.
- `src/components/MapCanvas.tsx` loads the selected minimap, measures its natural dimensions and viewport with `ResizeObserver`, then draws paths, current positions, heatmap cells, and event markers to a device-pixel-ratio-aware Canvas. Hover inspection is handled without creating a DOM node per telemetry row.
- `src/styles.css` provides the responsive application shell and control/map layout.

World coordinates are normalized to `u,v` before being scaled to the measured map frame. The image and Canvas share that frame and aspect ratio. The Canvas redraws when map, journey, layer, heatmap, viewport, or replay state changes.

## Data-processing and data flow

### Build-time pipeline

1. `scripts/preprocess.py` iterates the supplied February date folders, reads their `.nakama-0` Parquet files with PyArrow, and records each source folder date.
2. Validate the exact 8-column schema, required values, event vocabulary, map IDs, finite coordinates, and the documented map UV bounds. Decode `event` bytes as UTF-8. Preserve raw `ts` and `x,y,z`; stable-sort each journey by raw `ts` because three source files are not monotone. Preserve equal-time rows and note the timestamp unit ambiguity.
3. Identify player type from the complete identifier pattern: UUID-shaped `user_id` means human, all-digit ID means bot. Do not use the event name to decide whether a journey belongs to a human or bot.
4. Deduplicate the confirmed byte-identical 88-row file by content hash plus `(user_id, match_id)`. Store both source folder dates as provenance so either date filter can still find it without counting its rows twice. Preserve identical rows within a journey: the schema has no sample/event identifier to prove they are ingestion duplicates; the current source has 1,417 such repeated records after file-level deduplication.
5. Group journeys by the `match_id` column and `user_id`; enforce constant identifiers and map ID within each file. The manifest records per-match journey/row totals, human/bot counts, map ID, and source dates.
6. Convert event strings to compact integer codes and preserve raw coordinates and timestamp values in the output. The browser computes normalized `u,v` for Canvas rendering and heatmap binning from the manifest's map calibration.
7. Write `public/data/manifest.json` with map/date/match options and counts, plus JSON shards grouped by map and date. Use compact row arrays such as `[ts, x, y, z, eventCode]`; keep `user_id`, entity type, and source dates once per journey rather than repeating them in every row.
8. Commit the deterministic generated assets with the app so Vercel can deploy them without running Python. Keep the preprocessor and its dependency declaration in the repository so the assets can be regenerated from the raw source data.

### Browser data flow

```text
Parquet source folders
        │  PyArrow preprocessing; validate, decode, deduplicate
        ▼
manifest.json + map/date journey shards + minimap image assets
        │  static fetch; lazy load selected map/date shards; cache in memory
        ▼
filters → selected journeys → Canvas paths, event markers, heatmap, playback
```

The app first fetches `manifest.json`, then fetches only the selected map/date shard(s). Selecting “all dates” for a map fetches that map's available date shards and merges journeys by canonical `(user_id, match_id)` key. Selecting a match narrows the already loaded data. Fetch promises are cached for back-and-forth exploration. The duplicated journey appears in both relevant date partitions for date filtering, but is counted once when dates are combined.

The generated data and minimaps are static assets included in the project. The current manifest and shard filenames are not content-hashed; when datasets are refreshed on a host with aggressive caching, configure revalidation or add versioned URLs to prevent stale browser data.

## Coordinate transformation

Use the calibration values documented in `player_data/README.md`:

| Map | Scale | Origin X | Origin Z |
|---|---:|---:|---:|
| Ambrose Valley | 900 | -370 | -473 |
| Grand Rift | 581 | -290 | -290 |
| Lockdown | 1,000 | -500 | -500 |

For world position `(x,z)`:

```text
u = (x - origin_x) / scale
v = (z - origin_z) / scale
```

`u` and `v` are normalized map coordinates. The minimap's displayed pixel position is:

```text
screen_x = u * displayed_image_width
screen_y = (1 - v) * displayed_image_height
```

The vertical flip accounts for image coordinates starting at the top-left. The data's `y` is elevation and is not used for the top-down placement. Use each image's actual aspect/dimensions: Ambrose Valley is 4320×4320, Grand Rift is 2160×2158, and Lockdown is 9000×9000. This corrects the README's generic 1024×1024 statement. All observed coordinates fit normalized `[0,1]` using the supplied calibration; still count and surface any out-of-range records rather than silently clamping them. Before adding features, render one journey on each minimap and visually check alignment.

## Entity and event processing

Entity appearance comes from `user_id`: use an obvious solid/round path style for humans and a contrasting dashed or patterned style for bots, with a legend that does not rely on color alone. Event interpretation is independent of entity class because numeric-ID journeys contain some `Position` and `Loot` rows and UUID journeys contain bot-combat events.

Decode the binary `event` column as UTF-8, then map these exact values to separate marker codes/styles:

- `Kill`: human-on-human kill.
- `Killed`: human death to another human.
- `BotKill`: human killed a bot.
- `BotKilled`: human was killed by a bot.
- `KilledByStorm`: storm death.
- `Loot`: loot pickup.
- `Position`: human movement sample.
- `BotPosition`: bot movement sample.

Movement event points make the journey and traffic layer. Combat, death, storm, and loot markers are overlaid at their recorded `x,z` positions. The schema does not include attacker/victim IDs or item names, so the UI must not claim paired combatants or item-specific loot. `Kill` and `Killed` are both sparse (3 rows each); show counts and retain separate marker categories rather than implying strong spatial statistics.

## Filtering

The manifest provides available maps, partition dates, and matches with their map, dates, journey counts, and row counts. Map selection narrows dates/matches; date selection narrows matches using source partition provenance; match selection selects one canonical `match_id`. A combined map/date request fetches only matching shards. Keep the date folder label visible as the source partition label because the exact timestamp timezone/cutoff policy is undocumented.

On a match selection, paths and playback use all entity journeys for that match after the selected date scope is applied. If no match is selected, heatmaps and paths aggregate the selected map/date dataset. Empty filter results should be explicit and should not leave a prior map visible as if it matched.

## Heatmap generation

The shipped UI bins rows into an unsmoothed 96×96 normalized UV grid and draws the bins as Canvas image data aligned to the minimap. No kernel or blur is applied: each occupied cell represents the records that landed inside that bin. Intensity is scaled within each layer to its own busiest cell, with a legend and actual sample counts.

- **Player traffic:** count `Position` and `BotPosition` rows.
- **Kill locations:** count `Kill` and `BotKill` rows.
- **Death locations:** count `Killed`, `BotKilled`, and `KilledByStorm` rows.

The selected scope is either the selected match or all matches for the current map/date filter. Human/bot visibility and roster visibility constrain aggregation. Heatmaps intentionally use the full selected scope even when the replay playhead is earlier; the UI labels that behavior. These are sample/event record counts, not unique players, dwell time, or causal danger. The current grid is calculated in the browser with memoized React state and reused during playback; for the inspected 89k-row dataset this avoids a backend or worker. Reprofile before increasing dataset scale.

## Timeline and playback

For a selected match, combine participant rows and sort by raw `ts`, then use the match-wide minimum and maximum to derive normalized progress in `[0,1]`. The scrubber and playback can use normalized match progress without mislabeling the conflicting timestamp unit. On each frame, draw the path up to the selected progress and show the current/latest position per visible journey; event markers appear when their timestamp is reached. Keep playback state separate from filters so changing the map/date/match resets progress cleanly.

The Parquet schema marks `ts` as milliseconds, but stored values look like Unix seconds: interpreting them as seconds yields dates in the dataset's February 2026 window and per-journey spans of 13–890 units (median 306); interpreting them as milliseconds yields 1970 and sub-second journeys. Until LILA confirms the intended unit/timezone, preserve raw values and use only their order and normalized progress. If confirmed as seconds, show elapsed seconds from the match start; do not derive the filter date from an unconfirmed timestamp conversion.

## Performance and accessibility

- Fetch the selected map image only; Lockdown's JPEG is about 11.4 MB, so avoid loading all minimaps at startup.
- Lazy-load map/date shards and cache them; show loading state and selected-data counts.
- Keep journey rows in typed/plain data structures and draw paths/markers in Canvas; avoid per-row DOM, repeated parsing, and redraw loops.
- The current heatmap calculation runs in the browser's main thread and is memoized between playback frames. The inspected dataset is about 89k rows, so no backend or worker is used; consider a worker if the data grows or profiling shows UI stalls.
- Separate event visibility and heatmap layers; provide keyboard-accessible native controls and text legends in addition to color.
- Use Canvas device-pixel-ratio scaling and re-render on resize; keep the map and overlay in one aspect-ratio-locked container.

## Deployment approach

The intended deployment is a static site on Vercel (or another root-path static host). The verified local production command is `npm run build`; it publishes the app, manifest, map/date JSON shards, and minimap files under `dist/`. There is no runtime server, database, or secret configuration. The current source has not been deployed to a named host, so platform-specific routing, cache headers, and a public URL remain unverified. Regenerate data locally with the PyArrow preprocessor when source data changes; the static host does not need Python. Confirm that generated assets exist before publishing. The README documents local setup, regeneration, and root-path hosting assumptions; add the live URL after an actual deployment.

## Assumptions and trade-offs

- The provided scale/origin calibration is the authoritative transform; coordinate extents fit it, but landmark alignment still needs a visual check.
- Full UUID-shaped IDs are humans; numeric IDs are bots, consistent with the README and observed filenames.
- The timestamp unit is unresolved. The UI initially uses raw ordering and normalized progress only.
- Folder names are dataset partition labels. Their exact relationship to timestamp timezone/cutoff is not guaranteed.
- The byte-identical 88-row journey is treated as one canonical journey with both source dates retained; raw source provenance remains visible in processed metadata.
- Data is small and fixed. A static site and build-time processing are faster and simpler than a live query API; this trades away arbitrary uploads and real-time data refresh.
- Canvas is efficient for these overlays but offers less built-in accessibility than DOM/SVG marks; native controls, legends, and keyboard interaction remain in HTML.
- Heatmaps measure sampled points, not unique-player occupancy or causality; sparse event types require visible counts and cautious labels.

## Implemented milestones

1. **Data contract and preprocessing:** PyArrow validates the schema and values, decodes event bytes, classifies IDs, handles the exact duplicate-file provenance, and writes the static manifest and map/date shards.
2. **Map and filters:** the React/Vite interface renders all three minimaps, Canvas paths, human/bot styles, event markers, and map/date/match selectors.
3. **Playback:** match-wide raw timestamp ordering drives the timeline, play/pause, seeking, playback speed, and current player/event visibility.
4. **Heatmaps and UX:** traffic/kill/death bins, legends, loading/error/empty states, and responsive controls are implemented.
5. **Handoff:** README, dataset analysis, architecture, and insights documents are present; the local static production build is verified. Deployment to a named host remains outstanding.
