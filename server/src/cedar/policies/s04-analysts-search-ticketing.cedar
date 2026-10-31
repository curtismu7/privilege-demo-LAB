// NOTE: the groups used here (analysts, finance, travel-agents) are INVENTED for the demo. They are not real PingFederate or Privilege groups.
@id("s04-analysts-search-ticketing")
@reason("Analysts may use Search and Ticketing")
permit (principal in Group::"analysts", action == Action::"mcp:Invoke", resource)
when { context.app == "search" || context.app == "ticketing" };
