// NOTE: the groups used here (engineers, governance-reviewers, business-analysts, compliance) are INVENTED for the demo. They are not real PingFederate or Privilege groups.
@id("u13-analysts-backlog")
@reason("Business analysts may draft and update stories, update requirements, and search the knowledge base (updates are held for approval)")
permit (principal in Group::"business-analysts", action in [Action::"mcp:Invoke", Action::"mcp:InvokeUnattended"], resource)
when { [Tool::"backlog.create_story_draft", Tool::"backlog.update_story", Tool::"confluence.update_requirement", Tool::"kb.search"].contains(resource) };
