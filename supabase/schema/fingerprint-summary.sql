-- Summary of fingerprint.sql: one hash per kind of object. Run it on
-- production (read-only) and compare with production-<date>.fingerprint
-- before trusting the replica; run.sh checks the replica against it.
SELECT kind, count(*) n, md5(string_agg(item, E'\n' ORDER BY item)) h FROM (SELECT kind, item FROM (
  SELECT 'column' kind, c.relname || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
         || CASE WHEN a.attnotnull THEN ' not null' ELSE '' END
         || coalesce(' default ' || pg_get_expr(d.adbin, d.adrelid), '') item
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE n.nspname = 'public' AND c.relkind = 'r'
  UNION ALL
  SELECT 'constraint', c.relname || ' ' || con.conname || ' ' || pg_get_constraintdef(con.oid)
    FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
  UNION ALL
  SELECT 'rls', c.relname || ' ' || c.relrowsecurity
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r'
  UNION ALL
  SELECT 'trigger', pg_get_triggerdef(t.oid)
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE NOT t.tgisinternal AND (n.nspname = 'public' OR c.oid = 'auth.users'::regclass)
  UNION ALL
  SELECT 'policy', schemaname || '.' || tablename || ' ' || policyname || ' ' || cmd || ' ' || array_to_string(roles, ',')
         || ' using ' || coalesce(qual, '-') || ' check ' || coalesce(with_check, '-')
    FROM pg_policies WHERE schemaname IN ('public', 'storage')
  UNION ALL
  SELECT 'function', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') definer=' || p.prosecdef
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
  UNION ALL
  SELECT 'grant', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') ' || r.rolname
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    JOIN pg_roles r ON r.oid = a.grantee
   WHERE n.nspname = 'public' AND r.rolname IN ('anon', 'authenticated', 'service_role') AND a.privilege_type = 'EXECUTE'
  UNION ALL
  SELECT 'index', pg_get_indexdef(i.indexrelid)
    FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
  UNION ALL
  SELECT 'realtime', schemaname || '.' || tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime'
) x) f GROUP BY kind ORDER BY kind;