-- ============================================================
-- Fix RLS Policies for messages table to allow marking as read
-- Run this in Supabase SQL Editor
-- ============================================================

-- Ensure RLS is enabled
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- Allow participants to update messages in their conversations (e.g. mark as read)
DROP POLICY IF EXISTS "Participants can update messages" ON public.messages;
CREATE POLICY "Participants can update messages" 
ON public.messages 
FOR UPDATE 
USING (
  EXISTS (
    SELECT 1 FROM public.conversations c 
    WHERE c.id = messages.conversation_id 
    AND (c.participant_a = auth.uid() OR c.participant_b = auth.uid())
  )
);
