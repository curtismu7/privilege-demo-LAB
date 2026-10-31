// NOTE: the groups used here (analysts, finance, travel-agents) are INVENTED for the demo. They are not real PingFederate or Privilege groups.
@id("s23-permit-travel-agents")
@reason("Travel agents may book fares")
permit (principal in Group::"travel-agents", action in [Action::"mcp:Invoke", Action::"mcp:InvokeUnattended"], resource)
when { context.app == "booking" };
