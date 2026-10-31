// NOTE: the groups used here (engineers, governance-reviewers, business-analysts, compliance) are INVENTED for the demo. They are not real PingFederate or Privilege groups.
@id("u14-compliance-evidence")
@reason("Compliance may read pull requests, search the knowledge base and query logs, including restricted evidence")
permit (principal in Group::"compliance", action in [Action::"mcp:Invoke", Action::"mcp:InvokeUnattended"], resource)
when { [Tool::"github.read_pr", Tool::"kb.search", Tool::"cloudwatch.query_logs"].contains(resource) };
