// NOTE: the groups used here (engineers, governance-reviewers, business-analysts, compliance) are INVENTED for the demo. They are not real PingFederate or Privilege groups.
@id("u22-never-deploy")
@reason("Agents never deploy: every deploy.* tool is denied. No approval overrides this")
forbid (principal, action in [Action::"mcp:Invoke", Action::"mcp:InvokeUnattended"], resource)
when { resource.toolName like "deploy.*" };
