// NOTE: the groups used here (analysts, finance, travel-agents) are INVENTED for the demo. They are not real PingFederate or Privilege groups.
@id("s01-hold-large-fare")
@reason("Fares over 1000 need a second pair of eyes")
@approvers("priya")
forbid (principal, action == Action::"mcp:InvokeUnattended", resource == Tool::"book_fare")
when { context.args has amount && context.args.amount > 1000 }
unless { context.approval_count >= 1 };
