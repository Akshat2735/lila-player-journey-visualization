#!/usr/bin/env python3
"""Validate and convert LILA Parquet journeys to compact static app assets."""

from __future__ import annotations

import hashlib
import json
import math
import re
import shutil
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

import pyarrow as pa
import pyarrow.parquet as pq


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "player_data"
PUBLIC = ROOT / "public"
DATA_OUT = PUBLIC / "data"
MAPS_OUT = PUBLIC / "maps"

EXPECTED_COLUMNS = {"user_id", "match_id", "map_id", "x", "y", "z", "ts", "event"}
EVENT_CODES = {
    "Position": 0,
    "BotPosition": 1,
    "Kill": 2,
    "Killed": 3,
    "BotKill": 4,
    "BotKilled": 5,
    "KilledByStorm": 6,
    "Loot": 7,
}
MAPS = {
    "AmbroseValley": {
        "name": "Ambrose Valley",
        "image": "/maps/AmbroseValley_Minimap.png",
        "scale": 900,
        "origin_x": -370,
        "origin_z": -473,
    },
    "GrandRift": {
        "name": "Grand Rift",
        "image": "/maps/GrandRift_Minimap.png",
        "scale": 581,
        "origin_x": -290,
        "origin_z": -290,
    },
    "Lockdown": {
        "name": "Lockdown",
        "image": "/maps/Lockdown_Minimap.jpg",
        "scale": 1000,
        "origin_x": -500,
        "origin_z": -500,
    },
}
UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$")
NUMERIC_RE = re.compile(r"^[0-9]+$")


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def event_text(value: Any, path: Path, row: int) -> str:
    if isinstance(value, bytes):
        return value.decode("utf-8")
    if isinstance(value, str):
        return value
    raise ValueError(f"{path}: event at row {row} is {type(value).__name__}, expected bytes or string")


def load_journey(path: Path, partition_date: str) -> tuple[dict[str, Any], str]:
    table = pq.read_table(path)
    columns = set(table.column_names)
    if columns != EXPECTED_COLUMNS:
        missing, extra = sorted(EXPECTED_COLUMNS - columns), sorted(columns - EXPECTED_COLUMNS)
        raise ValueError(f"{path}: unexpected columns; missing={missing}, extra={extra}")

    data = table.to_pydict()
    try:
        timestamps = table.column("ts").cast(pa.int64()).to_pylist()
    except (pa.ArrowInvalid, pa.ArrowNotImplementedError) as exc:
        raise ValueError(f"{path}: ts cannot be read as an int64 timestamp value") from exc

    users = data["user_id"]
    matches = data["match_id"]
    maps = data["map_id"]
    if not users:
        raise ValueError(f"{path}: empty journey file")
    user_id, match_id, map_id = users[0], matches[0], maps[0]
    if not isinstance(user_id, str) or not (UUID_RE.fullmatch(user_id) or NUMERIC_RE.fullmatch(user_id)):
        raise ValueError(f"{path}: unrecognized user_id format: {user_id!r}")
    if not isinstance(match_id, str) or not match_id.endswith(".nakama-0"):
        raise ValueError(f"{path}: unexpected match_id: {match_id!r}")
    if map_id not in MAPS:
        raise ValueError(f"{path}: unknown map_id: {map_id!r}")
    if any(value != user_id for value in users):
        raise ValueError(f"{path}: user_id changes within one journey file")
    if any(value != match_id for value in matches):
        raise ValueError(f"{path}: match_id changes within one journey file")
    if any(value != map_id for value in maps):
        raise ValueError(f"{path}: map_id changes within one journey file")

    # The filename omits the server suffix that is present in the match_id column.
    stem = path.name.removesuffix(".nakama-0")
    filename_user, separator, filename_match = stem.partition("_")
    if not separator or filename_user != user_id or filename_match != match_id.removesuffix(".nakama-0"):
        raise ValueError(f"{path}: filename identifiers disagree with Parquet columns")

    journey_rows: list[list[int | float]] = []
    for index, values in enumerate(zip(
        timestamps,
        data["x"],
        data["y"],
        data["z"],
        data["event"],
        strict=True,
    )):
        timestamp, x, y, z, event = values
        if any(value is None for value in (timestamp, x, y, z, event)):
            raise ValueError(f"{path}: null value in required field at row {index}")
        coords = (float(x), float(y), float(z))
        if not all(math.isfinite(value) for value in coords):
            raise ValueError(f"{path}: non-finite coordinate at row {index}")
        map_config = MAPS[map_id]
        u = (coords[0] - map_config["origin_x"]) / map_config["scale"]
        v = (coords[2] - map_config["origin_z"]) / map_config["scale"]
        if not (0 <= u <= 1 and 0 <= v <= 1):
            raise ValueError(
                f"{path}: x/z coordinate at row {index} falls outside the "
                f"documented {map_id} minimap transform (u={u:.6f}, v={v:.6f})"
            )
        label = event_text(event, path, index)
        if label not in EVENT_CODES:
            raise ValueError(f"{path}: unknown event {label!r} at row {index}")
        journey_rows.append([int(timestamp), coords[0], coords[1], coords[2], EVENT_CODES[label]])

    journey_rows.sort(key=lambda row: row[0])
    return {
        "user_id": user_id,
        "match_id": match_id,
        "map_id": map_id,
        "entity_type": "bot" if NUMERIC_RE.fullmatch(user_id) else "human",
        "source_dates": [partition_date],
        "rows": journey_rows,
    }, hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    if not SOURCE.is_dir():
        raise SystemExit(f"Dataset folder not found: {SOURCE}")

    date_dirs = sorted(
        (item for item in SOURCE.iterdir() if item.is_dir() and item.name.startswith("February_")),
        key=lambda item: int(item.name.rsplit("_", 1)[1]),
    )
    if not date_dirs:
        raise SystemExit(f"No February_ date folders found under {SOURCE}")

    journeys: dict[tuple[str, str], dict[str, Any]] = {}
    journey_hashes: dict[tuple[str, str], set[str]] = defaultdict(set)
    seen_file_hashes: dict[str, tuple[str, str]] = {}
    input_files = input_rows = 0
    duplicates: list[dict[str, Any]] = []

    for date_dir in date_dirs:
        for path in sorted(date_dir.glob("*.nakama-0")):
            journey, digest = load_journey(path, date_dir.name)
            input_files += 1
            input_rows += len(journey["rows"])
            key = (journey["user_id"], journey["match_id"])

            if digest in seen_file_hashes:
                prior_key = seen_file_hashes[digest]
                if prior_key != key:
                    raise ValueError(f"{path}: identical file bytes have different identifiers")
                prior = journeys[prior_key]
                if prior["rows"] != journey["rows"]:
                    raise ValueError(f"{path}: hash duplicate did not produce the same rows")
                prior["source_dates"].append(date_dir.name)
                duplicates.append({"user_id": key[0], "match_id": key[1], "source_date": date_dir.name})
                continue

            seen_file_hashes[digest] = key
            if digest in journey_hashes[key]:
                # A repeated identical segment is already included; retain its date as provenance.
                journeys[key]["source_dates"].append(date_dir.name)
                duplicates.append({"user_id": key[0], "match_id": key[1], "source_date": date_dir.name})
                continue

            if key not in journeys:
                journeys[key] = journey
            else:
                current = journeys[key]
                if current["map_id"] != journey["map_id"] or current["entity_type"] != journey["entity_type"]:
                    raise ValueError(f"{path}: journey key maps to conflicting metadata")
                current["rows"].extend(journey["rows"])
                current["source_dates"].append(date_dir.name)
                current["rows"].sort(key=lambda row: row[0])
            journey_hashes[key].add(digest)

    # Build date/map shards from unique journeys. Duplicated input files keep both
    # date labels as provenance, but each journey appears only once per shard.
    matches: dict[str, dict[str, Any]] = {}
    map_totals: dict[str, dict[str, Any]] = {
        map_id: {"journeys": 0, "rows": 0} for map_id in MAPS
    }
    event_counts: Counter[int] = Counter()
    canonical_rows = 0
    for journey in journeys.values():
        journey["source_dates"] = sorted(set(journey["source_dates"]), key=lambda value: int(value.rsplit("_", 1)[1]))
        match_id = journey["match_id"]
        meta = matches.setdefault(match_id, {
            "match_id": match_id,
            "map_id": journey["map_id"],
            "source_dates": [],
            "journey_count": 0,
            "row_count": 0,
            "human_count": 0,
            "bot_count": 0,
        })
        if meta["map_id"] != journey["map_id"]:
            raise ValueError(f"{match_id}: rows span multiple maps")
        meta["source_dates"] = sorted(
            set(meta["source_dates"]) | set(journey["source_dates"]),
            key=lambda value: int(value.rsplit("_", 1)[1]),
        )
        meta["journey_count"] += 1
        meta["row_count"] += len(journey["rows"])
        meta["human_count"] += journey["entity_type"] == "human"
        meta["bot_count"] += journey["entity_type"] == "bot"
        map_totals[journey["map_id"]]["journeys"] += 1
        map_totals[journey["map_id"]]["rows"] += len(journey["rows"])
        canonical_rows += len(journey["rows"])
        event_counts.update(row[4] for row in journey["rows"])

    manifest = {
        "schema_version": 1,
        "dates": [date_dir.name for date_dir in date_dirs],
        "maps": {
            map_id: {**config, **map_totals[map_id]}
            for map_id, config in MAPS.items()
        },
        "events": [{"code": code, "name": name, "count": event_counts[code]} for name, code in EVENT_CODES.items()],
        "totals": {
            "input_files": input_files,
            "input_rows": input_rows,
            "duplicate_files": len(duplicates),
            "duplicate_rows_removed": input_rows - canonical_rows,
            "journeys": len(journeys),
            "matches": len(matches),
            "rows": canonical_rows,
        },
        "duplicates": duplicates,
        "matches": sorted(matches.values(), key=lambda item: (item["map_id"], item["match_id"])),
    }

    DATA_OUT.mkdir(parents=True, exist_ok=True)
    for map_id in MAPS:
        for date_dir in date_dirs:
            shard_journeys = [
                {
                    "user_id": journey["user_id"],
                    "entity_type": journey["entity_type"],
                    "match_id": journey["match_id"],
                    "source_dates": journey["source_dates"],
                    "rows": journey["rows"],
                }
                for journey in journeys.values()
                if journey["map_id"] == map_id and date_dir.name in journey["source_dates"]
            ]
            shard_journeys.sort(key=lambda item: (item["match_id"], item["entity_type"], item["user_id"]))
            write_json(DATA_OUT / map_id / f"{date_dir.name}.json", {"journeys": shard_journeys})
    write_json(DATA_OUT / "manifest.json", manifest)

    MAPS_OUT.mkdir(parents=True, exist_ok=True)
    for config in MAPS.values():
        source_image = SOURCE / "minimaps" / Path(config["image"]).name
        if not source_image.is_file():
            raise FileNotFoundError(source_image)
        shutil.copy2(source_image, MAPS_OUT / source_image.name)

    print(
        f"Processed {input_files} files / {input_rows:,} rows into "
        f"{len(journeys):,} journeys / {canonical_rows:,} unique rows across {len(matches):,} matches."
    )
    print(f"Removed {input_rows - canonical_rows:,} duplicate rows from {len(duplicates)} duplicate input file(s).")
    print(f"Generated manifest and map/date shards in {DATA_OUT}")


if __name__ == "__main__":
    main()
