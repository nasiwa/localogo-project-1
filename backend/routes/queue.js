const express = require('express');
const router = express.Router();

// Helper to verify user token
async function verifyUser(req, supabase) {
  const token = req.headers.authorization?.split(' ')[1] || req.headers['x-user-token'];
  if (!token) return { error: 'No token provided' };
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return { error: 'Invalid token' };
  return { user: data.user };
}

// POST /api/queue/claim
router.post('/claim', async (req, res) => {
  try {
    const supabase = req.app.get('getSupabase')();
    const { user, error } = await verifyUser(req, supabase);
    if (error) return res.status(401).json({ success: false, error });

    // Admin Bypass
    if (process.env.ADMIN_EMAIL && user.email === process.env.ADMIN_EMAIL) {
        return res.json({
            success: true,
            data: {
                user_id: user.id,
                queue_number: 0,
                session: 1,
                status: 'active',
                created_at: new Date(),
                activated_at: new Date(),
                expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24)
            }
        });
    }

    // Call RPC
    const { data: rpcData, error: rpcError } = await supabase.rpc('claim_queue_slot', { p_user_id: user.id });

    if (rpcError) {
      console.error('RPC Error:', rpcError);
      return res.status(500).json({ success: false, error: 'Database error while claiming slot' });
    }

    if (!rpcData.success) {
      return res.status(400).json(rpcData);
    }

    res.json(rpcData);
  } catch (err) {
    console.error('Claim Error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/queue/reset
router.post('/reset', async (req, res) => {
  try {
    const supabase = req.app.get('getSupabase')();
    const { user, error } = await verifyUser(req, supabase);
    if (error) return res.status(401).json({ success: false, error });

    const { error: delError } = await supabase
      .from('queue_slots')
      .delete()
      .eq('user_id', user.id);

    if (delError) throw delError;
    res.json({ success: true, message: 'Antrean berhasil direset' });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Gagal meriset antrean' });
  }
});

// GET /api/queue/status
router.get('/status', async (req, res) => {
  try {
    const supabase = req.app.get('getSupabase')();
    const { user, error } = await verifyUser(req, supabase);
    if (error) return res.status(401).json({ success: false, error });

    if (process.env.ADMIN_EMAIL && user.email === process.env.ADMIN_EMAIL) {
        return res.json({
            success: true,
            status: 'active',
            data: { queue_number: 0, session: 1, status: 'active' }
        });
    }

    const { data, error: dbError } = await supabase
      .from('queue_slots')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();

    if (dbError) throw dbError;

    if (!data) {
      return res.json({ success: true, status: 'not_queued' });
    }

    // AUTO-EXPIRE LOGIC: Jika active tapi waktu sudah lewat, ubah jadi expired
    if (data.status === 'active' && data.expires_at) {
      const expiresAt = new Date(data.expires_at).getTime();
      const now = new Date().getTime();
      if (now > expiresAt) {
        console.log(`Auto-expiring user ${user.id}`);
        const { data: updated, error: upError } = await supabase
          .from('queue_slots')
          .update({ status: 'expired' })
          .eq('user_id', user.id)
          .select()
          .single();
        
        if (!upError && updated) {
          return res.json({ success: true, status: 'expired', data: updated });
        }
      }
    }

    res.json({ success: true, status: data.status, data });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/queue/info (Public endpoint - always fresh for is_open)
router.get('/info', async (req, res) => {
  try {
    const supabase = req.app.get('getSupabase')();
    
    const { data: config } = await supabase
      .from('batch_config')
      .select('*')
      .limit(1)
      .single();
      
    if (!config) {
      return res.json({ success: true, data: { is_open: false } });
    }

    // Hitung slot terisi (bukan expired)
    const { count: activeCount } = await supabase
      .from('queue_slots')
      .select('*', { count: 'exact', head: true })
      .in('status', ['waiting', 'active', 'done']);

    const info = {
      is_open: config.is_open,
      total_quota: config.total_quota,
      filled: activeCount || 0,
      available: Math.max(0, config.total_quota - (activeCount || 0)),
      session_capacity: config.session_capacity,
      wave_duration_minutes: config.wave_duration_minutes
    };
    
    res.json({ success: true, data: info });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/queue/notify (Waitlist)
router.post('/notify', async (req, res) => {
  try {
    const supabase = req.app.get('getSupabase')();
    const { user, error } = await verifyUser(req, supabase);
    if (error) return res.status(401).json({ success: false, error });

    const { error: insertError } = await supabase
      .from('waitlist_notifications')
      .insert({ email: user.email, user_id: user.id });

    // Ignore unique constraint error if they already registered
    if (insertError && insertError.code !== '23505') {
      throw insertError;
    }

    res.json({ success: true, message: 'Terdaftar di waitlist' });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Gagal mendaftar waitlist' });
  }
});

module.exports = router;
