/**
 * PRICE CHART — Zenith AI v2
 * Canvas-based candlestick chart with SMC zones overlay.
 *
 * Overlays rendered from analysis prop:
 *   • Order Blocks (bullish = teal, bearish = red) — horizontal price bands
 *   • Fair Value Gaps (bullish = blue, bearish = red, lighter fill)
 *   • BOS lines — dashed horizontal at break level (teal/red)
 *   • CHoCH lines — dashed horizontal at break level (purple)
 *   • Swing High / Low triangles — matched by timestamp
 *   • Current price — dashed blue with label
 *
 * Interactions:
 *   • Scroll wheel — zoom in/out (candle count)
 *   • Drag — pan left/right
 *   • Hover — crosshair + OHLCV tooltip
 *
 * Props:
 *   symbol    — e.g. 'BTCUSDT'
 *   timeframe — '15m' | '1h' | '4h' | '1d'
 *   analysis  — full MTF analysis result from /api/trade { timeframes: {...} }
 *   height    — px (default 400)
 */
'use client';
import { useRef, useEffect, useState, useCallback } from 'react';

// ── MEXC public klines interval mapping ───────────────────────────────────────
const MEXC_IV = { '15m': '15m', '1h': '60m', '4h': '4h', '1d': '1d' };

// ── Color palette (Zenith dark theme) ─────────────────────────────────────────
const C = {
  bg:         '#0A0D13',
  axisArea:   '#0d1018',
  grid:       '#111620',
  axisBorder: '#1a1f2e',
  textDim:    '#2e3448',
  textMid:    '#4a5270',
  bull:       '#5EEAD4',
  bear:       '#ff6b6b',
  bullBody:   '#5EEAD4',
  bearBody:   '#ff6b6b',
  bullWick:   '#3dbea8',
  bearWick:   '#cc4444',
  curPrice:   '#7C9CFF',
  crosshair:  'rgba(90,96,120,0.45)',
  // SMC overlays
  obBull:     'rgba(94,234,212,0.11)',
  obBullBdr:  'rgba(94,234,212,0.28)',
  obBear:     'rgba(255,107,107,0.10)',
  obBearBdr:  'rgba(255,107,107,0.26)',
  fvgBull:    'rgba(124,156,255,0.07)',
  fvgBear:    'rgba(255,107,107,0.06)',
  bosBull:    'rgba(94,234,212,0.7)',
  bosBear:    'rgba(255,107,107,0.7)',
  choch:      'rgba(218,119,242,0.7)',
  swing:      '#ffa94d',
  volBull:    'rgba(94,234,212,0.18)',
  volBear:    'rgba(255,107,107,0.14)',
};

// ── Layout constants ──────────────────────────────────────────────────────────
const PRICE_AXIS_W = 72;
const TIME_AXIS_H  = 26;
const PAD_TOP      = 14;
const VOL_RATIO    = 0.13; // fraction of chart height for volume

// ─────────────────────────────────────────────────────────────────────────────

function formatPrice(p) {
  if (!p) return '—';
  if (p >= 1000)  return p.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (p >= 1)     return p.toFixed(4);
  return p.toFixed(6);
}

function formatTime(ts, tf) {
  const d = new Date(ts);
  if (tf === '1d') return `${d.getMonth()+1}/${d.getDate()}`;
  if (tf === '4h') return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}h`;
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function PriceChart({ symbol = 'BTCUSDT', timeframe = '4h', analysis = null, height = 400 }) {
  const containerRef = useRef(null);
  const canvasRef    = useRef(null);

  // Mutable chart state (not causing re-renders)
  const st = useRef({
    candles:    [],
    viewStart:  0,
    viewCount:  80,
    hoveredX:   null,
    hoveredY:   null,
    timeMap:    new Map(), // openTime → chartIndex
  });

  const [candles,    setCandles]    = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState(null);
  const [viewRange,  setViewRange]  = useState({ start: 0, count: 80 });
  const [tooltip,    setTooltip]    = useState(null); // { candle, x }

  // Drag state
  const drag = useRef({ active: false, startX: 0, startView: 0 });

  // ── Fetch klines ────────────────────────────────────────────────────────────

  const fetchKlines = useCallback(async (isInitial = false) => {
    if (isInitial) setLoading(true);
    setError(null);
    try {
      const iv  = MEXC_IV[timeframe] ?? timeframe;
      const url = `https://api.mexc.com/api/v3/klines?symbol=${symbol}&interval=${iv}&limit=250`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`MEXC API ${res.status}`);
      const raw = await res.json();
      if (!Array.isArray(raw) || raw.length === 0) throw new Error('No data');

      const data = raw.map(k => ({
        time:   Number(k[0]),
        open:   parseFloat(k[1]),
        high:   parseFloat(k[2]),
        low:    parseFloat(k[3]),
        close:  parseFloat(k[4]),
        volume: parseFloat(k[5]),
      }));

      // Build time → index map for matching SMC timestamps
      const tMap = new Map();
      data.forEach((c, i) => tMap.set(c.time, i));

      // On first load, default to the most recent 80 candles. On a
      // background refresh, keep whatever the user has zoomed/panned to
      // instead of yanking their view back every 15s.
      let start, count;
      if (isInitial || !st.current.candles.length) {
        count = Math.min(80, data.length);
        start = Math.max(0, data.length - count);
      } else {
        count = Math.min(st.current.viewCount, data.length);
        start = Math.max(0, Math.min(st.current.viewStart, data.length - count));
      }

      st.current.candles   = data;
      st.current.viewStart = start;
      st.current.viewCount = count;
      st.current.timeMap   = tMap;

      setCandles(data);
      setViewRange({ start, count });
    } catch (e) {
      setError(e.message);
    } finally {
      if (isInitial) setLoading(false);
    }
  }, [symbol, timeframe]);

  useEffect(() => { fetchKlines(true); }, [fetchKlines]);

  // Periodic background refresh so candles + the current-price line stay
  // live for as long as the chart is open (TradingPanel's own ticker already
  // polls every 10s — without this, the chart itself stays frozen at mount).
  useEffect(() => {
    const t = setInterval(() => fetchKlines(false), 15_000);
    return () => clearInterval(t);
  }, [fetchKlines]);

  // ── Draw ────────────────────────────────────────────────────────────────────

  const draw = useCallback(() => {
    const canvas    = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const dpr = window.devicePixelRatio || 1;
    const W   = container.clientWidth;
    const H   = container.clientHeight;
    if (W <= 0 || H <= 0) return;

    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width  = `${W}px`;
    canvas.style.height = `${H}px`;

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const { candles: cands, viewStart, viewCount, hoveredX, hoveredY, timeMap } = st.current;
    const visible = cands.slice(viewStart, viewStart + viewCount);
    if (!visible.length) {
      ctx.fillStyle = C.bg;
      ctx.fillRect(0, 0, W, H);
      return;
    }

    // ── Layout ────────────────────────────────────────────────────────────────
    const chartW  = W - PRICE_AXIS_W;
    const volH    = Math.floor((H - TIME_AXIS_H - PAD_TOP) * VOL_RATIO);
    const chartH  = H - TIME_AXIS_H - PAD_TOP - volH;
    const candleW = chartW / viewCount;
    const bodyW   = Math.max(1.5, candleW * 0.55);

    // ── Price range ───────────────────────────────────────────────────────────
    let minP = Math.min(...visible.map(c => c.low));
    let maxP = Math.max(...visible.map(c => c.high));
    const pPad = (maxP - minP) * 0.06;
    minP -= pPad; maxP += pPad;
    const priceRange = maxP - minP || 1;

    // ── Volume range ──────────────────────────────────────────────────────────
    const maxVol = Math.max(...visible.map(c => c.volume), 1);

    // ── Coordinate functions ──────────────────────────────────────────────────
    // X center of candle at global index gIdx
    const cx = (gIdx) => (gIdx - viewStart + 0.5) * candleW;
    // Y for price (within chart area, PAD_TOP at top)
    const py = (price) => PAD_TOP + chartH * (1 - (price - minP) / priceRange);
    // Y for volume bar bottom
    const vyTop = (vol) => H - TIME_AXIS_H - (vol / maxVol) * volH;

    // ── Background ────────────────────────────────────────────────────────────
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);

    // ── Horizontal grid lines ─────────────────────────────────────────────────
    const gridCount = 5;
    ctx.strokeStyle = C.grid;
    ctx.lineWidth   = 1;
    for (let i = 0; i <= gridCount; i++) {
      const y = py(minP + priceRange * i / gridCount);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(chartW, y); ctx.stroke();
    }

    // ── SMC OVERLAYS ──────────────────────────────────────────────────────────

    const tfData   = analysis?.timeframes?.[timeframe];
    const zones    = tfData?.zones    ?? {};
    const structure = tfData?.structure ?? {};

    // Helper: draw a horizontal price band
    const drawBand = (topPrice, botPrice, fill, strokeClr) => {
      if (topPrice < minP && botPrice < minP) return;
      if (topPrice > maxP && botPrice > maxP) return;
      const y1 = py(Math.min(maxP, topPrice));
      const y2 = py(Math.max(minP, botPrice));
      const bH = Math.max(1, Math.abs(y2 - y1));
      ctx.fillStyle = fill;
      ctx.fillRect(0, Math.min(y1, y2), chartW, bH);
      if (strokeClr) {
        ctx.strokeStyle = strokeClr;
        ctx.lineWidth   = 1;
        ctx.setLineDash([]);
        ctx.strokeRect(0, Math.min(y1, y2), chartW, bH);
      }
    };

    // Helper: draw a labeled horizontal dashed line
    const drawHLine = (price, color, label) => {
      if (price < minP || price > maxP) return;
      const y = py(price);
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth   = 1;
      ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(chartW, y); ctx.stroke();
      ctx.setLineDash([]);
      if (label) {
        ctx.font = 'bold 8.5px Inter, monospace';
        ctx.fillStyle = C.axisArea;
        ctx.fillRect(4, y - 9, ctx.measureText(label).width + 8, 14);
        ctx.fillStyle = color;
        ctx.textAlign = 'left';
        ctx.fillText(label, 8, y + 1);
      }
      ctx.restore();
    };

    // — Bullish Order Blocks ——————————————————————————————
    zones.bullishOBs?.forEach(ob =>
      drawBand(ob.high, ob.low, C.obBull, C.obBullBdr));

    // — Bearish Order Blocks ——————————————————————————————
    zones.bearishOBs?.forEach(ob =>
      drawBand(ob.high, ob.low, C.obBear, C.obBearBdr));

    // — Bullish FVGs ——————————————————————————————————————
    zones.bullishFVGs?.forEach(fvg =>
      drawBand(fvg.top, fvg.bottom, C.fvgBull, null));

    // — Bearish FVGs ——————————————————————————————————————
    zones.bearishFVGs?.forEach(fvg =>
      drawBand(fvg.top, fvg.bottom, C.fvgBear, null));

    // — BOS lines ————————————————————————————————————————
    structure.bullishBOS?.forEach(b => drawHLine(b.level, C.bosBull, 'BOS ↑'));
    structure.bearishBOS?.forEach(b => drawHLine(b.level, C.bosBear, 'BOS ↓'));

    // — CHoCH lines ——————————————————————————————————————
    structure.bullishCHOCH?.forEach(b => drawHLine(b.level, C.choch, 'CHoCH ↑'));
    structure.bearishCHOCH?.forEach(b => drawHLine(b.level, C.choch, 'CHoCH ↓'));

    // ── Candlesticks ─────────────────────────────────────────────────────────
    ctx.lineWidth = 1;
    visible.forEach((c, li) => {
      const gIdx = viewStart + li;
      const x    = cx(gIdx);
      const bull = c.close >= c.open;

      // Wick
      ctx.strokeStyle = bull ? C.bullWick : C.bearWick;
      ctx.beginPath();
      ctx.moveTo(x, py(c.high));
      ctx.lineTo(x, py(c.low));
      ctx.stroke();

      // Body
      const bTop = py(Math.max(c.open, c.close));
      const bBot = py(Math.min(c.open, c.close));
      const bH   = Math.max(1.5, bBot - bTop);
      ctx.fillStyle = bull ? C.bullBody : C.bearBody;
      ctx.fillRect(x - bodyW / 2, bTop, bodyW, bH);
    });

    // ── Swing high/low markers ────────────────────────────────────────────────
    // Match by timestamp to chart index
    const drawSwingMarker = (swings, isHigh) => {
      swings?.forEach(s => {
        const matchIdx = timeMap.get(s.time);
        if (matchIdx === undefined) return;
        if (matchIdx < viewStart || matchIdx >= viewStart + viewCount) return;
        const x   = cx(matchIdx);
        const yPt = py(s.price);
        const dir = isHigh ? -1 : 1;

        ctx.fillStyle = C.swing;
        ctx.beginPath();
        ctx.moveTo(x,     yPt + dir * 8);
        ctx.lineTo(x - 4, yPt + dir * 14);
        ctx.lineTo(x + 4, yPt + dir * 14);
        ctx.closePath();
        ctx.fill();

        // Dotted line from marker to candle tip
        ctx.strokeStyle = C.swing + '55';
        ctx.setLineDash([2, 2]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, yPt);
        ctx.lineTo(x, yPt + dir * 7);
        ctx.stroke();
        ctx.setLineDash([]);
      });
    };
    drawSwingMarker(structure.swingHighs, true);
    drawSwingMarker(structure.swingLows,  false);

    // ── Volume bars ───────────────────────────────────────────────────────────
    const volSepY = H - TIME_AXIS_H - volH;
    // Vol area background
    ctx.fillStyle = '#0b0f18';
    ctx.fillRect(0, volSepY, chartW, volH);
    // Separator
    ctx.strokeStyle = C.axisBorder;
    ctx.lineWidth   = 1;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(0, volSepY); ctx.lineTo(chartW, volSepY); ctx.stroke();

    visible.forEach((c, li) => {
      const gIdx = viewStart + li;
      const x    = cx(gIdx);
      const bull = c.close >= c.open;
      const bH   = Math.max(1, (c.volume / maxVol) * volH);
      ctx.fillStyle = bull ? C.volBull : C.volBear;
      ctx.fillRect(x - bodyW / 2, H - TIME_AXIS_H - bH, bodyW, bH);
    });

    // ── Current price line ────────────────────────────────────────────────────
    const lastC = cands[cands.length - 1];
    if (lastC && lastC.close >= minP && lastC.close <= maxP) {
      const y = py(lastC.close);
      ctx.save();
      ctx.strokeStyle = C.curPrice;
      ctx.lineWidth   = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(chartW, y); ctx.stroke();
      ctx.setLineDash([]);
      // Label box
      const lbl = formatPrice(lastC.close);
      const lblW = ctx.measureText(lbl).width + 10;
      ctx.fillStyle = C.curPrice;
      ctx.fillRect(chartW + 2, y - 9, PRICE_AXIS_W - 2, 18);
      ctx.fillStyle = '#0A0D13';
      ctx.font = 'bold 10px Inter, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(lbl, chartW + 6, y + 4);
      ctx.restore();
    }

    // ── Price axis ────────────────────────────────────────────────────────────
    ctx.fillStyle = C.axisArea;
    ctx.fillRect(chartW, 0, PRICE_AXIS_W, H);
    ctx.strokeStyle = C.axisBorder;
    ctx.lineWidth   = 1;
    ctx.beginPath(); ctx.moveTo(chartW, 0); ctx.lineTo(chartW, H); ctx.stroke();

    for (let i = 0; i <= gridCount; i++) {
      const price = minP + priceRange * i / gridCount;
      const y     = py(price);
      ctx.fillStyle = C.textMid;
      ctx.font = '9px Inter, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(formatPrice(price), chartW + 5, y + 3);
    }

    // ── Time axis ─────────────────────────────────────────────────────────────
    ctx.fillStyle = C.axisArea;
    ctx.fillRect(0, H - TIME_AXIS_H, W, TIME_AXIS_H);
    ctx.strokeStyle = C.axisBorder;
    ctx.beginPath();
    ctx.moveTo(0, H - TIME_AXIS_H); ctx.lineTo(chartW, H - TIME_AXIS_H); ctx.stroke();

    const labelEvery = Math.ceil(viewCount / 5);
    ctx.fillStyle = C.textMid;
    ctx.font = '9px Inter, monospace';
    ctx.textAlign = 'center';
    visible.forEach((c, li) => {
      if (li % labelEvery !== 0) return;
      const gIdx = viewStart + li;
      ctx.fillText(formatTime(c.time, timeframe), cx(gIdx), H - TIME_AXIS_H + 16);
    });

    // ── Crosshair ─────────────────────────────────────────────────────────────
    if (hoveredX !== null && hoveredX < chartW) {
      ctx.strokeStyle = C.crosshair;
      ctx.lineWidth   = 1;
      ctx.setLineDash([]);

      // Vertical line
      ctx.beginPath();
      ctx.moveTo(hoveredX, PAD_TOP);
      ctx.lineTo(hoveredX, H - TIME_AXIS_H);
      ctx.stroke();

      // Horizontal line
      if (hoveredY !== null) {
        ctx.beginPath();
        ctx.moveTo(0, hoveredY);
        ctx.lineTo(chartW, hoveredY);
        ctx.stroke();

        // Price label on axis
        const hPrice = minP + priceRange * (1 - (hoveredY - PAD_TOP) / chartH);
        if (hPrice >= minP && hPrice <= maxP) {
          const lbl = formatPrice(hPrice);
          ctx.fillStyle = '#252a3a';
          ctx.fillRect(chartW + 2, hoveredY - 9, PRICE_AXIS_W - 2, 18);
          ctx.fillStyle = '#e8e9f0';
          ctx.font = '9px Inter, monospace';
          ctx.textAlign = 'left';
          ctx.fillText(lbl, chartW + 5, hoveredY + 3);
        }
      }

      // Time label on axis
      const hIdx = Math.floor(hoveredX / candleW);
      const hCandle = visible[hIdx];
      if (hCandle) {
        const lbl  = formatTime(hCandle.time, timeframe);
        const lblW = ctx.measureText(lbl).width + 10;
        ctx.fillStyle = '#252a3a';
        ctx.fillRect(hoveredX - lblW / 2, H - TIME_AXIS_H + 3, lblW, 16);
        ctx.fillStyle = '#e8e9f0';
        ctx.font = '9px Inter, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(lbl, hoveredX, H - TIME_AXIS_H + 14);
      }
    }

  }, [candles, viewRange, analysis, timeframe]);

  // ── Redraw on state change ───────────────────────────────────────────────────
  useEffect(() => {
    st.current.viewStart = viewRange.start;
    st.current.viewCount = viewRange.count;
    draw();
  }, [candles, viewRange, analysis, draw]);

  // ── Resize observer ─────────────────────────────────────────────────────────
  useEffect(() => {
    const obs = new ResizeObserver(() => draw());
    if (containerRef.current) obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, [draw]);

  // ── Mouse handlers ───────────────────────────────────────────────────────────

  const onWheel = useCallback((e) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.15 : 0.87;
    setViewRange(prev => {
      const newCount = Math.round(Math.min(250, Math.max(15, prev.count * factor)));
      const newStart = Math.max(0, Math.min(
        st.current.candles.length - newCount,
        Math.round(prev.start + (prev.count - newCount) / 2),
      ));
      st.current.viewStart = newStart;
      st.current.viewCount = newCount;
      return { start: newStart, count: newCount };
    });
  }, []);

  // Attach wheel with { passive: false } so preventDefault works
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [onWheel]);

  const getLocalX = (e) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    return rect ? e.clientX - rect.left : 0;
  };
  const getLocalY = (e) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    return rect ? e.clientY - rect.top : 0;
  };

  const onMouseMove = (e) => {
    const x = getLocalX(e);
    const y = getLocalY(e);

    if (drag.current.active) {
      const container = containerRef.current;
      const chartW    = (container?.clientWidth ?? 0) - PRICE_AXIS_W;
      const candleW   = chartW / st.current.viewCount;
      const dx     = e.clientX - drag.current.startX;
      const shift  = Math.round(-dx / candleW);
      const newStart = Math.max(0, Math.min(
        st.current.candles.length - st.current.viewCount,
        drag.current.startView + shift,
      ));
      if (newStart !== st.current.viewStart) {
        st.current.viewStart = newStart;
        setViewRange(prev => ({ ...prev, start: newStart }));
        return;
      }
    }

    st.current.hoveredX = x < (containerRef.current?.clientWidth ?? 0) - PRICE_AXIS_W ? x : null;
    st.current.hoveredY = y;

    // Update tooltip
    const { viewStart, viewCount, candles: cands } = st.current;
    const chartW  = (containerRef.current?.clientWidth ?? 0) - PRICE_AXIS_W;
    const candleW = chartW / viewCount;
    const idx     = Math.floor(x / candleW);
    const gIdx    = viewStart + idx;

    if (gIdx >= 0 && gIdx < cands.length && x < chartW) {
      setTooltip({ candle: cands[gIdx], x });
    } else {
      setTooltip(null);
    }

    draw();
  };

  const onMouseLeave = () => {
    st.current.hoveredX = null;
    st.current.hoveredY = null;
    drag.current.active = false;
    setTooltip(null);
    draw();
  };

  const onMouseDown = (e) => {
    drag.current = {
      active:    true,
      startX:    e.clientX,
      startView: st.current.viewStart,
    };
  };

  const onMouseUp = () => { drag.current.active = false; };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div style={{ position: 'relative', width: '100%', height, background: C.bg, userSelect: 'none' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }}>
        <canvas
          ref={canvasRef}
          onMouseMove={onMouseMove}
          onMouseLeave={onMouseLeave}
          onMouseDown={onMouseDown}
          onMouseUp={onMouseUp}
          style={{ display: 'block', cursor: drag.current?.active ? 'grabbing' : 'crosshair' }}
        />
      </div>

      {/* ── OHLCV Tooltip ─────────────────────────────────────────────────── */}
      {tooltip && (
        <div style={{
          position:       'absolute',
          top:            10,
          left:           10,
          background:     'rgba(13,16,24,0.88)',
          border:         '1px solid #1a1f2e',
          borderRadius:   7,
          padding:        '7px 11px',
          fontSize:       11,
          fontFamily:     'monospace',
          pointerEvents:  'none',
          backdropFilter: 'blur(6px)',
          lineHeight:     1.7,
          zIndex:         10,
        }}>
          <div style={{ color: '#3a4460', fontSize: 10, marginBottom: 3 }}>
            {new Date(tooltip.candle.time).toLocaleString()}
          </div>
          {[
            ['O', tooltip.candle.open,  '#aab'],
            ['H', tooltip.candle.high,  '#5EEAD4'],
            ['L', tooltip.candle.low,   '#ff6b6b'],
            ['C', tooltip.candle.close, tooltip.candle.close >= tooltip.candle.open ? '#5EEAD4' : '#ff6b6b'],
            ['V', tooltip.candle.volume, '#7C9CFF'],
          ].map(([label, val, color]) => (
            <div key={label} style={{ display: 'flex', gap: 10 }}>
              <span style={{ color: '#2e3448', width: 10 }}>{label}</span>
              <span style={{ color }}>
                {label === 'V' ? val.toFixed(0) : formatPrice(val)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ── SMC legend ────────────────────────────────────────────────────── */}
      {analysis && (
        <div style={{
          position:      'absolute',
          top:           10,
          right:         PRICE_AXIS_W + 10,
          display:       'flex',
          gap:           8,
          pointerEvents: 'none',
          flexWrap:      'wrap',
        }}>
          {[
            ['OB ↑', '#5EEAD4'],
            ['OB ↓', '#ff6b6b'],
            ['FVG',  '#7C9CFF'],
            ['BOS',  '#5EEAD4'],
            ['CHoCH','#da77f2'],
            ['Swing','#ffa94d'],
          ].map(([label, color]) => (
            <div key={label} style={{
              display:       'flex',
              alignItems:    'center',
              gap:           4,
              background:    'rgba(10,13,19,0.75)',
              border:        `1px solid ${color}33`,
              borderRadius:  4,
              padding:       '2px 7px',
              fontSize:      9,
              color,
              fontFamily:    'Inter, sans-serif',
              fontWeight:    700,
              letterSpacing: '0.05em',
            }}>
              <span style={{ width: 6, height: 6, background: color + '55', border: `1px solid ${color}`, borderRadius: 1, flexShrink: 0 }} />
              {label}
            </div>
          ))}
        </div>
      )}

      {/* ── Loading overlay ────────────────────────────────────────────────── */}
      {loading && (
        <div style={{
          position:       'absolute',
          inset:          0,
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'center',
          background:     'rgba(10,13,19,0.85)',
          color:          '#7C9CFF',
          fontSize:       13,
          gap:            10,
        }}>
          <span style={{ animation: 'chartSpin 1s linear infinite', display: 'inline-block' }}>◌</span>
          Loading {symbol} {timeframe}…
        </div>
      )}

      {/* ── Error overlay ──────────────────────────────────────────────────── */}
      {error && !loading && (
        <div style={{
          position:       'absolute',
          inset:          0,
          display:        'flex',
          flexDirection:  'column',
          alignItems:     'center',
          justifyContent: 'center',
          background:     'rgba(10,13,19,0.9)',
          gap:            10,
        }}>
          <span style={{ color: '#ff6b6b', fontSize: 12 }}>⚠ {error}</span>
          <button onClick={fetchKlines} style={{
            padding:      '5px 14px',
            borderRadius: 6,
            border:       '1px solid #ff6b6b44',
            background:   'transparent',
            color:        '#ff6b6b',
            cursor:       'pointer',
            fontSize:     11,
          }}>Retry</button>
        </div>
      )}

      <style>{`@keyframes chartSpin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
