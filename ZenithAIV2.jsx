/**
 * ZENITH AI v2 — MAIN CHAT SHELL
 * Accepts session + onOpenDocs props from page.jsx
 */
'use client';
import { useState, useEffect, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';
import AuthScreen from './AuthScreen';
import Sidebar from './Sidebar';
import AgentActivityLog from './AgentActivityLog';
import CostDashboard  from './CostDashboard';
import TradingPanel   from './TradingPanel';
import MemoryPanel        from './MemoryPanel';
import PortfolioDashboard from './PortfolioDashboard';
import AlertsPanel        from './AlertsPanel';
import { useStreamOrchestration } from '../lib/realtime/useStreamOrchestration';
import { fetchTaskHistory, fetchTaskDetail } from '../lib/realtime/useOrchestratorRealtime';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const MODES = {
  auto:     { label:'⚡ Auto',     desc:'AI picks agents',  color:'#7C9CFF' },
  research: { label:'🔍 Research', desc:'Deep research',    color:'#748ffc' },
  writing:  { label:'✍️ Writing',  desc:'Compose content',  color:'#69db7c' },
  code:     { label:'💻 Code',     desc:'Build & review',   color:'#9775fa' },
  market:   { label:'📈 Market',   desc:'Crypto analysis',  color:'#ffa94d' },
};

function renderMd(text) {
  if (!text) return '';
  return text
    .replace(/```(\w*)\n([\s\S]*?)```/g, (_, l, c) =>
      `<pre style="background:#0d1018;border:1px solid #1a2030;border-radius:8px;padding:14px;overflow-x:auto;margin:10px 0"><code style="font-family:monospace;font-size:12px;color:#5EEAD4;line-height:1.6">${c.trim()}</code></pre>`)
    .replace(/^## (.+)$/gm,  '<h2 style="color:#fff;margin:16px 0 8px;font-size:16px;border-bottom:1px solid #1a1f2e;padding-bottom:4px">$1</h2>')
    .replace(/^### (.+)$/gm, '<h3 style="color:#e8e9f0;margin:12px 0 5px;font-size:14px">$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<strong style="color:#fff">$1</strong>')
    .replace(/`([^`]+)`/g,    '<code style="background:#1a1f2e;padding:2px 5px;border-radius:3px;font-size:12px;color:#5EEAD4;font-family:monospace">$1</code>')
    .replace(/^- (.+)$/gm,   '<li style="margin:3px 0;color:#bbb">$1</li>')
    .replace(/\n{2,}/g,       '</p><p style="margin:8px 0">');
}

function Bubble({ msg, isStreaming, onSaveDoc }) {
  const isUser = msg.role === 'user';
  const orchestrated = (msg.agentsUsed || 0) > 0;
  const content = isStreaming ? (msg.streamContent || '') : (msg.content || '');
  return (
    <div style={{ display:'flex', justifyContent:isUser?'flex-end':'flex-start', marginBottom:18, gap:10, alignItems:'flex-start' }}>
      {!isUser && (
        <div style={{ width:32, height:32, borderRadius:8, flexShrink:0, marginTop:2,
          background: orchestrated||isStreaming ? 'linear-gradient(135deg,#7C9CFF,#5EEAD4)' : 'linear-gradient(135deg,#7C9CFF88,#5EEAD488)',
          display:'flex', alignItems:'center', justifyContent:'center', fontSize:16, fontWeight:900, color:'#0A0D13',
          animation: isStreaming ? 'zpulse 1.5s ease-in-out infinite' : 'none',
        }}>
          {orchestrated||isStreaming ? '🤖' : '▲'}
        </div>
      )}
      <div style={{ maxWidth:'76%', display:'flex', flexDirection:'column', gap:5 }}>
        {orchestrated && !isStreaming && (
          <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
            <span style={{ background:'#7C9CFF18', border:'1px solid #7C9CFF33', color:'#7C9CFF', fontSize:10, padding:'2px 8px', borderRadius:4, fontWeight:700 }}>🤖 {msg.agentsUsed} AGENTS</span>
            {msg.subtasksCompleted > 0 && <span style={{ background:'#1a1a1a', color:'#444', fontSize:10, padding:'2px 8px', borderRadius:4 }}>{msg.subtasksCompleted} subtasks</span>}
            {msg.cost?.totalCostUsd && <span style={{ background:'#1a2e1f', color:'#69db7c', fontSize:10, padding:'2px 8px', borderRadius:4 }}>${msg.cost.totalCostUsd}</span>}
          </div>
        )}
        <div style={{
          background: isUser ? '#1a2244' : '#11151F',
          border: `1px solid ${isUser ? '#3b5bdb33' : isStreaming ? '#7C9CFF33' : '#1a1f2e'}`,
          borderRadius: isUser ? '14px 4px 14px 14px' : '4px 14px 14px 14px',
          padding:'12px 16px', color: msg.error ? '#ff6b6b' : '#e8e9f0', fontSize:14, lineHeight:1.7,
        }}>
          {isUser ? content : <div dangerouslySetInnerHTML={{ __html: renderMd(content) }} />}
          {isStreaming && <span style={{ display:'inline-block', width:2, height:14, background:'#7C9CFF', marginLeft:2, animation:'zblink 1s step-end infinite', verticalAlign:'text-bottom' }} />}
        </div>
        <div style={{ color:'#333', fontSize:10, textAlign: isUser ? 'right' : 'left', display:'flex', alignItems:'center', gap:8, justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
          <span>{new Date(msg.created_at).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })}</span>
          {!isUser && !isStreaming && !msg.error && content && (
            <button
              onClick={() => onSaveDoc?.(msg)}
              title="Save as Document"
              style={{ background:'none', border:'1px solid #1a1f2e', borderRadius:4, color:'#333', cursor:'pointer', fontSize:10, padding:'2px 7px', transition:'all 0.15s' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor='#7C9CFF44'; e.currentTarget.style.color='#7C9CFF'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor='#1a1f2e'; e.currentTarget.style.color='#333'; }}
            >📄 Save as Doc</button>
          )}
        </div>
      </div>
    </div>
  );
}

function Thinking({ active, done, total }) {
  return (
    <div style={{ display:'flex', gap:10, marginBottom:18, alignItems:'flex-start' }}>
      <div style={{ width:32, height:32, borderRadius:8, flexShrink:0, background:'linear-gradient(135deg,#7C9CFF,#5EEAD4)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:16 }}>🤖</div>
      <div style={{ background:'#11151F', border:'1px solid #7C9CFF33', borderRadius:'4px 14px 14px 14px', padding:'13px 18px', display:'flex', alignItems:'center', gap:12 }}>
        <div style={{ display:'flex', gap:4 }}>
          {[0,.2,.4].map((d,i) => <div key={i} style={{ width:6, height:6, borderRadius:'50%', background:'#7C9CFF', animation:`zbns 1s ${d}s infinite` }} />)}
        </div>
        <span style={{ color:'#555', fontSize:12 }}>
          {total > 0 ? `${done}/${total} agents done${active > 0 ? ` • ${active} running` : ''}...` : 'Supervisor planning...'}
        </span>
      </div>
    </div>
  );
}

export default function ZenithAIV2({ session: sessionProp, onOpenDocs, onOpenEditorWithAI }) {
  const [session,      setSession]      = useState(sessionProp ?? undefined);
  const [messages,     setMessages]     = useState([]);
  const [input,        setInput]        = useState('');
  const [mode,         setMode]         = useState('auto');
  const [useStreaming, setUseStreaming]  = useState(true);
  const [sidebarOpen,  setSidebarOpen]  = useState(false);
  const [showLog,      setShowLog]      = useState(false);
  const [showCost,     setShowCost]     = useState(false);
  const [showTrading,  setShowTrading]  = useState(false);
  const [showMemory,   setShowMemory]   = useState(false);
  const [showPortfolio, setShowPortfolio] = useState(false);
  const [showAlerts,    setShowAlerts]    = useState(false);
  const [unreadAlerts,  setUnreadAlerts]  = useState(0);

  // Cost/Alerts/Portfolio/Memory/Trading panels are all full-screen overlays
  // (position:fixed, inset:0) toggled by independent booleans above. Opening
  // more than one at once just stacks them by z-index — the ones underneath
  // are fully hidden (no visible close button) but stay mounted and running
  // (polling, timers) in the background. This keeps them mutually exclusive:
  // opening one closes the rest, and clicking the same button again toggles
  // it closed like before.
  const openOverlay = (setter, current) => {
    setShowCost(false);
    setShowAlerts(false);
    setShowPortfolio(false);
    setShowMemory(false);
    setShowTrading(false);
    if (!current) setter(true);
  };
  const [tasks,        setTasks]        = useState([]);
  const [activeId,     setActiveId]     = useState(null);
  const [batchLoading, setBatchLoading] = useState(false);
  const [toast,        setToast]        = useState(null);
  const bottomRef = useRef(null);

  const {
    start: startStream, abort: abortStream,
    streaming, tokens, plan, agentStatuses, agentEvents,
    activeAgents, doneAgents, error: streamError,
    cost: streamCost, taskId: streamTaskId,
  } = useStreamOrchestration();

  const loading = streaming || batchLoading;

  // Auth (if no session passed via props, handle internally)
  useEffect(() => {
    if (sessionProp !== undefined) { setSession(sessionProp); return; }
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session ?? null));
    const { data: l } = supabase.auth.onAuthStateChange((_, s) => setSession(s ?? null));
    return () => l.subscription.unsubscribe();
  }, [sessionProp]);

  // Poll unread alert-trigger count (authoritative resync, every 60s — backstop
  // for the live SSE stream below, which updates the badge instantly on triggers)
  useEffect(() => {
    if (!session?.access_token) return;
    const fetchUnread = async () => {
      try {
        const res = await fetch('/api/alerts?history=1&limit=1', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const data = await res.json();
        if (data.success) setUnreadAlerts(data.unreadCount ?? 0);
      } catch { /* noop */ }
    };
    fetchUnread();
    const t = setInterval(fetchUnread, 60_000);
    return () => clearInterval(t);
  }, [session]);

  // Global live alerts stream (SSE) — lives at the shell level so triggers keep
  // pushing toasts + browser notifications regardless of whether AlertsPanel is
  // open. Auto-reconnects when the server closes the connection (it force-closes
  // every ~10min to bound serverless runtime) or on network error.
  const alertsESRef = useRef(null);
  const alertsReconnectRef = useRef(null);
  const [alertsLiveStatus, setAlertsLiveStatus] = useState('connecting');
  const [alertsRefreshSignal, setAlertsRefreshSignal] = useState(0);

  useEffect(() => {
    if (!session?.access_token) return;
    let cancelled = false;

    const connect = () => {
      if (cancelled) return;
      setAlertsLiveStatus('connecting');
      const es = new EventSource(`/api/alerts/stream?token=${encodeURIComponent(session.access_token)}`);
      alertsESRef.current = es;

      es.addEventListener('connected', () => setAlertsLiveStatus('live'));
      es.addEventListener('heartbeat', () => setAlertsLiveStatus('live'));

      es.addEventListener('trigger', (e) => {
        let data;
        try { data = JSON.parse(e.data); } catch { return; }
        setUnreadAlerts(prev => prev + 1);
        setAlertsRefreshSignal(prev => prev + 1);
        setToast({ type: 'success', text: `🔔 ${data.message}` });
        setTimeout(() => setToast(null), 5000);
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          new Notification('Zenith Alert', { body: data.message });
        }
      });

      const scheduleReconnect = () => {
        if (cancelled) return;
        setAlertsLiveStatus('error');
        try { es.close(); } catch { /* already closed */ }
        if (alertsReconnectRef.current) clearTimeout(alertsReconnectRef.current);
        alertsReconnectRef.current = setTimeout(connect, 3000);
      };

      es.addEventListener('closing', scheduleReconnect);
      es.onerror = scheduleReconnect;
    };

    connect();

    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission();
    }

    return () => {
      cancelled = true;
      if (alertsReconnectRef.current) clearTimeout(alertsReconnectRef.current);
      alertsESRef.current?.close();
    };
  }, [session?.access_token]);

  useEffect(() => {
    if (session?.user) fetchTaskHistory(supabase, session.user.id).then(setTasks);
  }, [session]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior:'smooth' }); }, [messages, tokens]);

  // Sync streaming tokens → last message
  useEffect(() => {
    if (!streaming || !tokens) return;
    setMessages(prev => {
      const last = prev[prev.length - 1];
      if (last?.streaming) return [...prev.slice(0, -1), { ...last, streamContent: tokens }];
      return prev;
    });
  }, [tokens, streaming]);

  // Finalize streaming message
  useEffect(() => {
    if (streaming) return;
    setMessages(prev => {
      const last = prev[prev.length - 1];
      if (last?.streaming) {
        const f = { ...last, streaming: false, content: last.streamContent || last.content,
          agentsUsed: Object.values(agentStatuses).filter(s => s === 'done').length,
          subtasksCompleted: plan?.length || 0, cost: streamCost };
        delete f.streamContent;
        return [...prev.slice(0, -1), f];
      }
      return prev;
    });
    if (streamTaskId && session?.user) fetchTaskHistory(supabase, session.user.id).then(setTasks);
  }, [streaming]);

  useEffect(() => {
    if (streamError) {
      setMessages(prev => [...prev.filter(m => !m.streaming), {
        id: crypto.randomUUID(), role:'assistant', content:`❌ ${streamError}`,
        created_at: new Date().toISOString(), error: true,
      }]);
    }
  }, [streamError]);

  async function saveAsDocument(msg) {
    if (!session) return;
    const rawContent = msg.content || '';
    // Convert markdown to basic HTML for the document
    const html = renderMd(rawContent)
      .replace(/<\/p><p/g, '</p>\n<p')
      .replace(/<li/g, '\n<li');
    const docTitle = rawContent.replace(/[#*`]/g, '').trim().slice(0, 60) || 'AI Output';
    try {
      const res = await fetch('/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          title: docTitle,
          content: `<div style="font-family:Inter,sans-serif;font-size:12pt;line-height:1.6;color:#1a1a1a">${html}</div>`,
          metadata: { ai_generated: true, source: 'chat', agents_used: msg.agentsUsed || 0 },
        }),
      });
      const data = await res.json();
      if (data.success) {
        setToast({ type: 'success', text: '✓ Saved to Documents' });
        setTimeout(() => setToast(null), 3000);
      } else {
        throw new Error(data.error || 'Save failed');
      }
    } catch (err) {
      setToast({ type: 'error', text: `✕ ${err.message}` });
      setTimeout(() => setToast(null), 3000);
    }
  }

  async function send() {
    if (!input.trim() || loading || !session) return;
    const text = input.trim();
    setInput(''); setShowLog(true);
    setMessages(prev => [...prev, { id: crypto.randomUUID(), role:'user', content: text, created_at: new Date().toISOString() }]);

    if (useStreaming) {
      setMessages(prev => [...prev, { id: crypto.randomUUID(), role:'assistant', content:'', streamContent:'', streaming: true, created_at: new Date().toISOString(), agentsUsed: 0 }]);
      await startStream({ userInput: text, mode, accessToken: session.access_token });
    } else {
      setBatchLoading(true);
      try {
        const res = await fetch('/api/orchestrate', {
          method:'POST',
          headers: { 'Content-Type':'application/json', Authorization:`Bearer ${session.access_token}` },
          body: JSON.stringify({ userInput: text, mode }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || data.error || 'Failed');
        setMessages(prev => [...prev, {
          id: crypto.randomUUID(), role:'assistant',
          content: data.finalOutput || 'No output.',
          created_at: new Date().toISOString(),
          agentsUsed: data.agentsUsed || 0,
          subtasksCompleted: data.subtasksCompleted || 0,
          cost: data.cost,
        }]);
        if (session?.user) fetchTaskHistory(supabase, session.user.id).then(setTasks);
      } catch (err) {
        setMessages(prev => [...prev, { id: crypto.randomUUID(), role:'assistant', content:`❌ ${err.message}`, created_at: new Date().toISOString(), error: true }]);
      } finally { setBatchLoading(false); }
    }
  }

  async function loadTask(id) {
    setActiveId(id);
    const { task, agentResults } = await fetchTaskDetail(supabase, id);
    if (task) setMessages([
      { id: id + '-u', role:'user', content: task.original_request, created_at: task.created_at },
      { id: id + '-a', role:'assistant',
        content: agentResults.map(r => r.result_text).filter(Boolean).join('\n\n---\n\n') || '(No stored output)',
        created_at: task.completed_at || task.created_at,
        agentsUsed: agentResults.length, subtasksCompleted: agentResults.length,
        cost: { totalCostUsd: task.total_cost_usd } },
    ]);
  }

  async function deleteTask(id) {
    await supabase.from('orchestration_tasks').delete().eq('id', id);
    setTasks(p => p.filter(t => t.id !== id));
    if (activeId === id) { setMessages([]); setActiveId(null); }
  }

  function newChat() {
    setMessages([]); setActiveId(null); abortStream(); setSidebarOpen(false);
  }

  if (session === undefined) return (
    <div style={{ height:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#0A0D13', color:'#444', fontFamily:'Inter,sans-serif' }}>Loading...</div>
  );
  if (!session) return <AuthScreen />;

  const logEvents = agentEvents.map(e => ({
    timestamp: new Date().toISOString(),
    agent: e.agent || 'System',
    action: e.message || e.type,
    status: e.type === 'agent_error' ? 'failed' : 'success',
  }));

  return (
    <div style={{ display:'flex', height:'100vh', background:'#0A0D13', fontFamily:'Inter,sans-serif', color:'#e8e9f0', overflow:'hidden' }}>
      <Sidebar
        conversations={[]} orchestrationTasks={tasks} activeId={activeId}
        onSelect={id => { loadTask(id); setSidebarOpen(false); }}
        onNewChat={newChat} onDelete={deleteTask}
        userEmail={session.user?.email}
        onSignOut={() => supabase.auth.signOut()}
        open={sidebarOpen} onClose={() => setSidebarOpen(false)}
      />

      <div style={{ flex:1, display:'flex', flexDirection:'column', minWidth:0, marginRight: showLog ? 420 : 0, transition:'margin-right 0.3s ease' }}>
        {/* Top bar */}
        <div style={{ padding:'12px 20px', borderBottom:'1px solid #1a1f2e', display:'flex', justifyContent:'space-between', alignItems:'center', background:'#0d1018', flexShrink:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <button onClick={() => setSidebarOpen(true)} className="hamburger" style={{ background:'none', border:'none', color:'#555', cursor:'pointer', fontSize:18, display:'none', padding:'2px 6px' }}>☰</button>
            <span style={{ fontWeight:700, fontSize:15 }}>▲ Zenith</span>
            <span style={{ background:'#7C9CFF14', border:'1px solid #7C9CFF22', color:'#7C9CFF', fontSize:9, padding:'2px 8px', borderRadius:4, fontWeight:700, letterSpacing:'0.08em' }}>100 AGENTS</span>
            <button onClick={() => setUseStreaming(v => !v)} style={{ padding:'3px 8px', borderRadius:5, border:`1px solid ${useStreaming ? '#5EEAD433' : '#1a1f2e'}`, background: useStreaming ? '#5EEAD418' : 'transparent', color: useStreaming ? '#5EEAD4' : '#333', cursor:'pointer', fontSize:10, fontWeight:600 }}>
              {useStreaming ? '⚡ STREAM' : '⏳ BATCH'}
            </button>
          </div>

          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            {/* Documents button */}
            <button
              onClick={onOpenDocs}
              style={{ padding:'6px 12px', borderRadius:7, border:'1px solid #1a1f2e', background:'transparent', color:'#888', cursor:'pointer', fontSize:12, display:'flex', alignItems:'center', gap:6, transition:'all 0.15s' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = '#7C9CFF44'; e.currentTarget.style.color = '#7C9CFF'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = '#1a1f2e'; e.currentTarget.style.color = '#888'; }}
            >
              📄 Docs
            </button>
            <button onClick={() => openOverlay(setShowCost, showCost)} style={{ padding:'6px 10px', borderRadius:7, border:'1px solid #1a1f2e', background:'transparent', color:'#555', cursor:'pointer', fontSize:12 }}>💰</button>
            <button onClick={() => openOverlay(setShowAlerts, showAlerts)} style={{ position:'relative', padding:'6px 12px', borderRadius:7, border: showAlerts ? '1px solid #ffa94d55' : '1px solid #1a1f2e', background: showAlerts ? '#ffa94d18' : 'transparent', color: showAlerts ? '#ffa94d' : '#444', cursor:'pointer', fontSize:12, fontWeight:600 }}>
              🔔
              {unreadAlerts > 0 && (
                <span style={{ position:'absolute', top:-3, right:-3, background:'#ff6b6b', color:'#fff', fontSize:8, fontWeight:800, borderRadius:8, padding:'1px 4px', minWidth:13, textAlign:'center', lineHeight:'12px' }}>
                  {unreadAlerts > 9 ? '9+' : unreadAlerts}
                </span>
              )}
            </button>
            <button onClick={() => openOverlay(setShowPortfolio, showPortfolio)} style={{ padding:'6px 12px', borderRadius:7, border: showPortfolio ? '1px solid #69db7c55' : '1px solid #1a1f2e', background: showPortfolio ? '#69db7c18' : 'transparent', color: showPortfolio ? '#69db7c' : '#444', cursor:'pointer', fontSize:12, fontWeight:600 }}>💼</button>
            <button onClick={() => openOverlay(setShowMemory, showMemory)} style={{ padding:'6px 12px', borderRadius:7, border: showMemory ? '1px solid #da77f255' : '1px solid #1a1f2e', background: showMemory ? '#da77f218' : 'transparent', color: showMemory ? '#da77f2' : '#444', cursor:'pointer', fontSize:12, fontWeight:600 }}>🧠</button>
            <button onClick={() => openOverlay(setShowTrading, showTrading)} style={{ padding:'6px 12px', borderRadius:7, border: showTrading ? '1px solid #ffa94d55' : '1px solid #1a1f2e', background: showTrading ? '#ffa94d18' : 'transparent', color: showTrading ? '#ffa94d' : '#444', cursor:'pointer', fontSize:12, fontWeight:600 }}>📈</button>
            <button onClick={() => setShowLog(v => !v)} style={{ padding:'6px 12px', borderRadius:7, border: showLog ? '1px solid #7C9CFF44' : '1px solid #1a1f2e', background: showLog ? '#7C9CFF18' : 'transparent', color: showLog ? '#7C9CFF' : '#444', cursor:'pointer', fontSize:12, fontWeight:600 }}>
              🤖 {showLog ? '▶' : '◀'}
            </button>
          </div>
        </div>

        {/* Messages */}
        <div style={{ flex:1, overflowY:'auto', padding:'28px 36px' }}>
          {messages.length === 0 && (
            <div style={{ textAlign:'center', marginTop:72, color:'#2a2a2a' }}>
              <div style={{ fontSize:52 }}>▲</div>
              <div style={{ fontSize:20, fontWeight:700, color:'#444', marginTop:14 }}>Zenith AI v2</div>
              <div style={{ fontSize:13, marginTop:6, color:'#333' }}>100 agents · Real data · Complex tasks</div>

              {/* Quick actions */}
              <div style={{ display:'flex', gap:10, justifyContent:'center', marginTop:20 }}>
                <button onClick={onOpenDocs} style={{ padding:'8px 16px', borderRadius:8, border:'1px solid #1a1f2e', background:'#0d1018', color:'#7C9CFF', cursor:'pointer', fontSize:12, fontWeight:600, display:'flex', alignItems:'center', gap:6 }}>
                  📄 Open Documents
                </button>
                <button onClick={() => onOpenEditorWithAI?.() } style={{ padding:'8px 16px', borderRadius:8, border:'1px solid #7C9CFF33', background:'#7C9CFF14', color:'#7C9CFF', cursor:'pointer', fontSize:12, fontWeight:600 }}>
                  🤖 AI Write a Doc
                </button>
              </div>

              <div style={{ display:'flex', flexDirection:'column', gap:8, maxWidth:500, margin:'28px auto 0' }}>
                {[
                  '🔍 Research AI startup landscape and write investment thesis',
                  '📈 Analyze BTC/USDT with SMC — key levels and 7-day forecast',
                  '💻 Design scalable SaaS architecture with auth and payments',
                  '✍️ Write a 3000-word whitepaper on decentralized AI governance',
                ].map((p, i) => (
                  <button key={i} onClick={() => setInput(p.slice(2).trim())}
                    style={{ padding:'11px 16px', background:'#0d1018', border:'1px solid #1a1f2e', borderRadius:10, color:'#555', cursor:'pointer', fontSize:13, textAlign:'left', transition:'all 0.15s' }}
                    onMouseOver={e => { e.target.style.borderColor='#7C9CFF44'; e.target.style.color='#aaa'; }}
                    onMouseOut={e => { e.target.style.borderColor='#1a1f2e'; e.target.style.color='#555'; }}
                  >{p}</button>
                ))}
              </div>
            </div>
          )}

          {messages.map(m => <Bubble key={m.id} msg={m} isStreaming={m.streaming && streaming} onSaveDoc={saveAsDocument} />)}
          {loading && !messages.find(m => m.streaming) && <Thinking active={activeAgents} done={doneAgents} total={plan?.length || 0} />}
          <div ref={bottomRef} />
        </div>

        {/* Input area */}
        <div style={{ padding:'14px 36px 18px', borderTop:'1px solid #1a1f2e', background:'#0d1018', flexShrink:0 }}>
          <div style={{ display:'flex', gap:6, marginBottom:10, overflowX:'auto', paddingBottom:2 }}>
            {Object.entries(MODES).map(([k, m]) => (
              <button key={k} onClick={() => setMode(k)} style={{ padding:'5px 12px', borderRadius:7, border:`1px solid ${mode===k ? m.color+'55' : '#1a1f2e'}`, background: mode===k ? m.color+'14' : 'transparent', color: mode===k ? m.color : '#444', cursor:'pointer', fontSize:12, fontWeight:600, whiteSpace:'nowrap', transition:'all 0.15s' }}>{m.label}</button>
            ))}
          </div>

          <div style={{ display:'flex', gap:10, alignItems:'flex-end' }}>
            <textarea
              value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="Give the agents a complex task..."
              disabled={loading} rows={2}
              style={{ flex:1, background:'#11151F', border:'1px solid #1a2030', borderRadius:12, padding:'11px 16px', color:'#e8e9f0', fontSize:14, resize:'none', outline:'none', fontFamily:'Inter,sans-serif', lineHeight:1.5 }}
            />
            {loading
              ? <button onClick={abortStream} style={{ padding:'11px 18px', borderRadius:12, border:'1px solid #ff6b6b44', height:50, background:'#ff6b6b18', color:'#ff6b6b', cursor:'pointer', fontWeight:700, fontSize:13, minWidth:78 }}>✕ Stop</button>
              : <button onClick={send} disabled={!input.trim()} style={{ padding:'11px 20px', borderRadius:12, border:'none', height:50, background: !input.trim() ? '#1a1f2e' : 'linear-gradient(135deg,#7C9CFF,#5EEAD4)', color: !input.trim() ? '#333' : '#0A0D13', cursor: !input.trim() ? 'not-allowed' : 'pointer', fontWeight:700, fontSize:14, transition:'all 0.15s', minWidth:78 }}>↑ Run</button>
            }
          </div>

          <div style={{ color:'#222', fontSize:11, marginTop:7, display:'flex', justifyContent:'space-between' }}>
            <span>Shift+Enter = newline</span>
            <span>{MODES[mode]?.desc} · {useStreaming ? 'streaming' : 'batch'}</span>
          </div>
        </div>
      </div>

      {showLog && (
        <AgentActivityLog
          isRunning={loading}
          subtasks={plan?.map(s => ({ ...s, assigned_agents: [s.agent] })) || []}
          agentStatuses={agentStatuses} agentOutputs={{}}
          executionLog={logEvents} cost={streamCost || {}}
          onClose={() => setShowLog(false)}
        />
      )}

      {showCost && (
        <CostDashboard supabase={supabase} userId={session.user?.id} onClose={() => setShowCost(false)} />
      )}
      {showTrading && (
        <TradingPanel session={session} onClose={() => setShowTrading(false)} />
      )}
      {showMemory && (
        <MemoryPanel session={session} onClose={() => setShowMemory(false)} />
      )}
      {showPortfolio && (
        <PortfolioDashboard session={session} onClose={() => setShowPortfolio(false)} />
      )}
      {showAlerts && (
        <AlertsPanel
          session={session}
          onClose={() => setShowAlerts(false)}
          liveStatus={alertsLiveStatus}
          refreshSignal={alertsRefreshSignal}
        />
      )}

      {toast && (
        <div style={{ position:'fixed', bottom:90, left:'50%', transform:'translateX(-50%)', background: toast.type === 'success' ? '#0d2a1f' : '#2a0d0d', border:`1px solid ${toast.type === 'success' ? '#69db7c44' : '#ff6b6b44'}`, borderRadius:10, padding:'10px 20px', color: toast.type === 'success' ? '#69db7c' : '#ff6b6b', fontSize:13, fontWeight:600, zIndex:9999, boxShadow:'0 8px 32px #000a', pointerEvents:'none' }}>
          {toast.text}
        </div>
      )}

      <style>{`
        @media(max-width:768px){.hamburger{display:block!important;}}
        @keyframes zbns{0%,80%,100%{transform:translateY(0);opacity:.4}40%{transform:translateY(-6px);opacity:1}}
        @keyframes zpulse{0%,100%{opacity:1}50%{opacity:.6}}
        @keyframes zblink{0%,100%{opacity:1}50%{opacity:0}}
      `}</style>
    </div>
  );
}
