-- Enforce a strict maximum of 5 saved degree plans per user at the database layer.
-- Allows updating existing plans (including via INSERT ... ON CONFLICT DO UPDATE)
-- while rejecting any new distinct plan once the user already has 5 saved plans.

create or replace function public.enforce_max_degree_plans()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_count integer;
begin
  -- Allow upserts targeting an already-saved plan for this (user_email, program_id)
  if exists (
    select 1
    from public.degree_plans
    where user_email = new.user_email
      and program_id = new.program_id
  ) then
    return new;
  end if;

  select count(*)
    into existing_count
  from public.degree_plans
  where user_id = new.user_id
     or user_email = new.user_email;

  if existing_count >= 5 then
    raise exception 'You can save up to 5 degree plans. Delete an existing plan to add another.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_max_degree_plans on public.degree_plans;
create trigger trg_enforce_max_degree_plans
  before insert on public.degree_plans
  for each row
  execute function public.enforce_max_degree_plans();

notify pgrst, 'reload schema';
