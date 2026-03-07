do $$
declare
  owner_column_type text;
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'memory_records'
  ) then
    if not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'memory_records'
        and column_name = 'owner_user_id'
    ) then
      alter table memory_records add column owner_user_id uuid;
    else
      select c.data_type
      into owner_column_type
      from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name = 'memory_records'
        and c.column_name = 'owner_user_id';

      if owner_column_type is distinct from 'uuid' then
        if not exists (
          select 1
          from information_schema.columns
          where table_schema = 'public'
            and table_name = 'memory_records'
            and column_name = 'owner_user_id_uuid'
        ) then
          alter table memory_records add column owner_user_id_uuid uuid;
        end if;

        -- 레거시 문자열 owner를 변환할 때 유효 UUID만 유지하고 나머지는 NULL로 명시 처리한다.
        update memory_records
        set owner_user_id_uuid = case
          when trim(owner_user_id::text) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            then trim(owner_user_id::text)::uuid
          else null
        end;

        alter table memory_records drop column owner_user_id;
        alter table memory_records rename column owner_user_id_uuid to owner_user_id;
      end if;
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
