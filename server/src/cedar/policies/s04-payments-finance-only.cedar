// NOTE: the groups used here (analysts, finance, travel-agents) are INVENTED for the demo. They are not real PingFederate or Privilege groups.
@id("s04-payments-finance-only")
@reason("Payments is for finance, with the payments:write scope")
permit (principal in Group::"finance", action == Action::"mcp:Invoke", resource)
when { context.app == "payments" && context.token.scopes.contains("payments:write") };
