# Gameplay Insights

These observations use the processed snapshot for February 10–14, 2026: 89,016 retained telemetry rows across 1,242 canonical entity journeys and 796 matches. The byte-identical duplicate file is counted once; repeated identical rows within a journey are retained because the source has no sample/event ID to prove they are duplicate ingestion. Percentages below describe this dataset, not necessarily overall game behavior.

## Insight 1: Movement is dispersed across fine-grained map cells

### Observation

At the tool's 96×96 heatmap resolution, the busiest single traffic cell contains less than 1% of movement samples on each map.

### Evidence

Using the app's traffic definition (`Position` + `BotPosition`) and world-to-map transform, the busiest cell contains:

- **Ambrose Valley:** 308 of 48,691 movement samples (about **0.6%**).
- **Grand Rift:** 34 of 5,728 movement samples (about **0.6%**).
- **Lockdown:** 99 of 18,577 movement samples (about **0.5%**).

Each denominator is that map's movement-row count across all supplied dates and matches. These are recorded position samples binned without smoothing; repeated rows retained within journeys contribute to the counts.

### Interpretation

The sample does not show a single dominant cell at this fine resolution. This may mean movement samples are distributed across multiple cells and routes. It does not establish that all map areas receive equal use: adjacent cells may form a broader hotspot, and sample counts do not measure unique players or time spent.

### Level Design Implication

Review neighboring high-count cells and the underlying journeys together when assessing traversal routes or possible chokepoints. Avoid treating one 96×96 cell as a definitive hotspot; compare broader areas at consistent resolution before changing map flow.

## Insight 2: Recorded combat outcomes are mostly bot-involved

### Observation

Bot-specific combat event codes make up almost all recorded kill/death outcomes in this snapshot.

### Evidence

Across all maps, dates, and matches, the canonical processed data contains **2,410 `BotKill`** rows and **699 `BotKilled`** rows: **3,109 bot-involved combat rows**. It contains **3 `Kill`** and **3 `Killed`** rows: **6 human-versus-human-coded rows**. Thus, bot-specific codes account for 3,109 of 3,115 kill/death rows (**99.8%**). This denominator excludes `KilledByStorm` and non-combat events. The source meanings distinguish a human killing a bot (`BotKill`) from a human being killed by a bot (`BotKilled`); event type is independent of the journey owner's human/bot identifier.

### Interpretation

The recorded combat sample is strongly weighted toward bot-involved outcomes. The telemetry alone cannot show whether this reflects typical gameplay, the matches selected for collection, or encounter coverage; it does show that this snapshot provides very little evidence about human-versus-human outcome patterns.

### Level Design Implication

Use these records to inspect bot encounter spaces separately from PvP spaces. Treat any PvP balance conclusion as provisional, and seek broader human-versus-human match coverage before using these counts to guide combat-space changes.

## Insight 3: Telemetry coverage differs substantially by map

### Observation

Ambrose Valley contributes most of the retained rows, while Grand Rift contributes less than one tenth.

### Evidence

Across the complete canonical processed snapshot of **89,016 rows**:

- **Ambrose Valley:** 60,925 rows (**68.4%** of all rows), across 836 journeys.
- **Lockdown:** 21,238 rows (**23.9%**), across 295 journeys.
- **Grand Rift:** 6,853 rows (**7.7%**), across 111 journeys.

The percentages use 89,016 retained rows as the denominator. Rows include movement, combat, loot, and storm events; they are not counts of unique players or equal-duration play sessions.

### Interpretation

The three maps have unequal telemetry coverage in this supplied sample. Larger raw totals on Ambrose Valley may reflect more recorded journeys or rows rather than greater per-player activity or a gameplay preference. The dataset does not establish why coverage differs.

### Level Design Implication

When comparing map-level heatmaps or event counts, review per-match and per-journey evidence alongside raw totals. Consider collecting more Grand Rift sessions before drawing strong cross-map conclusions or prioritizing changes based only on aggregate volume.

## Limitations

- Landmark-level map alignment remains unverified. The supplied coordinate calibration, axis handling, image dimensions, and in-bounds checks are used, but the dataset contains no known landmark world coordinates for independent visual registration.
- Timestamp units remain unresolved. The Parquet annotation and observed integer values conflict, so this document does not interpret them as confirmed seconds or milliseconds.
- The tool therefore uses timestamp ordering and relative playback progress, and displays raw timestamp units where applicable; date filtering follows the supplied source-folder partitions.
- Deployment to a named host is not yet completed. The static production build has been verified locally, but no hosted URL has been checked.
