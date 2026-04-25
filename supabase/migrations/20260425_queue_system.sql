-- 1. Create batch_config Table
CREATE TABLE IF NOT EXISTS public.batch_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    total_quota INT NOT NULL DEFAULT 400,
    filled_quota INT NOT NULL DEFAULT 0,
    session_capacity INT NOT NULL DEFAULT 200,
    wave_capacity INT NOT NULL DEFAULT 20,
    wave_duration_minutes INT NOT NULL DEFAULT 7,
    session_gap_minutes INT NOT NULL DEFAULT 15,
    is_open BOOLEAN NOT NULL DEFAULT FALSE,
    issued_queue_numbers INT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Create queue_slots Table
CREATE TABLE IF NOT EXISTS public.queue_slots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    queue_number INT NOT NULL,
    session INT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('waiting', 'active', 'done', 'expired')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    activated_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    UNIQUE(user_id) -- 1 User = 1 Slot
);

CREATE INDEX IF NOT EXISTS idx_queue_slots_user_id ON public.queue_slots(user_id);
CREATE INDEX IF NOT EXISTS idx_queue_slots_status ON public.queue_slots(status);
CREATE INDEX IF NOT EXISTS idx_queue_slots_queue_number ON public.queue_slots(queue_number);

-- 3. Create waitlist_notifications Table
CREATE TABLE IF NOT EXISTS public.waitlist_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(email)
);

-- 4. Enable Row Level Security (RLS)
ALTER TABLE public.queue_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.waitlist_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.batch_config ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies
-- Users can only read their own queue slot
CREATE POLICY "Users can view own queue slot" 
ON public.queue_slots FOR SELECT 
USING (auth.uid() = user_id);

-- Users can read batch_config
CREATE POLICY "Anyone can read batch_config" 
ON public.batch_config FOR SELECT 
USING (true);

-- Users can insert waitlist
CREATE POLICY "Users can insert waitlist" 
ON public.waitlist_notifications FOR INSERT 
WITH CHECK (auth.uid() = user_id);

-- 6. RPC: claim_queue_slot (The core atomic function)
CREATE OR REPLACE FUNCTION public.claim_queue_slot(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_config public.batch_config%ROWTYPE;
    v_existing_slot public.queue_slots%ROWTYPE;
    v_active_slots_count INT;
    v_new_queue_number INT;
    v_assigned_session INT;
BEGIN
    -- Cek apakah user sudah punya antrean
    SELECT * INTO v_existing_slot FROM public.queue_slots WHERE user_id = p_user_id;
    IF FOUND THEN
        RETURN jsonb_build_object(
            'success', true, 
            'message', 'already_queued', 
            'data', row_to_json(v_existing_slot)
        );
    END IF;

    -- Mengunci baris batch_config untuk mencegah Race Condition (Atomic Lock)
    -- Ambil baris pertama (diasumsikan hanya ada 1 config aktif)
    SELECT * INTO v_config FROM public.batch_config LIMIT 1 FOR UPDATE;
    
    IF v_config IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'config_not_found');
    END IF;

    IF NOT v_config.is_open THEN
        RETURN jsonb_build_object('success', false, 'error', 'queue_closed');
    END IF;

    -- Hitung total slot yang valid (tidak expired)
    SELECT COUNT(*) INTO v_active_slots_count 
    FROM public.queue_slots 
    WHERE status IN ('waiting', 'active', 'done');

    -- Cek Kuota Habis Total
    IF v_active_slots_count >= v_config.total_quota THEN
        RETURN jsonb_build_object('success', false, 'error', 'quota_full');
    END IF;

    -- Ambil nomor antrean berikutnya
    v_new_queue_number := v_config.issued_queue_numbers + 1;
    
    -- Tentukan Sesi (Sesi 1: 1-200, Sesi 2: 201-400)
    v_assigned_session := CEIL(v_new_queue_number::NUMERIC / v_config.session_capacity::NUMERIC);

    -- Insert ke queue_slots
    INSERT INTO public.queue_slots (user_id, queue_number, session, status)
    VALUES (p_user_id, v_new_queue_number, v_assigned_session, 'waiting')
    RETURNING * INTO v_existing_slot;

    -- Update counter di batch_config
    UPDATE public.batch_config 
    SET issued_queue_numbers = v_new_queue_number 
    WHERE id = v_config.id;

    RETURN jsonb_build_object(
        'success', true, 
        'message', 'queue_claimed', 
        'data', row_to_json(v_existing_slot)
    );
END;
$$;

-- 7. Insert Default Config if empty
INSERT INTO public.batch_config (total_quota, filled_quota, session_capacity, wave_capacity, wave_duration_minutes, session_gap_minutes, is_open)
SELECT 400, 0, 200, 20, 7, 15, false
WHERE NOT EXISTS (SELECT 1 FROM public.batch_config);
