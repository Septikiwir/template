-- Add columns to settings table for display configuration
-- Step 1: Basic text and color settings
alter table public.settings 
add column if not exists display_welcome_text text not null default 'SELAMAT DATANG',
add column if not exists display_bg_color text not null default '#e7d8a1';

-- Step 2: Advanced background settings (Image & Video)
alter table public.settings 
add column if not exists display_bg_type text not null default 'color', -- 'color', 'image', 'video'
add column if not exists display_bg_url text;

-- Refresh publication (only if not already added)
-- If you get an error saying it's already a member, you can safely ignore it.
alter publication supabase_realtime add table settings;
