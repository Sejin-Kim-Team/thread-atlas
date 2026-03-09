do $$
declare
  constraint_record record;
begin
  if to_regclass('public.user_identities') is null then
    return;
  end if;

  for constraint_record in
    select conname
    from pg_constraint
    where conrelid = 'public.user_identities'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%provider%'
  loop
    execute format(
      'alter table public.user_identities drop constraint %I',
      constraint_record.conname
    );
  end loop;

  alter table public.user_identities
    add constraint user_identities_provider_check
    check (provider in ('google', 'bootstrap'));

  update public.user_identities
  set provider = 'bootstrap'
  where provider = 'google'
    and raw_claims ? 'bootstrapSubject';
end $$;
