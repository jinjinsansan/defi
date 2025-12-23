import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

export const hasSupabaseServerEnv = Boolean(supabaseUrl && supabaseSecretKey);

export function getSupabaseServerClient() {
  if (!hasSupabaseServerEnv || !supabaseUrl || !supabaseSecretKey) {
    throw new Error("Supabase 環境変数が設定されていません。");
  }
  return createClient(supabaseUrl, supabaseSecretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
