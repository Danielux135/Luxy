begin;

grant usage on schema public to service_role;

grant select, insert, update, delete on table
  public.approvals,
  public.job_events,
  public.jobs,
  public.machine_tokens,
  public.machines,
  public.provider_usage,
  public.telegram_updates,
  public.telegram_users
to service_role;

grant usage, select, update
on all sequences in schema public
to service_role;

commit;
