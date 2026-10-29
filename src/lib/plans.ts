import { supabase } from './supabase';

/**
 * Driver subscription plans.
 *
 * The source of truth is driver_subscriptions.plan_id → subscription_plans
 * (supabase/migrations/00002_reconcile_production_schema.sql). The app
 * names a plan by its slug: the plan's name in lower case with spaces as
 * underscores ('Pro Mini' → 'pro_mini'), the same rule as SQL
 * public.plan_slug(). Changes go through the change_driver_subscription
 * RPC, never a direct write.
 */
export function planSlug(name: string | null | undefined): string | null {
  if (!name) return null;
  return name.trim().toLowerCase().replace(/\s+/g, '_');
}

/** The subscription row as the UI uses it: the row plus its plan slug. */
export type SubscriptionWithPlan = Record<string, any> & { plan: string | null };

export function withPlanSlug(row: any): SubscriptionWithPlan | null {
  if (!row) return null;
  return { ...row, plan: planSlug(row.subscription_plans?.name) };
}

/**
 * Active plan slug per driver user id (driver_subscriptions.driver_id is
 * the auth user id). Used by admin views, which list driver_profiles.
 */
export async function activePlansByUser(userIds: string[]): Promise<Record<string, string>> {
  const ids = userIds.filter(Boolean);
  if (ids.length === 0) return {};
  const { data } = await supabase
    .from('driver_subscriptions')
    .select('driver_id, created_at, subscription_plans(name)')
    .in('driver_id', ids)
    .eq('subscription_status', 'active')
    .order('created_at', { ascending: false });
  const out: Record<string, string> = {};
  for (const row of (data ?? []) as any[]) {
    const slug = planSlug(row.subscription_plans?.name);
    if (slug && !out[row.driver_id]) out[row.driver_id] = slug;
  }
  return out;
}

/** Plans an administrator can assign, by slug, in the order shown. */
export const ASSIGNABLE_PLANS = ['free', 'basic', 'pro_mini', 'pro', 'unlimited'] as const;
