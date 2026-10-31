// NOTE: the groups used here (engineers, governance-reviewers, business-analysts, compliance) are INVENTED for the demo. They are not real PingFederate or Privilege groups.
@id("u21-never-change-policy")
@reason("Agents never change access policy. No approval overrides this")
forbid (principal, action in [Action::"mcp:Invoke", Action::"mcp:InvokeUnattended"], resource == Tool::"policy.change");
