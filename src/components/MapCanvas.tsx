import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import type { Journey, MapInfo, Row } from '../data';
import { EVENT_CLASS, formatCount } from '../data';

export interface LayerVisibility {
  human: boolean;
  bot: boolean;
  kill: boolean;
  death: boolean;
  loot: boolean;
  storm: boolean;
}

interface MapCanvasProps {
  map: MapInfo;
  journeys: Journey[];
  visibleJourneyIds: Set<string>;
  focusedJourneyId: string | null;
  layers: LayerVisibility;
  loading: boolean;
  currentTime: number;
  currentTimeLabel: string;
  heatmap: { traffic: Float32Array; kills: Float32Array; deaths: Float32Array };
  heatmapLayers: { traffic: boolean; kills: boolean; deaths: boolean };
}

const COLORS = {
  human: '#56d8c6',
  bot: '#c49bff',
  kill: '#ff755e',
  death: '#f8f4ed',
  loot: '#f6cc70',
  storm: '#7db8ff',
};

const EVENT_TITLES: Record<number, string> = {
  2: 'Kill',
  3: 'Death',
  4: 'Killed a bot',
  5: 'Killed by a bot',
  6: 'Storm death',
  7: 'Loot',
};

function journeyKey(journey: Journey): string {
  return `${journey.user_id}|${journey.match_id}`;
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

function markerClass(code: number): 'kill' | 'death' | 'loot' | 'storm' | 'movement' {
  return EVENT_CLASS[code] ?? 'movement';
}

function drawMarker(ctx: CanvasRenderingContext2D, x: number, y: number, code: number, size: number): void {
  const category = markerClass(code);
  if (category === 'movement') return;
  const color = category === 'death' && code === 5 ? COLORS.bot : COLORS[category];

  ctx.save();
  ctx.translate(x, y);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#0a0e10';
  ctx.fillStyle = color;

  if (category === 'kill') {
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-size * 0.63, -size * 0.63, size * 1.26, size * 1.26);
    ctx.strokeRect(-size * 0.63, -size * 0.63, size * 1.26, size * 1.26);
    ctx.rotate(-Math.PI / 4);
    if (code === 4) {
      ctx.fillStyle = '#121619';
      ctx.font = `800 ${size * 0.75}px Inter, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('B', 0, 0.5);
    }
  } else if (category === 'death') {
    ctx.beginPath();
    ctx.arc(0, 0, size, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (code === 5) {
      ctx.fillStyle = '#211a2a';
      ctx.font = `800 ${size * 0.75}px Inter, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('B', 0, 0.5);
    }
    ctx.strokeStyle = '#15191c';
    ctx.lineWidth = 1.7;
    ctx.beginPath();
    ctx.moveTo(-size * 0.43, -size * 0.43);
    ctx.lineTo(size * 0.43, size * 0.43);
    ctx.moveTo(size * 0.43, -size * 0.43);
    ctx.lineTo(-size * 0.43, size * 0.43);
    ctx.stroke();
  } else if (category === 'loot') {
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.85, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#16191a';
    ctx.fillRect(-size * 0.3, -size * 0.28, size * 0.6, size * 0.56);
  } else {
    ctx.beginPath();
    ctx.arc(0, 0, size * 1.25, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.7;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -size * 0.58);
    ctx.lineTo(size * 0.48, size * 0.38);
    ctx.lineTo(-size * 0.48, size * 0.38);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#101518';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.restore();
}

export function MapCanvas({ map, journeys, visibleJourneyIds, focusedJourneyId, layers, loading, currentTime, currentTimeLabel, heatmap, heatmapLayers }: MapCanvasProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [imageError, setImageError] = useState(false);
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [hoverInfo, setHoverInfo] = useState<{ left: number; top: number; hits: { journey: Journey; row: Row }[] } | null>(null);

  useEffect(() => {
    setImageError(false);
    setNaturalSize({ width: 0, height: 0 });
  }, [map.image]);

  useEffect(() => {
    const element = frameRef.current;
    if (!element) return undefined;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setViewportSize({ width: rect.width, height: rect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const frameSize = useMemo(() => {
    if (!naturalSize.width || !naturalSize.height || !viewportSize.width || !viewportSize.height) {
      return { width: 0, height: 0 };
    }
    const scale = Math.min(
      (viewportSize.width - 28) / naturalSize.width,
      (viewportSize.height - 60) / naturalSize.height,
      1,
    );
    return {
      width: Math.max(0, naturalSize.width * scale),
      height: Math.max(0, naturalSize.height * scale),
    };
  }, [naturalSize, viewportSize]);

  const drawableJourneys = useMemo(
    () => journeys.filter((journey) => {
      const isVisible = visibleJourneyIds.has(journeyKey(journey));
      const classVisible = journey.entity_type === 'human' ? layers.human : layers.bot;
      return isVisible && classVisible;
    }),
    [journeys, visibleJourneyIds, layers.human, layers.bot],
  );
  const heatmapCanvases = useMemo(() => {
    const colors = { traffic: '#35d7be', kills: '#ff6f52', deaths: '#aa89ff' };
    const result: Partial<Record<'traffic' | 'kills' | 'deaths', HTMLCanvasElement>> = {};
    for (const layer of ['traffic', 'kills', 'deaths'] as const) {
      const grid = heatmap[layer];
      const size = Math.sqrt(grid.length);
      const peak = grid.reduce((value, count) => Math.max(value, count), 0);
      if (peak === 0 || !Number.isInteger(size)) continue;
      const offscreen = document.createElement('canvas');
      offscreen.width = size;
      offscreen.height = size;
      const context = offscreen.getContext('2d');
      if (!context) continue;
      const image = context.createImageData(size, size);
      const color = colors[layer];
      const rgb = [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16));
      for (let i = 0; i < grid.length; i += 1) {
        if (!grid[i]) continue;
        const strength = Math.log1p(grid[i]) / Math.log1p(peak);
        const offset = i * 4;
        image.data[offset] = rgb[0];
        image.data[offset + 1] = rgb[1];
        image.data[offset + 2] = rgb[2];
        image.data[offset + 3] = Math.round(110 + 75 * strength);
      }
      context.putImageData(image, 0, 0);
      result[layer] = offscreen;
    }
    return result;
  }, [heatmap]);

  const inspectMap = (event: PointerEvent<HTMLDivElement>) => {
    if (!frameSize.width || !frameSize.height || loading) { setHoverInfo(null); return; }
    const rect = event.currentTarget.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;
    let closestEvent: { distance: number; journey: Journey; row: Row } | null = null;
    let closestPosition: { distance: number; journey: Journey; row: Row } | null = null;
    const eventHits: { distance: number; journey: Journey; row: Row }[] = [];
    for (const journey of drawableJourneys) {
      for (const row of journey.rows) {
        if (row[0] > currentTime) break;
        const kind = markerClass(row[4]);
        if (kind !== 'movement' && !layers[kind]) continue;
        const x = ((row[1] - map.origin_x) / map.scale) * frameSize.width;
        const y = (1 - (row[3] - map.origin_z) / map.scale) * frameSize.height;
        const distance = Math.hypot(pointerX - x, pointerY - y);
        if (kind !== 'movement') {
          if (distance <= 7) eventHits.push({ distance, journey, row });
          if (distance <= 14 && (!closestEvent || distance < closestEvent.distance)) closestEvent = { distance, journey, row };
        } else if (distance <= 14 && (!closestPosition || distance < closestPosition.distance)) {
          closestPosition = { distance, journey, row };
        }
      }
    }
    const best = closestEvent ?? closestPosition;
    if (!best) { setHoverInfo(null); return; }
    const hits = eventHits.length
      ? eventHits.sort((a, b) => a.distance - b.distance || b.row[0] - a.row[0]).map(({ journey, row }) => ({ journey, row }))
      : [{ journey: best.journey, row: best.row }];
    setHoverInfo({
      left: Math.max(8, Math.min(frameSize.width - 238, pointerX + 12)),
      top: Math.max(8, Math.min(frameSize.height - 170, pointerY + 12)),
      hits,
    });
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !frameSize.width || !frameSize.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const backingWidth = Math.round(frameSize.width * dpr);
    const backingHeight = Math.round(frameSize.height * dpr);
    if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
      canvas.width = backingWidth;
      canvas.height = backingHeight;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, frameSize.width, frameSize.height);

    for (const layer of ['traffic', 'kills', 'deaths'] as const) {
      const heatCanvas = heatmapCanvases[layer];
      if (heatmapLayers[layer] && heatCanvas) {
        ctx.save();
        ctx.globalAlpha = 0.68;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(heatCanvas, 0, 0, frameSize.width, frameSize.height);
        ctx.restore();
      }
    }

    const point = (row: Row): [number, number] => {
      const u = (row[1] - map.origin_x) / map.scale;
      const v = (row[3] - map.origin_z) / map.scale;
      return [u * frameSize.width, (1 - v) * frameSize.height];
    };

    const drawPaths = (entityType: 'bot' | 'human') => {
      for (const journey of drawableJourneys) {
        if (journey.entity_type !== entityType) continue;
        const focused = focusedJourneyId === journey.user_id;
        const otherFocused = focusedJourneyId !== null && !focused;
        ctx.save();
        ctx.globalAlpha = otherFocused ? 0.13 : focused ? 0.96 : entityType === 'human' ? 0.62 : 0.46;
        ctx.strokeStyle = entityType === 'human' ? COLORS.human : COLORS.bot;
        ctx.lineWidth = focused ? 2.5 : entityType === 'human' ? 1.8 : 1.5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.setLineDash(entityType === 'bot' ? [5, 4] : []);

        let started = false;
        let firstPoint: [number, number] | null = null;
        let lastPoint: [number, number] | null = null;
        ctx.beginPath();
        for (const row of journey.rows) {
          if (row[0] > currentTime) break;
          if (row[4] !== 0 && row[4] !== 1) continue;
          const [x, y] = point(row);
          if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > frameSize.width || y < 0 || y > frameSize.height) {
            started = false;
            continue;
          }
          if (!firstPoint) firstPoint = [x, y];
          if (!started) {
            ctx.moveTo(x, y);
            started = true;
          } else {
            ctx.lineTo(x, y);
          }
          lastPoint = [x, y];
        }
        ctx.stroke();
        ctx.setLineDash([]);
        if (firstPoint) {
          ctx.beginPath();
          ctx.arc(firstPoint[0], firstPoint[1], focused ? 3.6 : 3, 0, Math.PI * 2);
          ctx.fillStyle = '#101618';
          ctx.fill();
          ctx.strokeStyle = entityType === 'human' ? COLORS.human : COLORS.bot;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
        if (lastPoint) {
          ctx.fillStyle = ctx.strokeStyle;
          ctx.beginPath();
          ctx.arc(lastPoint[0], lastPoint[1], focused ? 3.8 : 3.2, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#0b1011';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        ctx.restore();
      }
    };

    drawPaths('bot');
    drawPaths('human');

    const enabled = (category: string) => category !== 'movement' && layers[category as keyof LayerVisibility];
    for (const journey of drawableJourneys) {
      for (const row of journey.rows) {
        if (row[0] > currentTime) break;
        const category = markerClass(row[4]);
        if (!enabled(category)) continue;
        const [x, y] = point(row);
        if (x < 0 || x > frameSize.width || y < 0 || y > frameSize.height) continue;
        drawMarker(ctx, x, y, row[4], focusedJourneyId === journey.user_id ? 5.1 : 4.5);
      }
    }
  }, [drawableJourneys, focusedJourneyId, frameSize, layers, map, currentTime, heatmapCanvases, heatmapLayers]);

  const visibleEventTimes = useMemo(() => {
    const times: number[] = [];
    for (const journey of journeys) {
      if (!visibleJourneyIds.has(journeyKey(journey))) continue;
      if ((journey.entity_type === 'human' && !layers.human) || (journey.entity_type === 'bot' && !layers.bot)) continue;
      for (const row of journey.rows) {
        const category = markerClass(row[4]);
        if (category !== 'movement' && layers[category]) times.push(row[0]);
      }
    }
    times.sort((a, b) => a - b);
    return times;
  }, [journeys, visibleJourneyIds, layers]);
  const eventCount = upperBound(visibleEventTimes, currentTime);

  return (
    <div ref={frameRef} className="map-frame-wrap">
      <div className="map-frame" style={{ width: frameSize.width, height: frameSize.height }} onPointerMove={inspectMap} onPointerLeave={() => setHoverInfo(null)}>
        <img
          className="map-image"
          src={map.image}
          alt={`${map.name} minimap`}
          onLoad={(event) => {
            const image = event.currentTarget;
            setNaturalSize({ width: image.naturalWidth, height: image.naturalHeight });
          }}
          onError={() => setImageError(true)}
        />
        <canvas ref={canvasRef} className="map-canvas" aria-label={`${map.name} player journey visualization`} />
        {loading && (
          <div className="map-overlay-state">
            <span className="spinner" />
            <span>Loading journey data</span>
          </div>
        )}
        {imageError && (
          <div className="map-overlay-state map-error">
            <strong>Map image unavailable</strong>
            <span>Check that the minimap asset was generated.</span>
          </div>
        )}
        {!loading && !journeys.length && (
          <div className="map-overlay-state map-empty">
            <span className="empty-crosshair">⌖</span>
            <strong>No journeys for these filters</strong>
            <span>Choose another date or map to continue.</span>
          </div>
        )}
        <div className="map-coord-note" title="Hollow circle: recorded journey start. Filled circle: latest position reached at the current replay point."><span className="start-key-mark" />Start <span className="end-key-mark" />Current position</div>
        {hoverInfo && (
          <div className="map-inspection-tooltip" style={{ left: hoverInfo.left, top: hoverInfo.top }} role="tooltip">
            {EVENT_CLASS[hoverInfo.hits[0].row[4]] !== 'movement' ? (
              <>
              <strong>{hoverInfo.hits.length > 1 ? `${hoverInfo.hits.length} events nearby` : EVENT_TITLES[hoverInfo.hits[0].row[4]]}</strong>
                {hoverInfo.hits.slice(0, 4).map(({ journey, row }, index) => (
                  <span key={`${journey.user_id}-${row[0]}-${row[4]}-${index}`}><b>{EVENT_TITLES[row[4]]}</b> · {journey.entity_type === 'bot' ? 'Bot' : 'Human'} · {journey.user_id.length > 16 ? `${journey.user_id.slice(0, 8)}…${journey.user_id.slice(-4)}` : journey.user_id} · {formatCount(row[0])}</span>
                ))}
                {hoverInfo.hits.length > 4 && <span>+{hoverInfo.hits.length - 4} more records here</span>}
              </>
            ) : (
              <>
                <strong>{hoverInfo.hits[0].journey.entity_type === 'bot' ? 'Bot movement' : 'Player movement'}</strong>
                <span>{hoverInfo.hits[0].journey.entity_type === 'bot' ? 'Bot' : 'Human player'} · {hoverInfo.hits[0].journey.user_id.length > 16 ? `${hoverInfo.hits[0].journey.user_id.slice(0, 8)}…${hoverInfo.hits[0].journey.user_id.slice(-4)}` : hoverInfo.hits[0].journey.user_id}</span>
                <span>Position recorded: {formatCount(hoverInfo.hits[0].row[0])}</span>
              </>
            )}
            <span>World X {hoverInfo.hits[0].row[1].toFixed(1)} · Z {hoverInfo.hits[0].row[3].toFixed(1)}</span>
            <small>{currentTimeLabel}</small>
          </div>
        )}
      </div>
      <div className="map-footer">
        <div className="map-footer-note">
          <span className="live-dot" />
          <span>Showing {formatCount(drawableJourneys.length)} of {formatCount(journeys.length)} journeys</span>
          <span className="footer-divider" />
          <span>{formatCount(eventCount)} event markers</span>
        </div>
        <div className="map-footer-right">MATCH PATHS · TOP-DOWN VIEW</div>
      </div>
    </div>
  );
}
