/**
 * ALERTS PANEL — Zenith AI v2
 * Manage price/SMC alerts and view notification history.
 *
 * Props: session, onClose
 */
'use client';
import { useState, useEffect, useCallback } from 'react';

const C = {
  bg: '#0A0D13', surface: '#0d1018', card: '#11151F',
  border: '#1a1f2e', muted: '#252a38',
  text: '#e8e9f0', dim: '#5a6070', dimmer: '#2e3448',
  accent: '#7C9CFF', teal: '#5EEAD4', green: '#69db7c',
  red: '#ff6b6b', yellow: '#ffa94d', purple: '#da77f2',
};

const SYMBOLS = ['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT','ADAUSDT','DOGEUSDT','AVAXUSDT'];

const TYPE_META = {
  price_above:     { icon: '▲', color: C.green,  label: 'Price Above' },
  price_below:     { icon: '▼', color: C.red,    label: 'Price Below' },
  pct_change:      { icon: '↕', color: C.yellow, label: '24h % Move'  },
  smc_signal:      { icon: '⚡', color: C.accent, label: 'SMC Signal'  },
  smc_score_above: { icon: '📊', color: C.purple, label: 'SMC Score'  },
};

function relTime(ts) {
  const d = (Date.now() - new Date(ts).getTime()) / 1000;
  if (d < 60)    return 'just now';
  if (d < 3600)  return `${Math.floor(d/60)}m ago`;
  if (d < 86400) return `${Math.floor(d/3600)}h ago`;
  return `${Math.floor(d/86400)}d ago`;
}

// ── Create alert form ───────────────────────────────────────────────────────

function CreateAlertForm({ session, onCreated, onClose }) {
  const [symbol,     setSymbol]     = useState('BTCUSDT');
  const [type,       setType]       = useState('price_above');
  const [threshold,  setThreshold]  = useState('');
  const [timeframe,  setTimeframe]  = useState('4h');
  const [signalType, setSignalType] = useState('');
  const [label,      setLabel]      = useState('');
  const [recurring,  setRecurring]  = useState(true);
  const [saving,     setSaving]     = useState(false);
  const [err,        setErr]        = useState(null);

  const isSmcSignal = type === 'smc_signal';
  const isSmcType   = type === 'smc_signal' || type === 'smc_score_above';

  const handleCreate = async () => {
    if (!isSmcSignal && !threshold) return;
    setSaving(true); setErr(null);
    try {
      const res = await fetch('/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          action: 'create', symbol, type,
          threshold: threshold ? parseFloat(threshold) : null,
          timeframe: isSmcType ? timeframe : null,
          signalType: isSmcSignal && signalType ? signalType : null,
          label: label || null,
          recurring,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      onCreated(data.alert);
      onClose();
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10,
      padding: 16, display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: C.accent, fontSize: 12, fontWeight: 700 }}>+ New Alert</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.dim, cursor: 'pointer', fontSize: 14 }}>✕</button>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {/* Symbol */}
        <select value={symbol} onChange={e => setSymbol(e.target.value)} style={{
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 6,
          color: C.text, padding: '6px 10px', fontSize: 12, outline: 'none',
        }}>
          {SYMBOLS.map(s => <option key={s}>{s}</option>)}
        </select>

        {/* Type */}
        <select value={type} onChange={e => setType(e.target.value)} style={{
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 6,
          color: C.text, padding: '6px 10px', fontSize: 12, outline: 'none',
        }}>
          {Object.entries(TYPE_META).map(([k, m]) => (
            <option key={k} value={k}>{m.icon} {m.label}</option>
          ))}
        </select>
      </div>

      {/* Threshold (price/pct/score types) */}
      {!isSmcSignal && (
        <div>
          <label style={{ color: C.dim, fontSize: 11, display: 'block', marginBottom: 4 }}>
            {type === 'price_above' || type === 'price_below' ? 'Price (USDT)'
              : type === 'pct_change' ? '24h Change Threshold (%)'
              : 'SMC Score Threshold (0–100)'}
          </label>
          <input
            type="number" value={threshold} onChange={e => setThreshold(e.target.value)}
            placeholder={type.includes('price') ? '65000' : type === 'pct_change' ? '5' : '70'}
            style={{
              width: '100%', boxSizing: 'border-box',
              background: C.card, border: `1px solid ${C.border}`, borderRadius: 6,
              color: C.text, padding: '7px 10px', fontSize: 12, outline: 'none',
            }}
          />
        </div>
      )}

      {/* SMC-specific fields */}
      {isSmcType && (
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <label style={{ color: C.dim, fontSize: 11, display: 'block', marginBottom: 4 }}>Timeframe</label>
            <select value={timeframe} onChange={e => setTimeframe(e.target.value)} style={{
              width: '100%', background: C.card, border: `1px solid ${C.border}`, borderRadius: 6,
              color: C.text, padding: '6px 10px', fontSize: 12, outline: 'none',
            }}>
              {['1h','4h','1d'].map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          {isSmcSignal && (
            <div style={{ flex: 1 }}>
              <label style={{ color: C.dim, fontSize: 11, display: 'block', marginBottom: 4 }}>Direction</label>
              <select value={signalType} onChange={e => setSignalType(e.target.value)} style={{
                width: '100%', background: C.card, border: `1px solid ${C.border}`, borderRadius: 6,
                color: C.text, padding: '6px 10px', fontSize: 12, outline: 'none',
              }}>
                <option value="">Any</option>
                <option value="LONG">LONG only</option>
                <option value="SHORT">SHORT only</option>
              </select>
            </div>
          )}
        </div>
      )}

      {/* Label */}
      <input
        value={label} onChange={e => setLabel(e.target.value)}
        placeholder="Optional note (e.g. 'Entry zone for swing trade')"
        style={{
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 6,
          color: C.text, padding: '7px 10px', fontSize: 12, outline: 'none',
        }}
      />

      {/* Recurring toggle */}
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12, color: C.dim }}>
        <input type="checkbox" checked={recurring} onChange={e => setRecurring(e.target.checked)}
          style={{ accentColor: C.accent }} />
        Recurring (don't disable after first trigger)
      </label>

      {err && <div style={{ color: C.red, fontSize: 11 }}>⚠ {err}</div>}

      <button
        onClick={handleCreate}
        disabled={saving || (!isSmcSignal && !threshold)}
        style={{
          padding: '9px', borderRadius: 7, border: 'none',
          background: (isSmcSignal || threshold) && !saving
            ? `linear-gradient(135deg,${C.accent},${C.teal})` : C.muted,
          color: (isSmcSignal || threshold) && !saving ? C.bg : '#333',
          fontWeight: 700, fontSize: 12,
          cursor: (isSmcSignal || threshold) ? 'pointer' : 'not-allowed',
        }}
      >
        {saving ? 'Creating…' : '🔔 Create Alert'}
      </button>
    </div>
  );
}

// ── Alert row ────────────────────────────────────────────────────────────────

function AlertRow({ alert, onToggle, onDelete }) {
  const meta = TYPE_META[alert.type] ?? TYPE_META.price_above;
  const [busy, setBusy] = useState(false);

  const thresholdLabel = () => {
    if (alert.type === 'price_above' || alert.type === 'price_below') return `$${alert.threshold}`;
    if (alert.type === 'pct_change') return `±${alert.threshold}%`;
    if (alert.type === 'smc_score_above') return `≥${alert.threshold} (${alert.timeframe})`;
    if (alert.type === 'smc_signal') return `${alert.signal_type ?? 'Any'} signal (${alert.timeframe})`;
    return '';
  };

  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`,
      borderLeft: `3px solid ${alert.status === 'active' ? meta.color : C.dimmer}`,
      borderRadius: 8, padding: '11px 14px',
      display: 'flex', alignItems: 'center', gap: 12,
      opacity: alert.status === 'disabled' ? 0.5 : 1,
    }}>
      <div style={{ fontSize: 16 }}>{meta.icon}</div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ color: '#fff', fontWeight: 700, fontSize: 12 }}>{alert.symbol}</span>
          <span style={{ color: meta.color, fontSize: 11, fontWeight: 600 }}>{meta.label}</span>
          <span style={{ color: C.dim, fontSize: 11 }}>{thresholdLabel()}</span>
          {alert.status === 'triggered' && (
            <span style={{ background: C.yellow + '18', color: C.yellow, fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 3 }}>
              TRIGGERED
            </span>
          )}
        </div>
        {alert.label && <div style={{ color: C.dimmer, fontSize: 10, marginTop: 3 }}>{alert.label}</div>}
        {alert.last_checked_at && (
          <div style={{ color: C.dimmer, fontSize: 9, marginTop: 2 }}>
            Last checked {relTime(alert.last_checked_at)}
            {alert.last_value !== null && ` · current: ${alert.last_value}`}
          </div>
        )}
      </div>

      {/* Toggle active/disabled */}
      <button
        onClick={async () => {
          setBusy(true);
          await onToggle(alert.id, alert.status === 'active' ? 'disabled' : 'active');
          setBusy(false);
        }}
        disabled={busy}
        style={{
          padding: '4px 10px', borderRadius: 6, fontSize: 10, fontWeight: 700, cursor: 'pointer',
          border: `1px solid ${alert.status === 'active' ? C.green + '44' : C.border}`,
          background: alert.status === 'active' ? C.green + '14' : 'transparent',
          color: alert.status === 'active' ? C.green : C.dim,
        }}
      >
        {alert.status === 'active' ? 'ON' : 'OFF'}
      </button>

      {/* Delete */}
      <button
        onClick={() => onDelete(alert.id)}
        style={{
          padding: '4px 8px', borderRadius: 6, border: `1px solid ${C.border}`,
          background: 'transparent', color: C.dimmer, cursor: 'pointer', fontSize: 12,
        }}
      >✕</button>
    </div>
  );
}

// ── Main Panel ───────────────────────────────────────────────────────────────

export default function AlertsPanel({ session, onClose, liveStatus = 'connecting', refreshSignal = 0 }) {
  const [alerts,      setAlerts]      = useState([]);
  const [history,     setHistory]     = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [tab,      setTab]      = useState('active'); // 'active' | 'history'
  const [loading,  setLoading]  = useState(true);
  const [showAdd,  setShowAdd]  = useState(false);

  const apiCall = useCallback(async (method, body = null, qs = '') => {
    const res = await fetch(`/api/alerts${qs}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return res.json();
  }, [session]);

  const fetchAlerts = useCallback(async () => {
    const data = await apiCall('GET');
    if (data.success) setAlerts(data.alerts);
  }, [apiCall]);

  const fetchHistory = useCallback(async () => {
    const data = await apiCall('GET', null, '?history=1&limit=30');
    if (data.success) {
      setHistory(data.triggers);
      // Use the server's exact count (not limited to the 30 rows fetched
      // above) — deriving this from `history` locally would undercount
      // whenever total unread exceeds the fetched page size, and disagree
      // with the 🔔 badge in the header, which already uses this same field.
      setUnreadCount(data.unreadCount ?? 0);
    }
  }, [apiCall]);

  useEffect(() => {
    Promise.all([fetchAlerts(), fetchHistory()]).finally(() => setLoading(false));
  }, [fetchAlerts, fetchHistory]);

  // ── Live updates ─────────────────────────────────────────────────────────────
  // The actual SSE connection lives in the parent shell (ZenithAIV2) so it stays
  // alive regardless of whether this panel is mounted. `liveStatus` reflects that
  // connection's state, and `refreshSignal` ticks up each time a trigger fires —
  // we just refetch our lists when that happens.

  useEffect(() => {
    if (refreshSignal === 0) return; // skip on initial mount, fetchAlerts/fetchHistory effect already covers it
    fetchAlerts();
    fetchHistory();
  }, [refreshSignal, fetchAlerts, fetchHistory]);

  const handleToggle = async (id, status) => {
    await apiCall('POST', { action: 'toggle', id, status });
    fetchAlerts();
  };

  const handleDelete = async (id) => {
    await apiCall('POST', { action: 'delete', id });
    setAlerts(prev => prev.filter(a => a.id !== id));
  };

  const handleMarkAllRead = async () => {
    await apiCall('POST', { action: 'mark_all_read' });
    fetchHistory();
  };

  const activeAlerts   = alerts.filter(a => a.status === 'active');
  const inactiveAlerts = alerts.filter(a => a.status !== 'active');

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9300,
      background: C.bg, display: 'flex', flexDirection: 'column',
      fontFamily: 'Inter, sans-serif', overflowY: 'auto',
    }}>
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px',
        borderBottom: `1px solid ${C.border}`, flexShrink: 0, flexWrap: 'wrap', rowGap: 8,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 7, fontSize: 14,
            background: 'linear-gradient(135deg,#ffa94d,#ff6b6b)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>🔔</div>
          <span style={{ color: '#fff', fontWeight: 800, fontSize: 14, letterSpacing: '0.04em' }}>
            ALERTS
          </span>
          {/* Live indicator */}
          <span style={{
            display: 'flex', alignItems: 'center', gap: 4,
            color: liveStatus === 'live' ? C.green : liveStatus === 'error' ? C.red : C.yellow,
            fontSize: 9, fontWeight: 700,
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: '50%',
              background: liveStatus === 'live' ? C.green : liveStatus === 'error' ? C.red : C.yellow,
              animation: liveStatus === 'live' ? 'apPulse 2s infinite' : 'none',
            }} />
            {liveStatus === 'live' ? 'LIVE' : liveStatus === 'error' ? 'OFFLINE' : 'CONNECTING'}
          </span>
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button onClick={() => setShowAdd(v => !v)} style={{
            padding: '6px 14px', borderRadius: 7, cursor: 'pointer', fontWeight: 700, fontSize: 12,
            border:     `1px solid ${showAdd ? C.accent + '44' : C.border}`,
            background: showAdd ? C.accent + '14' : 'transparent',
            color:      showAdd ? C.accent : C.dim,
          }}>+ New Alert</button>
          <button onClick={onClose} style={{
            padding: '6px 10px', borderRadius: 7, border: `1px solid ${C.border}`,
            background: 'transparent', color: C.dim, cursor: 'pointer', fontSize: 14,
          }}>✕</button>
        </div>
      </div>

      {/* ── Tabs ─────────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        {[
          { id: 'active',  label: `Alerts (${activeAlerts.length})` },
          { id: 'history', label: `History ${unreadCount > 0 ? `(${unreadCount} new)` : ''}` },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: '9px 18px', border: 'none',
            borderBottom: tab === t.id ? `2px solid ${C.accent}` : '2px solid transparent',
            background: 'transparent', color: tab === t.id ? C.accent : C.dim,
            cursor: 'pointer', fontSize: 12, fontWeight: 600,
          }}>{t.label}</button>
        ))}
        {tab === 'history' && unreadCount > 0 && (
          <button onClick={handleMarkAllRead} style={{
            marginLeft: 'auto', marginRight: 16, alignSelf: 'center',
            background: 'none', border: 'none', color: C.accent, cursor: 'pointer', fontSize: 11,
          }}>Mark all read</button>
        )}
      </div>

      {/* ── Content ──────────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>

        {showAdd && (
          <CreateAlertForm
            session={session}
            onCreated={(a) => setAlerts(prev => [a, ...prev])}
            onClose={() => setShowAdd(false)}
          />
        )}

        {loading ? (
          <div style={{ color: C.dim, fontSize: 12, textAlign: 'center', padding: 40 }}>Loading…</div>
        ) : tab === 'active' ? (
          alerts.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px 20px', color: C.dimmer, fontSize: 13 }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>🔔</div>
              No alerts yet. Create one to get notified of price moves or SMC signals.
            </div>
          ) : (
            <>
              {activeAlerts.map(a => (
                <AlertRow key={a.id} alert={a} onToggle={handleToggle} onDelete={handleDelete} />
              ))}
              {inactiveAlerts.length > 0 && (
                <>
                  <div style={{ color: C.dimmer, fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', marginTop: 8 }}>
                    INACTIVE / TRIGGERED
                  </div>
                  {inactiveAlerts.map(a => (
                    <AlertRow key={a.id} alert={a} onToggle={handleToggle} onDelete={handleDelete} />
                  ))}
                </>
              )}
            </>
          )
        ) : (
          history.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px 20px', color: C.dimmer, fontSize: 13 }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>📭</div>
              No notifications yet.
            </div>
          ) : (
            history.map(h => (
              <div key={h.id} style={{
                background: C.card, border: `1px solid ${C.border}`,
                borderLeft: `3px solid ${h.read ? C.dimmer : C.accent}`,
                borderRadius: 8, padding: '11px 14px',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                  <span style={{ color: C.text, fontSize: 12 }}>{h.message}</span>
                  <span style={{ color: C.dimmer, fontSize: 10, whiteSpace: 'nowrap' }}>{relTime(h.created_at)}</span>
                </div>
              </div>
            ))
          )
        )}
      </div>

      <style>{`
        @keyframes apPulse { 0%,100% { opacity:1 } 50% { opacity:0.3 } }
      `}</style>
    </div>
  );
}
