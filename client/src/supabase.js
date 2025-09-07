import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://jywvdftejvnisjvuidtt.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp5d3ZkZnRlanZuaXNqdnVpZHR0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTA1MjA5MzksImV4cCI6MjA2NjA5NjkzOX0._iZKkCzHcYUeU-37ZOJxYmvLgCFi0lIbR_xIbfK-EuA';

export const supabase = createClient(supabaseUrl, supabaseKey);
