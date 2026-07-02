/**
 * AGENT MEMORY — Zenith AI v2
 * Persistent cross-session memory for the orchestration system.
 *
 * Memories are stored in Supabase `agent_memories` and injected into
 * agent context at the start of each orchestration run, giving agents
 * awareness of user preferences, past insights, and prior task results.
 *
 * Memory types:
 *   fact         — explicit user facts  (portfolio, goals, assets held)
 *   preference   — style / risk / format preferences
 *   task_summary — completed orchestration run summaries
 *   insight      — market / analysis observations from past runs
 *   pattern      — recurring user behaviour patterns
 *
 * Retrieval: keyword overlap + recency + importance scoring (no embeddings needed)
 */

const MEMORY_TYPES = ['fact', 'preference', 'task_summary', 'insight', 'pattern'];

// Weights for composite recall score
const W_KEYWORD    = 0.50;
const W_TAG        = 0.25;
const W_RECENCY    = 0.15;
const W_IMPORTANCE = 0.10;

// Max age (days) for full recency score
const MAX_RECENCY_DAYS = 30;

// Hard cap on stored memories per user. Without this, extractFromRun() runs
// automatically after every orchestration task (not a manual user action),
// so an active user could accumulate rows indefinitely with no pruning.
const MAX_MEMORIES_PER_USER = 500;

// ─────────────────────────────────────────────────────────────────────────────

export class AgentMemory {
  constructor(supabase, userId) {
    if (!supabase || !userId) throw new Error('[AgentMemory] supabase + userId required');
    this.supabase = supabase;
    this.userId   = userId;
  }

  // ── WRITE ──────────────────────────────────────────────────────────────────

  /**
   * Store a new memory.
   * @param {string} content
   * @param {{ type, tags, metadata, importance, agentId, expiresInDays }} opts
   * @returns {Promise<object>} the inserted memory row
   */
  async remember(content, {
    type       = 'fact',
    tags       = [],
    metadata   = {},
    importance = 5,
    agentId    = null,
    expiresInDays = null,
  } = {}) {
    if (!content?.trim()) throw new Error('[AgentMemory] content is required');
    if (!MEMORY_TYPES.includes(type)) throw new Error(`[AgentMemory] unknown type: ${type}`);

    const expires_at = expiresInDays
      ? new Date(Date.now() + expiresInDays * 86_400_000).toISOString()
      : null;

    const { data, error } = await this.supabase
      .from('agent_memories')
      .insert({
        user_id:    this.userId,
        agent_id:   agentId,
        type,
        content:    content.trim(),
        tags:       tags.map(t => t.toLowerCase().trim()),
        metadata,
        importance: Math.max(1, Math.min(10, Math.round(importance))),
        expires_at,
      })
      .select()
      .single();

    if (error) throw new Error(`[AgentMemory] insert failed: ${error.message}`);

    await this._enforceCap();
    return data;
  }

  /**
   * Keep total stored memories for this user within MAX_MEMORIES_PER_USER by
   * evicting the least valuable rows (lowest importance, then least/oldest
   * accessed) once over the cap. New memories are never rejected outright —
   * we just make room, so this stays silent from the caller's perspective.
   */
  async _enforceCap() {
    const { count } = await this.supabase
      .from('agent_memories')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', this.userId);

    if (!count || count <= MAX_MEMORIES_PER_USER) return;

    const overflow = count - MAX_MEMORIES_PER_USER;
    const { data: toEvict } = await this.supabase
      .from('agent_memories')
      .select('id')
      .eq('user_id', this.userId)
      .order('importance', { ascending: true })
      .order('access_count', { ascending: true })
      .order('last_accessed', { ascending: true, nullsFirst: true })
      .limit(overflow);

    if (toEvict?.length) {
      await this.supabase
        .from('agent_memories')
        .delete()
        .in('id', toEvict.map(m => m.id))
        .eq('user_id', this.userId);
    }
  }

  /**
   * Bulk-store multiple memories (e.g. after a run extraction).
   */
  async rememberMany(items) {
    const results = [];
    for (const item of items) {
      try { results.push(await this.remember(item.content, item)); }
      catch (e) { console.warn('[AgentMemory] skip:', e.message); }
    }
    return results;
  }

  // ── READ ───────────────────────────────────────────────────────────────────

  /**
   * Recall memories relevant to a query using keyword + recency + importance scoring.
   * @param {string} query   — the orchestration task description
   * @param {{ limit, types, minImportance }} opts
   * @returns {Promise<Array>} scored and ranked memories
   */
  async recall(query = '', {
    limit         = 10,
    types         = null,
    minImportance = 2,
  } = {}) {
    // Fetch candidate pool (up to 200, respecting type + importance filters)
    let q = this.supabase
      .from('agent_memories')
      .select('*')
      .eq('user_id', this.userId)
      .gte('importance', minImportance)
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
      .order('importance', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(200);

    if (types?.length) q = q.in('type', types);

    const { data, error } = await q;
    if (error || !data?.length) return [];

    // If no query, just return top by importance + recency
    if (!query.trim()) {
      return data.slice(0, limit);
    }

    // Tokenise query (words ≥ 3 chars)
    const qWords = query
      .toLowerCase()
      .split(/\W+/)
      .filter(w => w.length >= 3);

    if (!qWords.length) return data.slice(0, limit);

    // Score each memory
    const scored = data.map(m => {
      const text = m.content.toLowerCase();
      const tagStr = (m.tags ?? []).join(' ').toLowerCase();

      // Keyword match (against content)
      const kwHits = qWords.filter(w => text.includes(w)).length;
      const kwScore = kwHits / qWords.length;

      // Tag match
      const tagHits = qWords.filter(w => tagStr.includes(w)).length;
      const tagScore = tagHits / qWords.length;

      // Recency score (1.0 = today, ~0 = 30+ days ago)
      const ageDays = (Date.now() - new Date(m.created_at).getTime()) / 86_400_000;
      const recencyScore = Math.max(0, 1 - ageDays / MAX_RECENCY_DAYS);

      // Importance score (normalised 0-1)
      const impScore = m.importance / 10;

      const total =
        kwScore  * W_KEYWORD +
        tagScore * W_TAG +
        recencyScore * W_RECENCY +
        impScore * W_IMPORTANCE;

      return { ...m, _score: total };
    });

    const relevant = scored
      .sort((a, b) => b._score - a._score)
      .slice(0, limit);

    // Fire-and-forget: update access stats
    const ids = relevant.map(m => m.id);
    this._touchAccess(ids).catch(() => {});

    return relevant;
  }

  /**
   * List all memories for the UI panel (with optional type filter + search).
   */
  async list({ type = null, search = '', limit = 50, offset = 0 } = {}) {
    let q = this.supabase
      .from('agent_memories')
      .select('*', { count: 'exact' })
      .eq('user_id', this.userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (type) q = q.eq('type', type);
    if (search.trim()) {
      // Supabase full-text-like: check content contains search term
      q = q.ilike('content', `%${search.trim()}%`);
    }

    const { data, count, error } = await q;
    if (error) throw new Error(error.message);
    return { memories: data ?? [], total: count ?? 0 };
  }

  // ── DELETE ─────────────────────────────────────────────────────────────────

  async forget(memoryId) {
    const { error } = await this.supabase
      .from('agent_memories')
      .delete()
      .eq('id', memoryId)
      .eq('user_id', this.userId);
    if (error) throw new Error(error.message);
  }

  async forgetByType(type) {
    const { error } = await this.supabase
      .from('agent_memories')
      .delete()
      .eq('user_id', this.userId)
      .eq('type', type);
    if (error) throw new Error(error.message);
  }

  // ── STATS ──────────────────────────────────────────────────────────────────

  async stats() {
    const { data, error } = await this.supabase
      .from('agent_memories')
      .select('type, importance')
      .eq('user_id', this.userId);

    if (error || !data) return {};

    const totals = { all: data.length };
    for (const m of data) {
      totals[m.type] = (totals[m.type] || 0) + 1;
    }
    const avgImportance = data.length
      ? (data.reduce((s, m) => s + m.importance, 0) / data.length).toFixed(1)
      : 0;

    return { totals, avgImportance };
  }

  // ── CONTEXT FORMATTING ─────────────────────────────────────────────────────

  /**
   * Format recalled memories for injection into an agent's system prompt.
   * Compact format designed to use minimal tokens.
   */
  formatForContext(memories, { maxChars = 2500 } = {}) {
    if (!memories?.length) return '';

    const TYPE_ICON = {
      fact:         '📌',
      preference:   '🎯',
      task_summary: '📋',
      insight:      '💡',
      pattern:      '🔁',
    };

    const lines = memories.map((m, i) => {
      const icon = TYPE_ICON[m.type] ?? '•';
      const age  = this._ageLabel(m.created_at);
      const tags = m.tags?.length ? ` [${m.tags.slice(0, 3).join(', ')}]` : '';
      return `${i + 1}. ${icon} [${m.type.toUpperCase()}${tags}] (imp ${m.importance}/10, ${age})\n   ${m.content}`;
    });

    let result = lines.join('\n\n');
    if (result.length > maxChars) result = result.slice(0, maxChars) + '\n…(truncated)';
    return result;
  }

  // ── EXTRACTION ─────────────────────────────────────────────────────────────

  /**
   * After a completed orchestration run, use Claude to extract + store key memories.
   * @param {string} userInput       — the original task
   * @param {string} finalOutput     — the compiled final output
   * @param {Anthropic} anthropic    — Anthropic SDK instance
   * @param {string} [taskId]        — optional task ID for metadata
   */
  async extractFromRun(userInput, finalOutput, anthropic, taskId = null) {
    if (!finalOutput?.trim()) return [];

    const systemPrompt = `You are a memory extraction specialist for an AI orchestration system.
Analyze a completed AI agent run and extract key information worth remembering for FUTURE sessions.

Memory types:
- fact: explicit user facts (portfolio composition, assets, goals, constraints)
- preference: user style, risk tolerance, output format preferences
- task_summary: brief summary of what was accomplished
- insight: market observations, analysis conclusions worth remembering
- pattern: recurring user behaviour or request patterns

Rules:
1. Extract 2–5 memories MAX — quality over quantity
2. Each memory must be self-contained and useful without context
3. Prefer SPECIFIC facts over vague ones
4. Assign importance 1–10 (10 = critical long-term info, 5 = useful, 1 = trivial)
5. Add relevant tags (e.g. ["bitcoin","trading","risk"] or ["writing","style"])
6. task_summary should be 1–2 sentences, max importance 6
7. ONLY return JSON — no markdown, no explanation

Return format (JSON array):
[
  { "type": "fact", "content": "...", "tags": ["tag1"], "importance": 8 },
  { "type": "task_summary", "content": "...", "tags": ["task"], "importance": 5 }
]`;

    const userPrompt = `User request:
"${userInput.slice(0, 500)}"

Agent output (truncated to 1500 chars):
"${finalOutput.slice(0, 1500)}"

Extract memories.`;

    try {
      const resp = await anthropic.messages.create({
        model:      'claude-sonnet-4-6',
        max_tokens: 600,
        system:     systemPrompt,
        messages:   [{ role: 'user', content: userPrompt }],
      });

      const text  = resp.content.find(b => b.type === 'text')?.text ?? '';
      const match = text.match(/\[[\s\S]*\]/);
      if (!match) return [];

      const extracted = JSON.parse(match[0]);
      if (!Array.isArray(extracted)) return [];

      // Store each extracted memory
      const stored = await this.rememberMany(
        extracted.map(e => ({
          content:    e.content,
          type:       MEMORY_TYPES.includes(e.type) ? e.type : 'fact',
          tags:       Array.isArray(e.tags) ? e.tags : [],
          importance: typeof e.importance === 'number' ? e.importance : 5,
          metadata:   taskId ? { source_task_id: taskId } : {},
        }))
      );

      console.log(`[AgentMemory] Extracted + stored ${stored.length} memories from run`);
      return stored;
    } catch (e) {
      console.warn('[AgentMemory] Extract failed:', e.message);
      return [];
    }
  }

  // ── PRIVATE HELPERS ────────────────────────────────────────────────────────

  async _touchAccess(ids) {
    if (!ids?.length) return;

    // NOTE: supabase-js .update() takes plain values, not query-builder objects —
    // `this.supabase.rpc(...)` used to be passed directly as the access_count
    // value here, which doesn't do an increment and silently fails (the error
    // was swallowed by the caller's .catch()). Fetch current counts, then
    // update each row with count + 1.
    const { data: rows } = await this.supabase
      .from('agent_memories')
      .select('id, access_count')
      .in('id', ids)
      .eq('user_id', this.userId);

    if (!rows?.length) return;

    const now = new Date().toISOString();
    await Promise.all(rows.map(r =>
      this.supabase
        .from('agent_memories')
        .update({ access_count: (r.access_count ?? 0) + 1, last_accessed: now })
        .eq('id', r.id)
        .eq('user_id', this.userId)
    ));
  }

  _ageLabel(createdAt) {
    const days = (Date.now() - new Date(createdAt).getTime()) / 86_400_000;
    if (days < 1)  return 'today';
    if (days < 7)  return `${Math.floor(days)}d ago`;
    if (days < 30) return `${Math.floor(days / 7)}w ago`;
    return `${Math.floor(days / 30)}mo ago`;
  }
}

/**
 * Factory helper: create an AgentMemory instance from a Supabase access token.
 * Used by API routes and the orchestrator.
 */
export async function createAgentMemory(supabase, userId) {
  return new AgentMemory(supabase, userId);
}
