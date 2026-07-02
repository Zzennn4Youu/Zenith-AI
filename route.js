/**
 * /api/portfolio
 *
 * GET  /api/portfolio?days=30  — fetch equity curve snapshots (1 per hour max)
 * POST /api/portfolio           — save portfolio snapshot (throttled: 1/hr)
 *   body: { totalUsdt, assets }
 */

import { createClient }        from '@supabase/supabase-js';
import { extractBearerToken }  from '../../../lib/security/middleware.js';

async function authenticate(request) {
  const tk = extractBearerToken(request);
  if (!tk.valid) return { ok: false, status: 401 };

  // Attach the user's JWT so .from() calls run under their identity for RLS.
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${tk.token}` } } },
  );
  const { data: { user }, error } = await supabase.auth.getUser(tk.token);
  if (error || !user) return { ok: false, status: 401 };
  return { ok: true, user, supabase };
}

// ── GET: equity curve ─────────────────────────────────────────────────────────

export async function GET(request) {
  const auth = await authenticate(request);
  if (!auth.ok) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const days = Math.min(90, parseInt(searchParams.get('days') ?? '30'));
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  const { data, error } = await auth.supabase
    .from('portfolio_snapshots')
    .select('total_usdt, assets, snapshot_at')
    .eq('user_id', auth.user.id)
    .gte('snapshot_at', since)
    .order('snapshot_at', { ascending: true });

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ success: true, snapshots: data ?? [] });
}

// ── POST: save snapshot ───────────────────────────────────────────────────────

export async function POST(request) {
  const auth = await authenticate(request);
  if (!auth.ok) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  let body;
  try { body = await request.json(); }
  catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { totalUsdt, assets } = body;
  if (!totalUsdt || totalUsdt <= 0) {
    return Response.json({ error: 'totalUsdt required' }, { status: 400 });
  }

  // Throttle: only save if last snapshot was > 55 minutes ago
  const { data: recent } = await auth.supabase
    .from('portfolio_snapshots')
    .select('snapshot_at')
    .eq('user_id', auth.user.id)
    .order('snapshot_at', { ascending: false })
    .limit(1)
    .single();

  const lastMs = recent ? new Date(recent.snapshot_at).getTime() : 0;
  const throttled = Date.now() - lastMs < 55 * 60 * 1000;

  if (!throttled) {
    await auth.supabase.from('portfolio_snapshots').insert({
      user_id:    auth.user.id,
      total_usdt: parseFloat(totalUsdt.toFixed(4)),
      assets:     assets ?? {},
    });
  }

  return Response.json({ success: true, saved: !throttled });
}
