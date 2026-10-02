import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowDownUp,
  CalendarDays,
  ChevronDown,
  CircleHelp,
  Crosshair,
  Database,
  Eye,
  EyeOff,
  Filter,
  Map as MapIcon,
  Pause,
  Play,
  RotateCcw,
  Search,
  Users,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { MapCanvas, type LayerVisibility } from './components/MapCanvas';
import {
  EVENT_CLASS,
  EVENT_NAME_BY_CODE,
  formatCount,
  formatDate,
  loadJourneys,
  loadManifest,
  shortMatchId,
  type Journey,
  type Manifest,
  type MapId,
  type MatchInfo,
} from './data';

const DEFAULT_MAP: MapId = 'AmbroseValley';
const INITIAL_LAYERS: LayerVisibility = {
  human: true,
  bot: true,
  kill: true,
  death: true,
  loot: true,
  storm: true,
};

function journeyKey(journey: Journey): string {
  return `${journey.user_id}|${journey.match_id}`;
}

function bestMatch(matches: MatchInfo[]): MatchInfo | undefined {
  return [...matches].sort((a, b) => b.human_count - a.human_count || b.journey_count - a.journey_count || b.row_count - a.row_count)[0];
}

function upperBound(values: number[], target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (values[middle] <= target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function displayDate(date: string): string {
  return date === 'all' ? 'All dates' : `${formatDate(date)}, 2026`;
}

function SelectField({ label, icon: Icon, value, onChange, children, disabled = false, title }: {
  label: string;
  icon: typeof MapIcon;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <label className="select-field">
      <span className="select-label"><Icon size={13} />{label}</span>
      <span className="select-control-wrap">
        <select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} title={title}>
          {children}
        </select>
        <ChevronDown className="select-chevron" size={14} />
      </span>
    </label>
  );
}

function LoadingScreen() {
  return (
    <main className="startup-state">
      <div className="startup-mark"><Activity size={22} /></div>
      <span className="eyebrow">LILA BLACK · LEVEL DESIGN</span>
      <h1>Opening the field log</h1>
      <p>Loading the verified match index and map data.</p>
      <span className="startup-progress"><span /></span>
    </main>
  );
}

function ErrorScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <main className="startup-state error-state">
      <div className="startup-mark error-mark"><AlertTriangle size={22} /></div>
      <span className="eyebrow">DATA LOAD INTERRUPTED</span>
      <h1>We couldn't open the player data</h1>
      <p>{message}</p>
      <button className="primary-button" onClick={onRetry}>Try again</button>
    </main>
  );
}

export default function App() {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [manifestError, setManifestError] = useState<string | null>(null);
  const [selectedMap, setSelectedMap] = useState<MapId>(DEFAULT_MAP);
  const [selectedDate, setSelectedDate] = useState('all');
  const [selectedMatch, setSelectedMatch] = useState('');
  const [journeys, setJourneys] = useState<Journey[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const [dataRetry, setDataRetry] = useState(0);
  const [layers, setLayers] = useState<LayerVisibility>(INITIAL_LAYERS);
  const [visibleJourneyIds, setVisibleJourneyIds] = useState<Set<string>>(new Set());
  const [focusedJourneyId, setFocusedJourneyId] = useState<string | null>(null);
  const [playerQuery, setPlayerQuery] = useState('');
  const [progress, setProgress] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [heatmapLayers, setHeatmapLayers] = useState({ traffic: false, kills: false, deaths: false });
  const [heatmapScope, setHeatmapScope] = useState<'match' | 'selection'>('match');
  const requestToken = useRef(0);
  const playStart = useRef(0);
  const playStartProgress = useRef(0);
  const progressRef = useRef(progress);
  progressRef.current = progress;

  const retryManifest = () => {
    setManifest(null);
    setManifestError(null);
    loadManifest().then(setManifest).catch((error: unknown) => {
      console.error('Could not load dataset manifest', error);
      setManifestError('The match index could not be loaded. Check the app data files, then try again.');
    });
  };

  useEffect(() => {
    let cancelled = false;
    loadManifest().then((value) => {
      if (!cancelled) setManifest(value);
    }).catch((error: unknown) => {
      if (!cancelled) {
        console.error('Could not load dataset manifest', error);
        setManifestError('The match index could not be loaded. Check the app data files, then try again.');
      }
    });
    return () => { cancelled = true; };
  }, []);

  const dateScopedMatches = useMemo(() => {
    if (!manifest) return [];
    return manifest.matches
      .filter((match) => match.map_id === selectedMap)
      .filter((match) => selectedDate === 'all' || match.source_dates.includes(selectedDate))
      .sort((a, b) => b.human_count - a.human_count || b.journey_count - a.journey_count || b.row_count - a.row_count);
  }, [manifest, selectedMap, selectedDate]);
  const defaultMatchId = useMemo(() => {
    if (!manifest) return '';
    return bestMatch(manifest.matches.filter((match) => match.map_id === DEFAULT_MAP))?.match_id ?? '';
  }, [manifest]);

  useEffect(() => {
    if (!dateScopedMatches.length) {
      setSelectedMatch('');
      return;
    }
    if (!dateScopedMatches.some((match) => match.match_id === selectedMatch)) {
      setSelectedMatch(bestMatch(dateScopedMatches)?.match_id ?? '');
    }
  }, [dateScopedMatches, selectedMatch]);

  useEffect(() => {
    if (!manifest) return undefined;
    const token = ++requestToken.current;
    setLoadingData(true);
    setDataError(null);
    setJourneys([]);
    const dates = selectedDate === 'all' ? manifest.dates : [selectedDate];
    loadJourneys(selectedMap, dates).then((value) => {
      if (token === requestToken.current) {
        setJourneys(value);
        setVisibleJourneyIds(new Set(value.map(journeyKey)));
        setFocusedJourneyId(null);
        setPlayerQuery('');
        setLoadingData(false);
      }
    }).catch((error: unknown) => {
      if (token === requestToken.current) {
        console.error('Could not load map data', error);
        setDataError('The gameplay data for this selection did not load. Try again or choose another date.');
        setJourneys([]);
        setLoadingData(false);
      }
    });
    return () => { requestToken.current += 1; };
  }, [manifest, selectedMap, selectedDate, dataRetry]);

  useEffect(() => {
    setProgress(0);
    setPlaying(false);
  }, [selectedMap, selectedDate, selectedMatch]);

  useEffect(() => {
    if (!playing) return undefined;
    let frame = 0;
    const tick = (now: number) => {
      if (!playStart.current) {
        playStart.current = now;
        playStartProgress.current = progressRef.current;
      }
      const next = Math.min(1, playStartProgress.current + (now - playStart.current) * playbackRate / 12000);
      setProgress(next);
      if (next >= 1) setPlaying(false);
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, playbackRate]);

  const selectedInfo = dateScopedMatches.find((match) => match.match_id === selectedMatch);
  const selectedJourneys = useMemo(
    () => journeys.filter((journey) => journey.match_id === selectedMatch),
    [journeys, selectedMatch],
  );
  const selectedMatchStats = useMemo(() => {
    let start = Number.POSITIVE_INFINITY;
    let end = Number.NEGATIVE_INFINITY;
    let markerCount = 0;
    const eventCounts: Record<string, number> = {};
    const movementCounts = new Map<string, number>();
    const movementTimes = new Map<string, number[]>();
    const eventTimes = new Map<number, number[]>();
    for (const journey of selectedJourneys) {
      let movementCount = 0;
      for (const row of journey.rows) {
        if (row[0] < start) start = row[0];
        if (row[0] > end) end = row[0];
        const eventName = EVENT_NAME_BY_CODE[row[4]];
        if (eventName) eventCounts[eventName] = (eventCounts[eventName] ?? 0) + 1;
        if (EVENT_CLASS[row[4]] !== 'movement') {
          markerCount += 1;
          const times = eventTimes.get(row[4]) ?? [];
          times.push(row[0]);
          eventTimes.set(row[4], times);
        } else {
          movementCount += 1;
          const times = movementTimes.get(journeyKey(journey)) ?? [];
          times.push(row[0]);
          movementTimes.set(journeyKey(journey), times);
        }
      }
      movementCounts.set(journeyKey(journey), movementCount);
    }
    for (const times of eventTimes.values()) times.sort((a, b) => a - b);
    return {
      timestampRange: Number.isFinite(start) ? { start, end } : null,
      markerCount,
      eventCounts,
      movementCounts,
      movementTimes,
      eventTimes,
    };
  }, [selectedJourneys]);
  const { timestampRange } = selectedMatchStats;
  const currentMatchTime = timestampRange
    ? timestampRange.start + (timestampRange.end - timestampRange.start) * progress
    : 0;
  const filteredPlayers = useMemo(() => {
    const query = playerQuery.trim().toLowerCase();
    return [...selectedJourneys]
      .filter((journey) => !query || journey.user_id.toLowerCase().includes(query))
      .sort((a, b) => a.entity_type.localeCompare(b.entity_type) || a.user_id.localeCompare(b.user_id));
  }, [selectedJourneys, playerQuery]);
  const selectedEventCounts = selectedMatchStats.eventCounts;
  const markerCount = selectedMatchStats.markerCount;
  const visibleJourneyCount = useMemo(
    () => selectedJourneys.reduce((count, journey) => count + Number(visibleJourneyIds.has(journeyKey(journey))), 0),
    [selectedJourneys, visibleJourneyIds],
  );
  const currentMoment = useMemo(() => {
    let playersSeen = 0;
    for (const journey of selectedJourneys) {
      if (!visibleJourneyIds.has(journeyKey(journey))) continue;
      if ((journey.entity_type === 'human' && !layers.human) || (journey.entity_type === 'bot' && !layers.bot)) continue;
      if (upperBound(selectedMatchStats.movementTimes.get(journeyKey(journey)) ?? [], currentMatchTime) > 0) playersSeen += 1;
    }
    const countCodes = (...codes: number[]) => codes.reduce((sum, code) => sum + upperBound(selectedMatchStats.eventTimes.get(code) ?? [], currentMatchTime), 0);
    return {
      playersSeen,
      kills: countCodes(2, 4),
      deaths: countCodes(3, 5),
      loot: countCodes(7),
      storm: countCodes(6),
    };
  }, [selectedJourneys, visibleJourneyIds, layers.human, layers.bot, selectedMatchStats, currentMatchTime]);
  const heatmapJourneys = heatmapScope === 'match' ? selectedJourneys : journeys;
  const mapGeometry = manifest?.maps[selectedMap];
  const heatmap = useMemo(() => {
    const size = 96;
    const grids = {
      traffic: new Float32Array(size * size),
      kills: new Float32Array(size * size),
      deaths: new Float32Array(size * size),
    };
    if (!mapGeometry) return grids;
    for (const journey of heatmapJourneys) {
      if (!visibleJourneyIds.has(journeyKey(journey))) continue;
      if ((journey.entity_type === 'human' && !layers.human) || (journey.entity_type === 'bot' && !layers.bot)) continue;
      for (const row of journey.rows) {
        const movement = row[4] === 0 || row[4] === 1;
        const category = EVENT_CLASS[row[4]];
        if (!movement && category !== 'kill' && category !== 'death' && category !== 'storm') continue;
        const u = (row[1] - mapGeometry.origin_x) / mapGeometry.scale;
        const v = (row[3] - mapGeometry.origin_z) / mapGeometry.scale;
        if (u < 0 || u > 1 || v < 0 || v > 1) continue;
        const x = Math.min(size - 1, Math.floor(u * size));
        const y = Math.min(size - 1, Math.floor((1 - v) * size));
        const cell = y * size + x;
        if (movement) grids.traffic[cell] += 1;
        else if (category === 'kill') grids.kills[cell] += 1;
        else grids.deaths[cell] += 1;
      }
    }
    return grids;
  }, [heatmapJourneys, visibleJourneyIds, layers.human, layers.bot, mapGeometry]);
  const heatmapSamples = useMemo(() => ({
    traffic: heatmap.traffic.reduce((sum, value) => sum + value, 0),
    kills: heatmap.kills.reduce((sum, value) => sum + value, 0),
    deaths: heatmap.deaths.reduce((sum, value) => sum + value, 0),
  }), [heatmap]);
  const heatmapLeaders = useMemo(() => {
    const size = Math.sqrt(heatmap.traffic.length);
    const result: Partial<Record<'traffic' | 'kills' | 'deaths', { count: number; x: number; z: number }>> = {};
    if (!mapGeometry || !Number.isInteger(size)) return result;
    for (const layer of ['traffic', 'kills', 'deaths'] as const) {
      const grid = heatmap[layer];
      let peak = 0;
      let peakIndex = -1;
      for (let index = 0; index < grid.length; index += 1) {
        if (grid[index] > peak) { peak = grid[index]; peakIndex = index; }
      }
      if (peakIndex < 0) continue;
      const x = peakIndex % size;
      const y = Math.floor(peakIndex / size);
      result[layer] = {
        count: peak,
        x: mapGeometry.origin_x + ((x + 0.5) / size) * mapGeometry.scale,
        z: mapGeometry.origin_z + (1 - (y + 0.5) / size) * mapGeometry.scale,
      };
    }
    return result;
  }, [heatmap, mapGeometry]);

  if (manifestError) return <ErrorScreen message={manifestError} onRetry={retryManifest} />;
  if (!manifest) return <LoadingScreen />;

  const mapInfo = manifest.maps[selectedMap];
  const allSelected = selectedJourneys.length > 0 && selectedJourneys.every((journey) => visibleJourneyIds.has(journeyKey(journey)));
  const resetPlayback = () => {
    setPlaying(false);
    setProgress(0);
    playStart.current = 0;
  };

  const clearFilters = () => {
    resetPlayback();
    setSelectedMap(DEFAULT_MAP);
    setSelectedDate('all');
    setSelectedMatch(defaultMatchId);
  };

  const resetView = () => {
    resetPlayback();
    setVisibleJourneyIds(new Set(journeys.map(journeyKey)));
    setFocusedJourneyId(null);
    setPlayerQuery('');
    setLayers(INITIAL_LAYERS);
    setHeatmapLayers({ traffic: false, kills: false, deaths: false });
    setHeatmapScope('match');
  };

  const activeHeatmaps = (['traffic', 'kills', 'deaths'] as const).filter((layer) => heatmapLayers[layer]);
  const activeHeatmapDescription = activeHeatmaps.length
    ? `${activeHeatmaps.map((layer) => layer === 'traffic' ? 'player traffic' : layer === 'kills' ? 'kill locations' : 'death locations').join(', ')} overlay uses ${heatmapScope === 'match' ? 'the full match' : 'all filtered matches'}.`
    : '';
  const visualizationDescription = playing
    ? `Watching this match unfold. Paths and events stop at the playhead. ${activeHeatmapDescription}`.trim()
    : activeHeatmaps.length
      ? `Showing ${activeHeatmapDescription}`
      : progress >= 1
        ? 'Showing the complete recorded movement and gameplay events for this match.'
      : progress > 0
        ? 'Showing movement and events recorded up to the paused point in this match.'
        : 'Showing player movement and gameplay events for this match.';

  const setEntityLayer = (key: 'human' | 'bot', value: boolean) => setLayers((current) => ({ ...current, [key]: value }));
  const setEventLayer = (key: 'kill' | 'death' | 'loot' | 'storm', value: boolean) => setLayers((current) => ({ ...current, [key]: value }));
  const toggleJourney = (journey: Journey) => {
    const key = journeyKey(journey);
    setVisibleJourneyIds((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setFocusedJourneyId(journey.user_id);
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark"><Activity size={18} strokeWidth={2.5} /></div>
          <div className="brand-name">LILA<span> / </span>BLACK</div>
          <div className="brand-separator" />
          <div className="product-name">PLAYER JOURNEY EXPLORER</div>
        </div>
        <div className="topbar-right">
          <div className="dataset-badge"><span className="live-dot" />STATIC SNAPSHOT</div>
          <div className="topbar-date">{formatDate(manifest.dates[0])} — {formatDate(manifest.dates[manifest.dates.length - 1])}, 2026</div>
          <div className="avatar-mark" title="Level Design workspace">LD</div>
        </div>
      </header>

      <main className="workspace">
        <section className="workspace-heading">
          <div>
            <div className="breadcrumb"><span>LEVEL DESIGN</span><span className="crumb-slash">/</span><span>TELEMETRY</span></div>
            <h1>Player journeys</h1>
            <p>See how players move, fight, loot, and fall across the battlefield.</p>
          </div>
          <div className="snapshot-note"><Database size={14} /><span>{formatCount(manifest.totals.rows)} verified gameplay records</span><span className="snapshot-dot" /></div>
        </section>

        <section className="filter-panel" aria-label="Dataset filters">
          <div className="filter-heading"><Filter size={14} /><span>EXPLORE DATA</span></div>
          <SelectField label="MAP" icon={MapIcon} value={selectedMap} onChange={(value) => { resetPlayback(); setSelectedMap(value as MapId); }}>
            {(Object.entries(manifest.maps) as [MapId, typeof mapInfo][]).map(([id, map]) => (
              <option key={id} value={id}>{map.name}</option>
            ))}
          </SelectField>
          <SelectField label="DATE" icon={CalendarDays} value={selectedDate} onChange={(value) => { resetPlayback(); setSelectedDate(value); }}>
            <option value="all">All dates</option>
            {manifest.dates.map((date) => <option key={date} value={date}>{formatDate(date)}, 2026</option>)}
          </SelectField>
          <SelectField label="MATCH" icon={Crosshair} value={selectedMatch} title="Choose a match by its short ID. Type an ID prefix while the list is open to jump to a match." onChange={(value) => { resetPlayback(); setSelectedMatch(value); }} disabled={!dateScopedMatches.length}>
            {dateScopedMatches.length ? dateScopedMatches.map((match) => (
              <option key={match.match_id} value={match.match_id}>
                {shortMatchId(match.match_id)} · {match.human_count} humans · {match.bot_count} bots
              </option>
            )) : <option value="">No matches</option>}
          </SelectField>
          <div className="filter-result">
            <span className="filter-result-label">MATCHES IN VIEW</span>
            <strong>{dateScopedMatches.length ? formatCount(dateScopedMatches.length) : '—'}</strong>
          </div>
          {(selectedMap !== DEFAULT_MAP || selectedDate !== 'all' || (selectedMatch !== '' && selectedMatch !== defaultMatchId)) && (
            <button className="clear-filter-button" onClick={clearFilters} title="Return to the default map, all available dates, and the recommended match.">
              <RotateCcw size={12} />Reset filters
            </button>
          )}
        </section>

        {dataError ? (
          <section className="inline-error" role="alert">
            <AlertTriangle size={18} />
            <div><strong>Map data could not be loaded</strong><span>{dataError}</span></div>
            <button onClick={() => { setDataError(null); setDataRetry((value) => value + 1); }}>Retry data load</button>
          </section>
        ) : null}

        <section className="workspace-grid">
          <div className="map-column">
            <div className="map-panel">
              <div className="map-panel-header">
                <div className="map-title-lockup">
                  <div className="map-title-icon"><MapIcon size={16} /></div>
                  <div>
                    <span className="map-kicker">BATTLEFIELD OVERVIEW</span>
                    <h2>{mapInfo.name}</h2>
                  </div>
                  <div className="map-tag">TOP DOWN</div>
                </div>
                <div className="map-header-meta">
                  {selectedInfo ? <><span className="match-pulse" /><span>MATCH {shortMatchId(selectedInfo.match_id)}</span><span className="header-meta-divider" /><span>{selectedInfo.human_count} human · {selectedInfo.bot_count} bots</span></> : <span>NO MATCH SELECTED</span>}
                  <button className="reset-view-button" onClick={resetView} title="Restore all player and event layers, clear player focus, hide heatmaps, and restart this match." aria-label="Reset map view">
                    <RotateCcw size={12} />Reset view
                  </button>
                </div>
              </div>

              <div className="analysis-context" aria-live="polite">
                <div className="analysis-context-copy">
                  <span className="analysis-context-label">CURRENT VIEW</span>
                  <strong>{mapInfo.name}<span> / </span>{displayDate(selectedDate)}<span> / </span>{selectedInfo ? `Match ${shortMatchId(selectedInfo.match_id)}` : 'No match'}</strong>
                  <p>{dataError ? 'Gameplay data could not be loaded for this selection.' : visualizationDescription}</p>
                </div>
                <div className="playback-state" title="Progress is relative because the source timestamp unit has not been confirmed.">
                  <span className={playing ? 'state-playing-dot' : 'state-paused-dot'} />
                  <span>{playing ? 'PLAYING' : progress >= 1 ? 'COMPLETE' : 'PAUSED'}</span>
                  <strong>{Math.round(progress * 100)}%</strong>
                </div>
              </div>

              <div className="map-entity-toolbar" aria-label="Map legend and visibility controls">
                <span className="toolbar-label" title="Choose which player and event layers are drawn on the minimap.">MAP KEY & LAYERS</span>
                <button title="Show or hide human-controlled player paths. Solid teal lines identify players." className={`layer-chip ${layers.human ? 'is-active human-chip' : ''}`} onClick={() => setEntityLayer('human', !layers.human)} aria-pressed={layers.human}>
                  <span className="line-swatch human-swatch" />Human
                </button>
                <button title="Show or hide AI-controlled bot paths. Dashed violet lines identify bots." className={`layer-chip ${layers.bot ? 'is-active bot-chip' : ''}`} onClick={() => setEntityLayer('bot', !layers.bot)} aria-pressed={layers.bot}>
                  <span className="line-swatch bot-swatch" />Bots
                </button>
                <span className="toolbar-separator" />
                <button title="Show or hide kill markers. Counts include the full selected match, not only the current playhead." className="layer-chip event-chip" onClick={() => setEventLayer('kill', !layers.kill)} aria-pressed={layers.kill}>
                  <span className="event-swatch kill-swatch" />Kill <span className="chip-count">{formatCount((selectedEventCounts.Kill ?? 0) + (selectedEventCounts.BotKill ?? 0))}</span>
                </button>
                <button title="Show or hide player and bot death markers. Counts include the full selected match." className="layer-chip event-chip" onClick={() => setEventLayer('death', !layers.death)} aria-pressed={layers.death}>
                  <span className="event-swatch death-swatch" />Death <span className="chip-count">{formatCount((selectedEventCounts.Killed ?? 0) + (selectedEventCounts.BotKilled ?? 0))}</span>
                </button>
                <button title="Show or hide loot markers. Counts include the full selected match." className="layer-chip event-chip" onClick={() => setEventLayer('loot', !layers.loot)} aria-pressed={layers.loot}>
                  <span className="event-swatch loot-swatch" />Loot <span className="chip-count">{formatCount(selectedEventCounts.Loot ?? 0)}</span>
                </button>
                <button title="Show or hide storm-death markers. Counts include the full selected match." className="layer-chip event-chip" onClick={() => setEventLayer('storm', !layers.storm)} aria-pressed={layers.storm}>
                  <span className="event-swatch storm-swatch" />Storm death <span className="chip-count">{formatCount(selectedEventCounts.KilledByStorm ?? 0)}</span>
                </button>
                <span className="journey-style-note" title="Path color and pattern identify the entity; marker shape identifies the event. B means a bot is involved in that event. Hollow and filled dots distinguish path start from current position.">B = bot involved · hollow start · filled current</span>
              </div>

              <div className="map-viewport">
                {dataError ? (
                  <div className="map-placeholder"><AlertTriangle size={24} /><strong>Gameplay data could not be loaded.</strong><span>Try loading again or choose a different date.</span></div>
                ) : !dateScopedMatches.length ? (
                  <div className="map-placeholder"><Crosshair size={26} /><strong>No gameplay data matches these filters.</strong><span>Try another map, date, or match.</span></div>
                ) : (
                  <MapCanvas
                    map={mapInfo}
                    journeys={selectedJourneys}
                    visibleJourneyIds={visibleJourneyIds}
                    focusedJourneyId={focusedJourneyId}
                    layers={layers}
                    loading={loadingData || !selectedMatch}
                    currentTime={currentMatchTime}
                    heatmap={heatmap}
                    heatmapLayers={heatmapLayers}
                    currentTimeLabel={timestampRange ? `${Math.round(progress * 100)}% through match` : 'No time range'}
                  />
                )}
              </div>

              <div className="heatmap-toolbar" aria-label="Heatmap controls">
                <div className="heatmap-control-label"><Activity size={13} /><span>HEATMAPS</span></div>
                <div className="heatmap-modes">
                  {(['traffic', 'kills', 'deaths'] as const).map((layer) => (
                    <button key={layer} title={`${heatmapLayers[layer] ? 'Hide' : 'Show'} ${layer === 'traffic' ? 'position-sample density: recorded human and bot movement locations.' : layer === 'kills' ? 'kill-event density: recorded human and bot kill locations.' : 'death-event density: recorded player, bot, and storm death locations.'} No smoothing is applied.`} className={`heatmap-mode ${heatmapLayers[layer] ? 'is-active' : ''} heatmap-${layer}`} onClick={() => setHeatmapLayers((current) => ({ ...current, [layer]: !current[layer] }))} aria-pressed={heatmapLayers[layer]}>
                      <span className={`heatmap-dot ${layer}`} />{layer === 'traffic' ? 'Player traffic' : layer === 'kills' ? 'Kill locations' : 'Death locations'} <span className="heatmap-count">{formatCount(heatmapSamples[layer])}</span>
                    </button>
                  ))}
                </div>
                <label className="heatmap-scope">Scope
                  <select value={heatmapScope} title="Heatmaps aggregate all rows in this match or all matches matching the selected map and date." onChange={(event) => setHeatmapScope(event.target.value as 'match' | 'selection')}>
                    <option value="match">This match</option><option value="selection">All filtered matches</option>
                  </select>
                </label>
                {Object.values(heatmapLayers).some(Boolean) && <span className="heatmap-sample-count" title="Heatmaps use all eligible records in the selected scope, regardless of playback position.">Full selected scope · not limited by playhead</span>}
              </div>
              <div className="heatmap-legend" aria-label="Heatmap legend">
                <span className="legend-heading">HEATMAP KEY</span>
                <span className="legend-method">Brighter cells contain more recorded positions or events. Each layer scales to its own busiest cell; cells are binned without smoothing.</span>
                {activeHeatmaps.length > 0 && <span className="legend-heading observation-heading">KEY OBSERVATIONS</span>}
                {activeHeatmaps.map((layer) => {
                  const leader = heatmapLeaders[layer];
                  const label = layer === 'traffic' ? 'traffic' : layer === 'kills' ? 'kills' : 'deaths';
                  const unit = layer === 'traffic'
                    ? (leader?.count === 1 ? 'position sample' : 'position samples')
                    : (leader?.count === 1 ? 'event' : 'events');
                  return leader ? (
                    <span className="heatmap-observation" key={layer} title="Highest-count 96 × 96 cell. Coordinates are the cell center; the count is the actual number of records in that cell.">
                      <i className={`heatmap-dot ${layer}`} />Most {label}: {formatCount(leader.count)} {unit} near X {leader.x.toFixed(1)}, Z {leader.z.toFixed(1)}
                    </span>
                  ) : null;
                })}
                {activeHeatmaps.map((layer) => <span key={layer} className="heatmap-intensity-label" title={`${layer === 'traffic' ? 'Traffic' : layer === 'kills' ? 'Kill' : 'Death'} intensity is scaled relative to that layer's busiest cell.`}>LOW <i className={`heatmap-intensity ${layer}`} /> HIGH</span>)}
              </div>

              <div className="playback-bar" aria-label="Match timeline controls">
                <button className="play-button" onClick={() => {
                  if (playing) { playStart.current = 0; setPlaying(false); return; }
                  if (progress >= 1) setProgress(0);
                  playStart.current = 0;
                  setPlaying(true);
                }} aria-label={playing ? 'Pause playback' : 'Play match'} disabled={!timestampRange || timestampRange.start === timestampRange.end}>{playing ? <Pause size={15} /> : <Play size={15} fill="currentColor" />}</button>
                <button className="restart-button" onClick={resetPlayback} aria-label="Restart playback" disabled={!timestampRange}><RotateCcw size={14} /></button>
                <div className="playback-title" title="Watch this match in recorded chronological order. Its time span is shown in the values supplied by the source; seconds or milliseconds have not been confirmed."><span>MATCH REPLAY</span><small>{timestampRange ? `Span: ${formatCount(timestampRange.end - timestampRange.start)} recorded units` : 'No recorded time range'}</small></div>
                <span className="playback-edge" title={timestampRange ? `First recorded value: ${timestampRange.start}` : undefined}>START</span>
                <input className="timeline-slider" type="range" min={timestampRange?.start ?? 0} max={timestampRange?.end ?? 1} step="1" value={timestampRange ? Math.round(currentMatchTime) : 0} disabled={!timestampRange || timestampRange.start === timestampRange.end} onChange={(event) => {
                  const value = Number(event.target.value);
                  const next = timestampRange && timestampRange.end > timestampRange.start ? (value - timestampRange.start) / (timestampRange.end - timestampRange.start) : 0;
                  setProgress(Math.max(0, Math.min(1, next))); setPlaying(false); playStart.current = 0;
                }} aria-label="Match replay timeline" title="Scrub through this match in timestamp order. Events after the playhead remain hidden." />
                <span className="playback-edge" title={timestampRange ? `Last recorded value: ${timestampRange.end}` : undefined}>END</span>
                <div className="playback-current" title={`Recorded timestamp ${Math.round(currentMatchTime)}; source time units are unconfirmed.`}><span>REPLAY POSITION</span><strong>{timestampRange ? `${Math.round(progress * 100)}% through match` : '—'}</strong></div>
                <label className="playback-rate" title="Change how quickly the replay advances.">Speed<select value={playbackRate} onChange={(event) => { playStart.current = 0; setPlaybackRate(Number(event.target.value)); }}><option value="0.5">0.5×</option><option value="1">1×</option><option value="2">2×</option><option value="4">4×</option></select></label>
              </div>

              <div className="moment-summary" aria-live="polite" aria-label="Current moment summary">
                <span className="moment-heading" title="Counts include recorded events at or before the replay position."><CircleHelp size={12} />CURRENT MOMENT</span>
                <span title="Distinct journeys with at least one recorded movement position by this point."><Users size={12} />Players seen <strong>{formatCount(currentMoment.playersSeen)}</strong></span>
                <span title="Kill events at or before this point."><i className="event-swatch kill-swatch" />Kills <strong>{formatCount(currentMoment.kills)}</strong></span>
                <span title="Player and bot death events at or before this point; storm deaths are shown separately."><i className="event-swatch death-swatch" />Deaths <strong>{formatCount(currentMoment.deaths)}</strong></span>
                <span title="Loot events at or before this point."><i className="event-swatch loot-swatch" />Loot <strong>{formatCount(currentMoment.loot)}</strong></span>
                <span title="Storm death events at or before this point."><i className="event-swatch storm-swatch" />Storm deaths <strong>{formatCount(currentMoment.storm)}</strong></span>
                <small>Counts include recorded activity through the playhead.</small>
              </div>

              <div className="map-panel-footer">
                <div className="journey-visibility"><Eye size={13} /><span>{formatCount(visibleJourneyCount)} / {formatCount(selectedJourneys.length)} journeys visible</span></div>
                <div className="timestamp-note"><CircleHelp size={13} /><span>Future movement and events stay hidden until the replay reaches them.</span></div>
              </div>
            </div>
          </div>

          <aside className="detail-panel" aria-label="Match and player details">
            <div className="detail-panel-heading">
              <div><span className="panel-eyebrow">SESSION DETAILS</span><h2>Match intel</h2></div>
              <div className={`intel-status ${selectedInfo ? '' : 'status-empty'}`}><span />{selectedInfo ? 'MATCH SELECTED' : 'NO MATCH'}</div>
            </div>
            {selectedInfo ? (
              <div className="session-card">
                <div className="session-card-top"><span>SESSION ID</span><Crosshair size={14} /></div>
                <strong>{selectedInfo.match_id.replace('.nakama-0', '')}</strong>
                <div className="session-card-meta">
                  <span><MapIcon size={12} />{mapInfo.name}</span>
                  <span><CalendarDays size={12} />{selectedInfo.source_dates.map(formatDate).join(' + ')}</span>
                </div>
                <div className="session-stats">
                  <div><span>HUMANS</span><strong>{selectedInfo.human_count}</strong></div>
                  <div><span>BOTS</span><strong>{selectedInfo.bot_count}</strong></div>
                  <div><span>ROWS</span><strong>{formatCount(selectedInfo.row_count)}</strong></div>
                </div>
              </div>
            ) : (
              <div className="no-session-card"><Crosshair size={17} /><span>Select a match to inspect its journeys.</span></div>
            )}

            <div className="panel-section-heading">
              <div><span className="panel-eyebrow">ENTITY ROSTER</span><h3>Player journeys <span className="roster-count">{selectedJourneys.length}</span></h3></div>
              <button className="text-action" onClick={() => {
                const keys = selectedJourneys.map(journeyKey);
                setVisibleJourneyIds(allSelected ? new Set() : new Set(keys));
                setFocusedJourneyId(null);
              }}>{allSelected ? <><EyeOff size={13} />Hide all</> : <><Eye size={13} />Show all</>}</button>
            </div>

            <div className="player-search">
              <Search size={14} />
              <input value={playerQuery} onChange={(event) => setPlayerQuery(event.target.value)} placeholder="Find player by ID" aria-label="Find player by ID" />
              {playerQuery && <button onClick={() => setPlayerQuery('')} aria-label="Clear player search">×</button>}
            </div>

            <div className="roster-list" role="list" aria-label="Player and bot journeys">
              {loadingData ? (
                <div className="roster-loading"><span className="spinner" />Loading roster</div>
              ) : filteredPlayers.length ? filteredPlayers.map((journey) => {
                const key = journeyKey(journey);
                const visible = visibleJourneyIds.has(key);
                const focused = focusedJourneyId === journey.user_id;
                const movementCount = selectedMatchStats.movementCounts.get(key) ?? 0;
                return (
                  <div className={`roster-row ${focused ? 'is-focused' : ''} ${!visible ? 'is-hidden' : ''}`} key={key} role="listitem">
                    <button className={`roster-entity-mark ${journey.entity_type}`} onClick={() => toggleJourney(journey)} aria-label={`${visible ? 'Hide' : 'Show'} ${journey.entity_type} ${journey.user_id}`}>
                      {visible ? <Eye size={13} /> : <EyeOff size={13} />}
                    </button>
                    <button className="roster-identity" onClick={() => setFocusedJourneyId(focused ? null : journey.user_id)} aria-pressed={focused}>
                      <span className={`entity-line-indicator ${journey.entity_type}`} />
                      <span className="roster-identity-copy"><strong>{journey.user_id}</strong><small>{formatCount(movementCount)} movement samples</small></span>
                    </button>
                    <span className={`entity-tag ${journey.entity_type}`}>{journey.entity_type === 'human' ? 'PLAYER' : 'BOT'}</span>
                  </div>
                );
              }) : (
                <div className="roster-empty">{playerQuery ? <><span>No player IDs match “{playerQuery}”.</span><button onClick={() => setPlayerQuery('')}>Reset search</button></> : 'No journeys in this match.'}</div>
              )}
            </div>

            <div className="roster-footer"><span>{formatCount(filteredPlayers.length)} entities</span><span>·</span><span>{formatCount(markerCount)} event markers</span></div>

              <div className="intel-footnote">
              <div className="footnote-icon"><ArrowDownUp size={14} /></div>
              <div><strong>Reading the replay</strong><p>The timeline follows the order recorded in the match. Its original time units are not defined, so progress is shown relative to the match.</p></div>
            </div>
          </aside>
        </section>

        <footer className="app-footer">
          <div><span className="footer-brand-dot" />LILA GAMES <span className="footer-slash">/</span> LEVEL DESIGN TOOLS</div>
          <div className="footer-center"><span>DATA SOURCE</span> FEBRUARY 10–14, 2026 <span className="footer-slash">·</span> {formatCount(manifest.totals.duplicate_rows_removed)} DUPLICATE ROWS EXCLUDED</div>
          <div className="footer-right">PLAYER JOURNEY EXPLORER <span>v1.0</span></div>
        </footer>
      </main>
    </div>
  );
}
