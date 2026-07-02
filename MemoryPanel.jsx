/**
 * MEMORY PANEL — Zenith AI v2
 * Full-screen overlay to view, search, manually add, and delete
 * the orchestrator's cross-session memories.
 *
 * Props: session, onClose
 */
'use client';
import { useState, useEffect, useCallback, useRef } from 'react';

const C = {
  bg: '#0A0D13', surface: '#0d1018', card: '#11151F',
  border: '#1a1f2e', muted: '#252a38',
  text: '#e8e9f0', dim: '#5a6070', dimmer: '#2e3448',
  accent: '#7C9CFF', teal: '#5EEAD4', green: '#69db7c',
  red: '#ff6b6b', yellow: '#ffa94d', purple: '#da77f2',
};

const TYPE_META = {
  fact:         { icon: '📌', color: C.teal,   label: 'Fact'    },
  preference:   { icon: '🎯', color: C.accent,  label: 'Pref'    },
  task_summary: { icon: '📋', color: C.dim,     label: 'Summary' },
  insight:      { icon: '💡', color: C.yellow,  label: 'Insight' },
  pattern:      { icon: '🔁', color: C.purple,  label: 'Pattern' },
};

const ALL_TYPES = Object.keys(TYPE_META);

function relTime(ts) {
  const d = (Date.now() - new Date(ts).getTime()) / 1000;
  if (d < 60)    return 'just now';
  if (d < 3600)  return `${Math.floor(d/60)}m ago`;
  if (d < 86400) return `${Math.floor(d/3600)}h ago`;
  if (d < 604800) return `${Math.floor(d/86400)}d ago`;
  return `${Math.floor(d/604800)}w ago`;
}

// ── Memory Card ───────────────────────────────────────────────────────────────

function MemoryCard({ memory, onDelete }) {
  const meta = TYPE_META[memory.type] ?? TYPE_META.fact;
  const [deleting, setDeleting] = useState(false);
  const [confirm,  setConfirm]  = useState(false);

  const handleDelete = async () => {
    if (!confirm) { setConfirm(true); setTimeout(() => setConfirm(false), 3000); return; }
    setDeleting(true);
    try {
      await onDelete(memory.id);
      // On success the parent removes this card from its list, so this
      // component unmounts — no need to reset local state here.
    } catch {
      setDeleting(false);
      setConfirm(false);
    }
  };

  return (
    <div style={{
      background:   C.card,
      border:       `1px solid ${C.border}`,
      borderLeft:   `3px solid ${meta.color}`,
      borderRadius: 8,
      padding:      '12px 14px',
      display:      'flex',
      gap:          12,
    }}>
      {/* Icon */}
      <div style={{ fontSize: 16, flexShrink: 0, lineHeight: 1.4 }}>{meta.icon}</div>

      {/* Body */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Header row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
          <span style={{
            background: meta.color + '18', border: `1px solid ${meta.color}33`,
            color: meta.color, fontSize: 9, fontWeight: 700, padding: '2px 7px',
            borderRadius: 4, letterSpacing: '0.07em',
          }}>
            {meta.label.toUpperCase()}
          </span>

          {/* Importance stars */}
          <span style={{ color: C.yellow, fontSize: 10 }}>
            {'★'.repeat(Math.round(memory.importance / 2))}{'☆'.repeat(5 - Math.round(memory.importance / 2))}
          </span>
          <span style={{ color: C.dimmer, fontSize: 10 }}>{memory.importance}/10</span>

          {memory.tags?.length > 0 && (
            <span style={{ color: C.dimmer, fontSize: 10 }}>
              {memory.tags.slice(0, 4).map(t => `#${t}`).join(' ')}
            </span>
          )}

          <span style={{ marginLeft: 'auto', color: C.dimmer, fontSize: 10 }}>
            {relTime(memory.created_at)}
          </span>
        </div>

        {/* Content */}
        <div style={{ color: C.text, fontSize: 12.5, lineHeight: 1.6, wordBreak: 'break-word' }}>
          {memory.content}
        </div>

        {/* Access stats */}
        {memory.access_count > 0 && (
          <div style={{ color: C.dimmer, fontSize: 10, marginTop: 5 }}>
            Used {memory.access_count}× · last {relTime(memory.last_accessed)}
          </div>
        )}
      </div>

      {/* Delete */}
      <button
        onClick={handleDelete}
        disabled={deleting}
        style={{
          flexShrink: 0, alignSelf: 'flex-start',
          padding: '3px 8px', borderRadius: 5,
          border: `1px solid ${confirm ? C.red + '55' : C.border}`,
          background: confirm ? C.red + '14' : 'transparent',
          color: confirm ? C.red : C.dimmer,
          cursor: 'pointer', fontSize: 11, fontWeight: confirm ? 700 : 400,
          transition: 'all 0.15s',
        }}
      >
        {deleting ? '…' : confirm ? 'Sure?' : '✕'}
      </button>
    </div>
  );
}

// ── Add Memory Form ───────────────────────────────────────────────────────────

function AddMemoryForm({ session, onAdded, onClose }) {
  const [content,    setContent]    = useState('');
  const [type,       setType]       = useState('fact');
  const [tags,       setTags]       = useState('');
  const [importance, setImportance] = useState(5);
  const [saving,     setSaving]     = useState(false);
  const [err,        setErr]        = useState(null);

  const handleAdd = async () => {
    if (!content.trim()) return;
    setSaving(true); setErr(null);
    try {
      const res = await fetch('/api/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          action: 'remember', content, type, importance,
          tags: tags.split(',').map(t => t.trim()).filter(Boolean),
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      onAdded(data.memory);
      onClose();
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      background: C.surface, border: `1px solid ${C.border}`,
      borderRadius: 10, padding: 16, display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: C.accent, fontSize: 12, fontWeight: 700 }}>+ New Memory</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.dim, cursor: 'pointer', fontSize: 14 }}>✕</button>
      </div>

      <textarea
        autoFocus
        value={content}
        onChange={e => setContent(e.target.value)}
        placeholder="Enter memory content…"
        rows={3}
        style={{
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 7,
          color: C.text, padding: '8px 10px', fontSize: 12.5, outline: 'none',
          resize: 'vertical', fontFamily: 'Inter, sans-serif', lineHeight: 1.5,
        }}
      />

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <select value={type} onChange={e => setType(e.target.value)} style={{
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 6,
          color: C.text, padding: '5px 10px', fontSize: 12, outline: 'none',
        }}>
          {ALL_TYPES.map(t => (
            <option key={t} value={t}>{TYPE_META[t].icon} {TYPE_META[t].label}</option>
          ))}
        </select>

        <input
          value={tags}
          onChange={e => setTags(e.target.value)}
          placeholder="tags (comma-separated)"
          style={{
            flex: 1, background: C.card, border: `1px solid ${C.border}`, borderRadius: 6,
            color: C.text, padding: '5px 10px', fontSize: 12, outline: 'none',
          }}
        />

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: C.dim, fontSize: 11 }}>Imp</span>
          <input
            type="range" min={1} max={10} value={importance}
            onChange={e => setImportance(Number(e.target.value))}
            style={{ width: 80, accentColor: C.accent }}
          />
          <span style={{ color: C.accent, fontSize: 11, fontWeight: 700, width: 16 }}>{importance}</span>
        </div>
      </div>

      {err && <div style={{ color: C.red, fontSize: 11 }}>⚠ {err}</div>}

      <button
        onClick={handleAdd}
        disabled={saving || !content.trim()}
        style={{
          padding: '8px', borderRadius: 7, border: 'none',
          background: content.trim() && !saving ? `linear-gradient(135deg,${C.accent},${C.teal})` : C.muted,
          color: content.trim() && !saving ? C.bg : '#333',
          fontWeight: 700, fontSize: 12, cursor: content.trim() ? 'pointer' : 'not-allowed',
        }}
      >
        {saving ? 'Saving…' : '💾 Save Memory'}
      </button>
    </div>
  );
}

// ── Main Panel ────────────────────────────────────────────────────────────────

export default function MemoryPanel({ session, onClose }) {
  const [memories,    setMemories]    = useState([]);
  const [stats,       setStats]       = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [activeType,  setActiveType]  = useState(null); // null = all
  const [search,      setSearch]      = useState('');
  const [total,       setTotal]       = useState(0);
  const [showAdd,     setShowAdd]     = useState(false);
  const [page,        setPage]        = useState(0);
  const LIMIT = 20;

  const apiCall = useCallback(async (method, body = null, params = '') => {
    const url = `/api/memory${params}`;
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return res.json();
  }, [session]);

  const fetchMemories = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: LIMIT,
        offset: page * LIMIT,
        ...(activeType ? { type: activeType } : {}),
        ...(search ? { search } : {}),
      });
      const data = await apiCall('GET', null, `?${params}`);
      if (data.success) { setMemories(data.memories); setTotal(data.total); }
    } catch { /* noop */ }
    finally { setLoading(false); }
  }, [apiCall, activeType, search, page]);

  const fetchStats = useCallback(async () => {
    const data = await apiCall('POST', { action: 'stats' });
    if (data.success) setStats(data.stats);
  }, [apiCall]);

  useEffect(() => { fetchMemories(); }, [fetchMemories]);
  useEffect(() => { fetchStats(); }, [fetchStats]);

  // Search debounce
  const searchTimer = useRef(null);
  const handleSearch = (v) => {
    setSearch(v);
    setPage(0);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(fetchMemories, 350);
  };

  const handleDelete = async (id) => {
    const res = await apiCall('POST', { action: 'forget', id });
    if (!res.success) throw new Error(res.error || 'Delete failed');
    setMemories(prev => prev.filter(m => m.id !== id));
    setTotal(prev => prev - 1);
    fetchStats();
  };

  const handleAdded = () => {
    // Refetch instead of splicing the new memory in directly — a manual splice
    // would show it even when it doesn't match the current type filter or
    // search term (e.g. adding a "preference" while filtered to "insight"
    // would incorrectly show that card at the top of the filtered list).
    fetchMemories();
    fetchStats();
  };

  const typeFilters = [
    { key: null,           label: `All (${stats?.totals?.all ?? '…'})` },
    ...ALL_TYPES.map(t => ({
      key: t,
      label: `${TYPE_META[t].icon} ${TYPE_META[t].label} (${stats?.totals?.[t] ?? 0})`,
    })),
  ];

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9100,
      background: C.bg, display: 'flex', flexDirection: 'column',
      fontFamily: 'Inter, sans-serif',
    }}>
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 20px', borderBottom: `1px solid ${C.border}`,
        flexShrink: 0, flexWrap: 'wrap', rowGap: 8,
      }}>
        {/* Title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 7, fontSize: 14,
            background: `linear-gradient(135deg,${C.accent},${C.purple})`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>🧠</div>
          <span style={{ color: '#fff', fontWeight: 800, fontSize: 14, letterSpacing: '0.04em' }}>
            AGENT <span style={{ color: C.accent }}>MEMORY</span>
          </span>
          <span style={{
            background: C.muted, color: C.dim, fontSize: 10, fontWeight: 700,
            padding: '2px 8px', borderRadius: 4,
          }}>
            {total} stored
          </span>
        </div>

        {/* Search */}
        <input
          value={search}
          onChange={e => handleSearch(e.target.value)}
          placeholder="Search memories…"
          style={{
            flex: 1, minWidth: 180, background: C.card, border: `1px solid ${C.border}`,
            borderRadius: 7, color: C.text, padding: '6px 12px', fontSize: 12,
            outline: 'none',
          }}
        />

        <button onClick={() => setShowAdd(v => !v)} style={{
          padding: '6px 14px', borderRadius: 7, cursor: 'pointer', fontWeight: 700,
          border:     `1px solid ${showAdd ? C.accent + '44' : C.border}`,
          background: showAdd ? C.accent + '14' : 'transparent',
          color:      showAdd ? C.accent : C.dim, fontSize: 12,
        }}>
          + Add
        </button>

        <button onClick={onClose} style={{
          padding: '6px 10px', borderRadius: 7,
          border: `1px solid ${C.border}`, background: 'transparent',
          color: C.dim, cursor: 'pointer', fontSize: 14,
        }}>✕</button>
      </div>

      {/* ── Type filter tabs ─────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', gap: 0, borderBottom: `1px solid ${C.border}`,
        flexShrink: 0, overflowX: 'auto',
      }}>
        {typeFilters.map(f => (
          <button key={String(f.key)} onClick={() => { setActiveType(f.key); setPage(0); }} style={{
            padding: '8px 16px', border: 'none', borderRadius: 0,
            borderBottom: activeType === f.key ? `2px solid ${C.accent}` : '2px solid transparent',
            background: 'transparent',
            color: activeType === f.key ? C.accent : C.dim,
            cursor: 'pointer', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
          }}>
            {f.label}
          </button>
        ))}
      </div>

      {/* ── Content ──────────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>

        {/* Add form */}
        {showAdd && (
          <AddMemoryForm
            session={session}
            onAdded={handleAdded}
            onClose={() => setShowAdd(false)}
          />
        )}

        {/* Stats bar */}
        {stats && (
          <div style={{
            display: 'flex', gap: 16, flexWrap: 'wrap',
            background: C.surface, borderRadius: 8, border: `1px solid ${C.border}`,
            padding: '10px 14px',
          }}>
            {ALL_TYPES.map(t => (
              <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ fontSize: 12 }}>{TYPE_META[t].icon}</span>
                <span style={{ color: TYPE_META[t].color, fontSize: 11, fontWeight: 700 }}>
                  {stats.totals?.[t] ?? 0}
                </span>
                <span style={{ color: C.dimmer, fontSize: 10 }}>{TYPE_META[t].label}s</span>
              </div>
            ))}
            <div style={{ marginLeft: 'auto', color: C.dimmer, fontSize: 10 }}>
              avg importance {stats.avgImportance}/10
            </div>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div style={{ color: C.dim, fontSize: 12, textAlign: 'center', padding: 40 }}>
            Loading memories…
          </div>
        )}

        {/* Empty state */}
        {!loading && memories.length === 0 && (
          <div style={{
            textAlign: 'center', padding: '48px 20px',
            color: C.dimmer, fontSize: 13,
          }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>🧠</div>
            {search ? `No memories matching "${search}"` : 'No memories yet.'}
            <br />
            <span style={{ fontSize: 11 }}>
              {search ? 'Try a different search term.' : 'Memories are extracted automatically after each orchestration run.'}
            </span>
          </div>
        )}

        {/* Memory cards */}
        {memories.map(m => (
          <MemoryCard key={m.id} memory={m} onDelete={handleDelete} />
        ))}

        {/* Pagination */}
        {total > LIMIT && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, paddingTop: 8 }}>
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              style={{
                padding: '5px 14px', borderRadius: 6, cursor: 'pointer',
                border: `1px solid ${C.border}`, background: 'transparent',
                color: page === 0 ? C.dimmer : C.dim, fontSize: 11,
              }}
            >← Prev</button>
            <span style={{ color: C.dim, fontSize: 11, lineHeight: '28px' }}>
              {page + 1} / {Math.ceil(total / LIMIT)}
            </span>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={(page + 1) * LIMIT >= total}
              style={{
                padding: '5px 14px', borderRadius: 6, cursor: 'pointer',
                border: `1px solid ${C.border}`, background: 'transparent',
                color: (page + 1) * LIMIT >= total ? C.dimmer : C.dim, fontSize: 11,
              }}
            >Next →</button>
          </div>
        )}
      </div>
    </div>
  );
}
