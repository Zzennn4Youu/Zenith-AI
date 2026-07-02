/**
 * DOCUMENT EDITOR — Full Microsoft Word-style editor
 * Features: contentEditable pages, toolbar, AI generation, find/replace,
 *           templates, autosave, versioning, export HTML/PDF, word count
 */
'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import DocumentToolbar    from './DocumentToolbar';
import FindReplace        from './FindReplace';
import DocumentTemplates  from './DocumentTemplates';
import AIInlineToolbar    from './AIInlineToolbar';

const PAGE_SIZES = {
  A4:     { width: 794,  height: 1123 },
  Letter: { width: 816,  height: 1056 },
  Legal:  { width: 816,  height: 1344 },
  A3:     { width: 1123, height: 1587 },
};

const DEFAULT_PAGE  = { pageSize:'A4', orientation:'portrait', marginTop:72, marginBottom:72, marginLeft:90, marginRight:90 };
const DEFAULT_FONT  = { defaultFont:'Inter', defaultSize:12, defaultColor:'#1a1a1a', lineHeight:'1.6' };
const AUTOSAVE_MS   = 2500;

function countWords(text) { return (text||'').split(/\s+/).filter(Boolean).length; }

// Escape user-controlled text before interpolating into raw HTML template
// strings (exportHTML / printDoc below use this for `title`) — without it, a
// title containing e.g. `</title><script>...` breaks out of its tag and
// injects into the exported file / print window.
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ── Page Settings modal ──────────────────────────────────────────────────────
function PageSettingsModal({ s, onChange, onClose }) {
  const ipt = (key) => (
    <input type="number" value={s[key]} min={0} max={300}
      onChange={e => onChange({ ...s, [key]: +e.target.value || 0 })}
      style={{ width:72, background:'#11151F', border:'1px solid #1a2030', borderRadius:6, color:'#ccc', padding:'6px 10px', fontSize:13, outline:'none', textAlign:'center' }} />
  );
  return (
    <div style={{ position:'fixed', inset:0, background:'#000000bb', display:'flex', alignItems:'center', justifyContent:'center', zIndex:9999, fontFamily:'Inter,sans-serif' }}>
      <div style={{ background:'#0d1018', border:'1px solid #1a1f2e', borderRadius:14, width:360, padding:'24px 28px', boxShadow:'0 32px 80px #000c' }}>
        <div style={{ color:'#fff', fontWeight:700, fontSize:16, marginBottom:18 }}>📐 Page Settings</div>
        {[['Page Size','pageSize','select',['A4','Letter','Legal','A3']],['Orientation','orientation','select',['portrait','landscape']]].map(([label,key,type,opts])=>(
          <div key={key} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
            <span style={{ color:'#888', fontSize:13 }}>{label}</span>
            <select value={s[key]} onChange={e=>onChange({...s,[key]:e.target.value})}
              style={{ background:'#11151F', border:'1px solid #1a2030', borderRadius:6, color:'#ccc', padding:'6px 10px', fontSize:13, outline:'none', width:140 }}>
              {opts.map(o=><option key={o} value={o}>{o.charAt(0).toUpperCase()+o.slice(1)}</option>)}
            </select>
          </div>
        ))}
        <div style={{ color:'#444', fontSize:11, textTransform:'uppercase', letterSpacing:'0.08em', margin:'14px 0 10px' }}>Margins (px)</div>
        {[['Top','marginTop'],['Bottom','marginBottom'],['Left','marginLeft'],['Right','marginRight']].map(([l,k])=>(
          <div key={k} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
            <span style={{ color:'#888', fontSize:13 }}>{l}</span>{ipt(k)}
          </div>
        ))}
        <div style={{ display:'flex', gap:10, marginTop:18 }}>
          <button onClick={onClose} style={{ flex:1, padding:'10px', borderRadius:8, border:'1px solid #1a1f2e', background:'transparent', color:'#555', cursor:'pointer' }}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ── AI Generate dialog ───────────────────────────────────────────────────────
function AIDialog({ onGenerate, onClose, generating }) {
  const [prompt, setPrompt] = useState('');
  const [docType, setDocType] = useState('report');
  const [lang, setLang] = useState('English');
  const [pages, setPages] = useState(2);
  return (
    <div style={{ position:'fixed', inset:0, background:'#000000cc', display:'flex', alignItems:'center', justifyContent:'center', zIndex:9999, fontFamily:'Inter,sans-serif' }}>
      <div style={{ background:'#0d1018', border:'1px solid #1a1f2e', borderRadius:16, width:500, padding:'28px 30px', boxShadow:'0 40px 120px #000c' }}>
        <div style={{ fontWeight:700, fontSize:16, color:'#fff', marginBottom:4 }}>🤖 AI Document Generator</div>
        <div style={{ color:'#444', fontSize:12, marginBottom:20 }}>Agents write, research, and format a complete document</div>

        <div style={{ marginBottom:12 }}>
          <label style={{ color:'#555', fontSize:11, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.06em', display:'block', marginBottom:6 }}>Topic / Instructions</label>
          <textarea value={prompt} onChange={e=>setPrompt(e.target.value)} rows={3} placeholder="e.g. Write a market analysis for AI startups in Southeast Asia..."
            style={{ width:'100%', background:'#11151F', border:'1px solid #1a2030', borderRadius:9, padding:'10px 14px', color:'#e8e9f0', fontSize:13, resize:'none', outline:'none', boxSizing:'border-box', fontFamily:'Inter,sans-serif' }} />
        </div>

        <div style={{ display:'flex', gap:12, marginBottom:12 }}>
          <div style={{ flex:1 }}>
            <label style={{ color:'#555', fontSize:11, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.06em', display:'block', marginBottom:6 }}>Document Type</label>
            <select value={docType} onChange={e=>setDocType(e.target.value)} style={{ width:'100%', background:'#11151F', border:'1px solid #1a2030', borderRadius:7, padding:'8px 12px', color:'#ccc', fontSize:13, outline:'none' }}>
              {[['report','📊 Report'],['proposal','💼 Proposal'],['essay','✍️ Essay'],['letter','📨 Letter'],['memo','📋 Memo'],['thesis','🎓 Research Paper'],['marketing','📣 Marketing'],['whitepaper','📄 Whitepaper'],['plan','🗺️ Action Plan'],['analysis','🔍 Analysis'],['sop','📐 SOP']].map(([v,l])=><option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div style={{ flex:1 }}>
            <label style={{ color:'#555', fontSize:11, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.06em', display:'block', marginBottom:6 }}>Language</label>
            <select value={lang} onChange={e=>setLang(e.target.value)} style={{ width:'100%', background:'#11151F', border:'1px solid #1a2030', borderRadius:7, padding:'8px 12px', color:'#ccc', fontSize:13, outline:'none' }}>
              {['English','Indonesian','Mandarin','Spanish','French','German','Japanese','Arabic'].map(l=><option key={l}>{l}</option>)}
            </select>
          </div>
        </div>

        <div style={{ marginBottom:20 }}>
          <label style={{ color:'#555', fontSize:11, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.06em', display:'block', marginBottom:8 }}>
            Length: ~{pages} page{pages>1?'s':''}
          </label>
          <input type="range" min={1} max={8} value={pages} onChange={e=>setPages(+e.target.value)} style={{ width:'100%', accentColor:'#7C9CFF' }} />
          <div style={{ display:'flex', justifyContent:'space-between', color:'#333', fontSize:10, marginTop:3 }}>
            <span>1 page</span><span>4 pages</span><span>8 pages</span>
          </div>
        </div>

        <div style={{ display:'flex', gap:10 }}>
          <button onClick={onClose} style={{ flex:1, padding:'11px', borderRadius:9, border:'1px solid #1a1f2e', background:'transparent', color:'#555', cursor:'pointer', fontSize:13 }}>Cancel</button>
          <button onClick={()=>onGenerate({prompt,docType,language:lang,pages})} disabled={!prompt.trim()||generating}
            style={{ flex:2, padding:'11px', borderRadius:9, border:'none', background:!prompt.trim()||generating?'#1a1f2e':'linear-gradient(135deg,#7C9CFF,#5EEAD4)', color:!prompt.trim()||generating?'#333':'#0A0D13', fontWeight:700, fontSize:13, cursor:!prompt.trim()||generating?'not-allowed':'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
            {generating?<><span style={{animation:'spin 1s linear infinite',display:'inline-block'}}>⟳</span> Generating...</>:'🤖 Generate'}
          </button>
        </div>
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

// ── MAIN EDITOR ──────────────────────────────────────────────────────────────
export default function DocumentEditor({ documentId, session, onClose, onSaved, autoOpenAI = false }) {
  const editorRef   = useRef(null);
  const autoSaveRef = useRef(null);

  const [loading,    setLoading]    = useState(true);
  const [saving,     setSaving]     = useState(false);
  const [lastSaved,  setLastSaved]  = useState(null);
  const [dirty,      setDirty]      = useState(false);
  const [title,      setTitle]      = useState('Untitled Document');
  const [pageSettings, setPage]     = useState(DEFAULT_PAGE);
  const [fontSettings, setFont]     = useState(DEFAULT_FONT);
  const [docState,   setDocState]   = useState({ font:'Inter', fontSize:12, textColor:'#1a1a1a', lineHeight:'1.6', highlight:'transparent' });
  const [wordCount,  setWC]         = useState(0);
  const [charCount,  setCC]         = useState(0);
  const [zoom,       setZoom]       = useState(100);
  const [versions,   setVersions]   = useState([]);

  // Panel states
  const [showAI,        setShowAI]        = useState(false);
  const [showPage,      setShowPage]      = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showFindReplace, setShowFR]      = useState(false);
  const [showVersions,  setShowVersions]  = useState(false);
  const [generating,    setGenerating]    = useState(false);

  // ── Load ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!documentId) {
      setLoading(false);
      // If AI write was requested, open AI dialog; else show template picker
      setTimeout(() => autoOpenAI ? setShowAI(true) : setShowTemplates(true), 300);
      return;
    }
    fetch(`/api/documents?id=${documentId}&versions=true`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    }).then(r => r.json()).then(data => {
      if (data.document) {
        const d = data.document;
        setTitle(d.title || 'Untitled');
        setPage({ ...DEFAULT_PAGE, ...(d.page_settings || {}) });
        setFont({ ...DEFAULT_FONT, ...(d.font_settings || {}) });
        setWC(d.word_count || 0); setCC(d.character_count || 0);
        setVersions(data.versions || []);
        if (editorRef.current) editorRef.current.innerHTML = d.content || '<p><br></p>';
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [documentId, session]);

  // ── Save ────────────────────────────────────────────────────────
  const save = useCallback(async (saveVersion = false) => {
    if (!session || !editorRef.current) return;
    setSaving(true);
    const content = editorRef.current?.innerHTML || '';
    const text    = editorRef.current?.innerText  || '';
    const wc = countWords(text);
    try {
      const method = documentId ? 'PUT' : 'POST';
      const url    = documentId ? `/api/documents?id=${documentId}` : '/api/documents';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type':'application/json', Authorization:`Bearer ${session.access_token}` },
        body: JSON.stringify({
          title, content, page_settings: pageSettings,
          font_settings: { ...fontSettings, lineHeight: docState.lineHeight },
          saveVersion, saved_by: saveVersion ? 'user' : 'autosave',
        }),
      });
      const data = await res.json();
      if (data.success) {
        setLastSaved(new Date()); setDirty(false);
        setWC(wc); setCC(text.length);
        if (!documentId && data.document?.id) onSaved?.(data.document);
      }
    } catch(err) { console.error('Save:', err); }
    finally { setSaving(false); }
  }, [session, documentId, title, pageSettings, fontSettings, docState]);

  // ── Autosave ────────────────────────────────────────────────────
  const handleInput = useCallback(() => {
    setDirty(true);
    const text = editorRef.current?.innerText || '';
    setWC(countWords(text)); setCC(text.length);
    clearTimeout(autoSaveRef.current);
    autoSaveRef.current = setTimeout(() => save(false), AUTOSAVE_MS);
  }, [save]);

  // Cancel any pending debounced autosave on unmount — otherwise closing the
  // editor within the AUTOSAVE_MS window still fires save() afterward, at
  // which point editorRef.current is null (React clears DOM refs on unmount),
  // so it would send an empty content string and overwrite the saved document.
  useEffect(() => {
    return () => clearTimeout(autoSaveRef.current);
  }, []);

  // ── Keyboard shortcuts ──────────────────────────────────────────
  useEffect(() => {
    const h = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(true); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') { e.preventDefault(); setShowFR(v => !v); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [save]);

  // ── AI Generate ─────────────────────────────────────────────────
  const generateWithAI = async ({ prompt, docType, language, pages }) => {
    setGenerating(true); setShowAI(false);
    try {
      const res = await fetch('/api/documents/generate', {
        method: 'POST',
        headers: { 'Content-Type':'application/json', Authorization:`Bearer ${session.access_token}` },
        body: JSON.stringify({ prompt, docType, language, pages, title }),
      });
      const data = await res.json();
      if (data.html && editorRef.current) {
        editorRef.current.innerHTML = data.html;
        if (data.title) setTitle(data.title);
        setDirty(true); handleInput();
      }
    } catch(err) { console.error('AI gen:', err); }
    finally { setGenerating(false); }
  };

  // ── Load template ───────────────────────────────────────────────
  const applyTemplate = (tmpl) => {
    if (editorRef.current) editorRef.current.innerHTML = tmpl.html;
    if (tmpl.id !== 'blank') setTitle(tmpl.label);
    setDirty(true); handleInput(); setShowTemplates(false);
  };

  // ── Export HTML ─────────────────────────────────────────────────
  const exportHTML = () => {
    const content = editorRef.current?.innerHTML || '';
    const sz = PAGE_SIZES[pageSettings.pageSize] || PAGE_SIZES.A4;
    const w  = pageSettings.orientation === 'landscape' ? sz.height : sz.width;
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${escapeHtml(title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}body{background:#f5f5f5;font-family:${fontSettings.defaultFont},Arial,sans-serif}
.page{width:${w}px;min-height:${pageSettings.orientation==='landscape'?sz.width:sz.height}px;margin:20px auto;background:#fff;
padding:${pageSettings.marginTop}px ${pageSettings.marginRight}px ${pageSettings.marginBottom}px ${pageSettings.marginLeft}px;
box-shadow:0 2px 16px rgba(0,0,0,.12);font-size:${fontSettings.defaultSize}pt;line-height:${fontSettings.lineHeight||1.6};color:${fontSettings.defaultColor}}
h1{font-size:22pt;margin:0 0 12px}h2{font-size:16pt;margin:14px 0 8px}h3{font-size:13pt;margin:10px 0 5px}
p{margin:0 0 8px}table{border-collapse:collapse;width:100%;margin:8px 0}td,th{padding:8px;border:1px solid #ccc}
ul,ol{padding-left:24px;margin:6px 0}li{margin:3px 0}
hr{border:none;border-top:1px solid #ddd;margin:16px 0}blockquote{border-left:3px solid #ccc;padding:6px 16px;color:#666;font-style:italic;margin:8px 0}
pre{background:#f5f5f5;padding:12px 16px;border-radius:4px;font-family:monospace;white-space:pre-wrap;margin:8px 0}
@media print{body{background:none}.page{margin:0;box-shadow:none}}
</style></head><body><div class="page">${content}</div></body></html>`;
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([html],{type:'text/html'})), download:`${title}.html` });
    a.click();
  };

  // ── Print PDF ───────────────────────────────────────────────────
  const printDoc = () => {
    const content = editorRef.current?.innerHTML || '';
    const sz = PAGE_SIZES[pageSettings.pageSize] || PAGE_SIZES.A4;
    const w  = pageSettings.orientation === 'landscape' ? sz.height : sz.width;
    const win = window.open('','_blank');
    win.document.write(`<!DOCTYPE html><html><head><title>${escapeHtml(title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:${fontSettings.defaultFont},Arial,sans-serif}
.page{width:${w}px;padding:${pageSettings.marginTop}px ${pageSettings.marginRight}px ${pageSettings.marginBottom}px ${pageSettings.marginLeft}px;
font-size:${fontSettings.defaultSize}pt;line-height:${fontSettings.lineHeight||1.6};color:${fontSettings.defaultColor}}
h1{font-size:22pt;margin:0 0 12px}h2{font-size:16pt;margin:14px 0 8px}h3{font-size:13pt;margin:10px 0 5px}
p{margin:0 0 8px}table{border-collapse:collapse;width:100%}td,th{padding:8px;border:1px solid #ccc}
ul,ol{padding-left:24px;margin:6px 0}blockquote{border-left:3px solid #ccc;padding:6px 16px;color:#666;font-style:italic}
@media print{@page{size:${pageSettings.pageSize} ${pageSettings.orientation};margin:0}body{margin:0}}
</style></head><body><div class="page">${content}</div></body></html>`);
    win.document.close();
    setTimeout(() => { win.print(); win.close(); }, 600);
  };

  // ── Restore version ─────────────────────────────────────────────
  const restoreVersion = (v) => {
    if (!window.confirm(`Restore v${v.version_number}? Current content will be replaced.`)) return;
    if (editorRef.current) editorRef.current.innerHTML = v.content;
    setDirty(true); setShowVersions(false); handleInput();
  };

  // ── Page dimensions ─────────────────────────────────────────────
  const sz   = PAGE_SIZES[pageSettings.pageSize] || PAGE_SIZES.A4;
  const pageW = pageSettings.orientation === 'landscape' ? sz.height : sz.width;
  const pageH = pageSettings.orientation === 'landscape' ? sz.width  : sz.height;
  const scale = zoom / 100;

  if (loading) return (
    <div style={{ height:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#0A0D13', color:'#555', fontFamily:'Inter,sans-serif' }}>Loading...</div>
  );

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100vh', background:'#0A0D13', fontFamily:'Inter,sans-serif' }}>

      {/* ─ Top bar ─────────────────────────────────────────────── */}
      <div style={{ background:'#0d1018', borderBottom:'1px solid #1a1f2e', padding:'9px 16px', display:'flex', alignItems:'center', gap:10, flexShrink:0, flexWrap:'wrap' }}>
        <button onClick={onClose} style={{ background:'none', border:'none', color:'#555', cursor:'pointer', fontSize:18, padding:'2px 6px' }}>←</button>

        <input value={title} onChange={e=>{setTitle(e.target.value);setDirty(true);}}
          style={{ flex:1, background:'transparent', border:'none', color:'#e8e9f0', fontSize:15, fontWeight:600, outline:'none', minWidth:0, maxWidth:400 }} placeholder="Document title" />

        <span style={{ color:saving?'#7C9CFF':dirty?'#ffa94d':'#2a2a2a', fontSize:11, flexShrink:0 }}>
          {saving?'⟳ Saving...':dirty?'● Unsaved':lastSaved?`✓ Saved ${lastSaved.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}`:''}
        </span>

        <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
          <button onClick={()=>setShowTemplates(true)} style={{ padding:'5px 10px', borderRadius:6, border:'1px solid #1a1f2e', background:'transparent', color:'#555', cursor:'pointer', fontSize:11 }}>📋 Templates</button>
          <button onClick={()=>setShowFR(v=>!v)} title="Ctrl+F" style={{ padding:'5px 10px', borderRadius:6, border:`1px solid ${showFindReplace?'#7C9CFF44':'#1a1f2e'}`, background:showFindReplace?'#7C9CFF14':'transparent', color:showFindReplace?'#7C9CFF':'#555', cursor:'pointer', fontSize:11 }}>🔍</button>
          <button onClick={()=>setShowVersions(v=>!v)} style={{ padding:'5px 10px', borderRadius:6, border:'1px solid #1a1f2e', background:'transparent', color:'#555', cursor:'pointer', fontSize:11 }}>🕒</button>
          <button onClick={()=>setShowPage(true)} style={{ padding:'5px 10px', borderRadius:6, border:'1px solid #1a1f2e', background:'transparent', color:'#555', cursor:'pointer', fontSize:11 }}>📐</button>
          <button onClick={()=>setShowAI(true)} style={{ padding:'5px 10px', borderRadius:7, border:'1px solid #7C9CFF44', background:'#7C9CFF14', color:'#7C9CFF', cursor:'pointer', fontSize:11, fontWeight:600 }}>🤖 AI Write</button>
          <button onClick={exportHTML} style={{ padding:'5px 10px', borderRadius:6, border:'1px solid #1a1f2e', background:'transparent', color:'#555', cursor:'pointer', fontSize:11 }}>⬇ HTML</button>
          <button onClick={printDoc} style={{ padding:'5px 10px', borderRadius:6, border:'1px solid #1a1f2e', background:'transparent', color:'#555', cursor:'pointer', fontSize:11 }}>🖨 PDF</button>
          <button onClick={()=>save(true)} style={{ padding:'5px 14px', borderRadius:7, border:'none', background:'linear-gradient(135deg,#7C9CFF,#5EEAD4)', color:'#0A0D13', fontWeight:700, cursor:'pointer', fontSize:11 }}>Save</button>
        </div>
      </div>

      {/* ─ Toolbar ─────────────────────────────────────────────── */}
      <DocumentToolbar editorRef={editorRef} onFormatChange={handleInput} docState={docState} onDocStateChange={setDocState} />

      {/* ─ Editor + Version panel ───────────────────────────────── */}
      <div style={{ flex:1, display:'flex', overflow:'hidden' }}>
        <div style={{ flex:1, overflow:'auto', background:'#1a1a1a', padding:'24px 0 60px' }}>

          {/* Zoom bar */}
          <div style={{ display:'flex', justifyContent:'center', marginBottom:10, gap:6, alignItems:'center' }}>
            <button onClick={()=>setZoom(v=>Math.max(50,v-10))} style={{ background:'#0d1018', border:'1px solid #2a2a2a', color:'#555', borderRadius:4, width:24, height:24, cursor:'pointer', fontSize:14 }}>−</button>
            <span style={{ color:'#444', fontSize:11, width:40, textAlign:'center' }}>{zoom}%</span>
            <button onClick={()=>setZoom(v=>Math.min(200,v+10))} style={{ background:'#0d1018', border:'1px solid #2a2a2a', color:'#555', borderRadius:4, width:24, height:24, cursor:'pointer', fontSize:14 }}>+</button>
            <button onClick={()=>setZoom(100)} style={{ background:'transparent', border:'none', color:'#333', cursor:'pointer', fontSize:10, marginLeft:4 }}>Reset</button>
          </div>

          {/* Page */}
          <div style={{ display:'flex', justifyContent:'center' }}>
            <div style={{
              width: pageW * scale, minHeight: pageH * scale,
              background:'#fff', boxShadow:'0 4px 32px #000000bb, 0 0 0 1px #00000033',
              transform:`scale(${scale})`, transformOrigin:'top center',
              marginBottom:(pageH * scale - pageH) * -1,
              position:'relative',
            }}>
              {/* AI overlay */}
              {generating && (
                <div style={{ position:'absolute', inset:0, background:'#ffffffcc', backdropFilter:'blur(4px)', display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:10, zIndex:10 }}>
                  <div style={{ fontSize:36, animation:'spin 2s linear infinite' }}>🤖</div>
                  <div style={{ color:'#333', fontWeight:600, fontSize:14 }}>AI agents writing your document...</div>
                  <div style={{ color:'#888', fontSize:12 }}>~15–30 seconds</div>
                </div>
              )}

              {/* Editable content */}
              <div
                ref={editorRef}
                contentEditable suppressContentEditableWarning spellCheck
                onInput={handleInput}
                style={{
                  width:'100%', minHeight:pageH,
                  padding:`${pageSettings.marginTop}px ${pageSettings.marginRight}px ${pageSettings.marginBottom}px ${pageSettings.marginLeft}px`,
                  fontFamily: fontSettings.defaultFont + ', Arial, sans-serif',
                  fontSize:   fontSettings.defaultSize + 'pt',
                  lineHeight: docState.lineHeight || fontSettings.lineHeight || '1.6',
                  color:      fontSettings.defaultColor,
                  outline:'none', boxSizing:'border-box',
                  wordBreak:'break-word', overflowWrap:'break-word',
                }}
              />
            </div>
          </div>
        </div>

        {/* Version history panel */}
        {showVersions && (
          <div style={{ width:220, background:'#0a0d13', borderLeft:'1px solid #1a1f2e', padding:'14px 12px', overflowY:'auto', flexShrink:0 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
              <span style={{ color:'#666', fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em' }}>Versions</span>
              <button onClick={()=>setShowVersions(false)} style={{ background:'none', border:'none', color:'#333', cursor:'pointer', fontSize:16 }}>✕</button>
            </div>
            {versions.length === 0 && <div style={{ color:'#333', fontSize:12 }}>No saved versions yet.<br/><br/>Press Ctrl+S to create one.</div>}
            {versions.map(v => (
              <div key={v.id} onClick={()=>restoreVersion(v)}
                style={{ padding:'9px 10px', borderRadius:8, border:'1px solid #1a1f2e', marginBottom:6, cursor:'pointer', transition:'all 0.1s' }}
                onMouseEnter={e=>e.currentTarget.style.borderColor='#7C9CFF44'}
                onMouseLeave={e=>e.currentTarget.style.borderColor='#1a1f2e'}>
                <div style={{ color:'#aaa', fontSize:12, fontWeight:600 }}>v{v.version_number}</div>
                <div style={{ color:'#444', fontSize:10, marginTop:2 }}>{new Date(v.created_at).toLocaleString()}</div>
                <div style={{ color:'#333', fontSize:10 }}>{(v.word_count||0).toLocaleString()} words • {v.saved_by}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ─ Status bar ──────────────────────────────────────────── */}
      <div style={{ background:'#0d1018', borderTop:'1px solid #1a1f2e', padding:'4px 20px', display:'flex', gap:20, flexShrink:0 }}>
        <span style={{ color:'#333', fontSize:11 }}>{wordCount.toLocaleString()} words</span>
        <span style={{ color:'#2a2a2a', fontSize:11 }}>{charCount.toLocaleString()} chars</span>
        <span style={{ color:'#2a2a2a', fontSize:11 }}>{pageSettings.pageSize} · {pageSettings.orientation}</span>
        <span style={{ marginLeft:'auto', color:'#1a1a1a', fontSize:10 }}>Ctrl+S = save version &nbsp;|&nbsp; Ctrl+F = find</span>
      </div>

      {/* ─ Dialogs ─────────────────────────────────────────────── */}
      {showAI        && <AIDialog onGenerate={generateWithAI} onClose={()=>setShowAI(false)} generating={generating} />}
      {showPage      && <PageSettingsModal s={pageSettings} onChange={setPage} onClose={()=>setShowPage(false)} />}
      {showTemplates && <DocumentTemplates onSelect={applyTemplate} onClose={()=>setShowTemplates(false)} />}
      {showFindReplace && <FindReplace editorRef={editorRef} onClose={()=>setShowFR(false)} />}

      {/* ─ AI Inline Toolbar (mounts globally; manages its own visibility) ── */}
      <AIInlineToolbar editorRef={editorRef} session={session} />

      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        [contenteditable]:focus{outline:none}
        [contenteditable] h1{font-size:22pt;font-weight:700;margin:0 0 10px}
        [contenteditable] h2{font-size:16pt;font-weight:600;margin:13px 0 7px}
        [contenteditable] h3{font-size:13pt;font-weight:600;margin:10px 0 5px}
        [contenteditable] h4{font-size:11pt;font-weight:600;margin:8px 0 4px}
        [contenteditable] p{margin:0 0 8px}
        [contenteditable] blockquote{border-left:3px solid #ccc;padding:6px 16px;color:#666;font-style:italic;margin:8px 0}
        [contenteditable] pre{background:#f5f5f5;border-radius:4px;padding:12px 16px;font-family:'JetBrains Mono',monospace;font-size:10pt;white-space:pre-wrap;margin:8px 0}
        [contenteditable] ul,[contenteditable] ol{padding-left:24px;margin:6px 0}
        [contenteditable] li{margin:3px 0}
        [contenteditable] table{border-collapse:collapse;width:100%;margin:8px 0}
        [contenteditable] td,[contenteditable] th{border:1px solid #ddd;padding:7px;min-width:60px;vertical-align:top}
        [contenteditable] th{background:#f5f5f5;font-weight:600}
        [contenteditable] hr{border:none;border-top:1px solid #ddd;margin:16px 0}
        [contenteditable] a{color:#0066cc}
      `}</style>
    </div>
  );
}
