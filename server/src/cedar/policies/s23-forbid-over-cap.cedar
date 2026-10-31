// NOTE: the groups used here (analysts, finance, travel-agents) are INVENTED for the demo. They are not real PingFederate or Privilege groups.
@id("s23-forbid-over-cap")
@reason("Hard cap: no booking over 10000 for anyone")
forbid (principal, action in [Action::"mcp:Invoke", Action::"mcp:InvokeUnattended"], resource == Tool::"book_fare")
when { context.args has amount && context.args.amount > 10000 };
