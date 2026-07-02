/**
 * AI INLINE TOOLBAR
 * Floating toolbar that appears when the user selects text inside the
 * DocumentEditor's contentEditable area. Offers quick AI refinement actions
 * and streams the result back via SSE, allowing the user to accept (replace)
 * or dismiss the suggestion.
 *
 * Props:
 *   editorRef — React ref pointing to the contentEditable div
 *   session   — Supabase session (needs session.access_token)
 */
'use client';
import { useState, useEffect, useRef, useCallback } from 'react';

// ── Action definitions ────────────────────────────────────────────────────────

const ACTIONS = [
  { id: 'improve',      icon: '✨', label: 'Improve',   color: '#7C9CFF' },
  { id: 'shorten',      icon: '↓',  label: 'Shorten',   color: '#5EEAD4' },
  { id: 'expand',       icon: '↑',  label: 'Expand',    color: '#5EEAD4' },
  { id: 'fix_grammar',  icon: '✓',  label: 'Fix',       color: '#69db7c' },
  { id: 'make_formal',  icon: '👔', label: 'Formal',    color: '#ffa94d' },
  { id: 'make_casual',  icon: '😊', label: 'Casual',    color: '#ffa94d' },
  { id: 'translate',    icon: '🌐', label: 'Translate', color: '#da77f2' },
  { id: 'custom',       icon: '✏️', label: 'Custom',    color: '#aaa'    },
];

const LANGUAGES = [
  'Indonesian','English','Mandarin','Spanish','French',
  'German','Japanese','Arabic','Korean','Portuguese','Hindi',
];

// ── Toolbar width for clamping (approximate) ──────────────────────────────────
const TOOLBAR_W  = 500;
const TOOLBAR_H  = 44;

// ─────────────────────────────────────────────────────────────────────────────

export default function AIInlineToolbar({ editorRef, session }) {
  // Visibility & position
  const [visible,      setVisible]      = useState(false);
  const [pos,          setPos]          = useState({ top: 0, left: 0 });

  // Selection state (saved before buttons steal focus)
  const [selectedText, setSelectedText] = useState('');
  const savedRangeRef  = useRef(null);   // cloneRange for restoring later

  // Sub-toolbars
  const [showTranslate, setShowTranslate] = useState(false);
  const [language,      setLanguage]      = useState('Indonesian');
  const [showCustom,    setShowCustom]    = useState(false);
  const [customPrompt,  setCustomPrompt]  = useState('');

  // Streaming state
  const [activeAction,  setActiveAction]  = useState(null);
  const [streaming,     setStreaming]      = useState(false);
  const [streamText,    setStreamText]    = useState('');
  const [done,          setDone]          = useState(false);
  const [aiError,       setAIError]       = useState(null);

  const toolbarRef = useRef(null);
  const abortRef   = useRef(null);

  // ── Position toolbar ────────────────────────────────────────────────────────

  function calcPosition(range) {
    const rect = range.getBoundingClientRect();

    // Try to place toolbar above the selection
    let top  = rect.top - TOOLBAR_H - 10;
    let left = rect.left + rect.width / 2 - TOOLBAR_W / 2;

    // Not enough space above → place below
    if (top < 60) top = rect.bottom + 10;

    // Clamp horizontally — Math.max/min together (not two sequential ifs) so
    // the left-edge minimum always wins even on viewports narrower than
    // TOOLBAR_W, where the previous sequential clamps could override each
    // other and push the toolbar to a negative (off-screen) position.
    left = Math.max(8, Math.min(left, window.innerWidth - TOOLBAR_W - 8));

    return { top, left };
  }

  // ── Detect text selection ───────────────────────────────────────────────────

  const handleMouseUp = useCallback((e) => {
    setTimeout(() => {
      // Don't interfere when clicking inside our own toolbar
      if (toolbarRef.current?.contains(e.target)) return;

      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
        setVisible(false);
        return;
      }

      const range  = sel.getRangeAt(0);
      const editor = editorRef.current;
      if (!editor || !editor.contains(range.commonAncestorContainer)) {
        setVisible(false);
        return;
      }

      const text = sel.toString().trim();
      if (text.length < 3) { setVisible(false); return; }

      // Save a clone of the range so we can restore it after button clicks
      savedRangeRef.current = range.cloneRange();

      // Reset stream state for new selection
      setSelectedText(text);
      setActiveAction(null);
      setStreamText('');
      setDone(false);
      setAIError(null);
      setShowCustom(false);
      setShowTranslate(false);

      setPos(calcPosition(range));
      setVisible(true);
    }, 10);
  }, [editorRef]);

  // Dismiss when scrolling (toolbar position would be stale)
  const handleScroll = useCallback(() => setVisible(false), []);

  // Dismiss on Escape
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') dismiss();
  }, []);

  useEffect(() => {
    document.addEventListener('mouseup',  handleMouseUp);
    window.addEventListener('scroll',     handleScroll,  true);
    window.addEventListener('keydown',    handleKeyDown);
    return () => {
      document.removeEventListener('mouseup',  handleMouseUp);
      window.removeEventListener('scroll',     handleScroll,  true);
      window.removeEventListener('keydown',    handleKeyDown);
    };
  }, [handleMouseUp, handleScroll, handleKeyDown]);

  // ── Stream refinement ───────────────────────────────────────────────────────

  const runAction = async (action, opts = {}) => {
    if (!selectedText || !session) return;

    // Cancel any in-progress stream
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setActiveAction(action);
    setStreaming(true);
    setStreamText('');
    setDone(false);
    setAIError(null);

    try {
      const res = await fetch('/api/documents/refine', {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization:  `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          selectedText,
          action,
          customPrompt: opts.customPrompt ?? '',
          language:     opts.language ?? language,
        }),
        signal: ctrl.signal,
      });

      if (!res.ok) {
        let msg = `Server error ${res.status}`;
        try {
          const body = await res.json();
          if (body?.error) msg = body.error;
        } catch { /* body wasn't JSON — keep generic message */ }
        throw new Error(msg);
      }

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let   buffer  = '';

      while (true) {
        const { done: rdDone, value } = await reader.read();
        if (rdDone) break;
        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE lines
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const ev = JSON.parse(line.slice(6));
            if (ev.type === 'token') setStreamText(p => p + ev.text);
            if (ev.type === 'done')  setDone(true);
            if (ev.type === 'error') setAIError(ev.message);
          } catch { /* malformed chunk — skip */ }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        setAIError(err.message || 'Request failed');
      }
    } finally {
      setStreaming(false);
    }
  };

  // ── Accept: replace selected text with AI result ────────────────────────────

  const acceptReplacement = () => {
    const range = savedRangeRef.current;
    if (!range || !streamText) return;

    try {
      // Restore the saved selection in the contentEditable
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);

      range.deleteContents();

      // Build a fragment so embedded line breaks become real <br> elements.
      // A single text node with raw '\n' characters renders as one unbroken
      // run inside a normal (non-`pre`) contentEditable — whitespace collapses
      // by default — so multi-line output (e.g. from "Expand" or a custom
      // prompt asking for a list) would silently lose its line breaks once
      // inserted, even though the streamed preview above shows it correctly
      // (that preview uses white-space: pre-wrap).
      const frag = document.createDocumentFragment();
      const parts = streamText.split('\n');
      parts.forEach((part, i) => {
        frag.appendChild(document.createTextNode(part));
        if (i < parts.length - 1) frag.appendChild(document.createElement('br'));
      });
      const lastNode = frag.lastChild;
      range.insertNode(frag);

      // Collapse cursor to end of inserted text
      const after = document.createRange();
      if (lastNode) after.setStartAfter(lastNode);
      after.collapse(true);
      sel.removeAllRanges();
      sel.addRange(after);

      // Notify DocumentEditor so autosave triggers
      editorRef.current?.dispatchEvent(new Event('input', { bubbles: true }));
    } catch (err) {
      console.error('[AIInlineToolbar] Replace failed:', err);
    }

    dismiss();
  };

  // ── Dismiss ─────────────────────────────────────────────────────────────────

  function dismiss() {
    abortRef.current?.abort();
    setVisible(false);
    setActiveAction(null);
    setStreamText('');
    setStreaming(false);
    setDone(false);
    setAIError(null);
    setShowCustom(false);
    setShowTranslate(false);
    setCustomPrompt('');
  }

  // ── Action button handler ───────────────────────────────────────────────────

  function onActionClick(id) {
    if (id === 'translate') {
      setShowTranslate(v => !v);
      setShowCustom(false);
      return;
    }
    if (id === 'custom') {
      setShowCustom(v => !v);
      setShowTranslate(false);
      return;
    }
    setShowCustom(false);
    setShowTranslate(false);
    runAction(id);
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  if (!visible) return null;

  const hasResult = streamText.length > 0;
  const isLoading = streaming;

  return (
    <div
      ref={toolbarRef}
      style={{
        position:   'fixed',
        top:        pos.top,
        left:       pos.left,
        zIndex:     10000,
        fontFamily: 'Inter, sans-serif',
        filter:     'drop-shadow(0 10px 40px rgba(0,0,0,0.7))',
        userSelect: 'none',
        width:      TOOLBAR_W,
      }}
    >
      {/* ── Main action bar ─────────────────────────────────────────────────── */}
      <div style={{
        background:   '#0d1018',
        border:       '1px solid #252a38',
        borderRadius: 10,
        padding:      '5px 8px',
        display:      'flex',
        alignItems:   'center',
        gap:          2,
        flexWrap:     'wrap',
      }}>
        {/* AI badge */}
        <span style={{
          background:    'linear-gradient(135deg,#7C9CFF18,#5EEAD418)',
          border:        '1px solid #7C9CFF33',
          color:         '#7C9CFF',
          fontSize:      9,
          fontWeight:    700,
          padding:       '2px 7px',
          borderRadius:  4,
          letterSpacing: '0.08em',
          marginRight:   4,
          whiteSpace:    'nowrap',
        }}>⚡ AI EDIT</span>

        {ACTIONS.map(a => {
          const isActive = activeAction === a.id;
          return (
            <button
              key={a.id}
              onClick={() => onActionClick(a.id)}
              style={{
                padding:    '4px 9px',
                borderRadius: 6,
                border:     `1px solid ${isActive ? a.color + '55' : 'transparent'}`,
                background: isActive ? a.color + '1a' : 'transparent',
                color:      isActive ? a.color : '#666',
                cursor:     'pointer',
                fontSize:   11,
                fontWeight: 600,
                display:    'flex',
                alignItems: 'center',
                gap:        4,
                transition: 'all 0.1s',
                whiteSpace: 'nowrap',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = a.color + '14';
                e.currentTarget.style.color      = a.color;
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = isActive ? a.color + '1a' : 'transparent';
                e.currentTarget.style.color      = isActive ? a.color : '#666';
              }}
            >
              <span style={{ fontSize: 12 }}>{a.icon}</span>
              {a.label}
            </button>
          );
        })}

        {/* Dismiss */}
        <button
          onClick={dismiss}
          style={{
            marginLeft:  'auto',
            background:  'none',
            border:      'none',
            color:       '#2a2a2a',
            cursor:      'pointer',
            fontSize:    14,
            padding:     '2px 5px',
            lineHeight:  1,
            flexShrink:  0,
          }}
          onMouseEnter={e => e.currentTarget.style.color = '#888'}
          onMouseLeave={e => e.currentTarget.style.color = '#2a2a2a'}
        >✕</button>
      </div>

      {/* ── Translate sub-bar ───────────────────────────────────────────────── */}
      {showTranslate && (
        <div style={{
          background:   '#0d1018',
          border:       '1px solid #252a38',
          borderRadius: 8,
          padding:      '9px 12px',
          marginTop:    4,
          display:      'flex',
          gap:          8,
          alignItems:   'center',
        }}>
          <select
            value={language}
            onChange={e => setLanguage(e.target.value)}
            style={{
              flex:         1,
              background:   '#11151F',
              border:       '1px solid #1a2030',
              borderRadius: 6,
              color:        '#ccc',
              padding:      '5px 10px',
              fontSize:     12,
              outline:      'none',
            }}
          >
            {LANGUAGES.map(l => <option key={l}>{l}</option>)}
          </select>
          <button
            onClick={() => { setShowTranslate(false); runAction('translate', { language }); }}
            style={{
              padding:      '5px 16px',
              borderRadius: 6,
              border:       'none',
              background:   'linear-gradient(135deg,#7C9CFF,#da77f2)',
              color:        '#fff',
              fontWeight:   700,
              cursor:       'pointer',
              fontSize:     11,
              whiteSpace:   'nowrap',
            }}
          >
            Translate →
          </button>
        </div>
      )}

      {/* ── Custom prompt sub-bar ───────────────────────────────────────────── */}
      {showCustom && (
        <div style={{
          background:   '#0d1018',
          border:       '1px solid #252a38',
          borderRadius: 8,
          padding:      '9px 12px',
          marginTop:    4,
          display:      'flex',
          gap:          8,
          alignItems:   'center',
        }}>
          <input
            autoFocus
            value={customPrompt}
            onChange={e => setCustomPrompt(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && customPrompt.trim()) {
                setShowCustom(false);
                runAction('custom', { customPrompt });
              }
            }}
            placeholder="e.g. Make it more persuasive, add urgency..."
            style={{
              flex:         1,
              background:   '#11151F',
              border:       '1px solid #1a2030',
              borderRadius: 6,
              color:        '#e8e9f0',
              padding:      '5px 10px',
              fontSize:     12,
              outline:      'none',
              fontFamily:   'Inter, sans-serif',
            }}
          />
          <button
            onClick={() => {
              if (!customPrompt.trim()) return;
              setShowCustom(false);
              runAction('custom', { customPrompt });
            }}
            disabled={!customPrompt.trim()}
            style={{
              padding:      '5px 16px',
              borderRadius: 6,
              border:       'none',
              background:   customPrompt.trim()
                ? 'linear-gradient(135deg,#7C9CFF,#5EEAD4)'
                : '#1a1f2e',
              color:        customPrompt.trim() ? '#0A0D13' : '#333',
              fontWeight:   700,
              cursor:       customPrompt.trim() ? 'pointer' : 'not-allowed',
              fontSize:     11,
              whiteSpace:   'nowrap',
            }}
          >
            Run →
          </button>
        </div>
      )}

      {/* ── Result panel ────────────────────────────────────────────────────── */}
      {(isLoading || hasResult || aiError) && (
        <div style={{
          background:   '#0d1018',
          border:       '1px solid #252a38',
          borderRadius: 10,
          marginTop:    4,
          overflow:     'hidden',
        }}>
          {/* Header */}
          <div style={{
            padding:      '7px 14px',
            borderBottom: '1px solid #1a1f2e',
            display:      'flex',
            alignItems:   'center',
            justifyContent: 'space-between',
          }}>
            <span style={{
              color:         '#444',
              fontSize:      10,
              fontWeight:    700,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
            }}>
              {ACTIONS.find(a => a.id === activeAction)?.label ?? 'AI'} Result
            </span>

            {/* Loading dots */}
            {isLoading && (
              <span style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                {[0, 0.15, 0.3].map((d, i) => (
                  <span
                    key={i}
                    style={{
                      width:      4,
                      height:     4,
                      borderRadius: '50%',
                      background: '#7C9CFF',
                      display:    'inline-block',
                      animation:  `aibns 1s ${d}s infinite`,
                    }}
                  />
                ))}
              </span>
            )}

            {done && !aiError && (
              <span style={{ color: '#69db7c', fontSize: 10 }}>✓ Done</span>
            )}
          </div>

          {/* Streamed text preview */}
          <div style={{
            padding:   '12px 14px',
            maxHeight: 220,
            overflowY: 'auto',
            color:     aiError ? '#ff6b6b' : '#d4d8e8',
            fontSize:  13,
            lineHeight: 1.65,
            whiteSpace: 'pre-wrap',
            wordBreak:  'break-word',
            minHeight:  40,
          }}>
            {aiError
              ? `❌ ${aiError}`
              : hasResult
                ? <>
                    {streamText}
                    {isLoading && (
                      <span style={{
                        display:       'inline-block',
                        width:         2,
                        height:        13,
                        background:    '#7C9CFF',
                        marginLeft:    2,
                        animation:     'aiblink 1s step-end infinite',
                        verticalAlign: 'text-bottom',
                      }} />
                    )}
                  </>
                : <span style={{ color: '#2a2a2a', fontStyle: 'italic' }}>
                    Generating…
                  </span>
            }
          </div>

          {/* Accept / Retry / Dismiss */}
          {done && !aiError && (
            <div style={{
              padding:    '8px 12px',
              borderTop:  '1px solid #1a1f2e',
              display:    'flex',
              gap:        8,
            }}>
              <button
                onClick={acceptReplacement}
                style={{
                  flex:         1,
                  padding:      '7px',
                  borderRadius: 7,
                  border:       'none',
                  background:   'linear-gradient(135deg,#7C9CFF,#5EEAD4)',
                  color:        '#0A0D13',
                  fontWeight:   700,
                  cursor:       'pointer',
                  fontSize:     12,
                }}
              >
                ✓ Replace Selection
              </button>

              <button
                onClick={() => {
                  setStreamText('');
                  setDone(false);
                  setAIError(null);
                  runAction(activeAction, { customPrompt, language });
                }}
                style={{
                  padding:      '7px 14px',
                  borderRadius: 7,
                  border:       '1px solid #1a1f2e',
                  background:   'transparent',
                  color:        '#555',
                  cursor:       'pointer',
                  fontSize:     12,
                  whiteSpace:   'nowrap',
                }}
              >
                ↩ Retry
              </button>

              <button
                onClick={dismiss}
                style={{
                  padding:      '7px 10px',
                  borderRadius: 7,
                  border:       '1px solid #1a1f2e',
                  background:   'transparent',
                  color:        '#333',
                  cursor:       'pointer',
                  fontSize:     13,
                }}
              >
                ✕
              </button>
            </div>
          )}
        </div>
      )}

      <style>{`
        @keyframes aibns {
          0%,80%,100% { transform:translateY(0);opacity:.35 }
          40%          { transform:translateY(-4px);opacity:1 }
        }
        @keyframes aiblink {
          0%,100% { opacity:1 }
          50%     { opacity:0 }
        }
      `}</style>
    </div>
  );
}
