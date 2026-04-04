import { createClient } from '@supabase/supabase-js';

// Read from environment variables — never hardcode credentials in source
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseKey) {
  console.error(
    '[FlyttGo] Missing Supabase environment variables.\n' +
    'Create a .env.local file with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.\n' +
    'See .env.example for the template.'
  );
}

export const supabase = createClient(
  supabaseUrl || 'https://jomhtghowrtegjfddite.databasepad.com',
  supabaseKey || ''
);
