import { NextResponse } from "next/server";
import { verifyMessage } from "ethers";
import { getSupabaseServerClient, hasSupabaseServerEnv } from "@/lib/supabase/serverClient";
import type { ActivityCategory, CreateActivityPayload } from "@/lib/activityLog";
import { buildActivityMessage } from "@/lib/activityLog";

const TABLE = "activity_logs";

export async function GET(request: Request) {
  if (!hasSupabaseServerEnv) {
    return NextResponse.json({ data: [] });
  }
  const url = new URL(request.url);
  const category = url.searchParams.get("category") as ActivityCategory | null;
  try {
    const supabase = getSupabaseServerClient();
    let query = supabase
      .from(TABLE)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(25);
    if (category) {
      query = query.eq("category", category);
    }
    const { data, error } = await query;
    if (error) {
      console.error("Supabase fetch failed", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const normalized = (data ?? []).map((entry) => ({
      ...entry,
      txHash: entry.tx_hash ?? null,
    }));
    return NextResponse.json({ data: normalized });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!hasSupabaseServerEnv) {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 500 });
  }
  try {
    const payload = (await request.json()) as (CreateActivityPayload & {
      nonce?: string;
      signature?: string;
    });
    if (!payload?.category || !payload?.description || !payload?.nonce || !payload?.signature) {
      return NextResponse.json({ error: "category, description, nonce, signature は必須です" }, { status: 400 });
    }
    if (!payload.account) {
      return NextResponse.json({ error: "account は必須です" }, { status: 400 });
    }
    const message = buildActivityMessage({
      category: payload.category,
      description: payload.description,
      txHash: payload.txHash,
      account: payload.account,
      nonce: payload.nonce,
    });
    const recovered = verifyMessage(message, payload.signature);
    if (recovered.toLowerCase() !== payload.account.toLowerCase()) {
      return NextResponse.json({ error: "署名が無効です" }, { status: 401 });
    }
    const supabase = getSupabaseServerClient();
    const { error } = await supabase.from(TABLE).insert({
      category: payload.category,
      description: payload.description,
      tx_hash: payload.txHash ?? null,
      account: payload.account ?? null,
    });
    if (error) {
      console.error("Supabase insert failed", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
