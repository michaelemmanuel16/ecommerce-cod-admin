# Sub-Agent Workflow Quick Reference

## Visual Workflow

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER REQUEST                            │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 1: Parent Creates Context File                           │
│  ✅ Create .claude/docs/tasks/context-session-{n}.md           │
│  ✅ Use template from context-session-template.md              │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 2: Parent Delegates Research (Can Run in Parallel)       │
│  ✅ Identify specialized agents needed                         │
│  ✅ Pass context file path to each agent                       │
│  ✅ Agents use Read/Glob/Grep only (NO code changes)           │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  SUB-AGENTS RESEARCH (Read-Only)                               │
│                                                                 │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐ │
│  │ frontend-dev     │  │ backend-dev      │  │ database-    │ │
│  │ researches UI    │  │ researches API   │  │ architect    │ │
│  └────────┬─────────┘  └────────┬─────────┘  └──────┬───────┘ │
│           │                     │                    │         │
│           ▼                     ▼                    ▼         │
│  frontend-dev-plan.md   backend-dev-plan.md   db-plan.md      │
└─────────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 3: Parent Reads ALL Plan Files                           │
│  ✅ Read .claude/docs/frontend-developer-plan.md               │
│  ✅ Read .claude/docs/backend-developer-plan.md                │
│  ✅ Read .claude/docs/database-architect-plan.md               │
│  ✅ Understand recommendations BEFORE implementing             │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 4: Parent Implements Based on Plans                      │
│  ✅ Parent does ALL code writing, editing, file creation       │
│  ✅ Combine insights from multiple agent plans                 │
│  ✅ Document any deviations from plans                         │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 5: Parent Updates Context File                           │
│  ✅ Mark tasks as complete                                     │
│  ✅ Document what was implemented                              │
│  ✅ Note any issues or deviations                              │
│  ✅ Update "Last Updated" timestamp                            │
└─────────────────────────────────────────────────────────────────┘
```

## Copy-Paste Templates

### Template 1: Creating Context File

```markdown
Create file: `.claude/docs/tasks/context-session-{n}.md`

# Context Session {n}

## Project Overview
**Feature/Task:** [Brief description of what we're building]
**Started:** [Current date]
**Status:** Research Phase

## Current State
- Existing architecture: [Describe current setup]
- Files involved: [List relevant files]
- Current features: [What already exists]

## Goals
- [ ] [Goal 1]
- [ ] [Goal 2]
- [ ] [Goal 3]

## Research Reports
- [ ] frontend-developer - Status: Pending
- [ ] backend-developer - Status: Pending
- [ ] database-architect - Status: Pending

## Technical Constraints
- [Constraint 1]
- [Constraint 2]

## Next Actions
1. Delegate research to specialized agents
2. Read all plan files
3. Implement based on recommendations

---
**Last Updated:** [Date/Time]
**Updated By:** Parent Agent
```

### Template 2: Delegating to Sub-Agent

```
Task for {agent-name}:

{Describe what needs to be researched, e.g.:
- "Research authentication implementation patterns in the codebase"
- "Analyze frontend component structure for user dashboard"
- "Review database schema for order management system"
}

Requirements:
{List specific requirements or constraints}

Context file: `.claude/docs/tasks/context-session-{n}.md`
Output plan to: `.claude/docs/{agent-name}-plan.md`

Research only - no implementation. Provide detailed plan with:
- Current codebase analysis
- Recommended approach
- Implementation steps
- Code patterns/examples
- Potential issues to consider
```

### Template 3: After Reading Plans - Implementation Note

```markdown
Update `.claude/docs/tasks/context-session-{n}.md`:

## Implementation Summary
**Date:** [Current date]
**Based on plans from:** frontend-developer, backend-developer, database-architect

### What Was Implemented
- [Feature 1] - following recommendations from {agent-plan}
- [Feature 2] - combining insights from {agent-plan-1} and {agent-plan-2}

### Deviations from Plans
- [Deviation 1]: Reason for deviation
- [Deviation 2]: Reason for deviation

### Files Created/Modified
- `path/to/file1.ts` - [Purpose]
- `path/to/file2.ts` - [Purpose]

### Next Steps
- [ ] Test implementation
- [ ] Update documentation
- [ ] Performance review

---
**Last Updated:** [Date/Time]
**Updated By:** Parent Agent
```

## Quick Reference: Agent Selection

**Need frontend work?** → `frontend-developer`
- Component architecture
- State management (Zustand)
- Shadcn UI components
- Responsive design

**Need backend API?** → `backend-developer`
- Express routes & controllers
- Business logic in services
- API design patterns
- Authentication/authorization

**Need database changes?** → `database-architect`
- Prisma schema design
- Migrations strategy
- Indexes and optimization
- Query patterns

**Need tests?** → `test-engineer`
- Jest/Vitest unit tests
- Playwright E2E tests
- Test coverage analysis
- Testing strategies

**Need Shadcn components?** → `shadcn-expert` (MCP-powered!)
- Component registry search
- Usage examples
- Installation commands
- Accessibility patterns

---

## Minimalist Approach: Only 5 Agents

**✅ You have 5 essential agents:**
1. `frontend-developer` - React, Zustand, React Router, Shadcn UI
2. `backend-developer` - Express, JWT, Bull/Redis, Socket.io
3. `database-architect` - Prisma schema, migrations, queries
4. `shadcn-expert` - Shadcn registry (MCP tools)
5. `test-engineer` - Jest, Vitest, Playwright

**❌ Removed agents** (parent handles these):
- Performance optimization - handled by backend/frontend devs
- Security audits - handled by backend-developer
- Code reviews - parent reviews inline
- Documentation - parent writes docs
- DevOps/Infrastructure - handle when needed
- Dependency management - parent handles

## Common Mistakes to Avoid

### ❌ Mistake 1: Implementing Without Research
```
User: "Add user profile page"
Parent: [Starts writing ProfilePage.tsx immediately]
```
**Why it's wrong:** Missing specialized knowledge, codebase patterns, architecture

### ❌ Mistake 2: Not Creating Context File
```
Parent: [Delegates to frontend-developer without context file]
Sub-agent: "Where is the context file? I can't proceed."
```
**Why it's wrong:** Sub-agent has no context about project goals or constraints

### ❌ Mistake 3: Not Reading Plan Files
```
Parent: [Delegates research]
Sub-agent: [Creates detailed plan]
Parent: [Starts implementing without reading plan]
```
**Why it's wrong:** Wastes the specialized research, misses recommendations

### ❌ Mistake 4: Asking Sub-Agent to Implement
```
Parent: "Frontend-developer, please create the login component"
Sub-agent: "I'm a researcher, not an implementer. I can only create plans."
```
**Why it's wrong:** Sub-agents don't have Write/Edit/Bash tools

### ❌ Mistake 5: Not Updating Context File
```
Parent: [Implements features based on plans]
Parent: [Moves to next task without updating context]
```
**Why it's wrong:** Loses track of what was done, makes debugging harder

## Checklist Before Starting

**Before you begin ANY complex feature, verify:**

- [ ] Have I created a context file in `.claude/docs/tasks/`?
- [ ] Have I identified which specialized agents are needed?
- [ ] Am I delegating research (not implementation) to sub-agents?
- [ ] Am I passing the context file path in my delegation?
- [ ] Will I read ALL plan files before implementing?
- [ ] Will I update the context file after implementation?

## Example: Complete Workflow

**User Request:** "Add a customer dashboard with order history and analytics"

### Step 1: Create Context File
```bash
File: .claude/docs/tasks/context-session-3.md
Content: Project overview, goals, current architecture, constraints
```

### Step 2: Delegate Research (Parallel)
```
Task for frontend-developer:
Research customer dashboard UI architecture including:
- Component hierarchy for dashboard
- Shadcn components for data visualization
- State management for customer data
- Responsive layout strategy

Context: .claude/docs/tasks/context-session-3.md
Output: .claude/docs/frontend-developer-plan.md

---

Task for backend-developer:
Research customer analytics API design including:
- REST endpoints for customer data
- Analytics aggregation logic
- Performance optimization for large datasets
- Caching strategy

Context: .claude/docs/tasks/context-session-3.md
Output: .claude/docs/backend-developer-plan.md

---

Task for database-architect:
Research database schema for customer analytics including:
- Query patterns for order history
- Indexes needed for performance
- Aggregation strategies
- Data retention considerations

Context: .claude/docs/tasks/context-session-3.md
Output: .claude/docs/database-architect-plan.md
```

### Step 3: Read Plans
```
Read .claude/docs/frontend-developer-plan.md
Read .claude/docs/backend-developer-plan.md
Read .claude/docs/database-architect-plan.md
```

### Step 4: Implement
```
Parent implements:
1. Database indexes (from database-architect plan)
2. Analytics API endpoints (from backend-developer plan)
3. Dashboard UI components (from frontend-developer plan)
```

### Step 5: Update Context
```
Update .claude/docs/tasks/context-session-3.md with:
- Implementation summary
- Files created/modified
- Deviations from plans
- Next steps
```

## Pro Tips

1. **Parallel Research**: Delegate to multiple agents simultaneously when research is independent
2. **Sequential Implementation**: Implement in dependency order (schema → API → UI)
3. **Document Deviations**: Always note when you deviate from agent recommendations
4. **Reuse Context Files**: Keep context files for similar features to maintain consistency
5. **Review Plans Together**: Look for conflicts between different agent recommendations before implementing

## Need Help?

- Check `CLAUDE.md` for full workflow documentation
- Review `.claude/agents/README.md` for agent capabilities
- Look at templates in `.claude/docs/` for examples
- Reference previous context files for patterns

---

**Remember: Research-First, Implement-Second**

Sub-agents are specialists who provide expert guidance.
Parent agent (main Claude session) is the implementer who writes all code.
