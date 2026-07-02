/**
 * ORCHESTRATOR V3 — Retry Logic + Fallback Agents + Real Tool Calls
 * 
 * Improvements over V2:
 * 1. Agent execution now calls REAL tools before Claude
 * 2. Fallback agents: if primary fails, secondary takes over
 * 3. Exponential retry with configurable max attempts
 * 4. Pre-execution tool calls inject real data into agent context
 * 5. Post-execution validation by Tier 5 agents
 */

import { Anthropic } from '@anthropic-ai/sdk';
import { getAgentByName, getAllAgents } from '../agents/AgentRegistry.js';
import { executeTool } from '../tools/ToolExecutor.js';
import { AgentMemory }  from '../memory/AgentMemory.js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Max retries per agent execution
const MAX_AGENT_RETRIES = 2;
const MAX_CONCURRENT_AGENTS = 30;

// Claude Sonnet 4.6 standard pricing (USD per million tokens) — update here if
// pricing changes; used by every cost-tracking calculation in this file.
const PRICE_PER_M_INPUT  = 3;
const PRICE_PER_M_OUTPUT = 15;

// ── Fallback map: if primary agent fails, use this one ─────────────────────
const FALLBACK_AGENTS = {
  alex: 'blake', blake: 'alex', casey: 'parker',
  drake: 'sam', emma: 'gray', fiona: 'river',
  iris: 'jack', kara: 'noah', liam: 'oracle',
  orion: 'ace', phoenix: 'quill', titan: 'cipher',
  iris_market: 'nexus_market', jax: 'peak', knight: 'orbit',
  zenith_validator: 'luminary', fusion: 'kai', aurora: 'olive',
};

// ── Tool pre-fetches: which tools to call BEFORE running agent ─────────────
const AGENT_PREFETCH_TOOLS = {
  alex:    [{ tool: 'web_search',       argKey: 'description' }],
  blake:   [{ tool: 'web_search',       argKey: 'description' }],
  drake:   [{ tool: 'news_search',      argKey: 'description' }],
  fiona:   [{ tool: 'news_search',      argKey: 'description' }],
  iris_market: [
    { tool: 'get_coin_price', argExtractor: desc => ({ symbol: extractSymbol(desc) }) },
    { tool: 'get_ohlcv',      argExtractor: desc => ({ symbol: extractSymbol(desc), days: 14 }) },
  ],
  jax: [
    { tool: 'get_ohlcv',         argExtractor: desc => ({ symbol: extractSymbol(desc), days: 30 }) },
    { tool: 'get_market_chart',  argExtractor: desc => ({ symbol: extractSymbol(desc), days: 30 }) },
  ],
  knight: [
    { tool: 'get_ohlcv',     argExtractor: desc => ({ symbol: extractSymbol(desc), days: 7 }) },
    { tool: 'get_fear_greed', argExtractor: () => ({}) },
  ],
  nexus_market: [
    { tool: 'get_top_coins', argExtractor: () => ({ limit: 10 }) },
  ],
  ranger: [
    { tool: 'get_coin_price', argExtractor: desc => ({ symbol: extractSymbol(desc) }) },
  ],
};

function extractSymbol(text) {
  const match = text.match(/\b(BTC|ETH|SOL|BNB|XRP|ADA|AVAX|DOT|MATIC|LINK|DOGE|SHIB|ARB|OP|SUI|INJ|TIA|SEI|PEPE|NEAR)\b/i);
  return match ? match[1].toUpperCase() : 'BTC';
}

// ── DB Event Writers ────────────────────────────────────────────────────────
async function logEvent(supabase, taskId, agentName, eventType, desc, metadata = {}) {
  try {
    await supabase.from('execution_log').insert({
      orchestration_task_id: taskId,
      agent_name: agentName,
      event_type: eventType,
      event_description: desc,
      metadata,
    });
  } catch (e) {
    console.warn(`[Log] ${eventType}:`, e.message);
  }
}

async function writeAgentResult(supabase, taskId, agent, subtaskId, result) {
  try {
    await supabase.from('agent_results').insert({
      orchestration_task_id: taskId,
      subtask_id: subtaskId,
      agent_name: agent.name,
      agent_role: agent.role,
      result_text: result.output || '',
      status: result.success ? 'completed' : 'failed',
      error_message: result.error || null,
      tokens_used: result.tokens || 0,
      cost_usd: result.cost || 0,
      started_at: result.startedAt,
      completed_at: new Date().toISOString(),
    });
  } catch (e) {
    console.warn('[AgentResult]', e.message);
  }
}

async function updateSubtaskStatus(supabase, taskId, subtaskId, status) {
  try {
    await supabase.from('task_subtasks')
      .update({ status, completed_at: status === 'completed' ? new Date().toISOString() : null })
      .eq('orchestration_task_id', taskId)
      .eq('subtask_id', subtaskId);
  } catch (e) { /* non-fatal */ }
}

async function writeSubtasks(supabase, taskId, subtasks) {
  try {
    await supabase.from('task_subtasks').insert(subtasks.map(s => ({
      orchestration_task_id: taskId,
      subtask_id: s.id,
      description: s.description,
      assigned_agents: s.assigned_agents,
      dependencies: s.dependencies || [],
      priority: s.priority || 'medium',
      status: 'pending',
    })));
  } catch (e) { console.warn('[Subtasks]', e.message); }
}

// ── Node 1: Supervisor ────────────────────────────────────────────────────
export async function supervisorNode(state, supabase) {
  const { userInput, taskId } = state;
  await logEvent(supabase, taskId, 'Supervisor', 'task_started', 'Analyzing request...');

  // Inject cross-session memories into supervisor planning context
  const memSuffix = state.agentMemoryContext
    ? `\n\nUSER MEMORY FROM PAST SESSIONS (use to personalise the plan):\n${state.agentMemoryContext}`
    : '';

  const systemPrompt = `You are a master task planner for an AI orchestration system with 100 specialized agents.
Break down the user's request into 5–12 focused sub-tasks.

Available agents by tier:
- Tier 1 Research: alex, blake, casey, drake, emma, fiona, gray, harper, iris, jack, kara, liam, mira, noah, olive, parker, quinn, river, sam, taylor
- Tier 2 Writing:  uma, victor, willow, xander, yara, zane, aria, beau, celeste, dakota, elix, finn, gina, haven, indigo, jasper, kai, luna, maverick, nyx
- Tier 3 Code:     orion, phoenix, quill, raven, sage, titan, uther, vortex, whisper, xenon, yuki, zephyr, ace, bolt, cipher, delta, echo, flux, ghost, horizon
- Tier 4 Market:   iris_market, jax, knight, lynx, magnus, nexus_market, orbit, peak, quantum, ranger, sentinel, signal, storm, tesla, umbra, venom, volt, wave, xenith, yon
- Tier 5 Validate: zenith_validator, aurora, beacon, compass, depth, echo_validation, fusion, genesis, harmony, insight, juncture, keystone, luminary, mirror, nexus_validation, oracle, prism, quest, resonance, sovereign

Rules:
1. ALWAYS end with fusion (Tier 5) to compile results
2. ALWAYS end with sovereign (Tier 5) for final approval
3. Dependencies must form a valid DAG (no cycles)
4. Assign 1 agent per sub-task (most focused)
5. Use lowercase agent names
6. Market tasks: use iris_market/jax/knight/nexus_market (NOT iris which is legal)

Return ONLY valid JSON, no markdown:
{"subtasks":[{"id":"snake_case","description":"...","assigned_agents":["name"],"dependencies":[],"priority":"high"}]}${memSuffix}`;

  try {
    const resp = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      system: systemPrompt,
      messages: [{ role: 'user', content: `Plan this task:\n\n${userInput}` }],
    });

    const text = resp.content.find(b => b.type === 'text')?.text || '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON in supervisor response');

    const plan = JSON.parse(match[0]);
    if (!plan.subtasks?.length) throw new Error('Empty subtask plan');

    // Ensure fusion + sovereign are at the end
    const hasCompiler = plan.subtasks.some(s => ['fusion', 'kai'].includes(s.assigned_agents[0]));
    if (!hasCompiler) {
      const allIds = plan.subtasks.map(s => s.id);
      plan.subtasks.push({
        id: 'compile_results',
        description: 'Compile and synthesize all agent outputs into final document',
        assigned_agents: ['fusion'],
        dependencies: allIds,
        priority: 'critical',
      });
      plan.subtasks.push({
        id: 'final_approval',
        description: 'Final quality check and approval of compiled output',
        assigned_agents: ['sovereign'],
        dependencies: ['compile_results'],
        priority: 'critical',
      });
    }

    await writeSubtasks(supabase, taskId, plan.subtasks);
    await logEvent(supabase, taskId, 'Supervisor', 'task_breakdown_complete',
      `${plan.subtasks.length} subtasks planned`, { count: plan.subtasks.length });

    state.taskBreakdown = plan;
    state.costTracking.total_tokens += resp.usage.input_tokens + resp.usage.output_tokens;
    state.costTracking.total_cost_usd +=
      (resp.usage.input_tokens / 1_000_000) * PRICE_PER_M_INPUT + (resp.usage.output_tokens / 1_000_000) * PRICE_PER_M_OUTPUT;
    return state;
  } catch (err) {
    await logEvent(supabase, taskId, 'Supervisor', 'supervisor_failed', err.message);
    state.errors.push(`Supervisor: ${err.message}`);
    state.taskBreakdown = { subtasks: [] };
    return state;
  }
}

// ── Node 2: Dispatcher with Retry + Fallback ──────────────────────────────
export async function agentDispatcherNode(state, supabase) {
  const { taskId } = state;
  const subtasks = state.taskBreakdown.subtasks || [];
  await logEvent(supabase, taskId, 'Dispatcher', 'dispatch_started', `Starting ${subtasks.length} subtasks`);

  const depGraph = buildDependencyGraph(subtasks);
  const agentResults = {};

  // buildDependencyGraph can leave subtasks out entirely if their declared
  // dependencies never resolve (e.g. a broken/hallucinated id in the
  // supervisor's JSON plan). Without this check those subtasks silently
  // vanish — no execution attempt, no failed status, no error — just
  // missing from the final output with no indication why.
  const scheduledIds = new Set(depGraph.flat().map(t => t.id));
  const unscheduled = subtasks.filter(t => !scheduledIds.has(t.id));
  for (const st of unscheduled) {
    state.errors.push(`${st.id}: skipped — unresolvable dependency chain`);
    await updateSubtaskStatus(supabase, taskId, st.id, 'failed');
    await logEvent(supabase, taskId, 'Dispatcher', 'subtask_failed',
      `"${st.id}" skipped: dependencies never resolved`, { subtask_id: st.id });
  }

  for (const [batchIdx, batch] of depGraph.entries()) {
    // Limit concurrent agents
    const chunks = chunkArray(batch, MAX_CONCURRENT_AGENTS);

    for (const chunk of chunks) {
      await Promise.all(chunk.map(st => updateSubtaskStatus(supabase, taskId, st.id, 'running')));

      const results = await Promise.allSettled(
        chunk.map(subtask => executeSubtaskWithRetry(
          subtask, state.sharedMemory, agentResults,
          supabase, taskId, state.costTracking, state.agentMemoryContext
        ))
      );

      for (const [i, result] of results.entries()) {
        const subtask = chunk[i];
        if (result.status === 'fulfilled' && result.value?.success) {
          agentResults[subtask.id] = result.value;
          await updateSubtaskStatus(supabase, taskId, subtask.id, 'completed');
          await logEvent(supabase, taskId, result.value.agentName, 'subtask_completed',
            `"${subtask.id}" done`, { subtask_id: subtask.id, used_fallback: result.value.usedFallback });
        } else {
          const errMsg = result.reason?.message || result.value?.error || 'Unknown error';
          state.errors.push(`${subtask.id}: ${errMsg}`);
          await updateSubtaskStatus(supabase, taskId, subtask.id, 'failed');
          await logEvent(supabase, taskId, subtask.assigned_agents?.[0], 'subtask_failed',
            `"${subtask.id}" failed: ${errMsg}`);
        }
      }
    }
  }

  state.agentResults = agentResults;
  await logEvent(supabase, taskId, 'Dispatcher', 'dispatch_complete',
    `Done: ${Object.keys(agentResults).length}/${subtasks.length} subtasks`);
  return state;
}

// ── Execute subtask with retry + fallback agent ────────────────────────────
async function executeSubtaskWithRetry(subtask, sharedMemory, previousResults, supabase, taskId, costTracking, agentMemoryContext) {
  const primaryName = subtask.assigned_agents?.[0];
  const fallbackName = FALLBACK_AGENTS[primaryName];

  // Try primary agent
  const primaryResult = await executeAgentWithRetry(
    primaryName, subtask, sharedMemory, previousResults,
    supabase, taskId, costTracking, agentMemoryContext
  );

  if (primaryResult.success) return primaryResult;

  // Try fallback agent if primary failed
  if (fallbackName) {
    console.log(`[Fallback] ${primaryName} failed → trying ${fallbackName}`);
    await logEvent(supabase, taskId, primaryName, 'agent_fallback',
      `Switching to fallback: ${fallbackName}`);

    const fallbackResult = await executeAgentWithRetry(
      fallbackName, subtask, sharedMemory, previousResults,
      supabase, taskId, costTracking, agentMemoryContext
    );

    if (fallbackResult.success) {
      return { ...fallbackResult, usedFallback: true, originalAgent: primaryName };
    }
  }

  return { success: false, error: `Both primary (${primaryName}) and fallback failed`, subtaskId: subtask.id };
}

// ── Execute one agent with retry ──────────────────────────────────────────
async function executeAgentWithRetry(agentName, subtask, sharedMemory, previousResults, supabase, taskId, costTracking, agentMemoryContext) {
  const agent = getAgentByName(agentName);
  if (!agent) return { success: false, error: `Unknown agent: ${agentName}` };

  const startedAt = new Date().toISOString();
  await logEvent(supabase, taskId, agent.name, 'agent_started',
    `${agent.displayName} starting: ${subtask.description.slice(0, 50)}...`,
    { subtask_id: subtask.id, tier: agent.tier });

  let lastError = null;

  for (let attempt = 0; attempt <= MAX_AGENT_RETRIES; attempt++) {
    try {
      // Pre-fetch real data via tools
      const toolContext = await prefetchToolData(agent, subtask.description);

      // Build full context for agent
      const memContext = JSON.stringify(sharedMemory?.getAllMemory?.() || {}).slice(0, 2000);
      const prevContext = Object.entries(previousResults)
        .slice(-4)
        .map(([id, r]) => `[${id}]: ${r.output?.slice(0, 250)}`)
        .join('\n\n');

      let systemFull = agent.systemPrompt;
      if (toolContext) systemFull += `\n\nREAL-TIME DATA (use this):\n${toolContext}`;
      if (memContext && memContext !== '{}') systemFull += `\n\nSHARED CONTEXT:\n${memContext}`;
      if (prevContext) systemFull += `\n\nPREVIOUS AGENTS:\n${prevContext}`;
      if (agentMemoryContext) systemFull += `\n\nUSER MEMORY FROM PAST SESSIONS (use to personalise your output):\n${agentMemoryContext}`;

      const resp = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: agent.maxTokens || 1500,
        system: systemFull,
        messages: [{ role: 'user', content: subtask.description }],
      });

      const output = resp.content.find(b => b.type === 'text')?.text || '';
      const tokens = resp.usage.input_tokens + resp.usage.output_tokens;
      const cost = (resp.usage.input_tokens / 1_000_000) * PRICE_PER_M_INPUT + (resp.usage.output_tokens / 1_000_000) * PRICE_PER_M_OUTPUT;

      costTracking.total_tokens += tokens;
      costTracking.total_cost_usd += cost;

      // Save to shared memory
      if (sharedMemory?.set) {
        await sharedMemory.set(subtask.id, { output, agent: agent.name, timestamp: new Date() },
          { agent: agent.name, dataType: 'subtask_result' });
      }

      await writeAgentResult(supabase, taskId, agent, subtask.id, {
        success: true, output, tokens, cost, startedAt,
      });

      await logEvent(supabase, taskId, agent.name, 'agent_completed',
        `${agent.displayName} done (attempt ${attempt + 1})`,
        { subtask_id: subtask.id, tokens, output_preview: output.slice(0, 150) });

      return { success: true, subtaskId: subtask.id, agentName: agent.name, output, tokens, cost };
    } catch (err) {
      lastError = err;
      if (attempt < MAX_AGENT_RETRIES) {
        await logEvent(supabase, taskId, agent.name, 'agent_retry',
          `Attempt ${attempt + 1} failed, retrying... (${err.message})`);
        await sleep(Math.pow(2, attempt) * 600);
      }
    }
  }

  await writeAgentResult(supabase, taskId, agent, subtask.id, {
    success: false, error: lastError?.message, startedAt,
  });
  await logEvent(supabase, taskId, agent.name, 'agent_failed',
    `All ${MAX_AGENT_RETRIES + 1} attempts failed: ${lastError?.message}`);

  return { success: false, error: lastError?.message, subtaskId: subtask.id };
}

// ── Pre-fetch tool data before running agent ──────────────────────────────
async function prefetchToolData(agent, description) {
  const prefetches = AGENT_PREFETCH_TOOLS[agent.name.toLowerCase()];
  if (!prefetches) return null;

  const results = [];

  for (const pf of prefetches) {
    try {
      const args = pf.argExtractor
        ? pf.argExtractor(description)
        : { query: description.slice(0, 100) };

      const toolResult = await executeTool(pf.tool, args, { retries: 1, timeoutMs: 8000 });
      if (toolResult.success) {
        results.push(`[${pf.tool}]:\n${JSON.stringify(toolResult.result, null, 2).slice(0, 800)}`);
      }
    } catch (e) {
      // Tool failure is non-fatal, agent proceeds without live data
      console.warn(`[Prefetch] ${pf.tool} failed:`, e.message);
    }
  }

  return results.length ? results.join('\n\n') : null;
}

// ── Node 3: Result Compiler ────────────────────────────────────────────────
export async function resultCompilerNode(state, supabase) {
  const { taskId } = state;
  await logEvent(supabase, taskId, 'Fusion', 'compilation_started', 'Synthesizing outputs...');

  const outputSections = Object.entries(state.agentResults)
    .filter(([, r]) => r?.output)
    .map(([id, r]) => `### ${id} (${r.agentName || 'unknown'})\n${r.output}`)
    .join('\n\n---\n\n');

  if (!outputSections.trim()) {
    state.finalOutput = 'No agent outputs were produced.';
    return state;
  }

  const system = `You are Fusion, the master synthesis agent.
Your job: take outputs from multiple specialized agents and produce ONE comprehensive, well-structured final response.

Rules:
1. Synthesize — don't copy-paste. Weave insights together.
2. Remove duplication — same fact once.
3. Add section headers (## Markdown).
4. Preserve all code blocks, tables, numbers.
5. If market data was fetched (prices, OHLCV), include it prominently.
6. End with a clear summary and next steps.
7. Be comprehensive but not padded.${state.agentMemoryContext ? `

USER MEMORY FROM PAST SESSIONS (use to personalise tone/format/emphasis):
${state.agentMemoryContext}` : ''}`;

  try {
    const resp = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 3000,
      system,
      messages: [{
        role: 'user',
        content: `Original request: "${state.userInput}"\n\n${outputSections}`,
      }],
    });

    state.finalOutput = resp.content.find(b => b.type === 'text')?.text || 'Compilation failed.';
    state.costTracking.total_tokens += resp.usage.input_tokens + resp.usage.output_tokens;
    state.costTracking.total_cost_usd +=
      (resp.usage.input_tokens / 1_000_000) * PRICE_PER_M_INPUT + (resp.usage.output_tokens / 1_000_000) * PRICE_PER_M_OUTPUT;
    await logEvent(supabase, taskId, 'Fusion', 'task_completed', 'Final output ready');
    return state;
  } catch (err) {
    state.finalOutput = Object.values(state.agentResults).map(r => r.output).filter(Boolean).join('\n\n');
    return state;
  }
}

// ── Dependency Graph ───────────────────────────────────────────────────────
function buildDependencyGraph(subtasks) {
  const completed = new Set();
  const batches = [];
  let guard = 0;
  while (completed.size < subtasks.length && guard++ < 30) {
    const ready = subtasks.filter(t =>
      !completed.has(t.id) && (t.dependencies || []).every(d => completed.has(d))
    );
    if (!ready.length) break;
    batches.push(ready);
    ready.forEach(t => completed.add(t.id));
  }
  return batches;
}

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Main Entry ─────────────────────────────────────────────────────────────
export async function runOrchestration(userInput, supabase, userId, taskId) {
  console.log('\n═══ ZENITH v3 ORCHESTRATION ═══');

  let sharedMemory = null;
  try {
    const { SharedMemoryFactory } = await import('../memory/SharedMemory.js');
    sharedMemory = await new SharedMemoryFactory(supabase).getOrCreate(taskId);
  } catch (e) { console.warn('[Memory]', e.message); }

  // Load cross-session memories and inject into state
  let agentMemory = null;
  let agentMemoryContext = '';
  try {
    agentMemory = new AgentMemory(supabase, userId);
    const memories = await agentMemory.recall(userInput, { limit: 8 });
    if (memories.length) {
      agentMemoryContext = agentMemory.formatForContext(memories);
      console.log(`[AgentMemory] Injecting ${memories.length} memories into context`);
    }
  } catch (e) { console.warn('[AgentMemory] load failed:', e.message); }

  const state = {
    userInput, userId, taskId,
    agentMemoryContext,
    taskBreakdown: { subtasks: [] },
    agentResults: {},
    sharedMemory,
    executionLog: [],
    finalOutput: '',
    costTracking: { total_tokens: 0, total_cost_usd: 0 },
    errors: [],
  };

  try {
    let s = await supervisorNode(state, supabase);
    s = await agentDispatcherNode(s, supabase);
    s = await resultCompilerNode(s, supabase);
    console.log(`═══ DONE | cost: $${s.costTracking.total_cost_usd.toFixed(4)} ═══\n`);

    // Extract memories from completed run (non-blocking)
    if (agentMemory && s.finalOutput) {
      agentMemory.extractFromRun(userInput, s.finalOutput, anthropic, taskId)
        .catch(e => console.warn('[AgentMemory] extract failed:', e.message));
    }

    return s;
  } catch (err) {
    console.error('❌ FATAL:', err.message);
    state.errors.push(err.message);
    state.finalOutput = `Orchestration failed: ${err.message}`;
    return state;
  }
}
