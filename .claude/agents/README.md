# Claude Code Agents - Minimalist Approach

This directory contains **5 specialized Claude Code sub-agents** focused on your E-Commerce COD Admin app's core tech stack.

---

## 🎯 Minimalist Philosophy

**Quality over quantity.** Only delegate when specialized domain knowledge adds real value.

### Why Only 5 Agents?

✅ **Focused on your stack**: React, Express, Prisma, Shadcn, Jest/Vitest/Playwright
✅ **Reduces overhead**: Faster delegation, clearer responsibility
✅ **MCP-powered**: Keep agents with unique tool access (Shadcn registry)
✅ **Parent handles general tasks**: Code review, docs, optimization done directly

---

## ⚠️ WORKFLOW ENFORCEMENT

**ALL AGENTS ARE RESEARCH-ONLY**

### Critical Rules

1. **Sub-agents are RESEARCHERS, not implementers**
   - They have Read, Glob, Grep tools (+ MCP for shadcn-expert)
   - They CANNOT write, edit, or create files
   - They CANNOT run bash commands
   - They analyze and plan, nothing more

2. **Parent agent (main Claude session) is the SOLE IMPLEMENTER**
   - Only the parent has Write, Edit, Bash tools
   - Parent creates context files FIRST
   - Parent delegates research to sub-agents
   - Parent reads ALL plans before implementing
   - Parent does ALL code changes

3. **Mandatory workflow enforced by:**
   - ⚠️ Header at top of every agent file
   - 🔒 REQUIRED fields in templates
   - 📋 Tool restrictions (Read/Glob/Grep only)
   - 🚨 Prominent instructions in CLAUDE.md

### Quick Reference

**See these files for complete workflow:**
- `CLAUDE.md` (line 7-181) - Mandatory workflow section
- `.claude/docs/WORKFLOW.md` - Visual diagrams and templates
- `.claude/docs/tasks/context-session-template.md` - Context file template
- `.claude/docs/agent-plan-template.md` - Research plan template

**If you're not following the research-first pattern, STOP and read CLAUDE.md first!**

---

## Architecture Overview

### Delegation Pattern

Simple, focused delegation for core development tasks:

```
User Request
    ↓
Parent Agent (You)
    ↓
    ├──→ frontend-developer (React/Shadcn UI research)
    ├──→ backend-developer (Express/API research)
    ├──→ database-architect (Prisma schema research)
    ├──→ shadcn-expert (Component registry queries via MCP)
    └──→ test-engineer (Testing strategy research)

All agents run in parallel ⚡
Parent reads plans → Implements code
```

### Key Benefits
- **Simple & fast** - Direct delegation, no orchestration overhead
- **Parallel research** - Multiple agents analyze simultaneously
- **Clear responsibility** - Each agent focuses on one domain
- **Parent stays in control** - All implementation decisions yours

---

## Key Principle: Research-First, Implement-Second

**All sub-agents are researchers, not implementers.** They analyze the codebase, propose detailed plans, and save them to `.claude/docs/{agent-name}-plan.md`. The parent agent (main Claude Code session) reads these plans and performs ALL implementation.

### Why This Pattern?

**Problem with implementer sub-agents:**
- Each sub-agent task is isolated (no context sharing)
- Parent agent loses visibility into what was implemented
- Bugs require starting new isolated sessions
- Wastes tokens on sub-agent implementation attempts

**Solution with researcher sub-agents:**
- Sub-agents create focused research reports
- Parent maintains full context of all changes
- Research saved to files for traceability
- Parent can debug issues with complete knowledge
- Token-efficient: summaries instead of full file reads

## Agent Overview

### 🎯 Parent Agent (Main Session)

**YOU (Claude Code Main Session)**
The parent agent that orchestrates research and performs ALL implementation.

**Your workflow:**
1. Create context file at `.claude/docs/tasks/context-session-{n}.md`
2. Delegate research to sub-agents (pass context file reference)
3. Read research plans from `.claude/docs/{agent-name}-plan.md`
4. Implement based on plans
5. Update context file with progress

**Tools:** Read, Write, Edit, Bash, Glob, Grep (full implementation capabilities)

---

### 🔬 Research Specialists (5 Agents)

All research agents follow the same workflow:
1. Read `.claude/docs/tasks/context-session-{n}.md` FIRST
2. Research codebase using Read/Glob/Grep (+ MCP for shadcn-expert)
3. Create plan at `.claude/docs/{agent-name}-plan.md`
4. Update context file
5. Return summary pointing to plan file

**Tools:** Read, Glob, Grep (NO Write/Edit/Bash)

---

#### **1. frontend-developer**
Frontend architecture researcher who analyzes React components, Zustand state management, and UI/UX requirements.

**Tech Focus:** React, Vite, Zustand, React Router, React Hook Form, Zod, Shadcn UI patterns

**Research areas:** Component hierarchy, state management, routing, forms, validation, responsive design

**Plan includes:** Component structure, props interfaces, store patterns, styling strategy, code examples

---

#### **2. backend-developer**
Backend architecture researcher who analyzes Express APIs, JWT auth, Bull queues, and service layer patterns.

**Tech Focus:** Express, Prisma Client, JWT, Bull/Redis, Socket.io, middleware, validation

**Research areas:** API routes, controllers, services, authentication, background jobs, real-time updates

**Plan includes:** API endpoints, request/response schemas, validation rules, middleware, code examples

---

#### **3. database-architect**
Database schema researcher who analyzes Prisma models, relationships, migrations, and query optimization.

**Tech Focus:** Prisma ORM, PostgreSQL, schema design, migrations, indexing, query patterns

**Research areas:** Prisma schema, relationships, indexes, migrations, query optimization, transactions

**Plan includes:** Schema changes, migration strategy, indexes, Prisma Client queries, performance tips

**Enhanced with:** Prisma-specific query patterns and best practices (absorbed from prisma-expert)

---

#### **4. shadcn-expert** (MCP-Powered)
Shadcn UI component specialist with **unique MCP tools** for querying component registry.

**Tech Focus:** Shadcn UI components, design system, accessibility, Tailwind styling

**Special Tools:** 6 Shadcn MCP tools for registry access (search, view, examples, installation)

**Research areas:** Component selection, variants, composition, props, examples, installation commands

**Plan includes:** Recommended components, usage examples, installation commands, styling patterns

---

#### **5. test-engineer**
Test coverage researcher who analyzes Jest/Vitest unit tests, integration tests, and Playwright E2E scenarios.

**Tech Focus:** Jest (backend), Vitest (frontend), Playwright (E2E), Testing Library, Supertest

**Research areas:** Existing test patterns, coverage gaps, E2E user flows, test infrastructure, mocking

**Plan includes:** Test files needed, testing strategies, mock patterns, Playwright scenarios, coverage goals

---

## How the Research-First Pattern Works

### Parent Agent Responsibilities (You)

As the parent agent (main Claude Code session), you:

1. **Create context file** for the feature/task
2. **Delegate research** to specialist sub-agents (can run in parallel)
3. **Read research plans** from `.claude/docs/{agent-name}-plan.md`
4. **Implement code** based on all research recommendations
5. **Update context file** with implementation progress
6. **Debug issues** (you have full context, unlike isolated sub-agents)

### Sub-Agent Responsibilities (Research Specialists)

All sub-agents follow this pattern:

1. **Read context file** FIRST (`.claude/docs/tasks/context-session-{n}.md`)
2. **Research codebase** using Read/Glob/Grep
3. **Create detailed plan** at `.claude/docs/{agent-name}-plan.md`
4. **Update context file** to mark research complete
5. **Return summary** pointing to plan file

**Sub-agents NEVER write code** - they only research and plan.

### Example: Research-First Workflow

**User Request:** "Build a user authentication system with email/password login"

**Parent Agent (You) Workflow:**

**Step 1: Create Context File**
```bash
Create `.claude/docs/tasks/context-session-1.md` with:
- Feature: Email/password authentication
- Requirements: Login, signup, JWT tokens
- Status: Research phase
```

**Step 2: Delegate Research (Parallel)**
```
Task to database-architect:
"Research user authentication schema requirements.
Context: `.claude/docs/tasks/context-session-1.md`
Save plan to: `.claude/docs/database-architect-plan.md`"

Task to backend-developer (parallel):
"Research authentication API patterns (JWT, bcrypt, etc).
Context: `.claude/docs/tasks/context-session-1.md`
Save plan to: `.claude/docs/backend-developer-plan.md`"

Task to shadcn-expert (parallel):
"Research Shadcn components for login/signup forms.
Context: `.claude/docs/tasks/context-session-1.md`
Save plan to: `.claude/docs/shadcn-expert-plan.md`"
```

**Step 3: Read All Research Plans**
```
- database-architect-plan.md → User schema, password hashing field, indexes
- backend-developer-plan.md → /api/auth/login, /api/auth/signup routes
- shadcn-expert-plan.md → Form, Input, Button, Label components
```

**Step 4: Implement Based on Plans**
```
Parent agent (YOU) now implements:
1. Create Prisma migration (from database-architect plan)
2. Create auth routes & controllers (from backend-developer plan)
3. Create login/signup UI (from shadcn-expert plan)
```

**Step 5: Update Context File**
```
Update context-session-1.md:
- Mark implementation complete
- Document what was built
- Note any deviations from plans
```

**Result:**
- All research saved in `.claude/docs/` for review
- Parent maintains full context of all changes
- Can easily debug issues or iterate
- Token-efficient: summaries instead of full file reads in parent context

### Intelligent Parallelization

The orchestrator maximizes efficiency by running independent tasks simultaneously:
- **Design phase**: Database and frontend architecture planned in parallel
- **Implementation**: Backend API and frontend UI built concurrently
- **QA phase**: Testing, security audit, and code review run together
- **Result**: 90%+ faster completion on complex multi-phase projects

---

## Usage Examples

### Starting a New Feature
```
"I want to add a blog post system with CRUD operations,
including rich text editing and image uploads"
```
Automatically involves: database-architect, backend-developer, frontend-developer, test-engineer

### Preparing for Production
```
"Prepare the app for production deployment to AWS"
```
Automatically involves: security-auditor, performance-optimizer, devops-engineer, infrastructure-manager

### Release Management
```
"Prepare a v2.0.0 release with all recent changes"
```
Automatically involves: release-manager, documentation-writer, test-engineer

### Maintenance & Optimization
```
"Our app is slow, improve performance across the stack"
```
Automatically involves: performance-optimizer, database-architect, code-reviewer

### Security Audit
```
"Perform a comprehensive security audit before launch"
```
Automatically involves: security-auditor, dependency-manager, code-reviewer

---

## Configuration

Each agent is configured with:

### YAML Frontmatter
```yaml
name: agent-name
description: Clear description of agent's expertise and when to use it
tools: Read, Write, Edit, Bash, Glob, Grep  # Available tools
model: claude-sonnet-4-5  # AI model to use
```

### System Prompt
Detailed instructions defining:
- Agent's expertise and responsibilities
- Best practices and guidelines
- Common patterns and anti-patterns
- Tool usage strategies
- Communication style

---

## Agent Tool Access

| Agent | Read | Write | Edit | Bash | Glob | Grep | Role |
|-------|------|-------|------|------|------|------|------|
| **Parent (You)** ⭐ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **Implementer** |
| frontend-developer | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ | Researcher |
| backend-developer | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ | Researcher |
| database-architect | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ | Researcher |
| test-engineer | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ | Researcher |
| performance-optimizer | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ | Researcher |
| code-reviewer | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ | Analyst |
| security-auditor | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ | Analyst |
| devops-engineer | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ | Researcher |
| infrastructure-manager | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ | Researcher |
| release-manager | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ | Researcher |
| documentation-writer | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ | Researcher |
| dependency-manager | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ | Researcher |
| shadcn-expert | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ | Service Expert |
| prisma-expert | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ | Service Expert |
| vercel-ai-expert | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ | Service Expert |

**Key Changes:**
- **All sub-agents are research-only** (Read, Glob, Grep only)
- **Parent agent (you) is the sole implementer** (has Write, Edit, Bash)
- Service experts have additional MCP tools for specialized research
- This enforces the research-first, implement-second pattern

---

## Best Practices

### 1. Be Specific in Requests
Instead of: "Fix the app"
Better: "Optimize the user dashboard loading time"

**Why:** Specific requests help the orchestrator create better execution plans and delegate to the right agents.

### 2. Trust the Orchestrator
The **project-manager** will automatically:
- Break complex requests into phases
- Delegate to appropriate specialists
- Manage dependencies
- Execute tasks in parallel when possible

**You don't need to** specify which agents to use - the orchestrator handles this automatically.

### 3. Describe the Goal, Not the Steps
Instead of: "Have the database-architect design a schema, then the backend-developer build an API..."
Better: "Build a blog system with posts, comments, and user authentication"

**Why:** The orchestrator is better at planning the workflow than manual step-by-step instructions.

### 4. Complex Projects Are Automatic
Multi-phase projects are the orchestrator's strength:
- "Build and deploy a complete e-commerce platform"
- "Migrate our app from MongoDB to PostgreSQL"
- "Prepare for production launch with full security audit"

The orchestrator will handle all phases automatically.

### 5. Iterative Development Still Works
For incremental work:
1. "Build core blog features" → orchestrator coordinates dev agents
2. "Add authentication" → orchestrator adds auth across stack
3. "Prepare for production" → orchestrator coordinates QA and deployment

### 6. Version Control
All agents work within your git repository. Commit changes regularly and review agent work before pushing.

---

## Customization

You can customize agents by editing their markdown files:

1. **Modify expertise**: Update the description and system prompt
2. **Adjust tools**: Change which tools the agent can access
3. **Add domain knowledge**: Include project-specific guidelines
4. **Change model**: Use different Claude models if needed

Example customization:
```yaml
---
name: frontend-developer
description: React and TypeScript specialist for our e-commerce platform
tools: Read, Write, Edit, Bash, Glob, Grep
model: claude-sonnet-4-5
---

You are a Frontend Developer specializing in React, TypeScript, and our
custom design system built on top of Chakra UI...
```

---

## Troubleshooting

### Orchestrator Not Engaging
If simple requests don't need orchestration, that's expected. The **project-manager** automatically engages for:
- Complex multi-phase projects
- Requests requiring multiple specialized agents
- Production deployment workflows
- Full-stack feature development

For simple single-agent tasks (e.g., "fix this typo"), Claude may directly use the appropriate specialist.

### Agent Not Being Invoked
- The orchestrator may have determined the agent isn't needed for this specific request
- Check the orchestrator's plan to see which agents were selected and why
- Make your request more specific if a particular capability is needed

### Workflow Seems Sequential Instead of Parallel
The orchestrator runs tasks in parallel when they're independent. Sequential execution happens when:
- Tasks have dependencies (backend needs schema first)
- Safety requires sequential work (test before deploy)
- This is usually intentional and correct

### Want to Override Orchestrator Decisions
You can be explicit: "Use the security-auditor to scan for vulnerabilities"
But generally, trust the orchestrator's judgment - it's optimized for efficiency and correctness.

### Agent Lacks Necessary Tools
- Edit the agent's YAML frontmatter to add required tools
- Note: Read-only agents (code-reviewer, security-auditor) intentionally have limited tools
- Only project-manager should have the Task tool

---

## Complete Development Workflow

Here's how the **project-manager** orchestrates all agents in a typical development cycle:

### User Request: "Build and deploy a new feature"

### Phase 1: Planning & Design
**project-manager** delegates in parallel:
1. **database-architect**: Design schema
2. **frontend-developer**: Plan component architecture

### Phase 2: Implementation
**project-manager** coordinates:
3. **backend-developer**: Build API (needs schema from Phase 1)
4. **frontend-developer**: Build UI (parallel with backend)
5. **documentation-writer**: Document API (parallel)

### Phase 3: Quality Assurance
**project-manager** runs in parallel:
6. **test-engineer**: Write and run tests
7. **code-reviewer**: Review code quality
8. **security-auditor**: Security scan

### Phase 4: Optimization & Polish
**project-manager** coordinates:
9. **performance-optimizer**: Optimize bottlenecks (if QA identified issues)
10. **dependency-manager**: Update & audit dependencies
11. **test-engineer**: Retest after optimizations

### Phase 5: Pre-Deployment
**project-manager** prepares release:
12. **release-manager**: Version bump, changelog
13. **documentation-writer**: Update README, docs
14. **test-engineer**: Final full test suite

### Phase 6: Deployment
**project-manager** orchestrates:
15. **infrastructure-manager**: Prepare cloud resources
16. **devops-engineer**: Update CI/CD, deploy
17. **release-manager**: Create GitHub release

### Phase 7: Post-Deployment Monitoring
**project-manager** sets up monitoring:
18. **infrastructure-manager**: Monitor metrics
19. **performance-optimizer**: Verify performance
20. **security-auditor**: Monitor for new vulnerabilities

**Key Point:** You just say "Build and deploy a new feature" - the **project-manager** orchestrates all 20 steps automatically!

---

## Additional Resources

- [Claude Code Documentation](https://docs.claude.com/claude-code)
- [Subagents Guide](https://docs.claude.com/claude-code/sub-agents)
- [Best Practices](https://www.anthropic.com/engineering/claude-code-best-practices)

---

## Support

If you encounter issues or have questions:
1. Check agent descriptions and system prompts
2. Review Claude Code documentation
3. Open an issue in your project repository
4. Customize agents to fit your specific needs

---

**Generated with Claude Code** 🤖

---

## Summary

This agent system provides **enterprise-grade development automation** through intelligent orchestration:

- **13 total agents**: 1 orchestrator + 12 specialized workers
- **Hierarchical architecture**: project-manager delegates to specialists
- **Automatic workflow planning**: Break complex requests into phases automatically
- **Intelligent parallelization**: 90%+ performance improvement on complex tasks
- **Complete automation**: From initial development through production deployment

Simply describe what you want to build - the **project-manager** orchestrator handles the rest, coordinating all specialized agents to deliver production-ready results.

**Get started:** Make a request and watch the orchestrated workflow in action!
