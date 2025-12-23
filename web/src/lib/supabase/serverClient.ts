import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const hasSupabaseServerEnv = Boolean(supabaseUrl && supabaseServiceRoleKey);

export function getSupabaseServerClient() {
  if (!hasSupabaseServerEnv || !supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error("Supabase 環境変数が設定されていません。");
  }
  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
