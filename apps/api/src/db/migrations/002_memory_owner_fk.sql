do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'memory_records'
  ) then
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'memory_records'
        and column_name = 'owner_user_id'
    ) then
      begin
        execute 'alter table memory_records alter column owner_user_id type uuid using owner_user_id::uuid';
      exception
        when invalid_text_representation then
          null;
      end;
    else
      alter table memory_records add column owner_user_id uuid;
    end if;

    if not exists (
      select 1
      from pg_constraint
      where conname = 'fk_memory_records_owner_user_id'
    ) then
      alter table memory_records
        add constraint fk_memory_records_owner_user_id
        foreign key (owner_user_id) references users(id) on delete cascade;
    end if;
  end if;
end $$;
