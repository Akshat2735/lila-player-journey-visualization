export type MapId = 'AmbroseValley' | 'GrandRift' | 'Lockdown';
export type EventName = 'Position' | 'BotPosition' | 'Kill' | 'Killed' | 'BotKill' | 'BotKilled' | 'KilledByStorm' | 'Loot';

export interface MapInfo {
  name: string;
  image: string;
  scale: number;
  origin_x: number;
  origin_z: number;
  journeys: number;
  rows: number;
}

export interface EventInfo {
  code: number;
  name: EventName;
  count: number;
}

export interface MatchInfo {
  match_id: string;
  map_id: MapId;
  source_dates: string[];
  journey_count: number;
  row_count: number;
  human_count: number;
  bot_count: number;
}

export interface Manifest {
  schema_version: number;
  dates: string[];
  maps: Record<MapId, MapInfo>;
  events: EventInfo[];
  totals: {
    input_files: number;
    input_rows: number;
    duplicate_files: number;
    duplicate_rows_removed: number;
    journeys: number;
    matches: number;
    rows: number;
  };
  matches: MatchInfo[];
}

export type Row = [ts: number, x: number, y: number, z: number, eventCode: number];

export interface Journey {
  user_id: string;
  entity_type: 'human' | 'bot';
  match_id: string;
  source_dates: string[];
  rows: Row[];
}

interface Shard {
  journeys: Journey[];
}

const shardCache = new Map<string, Promise<Journey[]>>();

export async function loadManifest(): Promise<Manifest> {
  const response = await fetch('/data/manifest.json');
  if (!response.ok) throw new Error(`Could not load dataset manifest (${response.status}).`);
  return response.json() as Promise<Manifest>;
}

async function loadShard(mapId: MapId, date: string): Promise<Journey[]> {
  const key = `${mapId}/${date}`;
  const cached = shardCache.get(key);
  if (cached) return cached;

  const request = fetch(`/data/${mapId}/${date}.json`).then(async (response) => {
    if (!response.ok) throw new Error(`Could not load ${date.replace('_', ' ')} data (${response.status}).`);
    const shard = (await response.json()) as Shard;
    return shard.journeys;
  });
  shardCache.set(key, request);
  request.catch(() => shardCache.delete(key));
  return request;
}

export async function loadJourneys(mapId: MapId, dates: string[]): Promise<Journey[]> {
  const shards = await Promise.all(dates.map((date) => loadShard(mapId, date)));
  const unique = new Map<string, Journey>();
  for (const shard of shards) {
    for (const journey of shard) {
      const key = `${journey.user_id}|${journey.match_id}`;
      const prior = unique.get(key);
      if (!prior) {
        unique.set(key, journey);
      } else {
        prior.source_dates = [...new Set([...prior.source_dates, ...journey.source_dates])].sort();
      }
    }
  }
  return [...unique.values()];
}

export const EVENT_CLASS: Record<number, 'kill' | 'death' | 'loot' | 'storm' | 'movement'> = {
  0: 'movement',
  1: 'movement',
  2: 'kill',
  3: 'death',
  4: 'kill',
  5: 'death',
  6: 'storm',
  7: 'loot',
};

export const EVENT_NAME_BY_CODE: Record<number, EventName> = {
  0: 'Position',
  1: 'BotPosition',
  2: 'Kill',
  3: 'Killed',
  4: 'BotKill',
  5: 'BotKilled',
  6: 'KilledByStorm',
  7: 'Loot',
};

export function formatDate(partition: string): string {
  const day = partition.split('_')[1];
  return `Feb ${Number(day)}`;
}

export function shortMatchId(matchId: string): string {
  return matchId.replace('.nakama-0', '').slice(0, 8).toUpperCase();
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}
