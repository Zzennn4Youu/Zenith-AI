/**
 * TRADING PANEL — Zenith AI v2
 * Full-screen trading dashboard integrating MEXC + SMCAnalyzer.
 *
 * Sections:
 *   • Header     — symbol/TF select, live price, 24h change
 *   • Left col   — SMC score arc, MTF grid, signal details, zones
 *   • Right col  — Balance, manual order form, SMC auto-trade
 *   • Bottom     — Open orders table (cancel), trade history
 *
 * Props: session, onClose
 */
'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import PriceChart from './PriceChart';

// ── Constants ──────────────────────────────────────────────────────────────────

const SYMBOLS = [
  'BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT',
  'XRPUSDT','ADAUSDT','DOGEUSDT','AVAXUSDT',
];
const MTF = ['1h', '4h', '1d'];

const C = {
  bg:      '#0A0D13',
  surface: '#0d1018',
  card:    '#11151F',
  border:  '#1a1f2e',
  muted:   '#252a38',
  text:    '#e8e9f0',
  dim:     '#5a6070',
  accent:  '#7C9CFF',
  teal:    '#5EEAD4',
  green:   '#69db7c',
  red:     '#ff6b6b',
  yellow:  '#ffa94d',
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmt(n, dec = 2) {
  if (n === null || n === undefined) return '—';
  const num = parseFloat(n);
  if (isNaN(num)) return '—';
  return num.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function fmtCompact(n) {
  const num = parseFloat(n);
  if (isNaN(num)) return '—';
  if (num >= 1000) return fmt(num, 2);
  if (num >= 1)    return fmt(num, 4);
  return fmt(num, 6);
}

function scoreColor(s) {
  if (s >= 70) return C.teal;
  if (s >= 55) return C.accent;
  if (s >= 40) return C.yellow;
  return C.red;
}

function scoreLabel(s) {
  if (s >= 70) return 'Bullish';
  if (s >= 55) return 'Slightly Bullish';
  if (s >= 40) return 'Ranging';
  return 'Bearish';
}

function trendColor(t) {
  if (!t) return C.dim;
  const lower = t.toLowerCase();
  if (lower === 'bullish') return C.teal;
  if (lower === 'bearish') return C.red;
  return C.yellow;
}

function signalColor(type) {
  if (!type) return C.dim;
  if (type === 'LONG')  return C.teal;
  if (type === 'SHORT') return C.red;
  return C.yellow;
}

function relTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

/** SVG arc gauge for SMC score (0-100) */
function ScoreArc({ score = 0 }) {
  const r     = 46;
  const circ  = 2 * Math.PI * r;
  const arc   = circ * 0.75;          // show 270° of circle
  const prog  = arc * (score / 100);
  const color = scoreColor(score);

  return (
    <svg width="110" height="110" viewBox="0 0 110 110">
      {/* Track */}
      <circle cx="55" cy="55" r={r} fill="none"
        stroke={C.muted} strokeWidth="7"
        strokeDasharray={`${arc} ${circ}`}
        strokeLinecap="round"
        transform="rotate(135 55 55)"
      />
      {/* Progress */}
      <circle cx="55" cy="55" r={r} fill="none"
        stroke={color} strokeWidth="7"
        strokeDasharray={`${prog} ${circ}`}
        strokeLinecap="round"
        transform="rotate(135 55 55)"
        style={{ transition: 'stroke-dasharray 0.6s ease, stroke 0.4s' }}
      />
      {/* Score */}
      <text x="55" y="51" textAnchor="middle" fill="#fff"
        fontSize="22" fontWeight="700" fontFamily="Inter, sans-serif">
        {score}
      </text>
      <text x="55" y="64" textAnchor="middle" fill={C.dim}
        fontSize="8.5" fontWeight="600" fontFamily="Inter, sans-serif"
        letterSpacing="0.08em">
        SCORE
      </text>
    </svg>
  );
}

/** Horizontal score bar for MTF grid */
function ScoreBar({ score = 0 }) {
  const w = `${Math.max(3, score)}%`;
  return (
    <div style={{ flex: 1, height: 4, background: C.muted, borderRadius: 2, overflow: 'hidden' }}>
      <div style={{ width: w, height: '100%', background: scoreColor(score), borderRadius: 2, transition: 'width 0.5s ease' }} />
    </div>
  );
}

/** Chip: LONG / SHORT / NEUTRAL */
function SignalChip({ type, size = 'sm' }) {
  const color = signalColor(type);
  const pad   = size === 'lg' ? '5px 14px' : '3px 9px';
  const fs    = size === 'lg' ? 12 : 10;
  return (
    <span style={{
      background: color + '18', border: `1px solid ${color}44`,
      color, fontSize: fs, fontWeight: 700, padding: pad,
      borderRadius: 5, letterSpacing: '0.06em', whiteSpace: 'nowrap',
    }}>
      {type || 'NEUTRAL'}
    </span>
  );
}

/** Trend text chip */
function TrendChip({ trend }) {
  const c = trendColor(trend);
  return (
    <span style={{ color: c, fontWeight: 700, fontSize: 11 }}>
      {trend ? (trend.charAt(0).toUpperCase() + trend.slice(1)) : '—'}
    </span>
  );
}

/** Loading skeleton line */
function Skeleton({ w = '100%', h = 14 }) {
  return (
    <div style={{
      width: w, height: h, borderRadius: 4,
      background: `linear-gradient(90deg, ${C.muted} 25%, ${C.card} 50%, ${C.muted} 75%)`,
      backgroundSize: '200% 100%',
      animation: 'tpShimmer 1.4s infinite',
    }} />
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function TradingPanel({ session, onClose }) {

  // ── Symbol / TF ─────────────────────────────────────────────────────────────
  const [symbol,    setSymbol]    = useState('BTCUSDT');
  const [timeframe, setTF]        = useState('4h');

  // ── Data ─────────────────────────────────────────────────────────────────────
  const [ticker,     setTicker]     = useState(null);
  const [balance,    setBalance]    = useState(null);
  const [analysis,   setAnalysis]   = useState(null);
  const [openOrders, setOpenOrders] = useState([]);
  const [history,    setHistory]    = useState([]);

  // ── Loading / error ──────────────────────────────────────────────────────────
  const [loadingMain,   setLoadingMain]   = useState(true);
  const [loadingTicker, setLoadingTicker] = useState(false);
  const [error,         setError]         = useState(null);

  // ── Order form ───────────────────────────────────────────────────────────────
  const [orderType,   setOrderType]   = useState('market'); // 'market' | 'limit'
  const [side,        setSide]        = useState('BUY');
  const [quantity,    setQuantity]    = useState('');
  const [limitPrice,  setLimitPrice]  = useState('');
  const [smcCapital,  setSmcCapital]  = useState('');
  const [placing,     setPlacing]     = useState(false);
  const [orderMsg,    setOrderMsg]    = useState(null);   // { type:'ok'|'err', text }
  const [canceling,   setCanceling]   = useState(null);   // orderId being cancelled

  // ── Bottom tab ───────────────────────────────────────────────────────────────
  const [bottomTab, setBottomTab] = useState('orders');
  const [showChart, setShowChart] = useState(true);

  // ── API helper ───────────────────────────────────────────────────────────────

  const tradeAPI = useCallback(async (action, params = {}) => {
    const res = await fetch('/api/trade', {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization:  `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ action, ...params }),
    });
    return res.json();
  }, [session]);

  // ── Fetch ticker (public MEXC, no auth) ──────────────────────────────────────

  const fetchTicker = useCallback(async () => {
    setLoadingTicker(true);
    try {
      const res  = await fetch(
        `https://api.mexc.com/api/v3/ticker/24hr?symbol=${symbol}`
      );
      const d    = await res.json();
      const chg  = parseFloat(d.priceChangePercent);
      setTicker({
        price:    parseFloat(d.lastPrice),
        change:   parseFloat(d.priceChange),
        changePct: chg,
        high24h:  parseFloat(d.highPrice),
        low24h:   parseFloat(d.lowPrice),
        vol24h:   parseFloat(d.volume),
      });
    } catch { /* non-fatal */ }
    finally  { setLoadingTicker(false); }
  }, [symbol]);

  // ── Fetch main data ──────────────────────────────────────────────────────────

  const fetchAll = useCallback(async () => {
    setLoadingMain(true);
    setError(null);
    try {
      const [balRes, anRes, ordRes, histRes] = await Promise.allSettled([
        tradeAPI('balance'),
        tradeAPI('analyze_mtf', { symbol, timeframes: MTF }),
        tradeAPI('open_orders', { symbol }),
        tradeAPI('trade_history', { symbol, limit: 20 }),
      ]);

      if (balRes.status  === 'fulfilled' && balRes.value.success)  setBalance(balRes.value.result);
      if (anRes.status   === 'fulfilled' && anRes.value.success)   setAnalysis(anRes.value.result);
      if (ordRes.status  === 'fulfilled' && ordRes.value.success)  setOpenOrders(ordRes.value.result ?? []);
      if (histRes.status === 'fulfilled' && histRes.value.success) setHistory(histRes.value.result ?? []);

      // Collect what actually failed, whether the promise itself rejected
      // (network/parse error — `.value` doesn't exist on a rejected
      // allSettled result, only `.reason`) or it resolved with
      // { success: false, error }. Previously only analyze_mtf's app-level
      // error was checked, and unsafely (reading `.value` without confirming
      // the promise had fulfilled) — so e.g. a network failure on that call
      // left the SMC panel silently empty with no error shown anywhere.
      const errs = [balRes, anRes, ordRes, histRes]
        .map(r => r.status === 'rejected' ? r.reason?.message : (!r.value?.success ? r.value?.error : null))
        .filter(Boolean);

      if (errs.some(e => e?.includes?.('credentials'))) {
        setError('MEXC_API_KEY / MEXC_SECRET_KEY not set in .env');
      } else if (errs.length) {
        setError(errs[0]);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingMain(false);
    }
  }, [symbol, tradeAPI]);

  // ── Effects ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    fetchAll();
    fetchTicker();
  }, [fetchAll, fetchTicker]);

  // Ticker auto-refresh every 10 s
  useEffect(() => {
    const t = setInterval(fetchTicker, 10_000);
    return () => clearInterval(t);
  }, [fetchTicker]);

  // ── Place order ───────────────────────────────────────────────────────────────

  const placeOrder = async () => {
    if (!quantity || parseFloat(quantity) <= 0) return;
    setPlacing(true);
    setOrderMsg(null);
    try {
      const action = orderType === 'market' ? 'place_market' : 'place_limit';
      const params = {
        symbol, side,
        quantity: parseFloat(quantity),
        ...(orderType === 'limit' && { price: parseFloat(limitPrice) }),
      };
      const res = await tradeAPI(action, params);
      if (res.success) {
        setOrderMsg({ type: 'ok', text: `✓ ${side} order placed — ID ${res.result?.orderId ?? ''}` });
        setQuantity(''); setLimitPrice('');
        await Promise.all([fetchAll(), fetchTicker()]);
      } else {
        setOrderMsg({ type: 'err', text: res.error ?? 'Order failed' });
      }
    } catch (e) {
      setOrderMsg({ type: 'err', text: e.message });
    } finally {
      setPlacing(false);
      setTimeout(() => setOrderMsg(null), 6000);
    }
  };

  // ── Place SMC trade ───────────────────────────────────────────────────────────

  const placeSmcTrade = async () => {
    const signal = analysis?.timeframes?.[timeframe]?.signal;
    if (!signal || !smcCapital || parseFloat(smcCapital) <= 0) return;
    setPlacing(true);
    setOrderMsg(null);
    try {
      const res = await tradeAPI('place_smc_trade', {
        symbol,
        signal,
        capitalUSDT: parseFloat(smcCapital),
      });
      if (res.success) {
        setOrderMsg({ type: 'ok', text: `✓ SMC trade placed — Entry ${fmt(signal.entry)}` });
        setSmcCapital('');
        await fetchAll();
      } else {
        setOrderMsg({ type: 'err', text: res.error ?? 'SMC trade failed' });
      }
    } catch (e) {
      setOrderMsg({ type: 'err', text: e.message });
    } finally {
      setPlacing(false);
      setTimeout(() => setOrderMsg(null), 6000);
    }
  };

  // ── Cancel order ──────────────────────────────────────────────────────────────

  const cancelOrder = async (orderId) => {
    setCanceling(orderId);
    try {
      await tradeAPI('cancel', { symbol, orderId });
      setOpenOrders(prev => prev.filter(o => o.orderId !== orderId));
    } catch { /* show nothing */ }
    finally { setCanceling(null); }
  };

  // ── Derived values ────────────────────────────────────────────────────────────

  const usdtBalance  = balance?.find(b => b.asset === 'USDT');
  const usdtFree     = parseFloat(usdtBalance?.free ?? 0);
  const baseAsset    = symbol.replace('USDT', '');
  const assetBalance = balance?.find(b => b.asset === baseAsset);
  const assetFree    = parseFloat(assetBalance?.free ?? 0);
  const mainTF      = analysis?.timeframes?.[timeframe];
  const mtfScore    = analysis?.weightedScore ?? 0;
  const domTrend    = analysis?.dominantTrend;
  const signal      = mainTF?.signal;
  const zones       = mainTF?.zones ?? {};
  const structure   = mainTF?.structure ?? {};

  const fillPct = (pct) => {
    // BUY spends USDT → convert to asset qty via price. SELL disposes of the
    // asset itself, so it must use the held asset balance directly — using
    // usdtFree/price here too (as before) would fill in a quantity with no
    // relationship to what's actually held, for every SELL click.
    if (side === 'BUY') {
      if (!ticker?.price || !usdtFree) return;
      setQuantity(((usdtFree * pct) / ticker.price).toFixed(6));
    } else {
      if (!assetFree) return;
      setQuantity((assetFree * pct).toFixed(6));
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div style={{
      position:   'fixed', inset: 0, zIndex: 9000,
      background: C.bg,
      display:    'flex', flexDirection: 'column',
      fontFamily: 'Inter, sans-serif',
      overflowY:  'auto',
    }}>

      {/* ── HEADER ─────────────────────────────────────────────────────────── */}
      <div style={{
        display:      'flex', alignItems: 'center', gap: 12,
        padding:      '12px 20px',
        borderBottom: `1px solid ${C.border}`,
        flexShrink:   0,
        flexWrap:     'wrap',
        rowGap:       8,
      }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginRight: 4 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 7,
            background: 'linear-gradient(135deg,#7C9CFF,#5EEAD4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14, color: C.bg, fontWeight: 900,
          }}>📈</div>
          <span style={{ color: '#fff', fontWeight: 800, fontSize: 14, letterSpacing: '0.04em' }}>
            ZENITH <span style={{ color: C.accent }}>TRADING</span>
          </span>
        </div>

        {/* Symbol selector */}
        <select value={symbol} onChange={e => setSymbol(e.target.value)}
          style={{
            background: C.card, border: `1px solid ${C.border}`,
            color: '#fff', borderRadius: 7, padding: '5px 10px',
            fontSize: 13, fontWeight: 700, outline: 'none', cursor: 'pointer',
          }}>
          {SYMBOLS.map(s => <option key={s}>{s}</option>)}
        </select>

        {/* Timeframe selector */}
        <select value={timeframe} onChange={e => setTF(e.target.value)}
          style={{
            background: C.card, border: `1px solid ${C.border}`,
            color: C.dim, borderRadius: 7, padding: '5px 10px',
            fontSize: 12, outline: 'none', cursor: 'pointer',
          }}>
          {['15m','1h','4h','1d'].map(t => <option key={t}>{t}</option>)}
        </select>

        {/* Live price */}
        {ticker && (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ color: '#fff', fontSize: 18, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
              ${fmt(ticker.price)}
            </span>
            <span style={{
              fontSize: 12, fontWeight: 700,
              color: ticker.changePct >= 0 ? C.green : C.red,
            }}>
              {ticker.changePct >= 0 ? '▲' : '▼'} {Math.abs(ticker.changePct).toFixed(2)}%
            </span>
            <span style={{ color: C.dim, fontSize: 11 }}>
              H: ${fmt(ticker.high24h)} · L: ${fmt(ticker.low24h)}
            </span>
          </div>
        )}

        {loadingTicker && <span style={{ color: C.dim, fontSize: 11 }}>Refreshing…</span>}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={fetchAll} title="Refresh all" style={{
            padding: '6px 12px', borderRadius: 7, border: `1px solid ${C.border}`,
            background: 'transparent', color: C.dim, cursor: 'pointer', fontSize: 11,
          }}>↻ Refresh</button>
          <button onClick={() => setShowChart(v => !v)} style={{
            padding: '6px 12px', borderRadius: 7, fontSize: 11, cursor: 'pointer',
            border:     `1px solid ${showChart ? C.accent + '44' : C.border}`,
            background: showChart ? C.accent + '14' : 'transparent',
            color:      showChart ? C.accent : C.dim,
            fontWeight: 600,
          }}>📊 Chart</button>
          <button onClick={onClose} style={{
            padding: '6px 10px', borderRadius: 7, border: `1px solid ${C.border}`,
            background: 'transparent', color: C.dim, cursor: 'pointer', fontSize: 14,
          }}>✕</button>
        </div>
      </div>

      {/* ── CREDENTIALS ERROR ───────────────────────────────────────────────── */}
      {error && (
        <div style={{
          margin: 16, padding: '12px 16px', borderRadius: 8,
          background: '#2a0f0f', border: `1px solid ${C.red}44`,
          color: C.red, fontSize: 12,
        }}>
          ⚠ {error}
        </div>
      )}

      {/* ── PRICE CHART ────────────────────────────────────────────────────── */}
      {showChart && (
        <div style={{
          borderBottom: `1px solid ${C.border}`,
          flexShrink:   0,
          position:     'relative',
        }}>
          <PriceChart
            symbol={symbol}
            timeframe={timeframe}
            analysis={analysis}
            height={380}
          />
        </div>
      )}

      {/* ── MAIN BODY ──────────────────────────────────────────────────────── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '340px 1fr',
        gap: 0,
        flex: 1,
        minHeight: 0,
        borderBottom: `1px solid ${C.border}`,
      }}>

        {/* ─── LEFT: SMC ANALYSIS ─────────────────────────────────────────── */}
        <div style={{
          borderRight:  `1px solid ${C.border}`,
          overflowY:    'auto',
          padding:      16,
          display:      'flex', flexDirection: 'column', gap: 12,
        }}>

          {/* Score arc + trend */}
          <div style={{
            background: C.card, borderRadius: 10, border: `1px solid ${C.border}`,
            padding: 16, display: 'flex', alignItems: 'center', gap: 16,
          }}>
            {loadingMain ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
                <Skeleton w="60%" h={80} />
                <Skeleton w="80%" />
              </div>
            ) : (
              <>
                <ScoreArc score={mtfScore} />
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ color: scoreColor(mtfScore), fontSize: 15, fontWeight: 700 }}>
                    {scoreLabel(mtfScore)}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: C.dim, fontSize: 11 }}>Trend</span>
                    <TrendChip trend={domTrend} />
                  </div>
                  {signal && (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      <SignalChip type={signal.type} />
                      {signal.strength && (
                        <span style={{ color: C.dim, fontSize: 10 }}>{signal.strength}</span>
                      )}
                    </div>
                  )}
                  <div style={{ color: C.dim, fontSize: 10, marginTop: 2 }}>
                    MTF weighted · {MTF.join(' + ')}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* MTF grid */}
          <div style={{ background: C.card, borderRadius: 10, border: `1px solid ${C.border}`, padding: 14 }}>
            <div style={{ color: C.dim, fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', marginBottom: 10 }}>
              MULTI-TIMEFRAME
            </div>
            {loadingMain ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {MTF.map(t => <Skeleton key={t} h={22} />)}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {MTF.map(tf => {
                  const d = analysis?.timeframes?.[tf];
                  const s = d?.confluenceScore ?? 0;
                  return (
                    <div key={tf} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{
                        color: tf === timeframe ? C.accent : C.dim,
                        fontSize: 11, fontWeight: 700, width: 28,
                      }}>{tf.toUpperCase()}</span>
                      <ScoreBar score={s} />
                      <span style={{ color: scoreColor(s), fontSize: 11, fontWeight: 700, width: 22, textAlign: 'right' }}>{s}</span>
                      <TrendChip trend={d?.trend} />
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Signal details */}
          {!loadingMain && signal && (
            <div style={{ background: C.card, borderRadius: 10, border: `1px solid ${C.border}`, padding: 14 }}>
              <div style={{ color: C.dim, fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', marginBottom: 10 }}>
                SIGNAL DETAILS · {timeframe.toUpperCase()}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {[
                  ['Entry',  fmtCompact(signal.entry),      '#fff'],
                  ['Stop',   fmtCompact(signal.stopLoss),   C.red],
                  ['Target', fmtCompact(signal.takeProfit), C.teal],
                  ['R:R',    signal.riskReward ? `1 : ${parseFloat(signal.riskReward).toFixed(2)}` : '—', C.accent],
                ].map(([label, val, color]) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: C.dim, fontSize: 11 }}>{label}</span>
                    <span style={{ color, fontSize: 12, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                      {label !== 'R:R' ? `$${val}` : val}
                    </span>
                  </div>
                ))}
                {signal.reasons?.length > 0 && (
                  <div style={{ marginTop: 6, borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>
                    {signal.reasons.slice(0, 3).map((r, i) => (
                      <div key={i} style={{ color: C.dim, fontSize: 10, lineHeight: 1.5 }}>· {r}</div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Zones */}
          {!loadingMain && (zones.bullishOBs?.length > 0 || zones.bullishFVGs?.length > 0) && (
            <div style={{ background: C.card, borderRadius: 10, border: `1px solid ${C.border}`, padding: 14 }}>
              <div style={{ color: C.dim, fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', marginBottom: 10 }}>
                KEY ZONES
              </div>

              {zones.bullishOBs?.slice(0, 2).map((ob, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, alignItems: 'center' }}>
                  <span style={{ background: C.teal + '18', border: `1px solid ${C.teal}33`, color: C.teal, fontSize: 9, padding: '2px 7px', borderRadius: 3, fontWeight: 700 }}>OB ↑</span>
                  <span style={{ color: '#ccc', fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>${fmtCompact(ob.low)} – ${fmtCompact(ob.high)}</span>
                </div>
              ))}
              {zones.bearishOBs?.slice(0, 2).map((ob, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, alignItems: 'center' }}>
                  <span style={{ background: C.red + '18', border: `1px solid ${C.red}33`, color: C.red, fontSize: 9, padding: '2px 7px', borderRadius: 3, fontWeight: 700 }}>OB ↓</span>
                  <span style={{ color: '#ccc', fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>${fmtCompact(ob.low)} – ${fmtCompact(ob.high)}</span>
                </div>
              ))}
              {zones.bullishFVGs?.slice(0, 2).map((g, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, alignItems: 'center' }}>
                  <span style={{ background: C.accent + '18', border: `1px solid ${C.accent}33`, color: C.accent, fontSize: 9, padding: '2px 7px', borderRadius: 3, fontWeight: 700 }}>FVG ↑</span>
                  <span style={{ color: '#ccc', fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>${fmtCompact(g.bottom)} – ${fmtCompact(g.top)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ─── RIGHT: TRADING ──────────────────────────────────────────────── */}
        <div style={{
          overflowY:   'auto',
          padding:     16,
          display:     'flex', flexDirection: 'column', gap: 12,
        }}>

          {/* Balance */}
          <div style={{
            background: C.card, borderRadius: 10, border: `1px solid ${C.border}`,
            padding: '12px 16px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <div>
              <div style={{ color: C.dim, fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', marginBottom: 4 }}>USDT BALANCE</div>
              {loadingMain
                ? <Skeleton w={100} h={20} />
                : <span style={{ color: '#fff', fontSize: 20, fontWeight: 700 }}>${fmt(usdtFree)}</span>
              }
              {usdtBalance?.locked && parseFloat(usdtBalance.locked) > 0 && (
                <span style={{ color: C.dim, fontSize: 11, marginLeft: 8 }}>
                  (${fmt(usdtBalance.locked)} locked)
                </span>
              )}
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ color: C.dim, fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', marginBottom: 4 }}>OPEN ORDERS</div>
              <span style={{ color: openOrders.length > 0 ? C.yellow : C.dim, fontSize: 18, fontWeight: 700 }}>
                {openOrders.length}
              </span>
            </div>
          </div>

          {/* Order form */}
          <div style={{
            background: C.card, borderRadius: 10, border: `1px solid ${C.border}`, padding: 16,
          }}>
            <div style={{ color: C.dim, fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', marginBottom: 12 }}>
              PLACE ORDER
            </div>

            {/* Market / Limit tabs */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
              {['market', 'limit'].map(t => (
                <button key={t} onClick={() => setOrderType(t)} style={{
                  padding: '5px 14px', borderRadius: 6, cursor: 'pointer',
                  border:     `1px solid ${orderType === t ? C.accent + '55' : C.border}`,
                  background: orderType === t ? C.accent + '18' : 'transparent',
                  color:      orderType === t ? C.accent : C.dim,
                  fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}>
                  {t}
                </button>
              ))}
            </div>

            {/* Buy / Sell */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
              {['BUY', 'SELL'].map(s => (
                <button key={s} onClick={() => setSide(s)} style={{
                  padding: '9px', borderRadius: 7, cursor: 'pointer', fontWeight: 800,
                  fontSize: 13, letterSpacing: '0.04em',
                  border:     `1px solid ${side === s ? (s === 'BUY' ? C.teal : C.red) + '55' : C.border}`,
                  background: side === s
                    ? (s === 'BUY' ? C.teal : C.red) + '1a'
                    : 'transparent',
                  color: side === s ? (s === 'BUY' ? C.teal : C.red) : C.dim,
                }}>
                  {s === 'BUY' ? '▲' : '▼'} {s}
                </button>
              ))}
            </div>

            {/* Qty */}
            <label style={{ color: C.dim, fontSize: 11, display: 'block', marginBottom: 4 }}>
              Quantity ({symbol.replace('USDT', '')})
            </label>
            <input
              type="number" value={quantity} onChange={e => setQuantity(e.target.value)}
              placeholder="0.00000"
              style={{
                width: '100%', boxSizing: 'border-box',
                background: C.surface, border: `1px solid ${C.border}`,
                borderRadius: 7, color: '#fff', padding: '8px 12px',
                fontSize: 13, outline: 'none', fontVariantNumeric: 'tabular-nums',
                marginBottom: 8,
              }}
            />

            {/* % presets */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
              {[0.25, 0.5, 0.75, 1].map(p => (
                <button key={p} onClick={() => fillPct(p)} style={{
                  flex: 1, padding: '5px 0', borderRadius: 6,
                  border: `1px solid ${C.border}`, background: 'transparent',
                  color: C.dim, cursor: 'pointer', fontSize: 11,
                }}>
                  {p * 100}%
                </button>
              ))}
            </div>

            {/* Limit price */}
            {orderType === 'limit' && (
              <>
                <label style={{ color: C.dim, fontSize: 11, display: 'block', marginBottom: 4 }}>
                  Limit Price (USDT)
                </label>
                <input
                  type="number" value={limitPrice} onChange={e => setLimitPrice(e.target.value)}
                  placeholder={ticker ? `${fmt(ticker.price)}` : '0.00'}
                  style={{
                    width: '100%', boxSizing: 'border-box',
                    background: C.surface, border: `1px solid ${C.border}`,
                    borderRadius: 7, color: '#fff', padding: '8px 12px',
                    fontSize: 13, outline: 'none', marginBottom: 12,
                  }}
                />
              </>
            )}

            {/* Place order button */}
            <button
              onClick={placeOrder}
              disabled={placing || !quantity || (orderType === 'limit' && !limitPrice)}
              style={{
                width: '100%', padding: '11px', borderRadius: 8, border: 'none',
                background: placing || !quantity
                  ? C.muted
                  : side === 'BUY'
                    ? `linear-gradient(135deg,${C.teal},#00b4a8)`
                    : `linear-gradient(135deg,${C.red},#e03030)`,
                color:     placing || !quantity ? '#333' : '#fff',
                fontWeight: 800, fontSize: 13, cursor: placing || !quantity ? 'not-allowed' : 'pointer',
                letterSpacing: '0.04em',
              }}
            >
              {placing ? '…' : `${side === 'BUY' ? '▲ Buy' : '▼ Sell'} ${symbol}`}
            </button>

            {/* Order result message */}
            {orderMsg && (
              <div style={{
                marginTop: 8, padding: '8px 12px', borderRadius: 7,
                background: orderMsg.type === 'ok' ? '#0f2a1a' : '#2a0f0f',
                color:      orderMsg.type === 'ok' ? C.green   : C.red,
                fontSize: 11,
              }}>
                {orderMsg.text}
              </div>
            )}
          </div>

          {/* SMC Auto-trade */}
          {!loadingMain && signal && signal.type !== 'NEUTRAL' && (
            <div style={{
              background: C.card, borderRadius: 10,
              border: `1px solid ${signalColor(signal.type)}33`,
              padding: 16,
            }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12,
              }}>
                <div style={{ color: C.dim, fontSize: 10, fontWeight: 700, letterSpacing: '0.08em' }}>
                  ⚡ SMC AUTO-TRADE
                </div>
                <SignalChip type={signal.type} size="sm" />
                {signal.strength && (
                  <span style={{ color: C.dim, fontSize: 10 }}>{signal.strength}</span>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
                {[
                  ['Entry',  signal.entry,      C.accent],
                  ['SL',     signal.stopLoss,   C.red],
                  ['TP',     signal.takeProfit, C.teal],
                  ['R:R',    signal.riskReward ? `1:${parseFloat(signal.riskReward).toFixed(1)}` : '—', C.yellow],
                ].map(([l, v, c]) => (
                  <div key={l} style={{
                    background: C.surface, borderRadius: 7, padding: '8px 10px',
                    border: `1px solid ${C.border}`,
                  }}>
                    <div style={{ color: C.dim, fontSize: 9, marginBottom: 3 }}>{l}</div>
                    <div style={{ color: c, fontSize: 12, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                      {l === 'R:R' ? v : `$${fmtCompact(v)}`}
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="number" value={smcCapital}
                  onChange={e => setSmcCapital(e.target.value)}
                  placeholder="Capital (USDT)"
                  style={{
                    flex: 1, background: C.surface, border: `1px solid ${C.border}`,
                    borderRadius: 7, color: '#fff', padding: '8px 12px',
                    fontSize: 12, outline: 'none',
                  }}
                />
                <button
                  onClick={placeSmcTrade}
                  disabled={placing || !smcCapital}
                  style={{
                    padding: '8px 16px', borderRadius: 7, border: 'none',
                    background: placing || !smcCapital
                      ? C.muted
                      : `linear-gradient(135deg,${C.accent},${C.teal})`,
                    color:  placing || !smcCapital ? '#333' : C.bg,
                    fontWeight: 800, fontSize: 12,
                    cursor: placing || !smcCapital ? 'not-allowed' : 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {placing ? '…' : 'Execute →'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── BOTTOM: ORDERS / HISTORY ────────────────────────────────────────── */}
      <div style={{ flexShrink: 0, borderTop: `1px solid ${C.border}` }}>

        {/* Tab bar */}
        <div style={{ display: 'flex', gap: 0, borderBottom: `1px solid ${C.border}` }}>
          {[
            { id: 'orders',  label: `Open Orders ${openOrders.length > 0 ? `(${openOrders.length})` : ''}` },
            { id: 'history', label: 'Trade History' },
          ].map(tab => (
            <button key={tab.id} onClick={() => setBottomTab(tab.id)} style={{
              padding: '9px 18px', borderRadius: 0, border: 'none',
              borderBottom: bottomTab === tab.id ? `2px solid ${C.accent}` : '2px solid transparent',
              background:   'transparent',
              color:        bottomTab === tab.id ? C.accent : C.dim,
              cursor:       'pointer', fontSize: 12, fontWeight: 600,
              transition:   'all 0.15s',
            }}>
              {tab.label}
            </button>
          ))}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', paddingRight: 16 }}>
            <span style={{ color: C.dim, fontSize: 10 }}>{symbol}</span>
          </div>
        </div>

        {/* Table */}
        <div style={{ maxHeight: 200, overflowY: 'auto' }}>
          {bottomTab === 'orders' ? (
            openOrders.length === 0 ? (
              <div style={{ padding: '20px 16px', color: C.dim, fontSize: 12, textAlign: 'center' }}>
                {loadingMain ? 'Loading…' : 'No open orders'}
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                    {['Order ID', 'Side', 'Type', 'Price', 'Qty', 'Filled', 'Status', ''].map(h => (
                      <th key={h} style={{ padding: '8px 12px', color: C.dim, textAlign: 'left', fontWeight: 600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {openOrders.map(o => (
                    <tr key={o.orderId} style={{ borderBottom: `1px solid ${C.border}22` }}>
                      <td style={{ padding: '8px 12px', color: C.dim, fontFamily: 'monospace', fontSize: 10 }}>
                        {String(o.orderId).slice(-8)}
                      </td>
                      <td style={{ padding: '8px 12px', color: o.side === 'BUY' ? C.teal : C.red, fontWeight: 700 }}>
                        {o.side}
                      </td>
                      <td style={{ padding: '8px 12px', color: C.dim }}>{o.type}</td>
                      <td style={{ padding: '8px 12px', color: '#ccc', fontVariantNumeric: 'tabular-nums' }}>
                        ${fmtCompact(o.price)}
                      </td>
                      <td style={{ padding: '8px 12px', color: '#ccc' }}>{fmt(o.origQty, 6)}</td>
                      <td style={{ padding: '8px 12px', color: C.dim }}>{fmt(o.executedQty, 6)}</td>
                      <td style={{ padding: '8px 12px' }}>
                        <span style={{ color: C.yellow, fontSize: 10, fontWeight: 700 }}>{o.status}</span>
                      </td>
                      <td style={{ padding: '8px 12px' }}>
                        <button
                          onClick={() => cancelOrder(o.orderId)}
                          disabled={canceling === o.orderId}
                          style={{
                            padding: '3px 9px', borderRadius: 5,
                            border: `1px solid ${C.red}44`, background: C.red + '12',
                            color: C.red, cursor: 'pointer', fontSize: 10, fontWeight: 700,
                          }}
                        >
                          {canceling === o.orderId ? '…' : 'Cancel'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          ) : (
            history.length === 0 ? (
              <div style={{ padding: '20px 16px', color: C.dim, fontSize: 12, textAlign: 'center' }}>
                {loadingMain ? 'Loading…' : 'No trade history'}
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                    {['Symbol', 'Side', 'Price', 'Qty', 'Total', 'Time'].map(h => (
                      <th key={h} style={{ padding: '8px 12px', color: C.dim, textAlign: 'left', fontWeight: 600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {history.map((t, i) => (
                    <tr key={i} style={{ borderBottom: `1px solid ${C.border}22` }}>
                      <td style={{ padding: '8px 12px', color: '#ccc' }}>{t.symbol}</td>
                      <td style={{ padding: '8px 12px', color: t.isBuyer ? C.teal : C.red, fontWeight: 700 }}>
                        {t.isBuyer ? 'BUY' : 'SELL'}
                      </td>
                      <td style={{ padding: '8px 12px', color: '#ccc', fontVariantNumeric: 'tabular-nums' }}>
                        ${fmtCompact(t.price)}
                      </td>
                      <td style={{ padding: '8px 12px', color: '#ccc' }}>{fmt(t.qty, 6)}</td>
                      <td style={{ padding: '8px 12px', color: C.dim }}>
                        ${fmt(parseFloat(t.price) * parseFloat(t.qty))}
                      </td>
                      <td style={{ padding: '8px 12px', color: C.dim }}>{relTime(t.time)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}
        </div>
      </div>

      <style>{`
        @keyframes tpShimmer {
          0%   { background-position: 200% 0 }
          100% { background-position: -200% 0 }
        }
      `}</style>
    </div>
  );
}
