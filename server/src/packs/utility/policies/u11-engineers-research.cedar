// NOTE: the groups used here (engineers, governance-reviewers, business-analysts, compliance) are INVENTED for the demo. They are not real PingFederate or Privilege groups.
@id("u11-engineers-research")
@reason("Engineers may search the knowledge base and query logs (restricted data is a separate forbid)")
permit (principal in Group::"engineers", action in [Action::"mcp:Invoke", Action::"mcp:InvokeUnattended"], resource)
when { [Tool::"kb.search", Tool::"cloudwatch.query_logs"].contains(resource) };
