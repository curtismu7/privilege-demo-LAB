// NOTE: the groups used here (analysts, finance, travel-agents) are INVENTED for the demo. They are not real PingFederate or Privilege groups.
@id("s05-rugpull-pin")
@reason("Tool schema changed since it was approved")
forbid (principal, action, resource)
when { context.pinnedHash != context.observedHash };
