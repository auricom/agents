# AGENTS

<skills_system priority="1">

## Available Skills

<!-- SKILLS_TABLE_START -->
<usage>
When users ask you to perform tasks, check if any of the available skills below can help complete the task more effectively. Skills provide specialized capabilities and domain knowledge.

How to use skills:
- Invoke: `npx openskills read <skill-name>` (run in your shell)
  - For multiple: `npx openskills read skill-one,skill-two`
- The skill content will load with detailed instructions on how to complete the task
- Base directory provided in output for resolving bundled resources (references/, scripts/, assets/)

Usage notes:
- Only use skills listed in <available_skills> below
- Do not invoke a skill that is already loaded in your context
- Each skill invocation is stateless
</usage>

<available_skills>

<skill>
<name>ansible-skill</name>
<description>"Infrastructure automation with Ansible. Use for server provisioning, configuration management, application deployment, and multi-host orchestration. Includes playbooks for OpenClaw VPS setup, security hardening, and common server configurations."</description>
<location>project</location>
</skill>

<skill>
<name>skill-creator</name>
<description>Create or update AgentSkills. Use when designing, structuring, or packaging skills with scripts, references, and assets.</description>
<location>project</location>
</skill>

</available_skills>
<!-- SKILLS_TABLE_END -->

</skills_system>
