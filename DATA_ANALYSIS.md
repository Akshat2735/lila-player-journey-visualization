# Player Data Analysis

## Scope and method

I inspected `player_data/README.md`, enumerated the complete folder tree, checked every `.nakama-0` file's Parquet magic/footer and schema, and decoded every row in all five date folders. The scan covered 1,243 files and 89,104 physical rows. I also checked all three minimap images' actual dimensions and viewed the images.

The raw dataset was not modified. Counts below include an exact duplicate file unless explicitly stated otherwise.

## 1. Dataset overview

This is LILA BLACK player-event telemetry for February 10–14, 2026, stored as one player/bot journey per Parquet file. It contains 89,104 rows in 1,243 files, 796 distinct match IDs, and 339 distinct `user_id` values: 245 UUID-shaped IDs and 94 numeric IDs. The README's 339 “players” therefore includes numeric bot IDs.

Every row has a position (`x`, `y`, `z`), timestamp (`ts`), and event. Movement is the largest category: `Position` and `BotPosition` together account for 73,059 rows (82.0%). Loot accounts for 12,885 rows. All 8 documented event strings occur in the decoded data.

The data is concentrated on Ambrose Valley (61,013 rows; 837 files), followed by Lockdown (21,238 rows; 295 files) and Grand Rift (6,853 rows; 111 files). The February 14 folder is the smallest and is described by the README as partial.

## 2. File structure and verified counts

```text
player_data/
├── README.md
├── .DS_Store
├── February_10/  437 Parquet files
├── February_11/  293 Parquet files
├── February_12/  268 Parquet files
├── February_13/  166 Parquet files
├── February_14/   79 Parquet files
└── minimaps/
    ├── AmbroseValley_Minimap.png
    ├── GrandRift_Minimap.png
    └── Lockdown_Minimap.jpg
```

All 1,243 data files have Parquet `PAR1` header/footer signatures and one row group each. Their names follow `{user_id}_{match_id}.nakama-0`; the `match_id` column includes the `.nakama-0` suffix, while the filename's match portion does not.

| Folder | Files | Rows | Distinct matches in folder |
|---|---:|---:|---:|
| February_10 | 437 | 33,687 | 285 |
| February_11 | 293 | 21,235 | 201 |
| February_12 | 268 | 18,429 | 162 |
| February_13 | 166 | 11,106 | 112 |
| February_14 | 79 | 4,647 | 37 |
| **Total** | **1,243** | **89,104** | **796 distinct overall** |

The match counts per folder sum to 797 because one match appears in two folders due to a copied file (see edge cases).

## 3. Parquet schema and storage details

All files have the same 8 required (non-nullable) columns. There were no schema variants. The physical encodings are Parquet `BYTE_ARRAY` for string-like values, `FLOAT` for coordinates, and `INT64` for `ts`. The three ID/map fields carry Parquet UTF-8 string annotations; `event` is binary without a string annotation. Its values decode cleanly as UTF-8.

| Column | Verified Parquet type | Observed meaning |
|---|---|---|
| `user_id` | `BYTE_ARRAY`, UTF-8 string | Player or bot identifier; constant within each file. |
| `match_id` | `BYTE_ARRAY`, UTF-8 string | Match identifier, with `.nakama-0` suffix; constant within each file. |
| `map_id` | `BYTE_ARRAY`, UTF-8 string | One of `AmbroseValley`, `GrandRift`, `Lockdown`; constant within each file. |
| `x` | `FLOAT` (32-bit) | World-space X coordinate. |
| `y` | `FLOAT` (32-bit) | World-space vertical/elevation coordinate; not the minimap's vertical axis. |
| `z` | `FLOAT` (32-bit) | World-space Z coordinate; used with `x` for the 2D map. |
| `ts` | `INT64`, annotated `TIMESTAMP_MILLIS` | Stored integer timestamp; see the unit ambiguity below. |
| `event` | `BYTE_ARRAY` (binary) | UTF-8 event bytes; decode before display/grouping. |

The files use Snappy-compressed Parquet pages. String ID/map columns use dictionary encoding in the data pages; other observed columns use plain values. A standard Parquet reader such as PyArrow should handle these encodings. File columns are required and Parquet row-group statistics report zero nulls for all columns. No missing values were observed.

## 4. Coordinate system and minimap mapping

Use `x` and `z` for the top-down map. `y` is elevation. The README supplies these world-to-map parameters:

| Map | Scale | Origin X | Origin Z |
|---|---:|---:|---:|
| Ambrose Valley | 900 | -370 | -473 |
| Grand Rift | 581 | -290 | -290 |
| Lockdown | 1,000 | -500 | -500 |

For world coordinate `(x, z)`, first calculate normalized map coordinates:

```text
u = (x - origin_x) / scale
v = (z - origin_z) / scale
```

Then map to the image's **actual** pixel dimensions `W × H` (image origin is top-left):

```text
pixel_x = u * W
pixel_y = (1 - v) * H
```

If the image is displayed at another size, use its rendered width and height or scale normalized `(u, 1-v)` to the display. The README's example uses 1024×1024, but the included image files are not all that size:

| Minimap | Actual dimensions | Format |
|---|---:|---|
| Ambrose Valley | 4320×4320 | PNG, RGBA |
| Grand Rift | 2160×2158 | PNG, RGBA |
| Lockdown | 9000×9000 | JPEG, RGB |

Do not hard-code 1024 as the image's native size. The decoded coordinates fall within the normalized `[0,1]` range for all three maps using the README's scale/origin values. Their observed world-coordinate envelopes are:

| Map | X range | Z range |
|---|---:|---:|
| Ambrose Valley | -324.967 to 301.787 | -380.007 to 360.758 |
| Grand Rift | -225.904 to 256.616 | -194.005 to 170.113 |
| Lockdown | -406.630 to 348.356 | -285.105 to 329.238 |

This range check confirms the transforms produce in-image normalized coordinates; it does not independently prove that the plotted points line up with particular visual landmarks. Treat the README's origins/scales as the supplied calibration and visually spot-check the overlay before relying on it for design decisions.

## 5. Human and bot identifiers

The README's identifier rule matches the filenames and decoded `user_id` values:

- UUID-form IDs (245 distinct IDs) are human players.
- Numeric IDs (94 distinct IDs) are bots.
- Prefer a full UUID/numeric pattern check rather than testing whether an ID merely contains digits.

A single ID can have multiple match files. There are 1,242 unique `(user_id, match_id)` pairs after excluding the duplicate copy.

Do not infer the event type from the ID format. Numeric-ID files contain `Position` and `Loot` rows as well as bot-labelled events, while UUID-ID files also contain `BotKill` and `BotKilled` events. Use the identifier to style the journey/entity and use the decoded `event` value independently to style each event.

## 6. Event types and suggested display

The event bytes decode to exactly these eight values. Counts below are observed across the 89,104 physical rows, including the duplicate file.

| Event | Rows | README meaning | Suggested display |
|---|---:|---|---|
| `Position` | 51,347 | Human position sample | Human journey path/point; use a subdued path style. |
| `BotPosition` | 21,712 | Bot position sample | Bot journey path/point with a distinct color or line pattern. |
| `Kill` | 3 | Human killed a human | Distinct human-kill marker. |
| `Killed` | 3 | Human player was killed by a human | Distinct human-death marker. |
| `BotKill` | 2,415 | Human killed a bot | Bot-kill marker, visually distinct from human-vs-human. |
| `BotKilled` | 700 | Human was killed by a bot | Bot-death marker. |
| `KilledByStorm` | 39 | Player died to storm | Storm-death marker. |
| `Loot` | 12,885 | Player picked up an item | Loot marker; no item type is present in this schema. |

For heatmaps, keep traffic (`Position`/`BotPosition`) separate from combat/death/loot layers. The schema has no killer ID, victim ID, item name, storm boundary, or extraction event field, so it cannot directly identify paired combat participants, item categories, storm geometry, or successful extractions. A co-located/timestamp-near `Kill` and `Killed` should not be treated as a proven pair without an explicit matching key.

## 7. Timestamp handling and ambiguity

The Parquet annotation says `TIMESTAMP_MILLIS`, and the README shows a 1970 date produced by interpreting a sample value as milliseconds. However, the decoded `ts` integers are around 1.77 billion. Interpreted as Unix **seconds**, they land on February 9–14, 2026; per-file time spans are 13–890 raw units (median 306), which is plausible for gameplay journeys lasting seconds to minutes. Interpreted as milliseconds, the values land in January 1970 and journeys span only milliseconds. The raw values therefore strongly suggest seconds despite the millisecond Parquet annotation and README example.

This is a real data-contract conflict, not something the UI should silently hide. For playback, preserve the raw integer, sort by it, and compute `elapsed = ts - match_min_ts`; this preserves ordering and relative timing regardless of epoch origin. Display the elapsed scale as seconds only after confirming the unit. For date filters, use the supplied folder partition date unless the owner confirms the intended timestamp unit and timezone. The timestamp's timezone treatment is not explicitly declared as UTC in the Parquet logical type, and directory dates do not always equal the converted UTC calendar date.

## 8. Match, date, and map relationships

Each file is one entity journey for one match and one map. Reconstruct a match by grouping on the **column** `match_id`, not by assuming each file is a distinct match. Match files provide multiple entity journeys; sort their rows by `ts` for playback. The date folders contain the event data partition, but the exact partition/timezone rule is undocumented. `map_id` is constant within each journey file and identifies which calibration/minimap to use.

| Map | Files | Rows |
|---|---:|---:|
| Ambrose Valley | 837 | 61,013 |
| Grand Rift | 111 | 6,853 |
| Lockdown | 295 | 21,238 |

The `match_id` column includes the server suffix, and rows inside one file share the same match identifier. The dataset does not include a separate date column.

## 9. Representative decoded rows and basic statistics

A representative 65-row journey is `February_10/0019c582-574d-4a53-9f77-554519b75b4c_1298e3e2-2776-4038-ba9b-72808b041561.nakama-0`. The ID is UUID-shaped; the file contains `AmbroseValley` rows. Examples decoded from its row values:

| Row | Event | `x` | `y` | `z` | Raw `ts` |
|---:|---|---:|---:|---:|---:|
| 0 | Position | -315.354 | 125.675 | -2.593 | 1770754537 |
| 1 | Position | -317.804 | 125.525 | 0.661 | 1770754557 |
| 7 | Loot | -280.187 | 114.228 | 60.431 | 1770754596 |

The timestamps progress by 20 then 39 raw units across these sample rows; as seconds this is a plausible interval. This supports (but does not prove) the seconds interpretation.

Observed event totals:

| Category | Rows | Share |
|---|---:|---:|
| Position + BotPosition | 73,059 | 82.0% |
| Loot | 12,885 | 14.5% |
| BotKill + BotKilled | 3,115 | 3.5% |
| KilledByStorm | 39 | 0.044% |
| Kill + Killed | 6 | 0.007% |

The low `Kill`/`Killed` counts and 39 storm-death rows are observations about this sample, not necessarily representative game-wide rates. They should not be used as balance metrics without checking sample coverage and duplicate handling.

## 10. Important edge cases and ambiguities

1. **Exact duplicate file:** the same 88-row file for UUID `cfa03e9f-81f6-41ef-a0fa-30c7e830f4ed` and match `ac049b28-8116-4ff1-9e60-4be0537b8cc9` is present under both February 10 and February 11. The files have identical byte size and SHA-256. Physical total is 89,104 rows; exact-file deduplication yields 89,016 rows. Preserve source path/date provenance if deduplicating.
2. **Repeated rows within journeys:** after removing the byte-identical file copy, a full-row equality scan finds 1,417 repeated rows: 1,234 `Loot`, 34 `BotKill`, 147 `Position`, and 2 `BotKilled`. Preserve these source rows: there is no event/sample ID to distinguish duplicate ingestion from multiple identical events at the same recorded time and location. Counts therefore describe retained telemetry records, not deduplicated unique actions or positions.
3. **Input ordering:** three files have rows whose original `ts` order is not monotone. Sort rows by raw `ts` before playback; retain equal-timestamp rows because their within-timestamp order is not established.
4. **Timestamp unit conflict:** Parquet says milliseconds; raw values and journey duration strongly indicate seconds. Keep raw values until confirmed. Do not render the timestamp directly as a millisecond date.
5. **Minimap dimension conflict:** README says 1024×1024, actual assets are 4320×4320, 2160×2158, and 9000×9000. Use actual image dimensions or normalized map coordinates.
6. **Event/identity mismatch:** numeric IDs have some `Position` and `Loot`; UUID IDs contain bot combat events. Actor class and event type are independent display dimensions in the observed data.
7. **Sparse event types:** only 3 `Kill`, 3 `Killed`, and 39 `KilledByStorm` rows exist. A heatmap may be sparse; do not imply unsupported certainty.
8. **No participant/item detail:** there are no attacker/victim/item columns. Loot cannot be separated by item and combat rows cannot be authoritatively paired.
9. **Coordinate meaning:** use `z`, not `y`, for vertical map pixels. `y` is elevation.
10. **No extraction/storm state:** the schema has storm-death events but no storm-front position or extraction event.
11. **Folder-date semantics:** directories label dates, but their timezone/cutoff relationship to `ts` is not documented. Keep the folder as the date-filter source until clarified.
12. **Filename parsing:** UUIDs contain hyphens and the match suffix differs between filename and `match_id` column. Parse the first underscore as the separator only if using filenames; prefer the columns for joins.
13. **Coordinate audit:** all 89,104 physical rows project into inclusive `[0,1]` UV bounds with the README calibration for their map. The processing step now fails with a row-specific error if a future input violates those documented bounds; it does not silently clamp.

## 11. Assumptions to record

- Treat UUID format as human and all-digit IDs as bots, consistent with the README and observed filenames.
- Treat `x,z` as map-plane coordinates and `y` as elevation, per README.
- Use the README-provided map calibration, but multiply normalized UV by each actual minimap image dimension.
- Use the raw `ts` only for ordering and relative elapsed playback until the seconds-vs-milliseconds contract is confirmed.
- Treat date folder labels as dataset partition labels, not necessarily UTC calendar dates.
- Deduplicate only the confirmed byte-identical `(user_id, match_id)` copy; keep a record of both source paths.
- Event descriptions follow the README; do not infer extra semantics or combat pairings from proximity alone.

## 12. Recommended data-processing pipeline

1. Enumerate the five date partitions and minimaps; retain source file path and partition date.
2. Read Parquet files with a real Parquet library, decode `event` bytes as UTF-8, and validate the expected 8-column schema.
3. Normalize IDs/events to strings; identify entity type from full UUID vs numeric ID pattern. Preserve raw values for audit.
4. Add a canonical match key from `match_id`; optionally deduplicate exact duplicate files by content hash plus IDs while retaining provenance.
5. Validate required values, event vocabulary, map IDs, coordinate finiteness/ranges, and that map coordinates produce UVs in `[0,1]`. Do not silently clamp invalid points.
6. Resolve timestamp units/timezone with the data owner. Until then, sort on raw `ts` and derive match-relative elapsed time from the minimum timestamp across all rows for that match.
7. Convert `x,z` to normalized map UV using the map table, then convert UV to each minimap's actual rendered width and height. Keep `y` available for optional elevation inspection, not 2D placement.
8. Produce separate layers for human/bot paths, movement density, loot, human combat, bot combat, and storm deaths. Label counts and note the small event samples.
9. Aggregate at the selected map/date/match filter only after deduplication and time normalization; show coverage (matches, journeys, rows) alongside heatmaps.

## Recommended next build step

Before implementation, confirm the intended `ts` unit/timezone and whether the duplicated 88-row file is expected. Then build a small data-validation/normalization layer and a static overlay for one match on each map to check alignment against the images. Once those checks pass, implement the browser explorer with map/date/match filters, path/entity toggles, an elapsed-time scrubber, and separate traffic/event heatmap layers. Use `DATA_ANALYSIS.md` as the data contract and carry the timestamp/duplicate caveats into the UI until they are resolved.
