/**
 * PORTFOLIO DASHBOARD — Zenith AI v2
 *
 * Sections:
 *   • Header      — total value, 24h change, refresh
 *   • Equity Curve — AreaChart of portfolio value over time (Supabase snapshots)
 *   • Allocation   — PieChart donut of asset distribution
 *   • P&L Table   — per-asset realized/unrealized P&L, avg buy price, ROI
 *   • Analytics   — win rate, avg win/loss, profit factor, best/worst trade
 *
 * Data flow (all client-side aggregation):
 *   1. /api/trade { action: 'balance' }             → asset holdings
 *   2. MEXC public /ticker/24hr (batch)              → current prices + 24h Δ
 *   3. /api/trade { action: 'trade_history' } ×N   → trades per symbol
 *   4. /api/portfolio (GET)                         → equity curve history
 *   5. /api/portfolio (POST)                        → save hourly snapshot
 *
 * Props: session, onClose
 */
'use client';
import { useState, useEffect, useCallback } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from 'recharts';

// ── Theme ─────────────────────────────────────────────────────────────────────

const C = {
  bg: '#0A0D13', surface: '#0d1018', card: '#11151F',
  border: '#1a1f2e', muted: '#252a38',
  text: '#e8e9f0', dim: '#5a6070', dimmer: '#2e3448',
  accent: '#7C9CFF', teal: '#5EEAD4',
  green: '#69db7c', red: '#ff6b6b', yellow: '#ffa94d', purple: '#da77f2',
};

// Known asset accent colors
const ASSET_CLR = {
  BTC: '#F7931A', ETH: '#627EEA', BNB: '#F3BA2F',
  SOL: '#9945FF', XRP: '#346AA9', ADA: '#0033AD',
  DOGE: '#C2A633', AVAX: '#E84142', MATIC: '#8247E5',
  USDT: '#26A17B', USDC: '#2775CA',
};
const PALETTE = ['#7C9CFF','#5EEAD4','#ffa94d','#da77f2','#69db7c','#ff6b6b','#F7931A','#627EEA'];
const assetColor = (sym, i) => ASSET_CLR[sym] ?? PALETTE[i % PALETTE.length];

// ── Formatters ────────────────────────────────────────────────────────────────

const fmtUsd = (n, dec = 2) => {
  if (n === null || n === undefined || isNaN(n)) return '—';
  const abs = Math.abs(n);
  const str = abs >= 1000
    ? abs.toLocaleString('en-US', { maximumFractionDigits: 2 })
    : abs >= 1 ? abs.toFixed(dec) : abs.toFixed(4);
  return `${n < 0 ? '-' : ''}$${str}`;
};

const fmtPct = (n) => {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
};

const fmtQty = (n) => {
  if (!n) return '0';
  return parseFloat(n) >= 1 ? parseFloat(n).toFixed(4) : parseFloat(n).toFixed(6);
};

const pnlColor = (n) => (!n || n === 0) ? C.dim : n > 0 ? C.green : C.red;

const timeLabel = (iso) => {
  const d = new Date(iso);
  return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}h`;
};

// ── P&L calculation helpers ────────────────────────────────────────────────────

/**
 * Compute per-asset P&L from trade history using weighted-average cost basis.
 * Returns { avgBuyPrice, costBasis, unrealizedPnL, realizedPnL, totalPnL, roi,
 *           totalBought, totalSold }
 */
function computeAssetPnL(trades, currentPrice, currentQty) {
  if (!trades?.length) return null;

  const sorted = [...trades].sort((a, b) => a.time - b.time);

  // Chronological moving-average cost basis. This walks buys/sells in order
  // and reduces the buy pool on each sell — so avgBuy naturally resets after
  // a full exit. (Previously this used one lifetime-average buy price across
  // *all* buys regardless of order, which gives the wrong realized P&L and
  // cost basis whenever a position was fully closed and later re-opened at a
  // different price — e.g. buy @10, sell @50 [+40 realized], buy @100 would
  // report realized P&L as -5 instead of +40, and cost basis as 55 instead
  // of 100. This also keeps numbers consistent with computeTradeAnalytics
  // below, which already uses this same method.)
  let buyUsdt = 0;
  let buyQty  = 0;
  let avgBuy  = 0;
  let realizedPnL     = 0;
  let totalBoughtUsdt = 0;
  let totalSoldUsdt   = 0;

  for (const t of sorted) {
    const price = parseFloat(t.price);
    const qty   = parseFloat(t.qty);
    const usdt  = parseFloat(t.quoteQty);

    if (t.isBuyer) {
      buyUsdt += usdt;
      buyQty  += qty;
      avgBuy   = buyQty > 0 ? buyUsdt / buyQty : 0;
      totalBoughtUsdt += usdt;
    } else {
      realizedPnL += (price - avgBuy) * qty;
      buyUsdt = Math.max(0, buyUsdt - avgBuy * qty);
      buyQty  = Math.max(0, buyQty  - qty);
      avgBuy   = buyQty > 0 ? buyUsdt / buyQty : 0;
      totalSoldUsdt += usdt;
    }
  }

  const avgBuyPrice   = avgBuy; // cost basis of what's currently held
  const costBasis     = avgBuyPrice * Math.max(0, currentQty);
  const currentValue  = currentPrice * Math.max(0, currentQty);
  const unrealizedPnL = currentValue - costBasis;
  const totalPnL       = unrealizedPnL + realizedPnL;
  const roi            = costBasis > 0 ? (unrealizedPnL / costBasis) * 100 : 0;

  return {
    avgBuyPrice, costBasis, currentValue, unrealizedPnL,
    realizedPnL, totalPnL, roi, totalBoughtUsdt, totalSoldUsdt,
  };
}

/**
 * Compute aggregate trade analytics across all symbols.
 */
function computeTradeAnalytics(tradesBySymbol) {
  const closedTrades = [];

  for (const [symbol, trades] of Object.entries(tradesBySymbol)) {
    const sorted = [...trades].sort((a, b) => a.time - b.time);
    let avgBuy = 0;
    let totalBuyUsdt = 0;
    let totalBuyQty  = 0;

    for (const t of sorted) {
      const price = parseFloat(t.price);
      const qty   = parseFloat(t.qty);
      const usdt  = parseFloat(t.quoteQty);

      if (t.isBuyer) {
        totalBuyUsdt += usdt;
        totalBuyQty  += qty;
        avgBuy = totalBuyQty > 0 ? totalBuyUsdt / totalBuyQty : 0;
      } else {
        const pnl = (price - avgBuy) * qty;
        closedTrades.push({ symbol, pnl, price, qty, time: t.time });
        totalBuyUsdt = Math.max(0, totalBuyUsdt - avgBuy * qty);
        totalBuyQty  = Math.max(0, totalBuyQty  - qty);
        avgBuy = totalBuyQty > 0 ? totalBuyUsdt / totalBuyQty : 0;
      }
    }
  }

  if (!closedTrades.length) return null;

  const wins   = closedTrades.filter(t => t.pnl > 0);
  const losses = closedTrades.filter(t => t.pnl < 0);
  const totalWins   = wins.reduce((s, t) => s + t.pnl, 0);
  const totalLosses = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));

  const best  = closedTrades.reduce((b, t) => t.pnl > b.pnl ? t : b);
  const worst = closedTrades.reduce((w, t) => t.pnl < w.pnl ? t : w);

  return {
    totalClosed:    closedTrades.length,
    winRate:        closedTrades.length > 0 ? wins.length / closedTrades.length * 100 : 0,
    avgWin:         wins.length   > 0 ? totalWins   / wins.length   : 0,
    avgLoss:        losses.length > 0 ? -totalLosses / losses.length : 0,
    totalPnL:       totalWins - totalLosses,
    profitFactor:   totalLosses > 0 ? totalWins / totalLosses : (totalWins > 0 ? 99 : 0),
    best,
    worst,
    winsCount:      wins.length,
    lossesCount:    losses.length,
  };
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, color }) {
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`,
      borderRadius: 9, padding: '14px 16px',
    }}>
      <div style={{ color: C.dim, fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ color: color ?? C.text, fontSize: 18, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </div>
      {sub && <div style={{ color: C.dimmer, fontSize: 10, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function Skeleton({ w = '100%', h = 14 }) {
  return (
    <div style={{
      width: w, height: h, borderRadius: 4,
      background: `linear-gradient(90deg,${C.muted} 25%,${C.card} 50%,${C.muted} 75%)`,
      backgroundSize: '200% 100%', animation: 'pdShimmer 1.4s infinite',
    }} />
  );
}

// Custom recharts tooltip
function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: C.surface, border: `1px solid ${C.border}`,
      borderRadius: 7, padding: '8px 12px', fontSize: 11,
    }}>
      <div style={{ color: C.dim, marginBottom: 4 }}>{label}</div>
      <div style={{ color: C.teal, fontWeight: 700 }}>{fmtUsd(payload[0].value)}</div>
    </div>
  );
}

// ── Main Dashboard ─────────────────────────────────────────────────────────────

export default function PortfolioDashboard({ session, onClose }) {
  const [assets,    setAssets]    = useState([]);   // [{ symbol, qty, price, pnl, ... }]
  const [analytics, setAnalytics] = useState(null);
  const [history,   setHistory]   = useState([]);   // equity curve points
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(null);

  // Derived
  const totalUsdt  = assets.reduce((s, a) => s + (a.currentValue ?? 0), 0);
  const totalPnL   = assets.reduce((s, a) => s + (a.pnl?.unrealizedPnL ?? 0), 0);
  const allocation = assets
    .filter(a => a.currentValue > 0.5)
    .map((a, i) => ({ name: a.symbol, value: a.currentValue, i }));

  // ── API helpers ─────────────────────────────────────────────────────────────

  const tradeAPI = useCallback(async (action, params = {}) => {
    const res = await fetch('/api/trade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ action, ...params }),
    });
    return res.json();
  }, [session]);

  const portfolioAPI = useCallback(async (method, body = null, qs = '') => {
    const res = await fetch(`/api/portfolio${qs}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return res.json();
  }, [session]);

  // ── Fetch & aggregate ───────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // 1. Balance
      const balRes = await tradeAPI('balance');
      if (!balRes.success) throw new Error(balRes.error ?? 'Balance fetch failed');

      const holdings = (balRes.result ?? []).filter(b => {
        const qty = parseFloat(b.free) + parseFloat(b.locked);
        return qty > 0.000001;
      });

      if (!holdings.length) {
        setAssets([]);
        setLoading(false);
        return;
      }

      // 2. Prices (MEXC public, all symbols in one batch)
      const nonUsdt = holdings.filter(b => b.asset !== 'USDT');
      const priceMap = {};

      if (nonUsdt.length) {
        const tickers = await Promise.allSettled(
          nonUsdt.map(b =>
            fetch(`https://api.mexc.com/api/v3/ticker/24hr?symbol=${b.asset}USDT`)
              .then(r => r.json())
          )
        );
        tickers.forEach((r, i) => {
          if (r.status === 'fulfilled' && r.value.lastPrice) {
            priceMap[nonUsdt[i].asset] = {
              price:  parseFloat(r.value.lastPrice),
              chgPct: parseFloat(r.value.priceChangePercent),
            };
          }
        });
      }
      priceMap['USDT'] = { price: 1, chgPct: 0 };

      // 3. Trade histories (parallel)
      const tradeHistories = {};
      await Promise.allSettled(
        nonUsdt.map(async b => {
          const res = await tradeAPI('trade_history', { symbol: `${b.asset}USDT`, limit: 500 });
          if (res.success) tradeHistories[b.asset] = res.result ?? [];
        })
      );

      // 4. Build asset rows
      const rows = holdings.map((b, i) => {
        const qty   = parseFloat(b.free) + parseFloat(b.locked);
        const info  = priceMap[b.asset] ?? { price: 0, chgPct: 0 };
        const cv    = qty * info.price;
        const pnl   = computeAssetPnL(tradeHistories[b.asset] ?? [], info.price, qty);

        return {
          symbol:       b.asset,
          qty,
          price:        info.price,
          chgPct:       info.chgPct,
          currentValue: cv,
          color:        assetColor(b.asset, i),
          pnl,
          trades:       tradeHistories[b.asset] ?? [],
        };
      }).sort((a, b) => b.currentValue - a.currentValue);

      // 5. Trade analytics
      const an = computeTradeAnalytics(tradeHistories);

      setAssets(rows);
      setAnalytics(an);

      // 6. Equity curve history
      const histRes = await portfolioAPI('GET', null, '?days=30');
      if (histRes.success) {
        setHistory(histRes.snapshots.map(s => ({
          label: timeLabel(s.snapshot_at),
          value: parseFloat(s.total_usdt),
        })));
      }

      // 7. Save snapshot (throttled server-side)
      const totalNow = rows.reduce((s, a) => s + a.currentValue, 0);
      const assetsObj = Object.fromEntries(
        rows.map(r => [r.symbol, { qty: r.qty, price: r.price, value: r.currentValue }])
      );
      portfolioAPI('POST', { totalUsdt: totalNow, assets: assetsObj }).catch(() => {});

    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [tradeAPI, portfolioAPI]);

  useEffect(() => { load(); }, [load]);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9200,
      background: C.bg, display: 'flex', flexDirection: 'column',
      fontFamily: 'Inter, sans-serif', overflowY: 'auto',
    }}>

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14, padding: '12px 20px',
        borderBottom: `1px solid ${C.border}`, flexShrink: 0, flexWrap: 'wrap', rowGap: 8,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 7, fontSize: 15,
            background: 'linear-gradient(135deg,#7C9CFF,#5EEAD4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>💼</div>
          <span style={{ color: '#fff', fontWeight: 800, fontSize: 14, letterSpacing: '0.04em' }}>
            PORTFOLIO <span style={{ color: C.accent }}>DASHBOARD</span>
          </span>
        </div>

        {/* Total value */}
        {!loading && totalUsdt > 0 && (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span style={{ color: '#fff', fontSize: 22, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
              {fmtUsd(totalUsdt)}
            </span>
            <span style={{ color: pnlColor(totalPnL), fontSize: 13, fontWeight: 700 }}>
              {totalPnL >= 0 ? '+' : ''}{fmtUsd(totalPnL)} unrealized
            </span>
          </div>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button onClick={load} style={{
            padding: '6px 12px', borderRadius: 7,
            border: `1px solid ${C.border}`, background: 'transparent',
            color: C.dim, cursor: 'pointer', fontSize: 11,
          }}>↻ Refresh</button>
          <button onClick={onClose} style={{
            padding: '6px 10px', borderRadius: 7,
            border: `1px solid ${C.border}`, background: 'transparent',
            color: C.dim, cursor: 'pointer', fontSize: 14,
          }}>✕</button>
        </div>
      </div>

      {error && (
        <div style={{ margin: 16, padding: '10px 14px', borderRadius: 8, background: '#2a0f0f', border: `1px solid ${C.red}44`, color: C.red, fontSize: 12 }}>
          ⚠ {error}
        </div>
      )}

      {/* ── Body ──────────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* ── Row 1: Equity Curve + Allocation ──────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 14 }}>

          {/* Equity Curve */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16 }}>
            <div style={{ color: C.dim, fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', marginBottom: 12 }}>
              EQUITY CURVE — LAST 30 DAYS
            </div>
            {loading ? (
              <Skeleton h={200} />
            ) : history.length < 2 ? (
              <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.dimmer, fontSize: 12, flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 28 }}>📈</span>
                Not enough data yet
                <span style={{ fontSize: 10 }}>Check back after a few hours of usage</span>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={history} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={C.teal} stopOpacity={0.25} />
                      <stop offset="95%" stopColor={C.teal} stopOpacity={0}    />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis dataKey="label" stroke={C.dimmer}
                    tick={{ fontSize: 9, fill: C.dimmer }} tickLine={false} />
                  <YAxis stroke={C.dimmer} tick={{ fontSize: 9, fill: C.dimmer }}
                    tickLine={false} tickFormatter={v => `$${v >= 1000 ? `${(v/1000).toFixed(1)}k` : v.toFixed(0)}`} />
                  <Tooltip content={<ChartTooltip />} />
                  <Area type="monotone" dataKey="value" stroke={C.teal} strokeWidth={2}
                    fill="url(#eqGrad)" dot={false} activeDot={{ r: 4, fill: C.teal }} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Allocation donut */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16 }}>
            <div style={{ color: C.dim, fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', marginBottom: 8 }}>
              ALLOCATION
            </div>
            {loading ? <Skeleton h={200} /> : allocation.length === 0 ? (
              <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.dimmer, fontSize: 12 }}>No assets</div>
            ) : (
              <>
                <PieChart width={268} height={160}>
                  <Pie data={allocation} cx={134} cy={80}
                    innerRadius={48} outerRadius={72}
                    dataKey="value" paddingAngle={2}>
                    {allocation.map((entry, i) => (
                      <Cell key={i} fill={assetColor(entry.name, i)} strokeWidth={0} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v) => fmtUsd(v)} contentStyle={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 11 }} />
                </PieChart>
                {/* Legend */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', marginTop: 4 }}>
                  {allocation.map((a, i) => (
                    <div key={a.name} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <div style={{ width: 7, height: 7, borderRadius: 2, background: assetColor(a.name, i), flexShrink: 0 }} />
                      <span style={{ color: C.dim, fontSize: 10 }}>
                        {a.name} <span style={{ color: C.dimmer }}>
                          {((a.value / totalUsdt) * 100).toFixed(0)}%
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* ── Row 2: P&L Table ──────────────────────────────────────────── */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.border}` }}>
            <span style={{ color: C.dim, fontSize: 10, fontWeight: 700, letterSpacing: '0.07em' }}>P&L PER ASSET</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                  {['Asset','Holdings','Price','24h','Avg Buy','Cost Basis','Curr Value','Unreal P&L','Real P&L','ROI'].map(h => (
                    <th key={h} style={{ padding: '8px 14px', color: C.dimmer, textAlign: h === 'Asset' ? 'left' : 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={10} style={{ padding: 20, textAlign: 'center', color: C.dimmer, fontSize: 12 }}>Loading…</td></tr>
                ) : assets.length === 0 ? (
                  <tr><td colSpan={10} style={{ padding: 20, textAlign: 'center', color: C.dimmer, fontSize: 12 }}>No assets found</td></tr>
                ) : (
                  assets.map(a => (
                    <tr key={a.symbol} style={{ borderBottom: `1px solid ${C.border}22` }}>
                      {/* Asset */}
                      <td style={{ padding: '10px 14px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                          <div style={{ width: 6, height: 6, borderRadius: 2, background: a.color }} />
                          <span style={{ color: '#fff', fontWeight: 700 }}>{a.symbol}</span>
                        </div>
                      </td>
                      {/* Holdings */}
                      <td style={{ padding: '10px 14px', textAlign: 'right', color: C.dim, fontVariantNumeric: 'tabular-nums' }}>
                        {fmtQty(a.qty)}
                      </td>
                      {/* Price */}
                      <td style={{ padding: '10px 14px', textAlign: 'right', color: C.text, fontVariantNumeric: 'tabular-nums' }}>
                        {fmtUsd(a.price)}
                      </td>
                      {/* 24h */}
                      <td style={{ padding: '10px 14px', textAlign: 'right', color: a.chgPct >= 0 ? C.green : C.red, fontWeight: 600 }}>
                        {fmtPct(a.chgPct)}
                      </td>
                      {/* Avg Buy */}
                      <td style={{ padding: '10px 14px', textAlign: 'right', color: C.dim, fontVariantNumeric: 'tabular-nums' }}>
                        {a.pnl ? fmtUsd(a.pnl.avgBuyPrice) : '—'}
                      </td>
                      {/* Cost Basis */}
                      <td style={{ padding: '10px 14px', textAlign: 'right', color: C.dim, fontVariantNumeric: 'tabular-nums' }}>
                        {a.pnl ? fmtUsd(a.pnl.costBasis) : fmtUsd(a.currentValue)}
                      </td>
                      {/* Current Value */}
                      <td style={{ padding: '10px 14px', textAlign: 'right', color: C.text, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                        {fmtUsd(a.currentValue)}
                      </td>
                      {/* Unrealized P&L */}
                      <td style={{ padding: '10px 14px', textAlign: 'right', color: pnlColor(a.pnl?.unrealizedPnL), fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                        {a.pnl ? `${a.pnl.unrealizedPnL >= 0 ? '+' : ''}${fmtUsd(a.pnl.unrealizedPnL)}` : '—'}
                      </td>
                      {/* Realized P&L */}
                      <td style={{ padding: '10px 14px', textAlign: 'right', color: pnlColor(a.pnl?.realizedPnL), fontVariantNumeric: 'tabular-nums' }}>
                        {a.pnl ? `${a.pnl.realizedPnL >= 0 ? '+' : ''}${fmtUsd(a.pnl.realizedPnL)}` : '—'}
                      </td>
                      {/* ROI */}
                      <td style={{ padding: '10px 14px', textAlign: 'right', color: pnlColor(a.pnl?.roi), fontWeight: 700 }}>
                        {a.pnl ? fmtPct(a.pnl.roi) : '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {/* Total row */}
              {!loading && assets.length > 0 && (
                <tfoot>
                  <tr style={{ borderTop: `1px solid ${C.border}`, background: C.surface }}>
                    <td style={{ padding: '10px 14px', color: C.dim, fontWeight: 700, fontSize: 11 }} colSpan={6}>TOTAL</td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', color: '#fff', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                      {fmtUsd(totalUsdt)}
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', color: pnlColor(totalPnL), fontWeight: 700 }}>
                      {totalPnL >= 0 ? '+' : ''}{fmtUsd(totalPnL)}
                    </td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>

        {/* ── Row 3: Trade Analytics ─────────────────────────────────────── */}
        {!loading && analytics && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
            <StatCard label="WIN RATE" value={`${analytics.winRate.toFixed(1)}%`}
              sub={`${analytics.winsCount}W / ${analytics.lossesCount}L of ${analytics.totalClosed} trades`}
              color={analytics.winRate >= 50 ? C.green : C.red} />
            <StatCard label="TOTAL P&L (CLOSED)"
              value={`${analytics.totalPnL >= 0 ? '+' : ''}${fmtUsd(analytics.totalPnL)}`}
              color={pnlColor(analytics.totalPnL)} />
            <StatCard label="AVG WIN" value={fmtUsd(analytics.avgWin)} color={C.green}
              sub="per profitable close" />
            <StatCard label="AVG LOSS" value={fmtUsd(-analytics.avgLoss)} color={C.red}
              sub="per losing close" />
            <StatCard label="PROFIT FACTOR"
              value={analytics.profitFactor >= 99 ? '∞' : analytics.profitFactor.toFixed(2)}
              color={analytics.profitFactor >= 1.5 ? C.green : analytics.profitFactor >= 1 ? C.yellow : C.red}
              sub="wins ÷ losses" />
            {analytics.best && (
              <StatCard label="BEST TRADE"
                value={`+${fmtUsd(analytics.best.pnl)}`}
                sub={`${analytics.best.symbol} · ${fmtQty(analytics.best.qty)} units`}
                color={C.teal} />
            )}
            {analytics.worst && (
              <StatCard label="WORST TRADE"
                value={fmtUsd(analytics.worst.pnl)}
                sub={`${analytics.worst.symbol} · ${fmtQty(analytics.worst.qty)} units`}
                color={C.red} />
            )}
          </div>
        )}

        {/* No trades state */}
        {!loading && !analytics && assets.length > 0 && (
          <div style={{
            background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
            padding: '32px 20px', textAlign: 'center', color: C.dimmer,
          }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>📊</div>
            No closed trades yet — analytics will appear after your first sell.
          </div>
        )}

      </div>

      <style>{`
        @keyframes pdShimmer { 0% { background-position:200% 0 } 100% { background-position:-200% 0 } }
      `}</style>
    </div>
  );
}
