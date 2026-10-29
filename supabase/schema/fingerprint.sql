-- Structural fingerprint of the public schema (+ storage policies), one
-- row per object, for comparing production with a replica or with the
-- result of migrations. Function bodies are not compared (formatting
-- differs); their signature, security mode and grants are.
SELECT kind, item FROM (
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
  UNION ALL
  -- Views run with their owner's rights unless security_invoker is set,
  -- so their definition, options and privileges matter as much as RLS.
  SELECT 'view', c.relname || ' ' || coalesce(array_to_string(c.reloptions, ','), '-') || ' '
         || md5(regexp_replace(pg_get_viewdef(c.oid, true), '\s+', ' ', 'g'))
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm')
  UNION ALL
  -- MAINTAIN exists from PostgreSQL 17 only; left out so 16 and 17 compare.
  SELECT 'table_grant', c.relname || ' ' || r.rolname || ' ' || a.privilege_type
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
    JOIN pg_roles r ON r.oid = a.grantee
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v', 'm') AND a.privilege_type <> 'MAINTAIN'
     AND r.rolname IN ('anon', 'authenticated', 'service_role')
  UNION ALL
  SELECT 'replica_identity', c.relname || ' ' || c.relreplident::text
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r'
  UNION ALL
  SELECT 'bucket', id || ' public=' || coalesce(public::text, '-') || ' limit=' || coalesce(file_size_limit::text, '-')
         || ' mime=' || coalesce(array_to_string(allowed_mime_types, ','), '-')
    FROM storage.buckets
) x ORDER BY kind, item;
