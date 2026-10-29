// ============================================================================
// FlyttGo — a driver's current subscription, server side
// ============================================================================
//
// driver_subscriptions.driver_id is the driver's auth user id and the plan
// is plan_id → subscription_plans (supabase/migrations/00002). Plans are
// named by slug (planSlug in ./pricing.ts). Changes go through the
// change_driver_subscription RPC.
// ============================================================================

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { planSlug, type CurrentSubscription } from './pricing.ts';

/** The driver's latest subscription row with its plan slug, or null. */
export async function currentSubscription(db: SupabaseClient, userId: string): Promise<CurrentSubscription | null> {
  const { data } = await db
    .from('driver_subscriptions')
    .select('subscription_status, start_date, subscription_plans(name)')
    .eq('driver_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const plan = (data as any).subscription_plans?.name ?? null;
  return { plan: planSlug(plan), subscription_status: data.subscription_status, start_date: data.start_date };
}

/** Slug of the driver's active plan, or null when none is active. */
export async function activePlanSlug(db: SupabaseClient, userId: string): Promise<string | null> {
  const { data } = await db
    .from('driver_subscriptions')
    .select('subscription_plans(name)')
    .eq('driver_id', userId)
    .eq('subscription_status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return planSlug((data as any)?.subscription_plans?.name ?? null);
}
