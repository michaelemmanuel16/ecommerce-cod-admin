# [Agent Name] Research Plan

> **📋 This is a RESEARCH PLAN, not implementation**
> The parent agent will read this and perform the actual implementation.

**Generated:** [Date/Time - REQUIRED]
**Agent:** [Your agent name - REQUIRED]
**Context File:** `.claude/docs/tasks/context-session-{n}.md` - [REQUIRED]

## Executive Summary (REQUIRED)
**What was researched:** [Brief 2-3 sentence summary]
**Recommended approach:** [High-level recommendation]
**Complexity assessment:** [Low/Medium/High]
**Estimated implementation time:** [Time estimate]

## Context Understanding (REQUIRED)
✅ **Context file read:** `.claude/docs/tasks/context-session-{n}.md`
✅ **Goals understood:** [List goals from context file]
✅ **Constraints identified:** [List constraints from context file]

## Current Codebase Analysis (REQUIRED)
### Files Reviewed
- `path/to/file1.ts` - [What you learned from this file]
- `path/to/file2.ts` - [What you learned from this file]
- `path/to/file3.ts` - [What you learned from this file]

### Existing Patterns Identified
- **Pattern 1:** [Description and location in codebase]
- **Pattern 2:** [Description and location in codebase]

### Relevant Architecture
- [Component/module architecture relevant to this task]
- [State management patterns]
- [API integration patterns]

## Recommended Approaches (REQUIRED)

### ✅ RECOMMENDED: Option 1 - [Approach Name]
**Summary:** [1-2 sentence summary of this approach]

**Pros:**
- ✅ Pro 1 - [Why this is beneficial]
- ✅ Pro 2 - [Why this is beneficial]
- ✅ Pro 3 - [Why this is beneficial]

**Cons:**
- ⚠️ Con 1 - [Potential drawback]
- ⚠️ Con 2 - [Potential drawback]

**Complexity:** [Low/Medium/High]

### Alternative: Option 2 - [Approach Name] (if applicable)
**Summary:** [1-2 sentence summary of alternative]

**Pros:**
- ✅ Pro 1

**Cons:**
- ⚠️ Con 1
- ⚠️ Con 2

**Complexity:** [Low/Medium/High]

**Why not recommended:** [Explain why Option 1 is better]

## Detailed Implementation Steps (REQUIRED)

### Phase 1: [Phase Name]
1. **Step 1:** [Specific action to take]
   - **File:** `path/to/file.ts`
   - **Action:** [Create/Modify/Delete]
   - **Changes needed:** [Detailed description]
   - **Why:** [Rationale for this change]

2. **Step 2:** [Specific action to take]
   - **File:** `path/to/file.ts`
   - **Action:** [Create/Modify/Delete]
   - **Changes needed:** [Detailed description]
   - **Why:** [Rationale for this change]

### Phase 2: [Phase Name]
[Continue with more steps...]

## File Structure Plan (REQUIRED)
```
directory/
├── file1.ts          # Purpose: [Detailed purpose]
├── file2.tsx         # Purpose: [Detailed purpose]
├── types/
│   └── index.ts      # Purpose: [Type definitions]
└── __tests__/
    └── file1.test.ts # Purpose: [Test coverage]
```

## Code Patterns & Examples (REQUIRED)

### Pattern 1: [Pattern Name]
**Location in codebase:** `path/to/existing/example.ts:123`
**Follow this pattern:**
```typescript
// Example pattern from existing codebase
// Explain what makes this pattern good
```

### Pattern 2: [Pattern Name]
**Recommended implementation:**
```typescript
// Code example showing recommended approach
// Include comments explaining key decisions
```

## Dependencies & Requirements

### Package Dependencies
- `package-name@version` - [Why needed] - [npm install command]
- `package-name@version` - [Why needed] - [npm install command]

### Environment Variables
- `ENV_VAR_NAME` - [Purpose] - [Example value]
- `ENV_VAR_NAME` - [Purpose] - [Example value]

### External Services/APIs
- [Service name] - [Purpose] - [Setup required]

## Type Definitions (if applicable)

```typescript
// Recommended TypeScript types/interfaces
interface Example {
  // Type definitions with comments
}
```

## Testing Strategy (REQUIRED)

### Unit Tests Needed
- **File:** `path/to/test.test.ts`
- **Coverage:** [What functions/methods to test]
- **Test cases:**
  1. [Test case 1]
  2. [Test case 2]
  3. [Edge case 1]

### Integration Tests Needed
- **Scenario:** [What integration to test]
- **Test case:** [Description]

### E2E Tests Needed (if applicable)
- **User flow:** [Description of flow to test]
- **Test file:** `e2e/feature.spec.ts`

## Potential Issues & Mitigations (REQUIRED)

### Issue 1: [Potential problem]
- **Impact:** [High/Medium/Low]
- **Likelihood:** [High/Medium/Low]
- **Mitigation:** [How to prevent or handle]

### Issue 2: [Potential problem]
- **Impact:** [High/Medium/Low]
- **Likelihood:** [High/Medium/Low]
- **Mitigation:** [How to prevent or handle]

## Performance Considerations
- [Performance concern 1] - [How to address]
- [Performance concern 2] - [How to address]

## Security Considerations
- [Security concern 1] - [How to address]
- [Security concern 2] - [How to address]

## Accessibility Considerations (for frontend)
- [A11y requirement 1] - [How to implement]
- [A11y requirement 2] - [How to implement]

## References & Resources

### Documentation
- [Link to official docs] - [What it explains]
- [Link to API docs] - [What it explains]

### Similar Implementations in Codebase
- `path/to/similar/feature.ts:123-456` - [Why this is a good reference]
- `path/to/similar/component.tsx:78-234` - [What pattern to follow]

### Best Practices
- [Best practice 1] - [Source/justification]
- [Best practice 2] - [Source/justification]

## Questions for Parent Agent (if any)
- [ ] Question 1: [Clarification needed]
- [ ] Question 2: [Decision required]

## Summary for Parent Agent (REQUIRED)

**This plan recommends:** [1-sentence summary]

**Implementation order:**
1. [High-level step 1]
2. [High-level step 2]
3. [High-level step 3]

**Key files to modify:**
- `file1.ts`
- `file2.tsx`
- `file3.ts`

**Estimated complexity:** [Low/Medium/High]

**Ready for implementation:** [Yes/No - explain if No]

---

## ⚠️ IMPORTANT: Next Steps for Parent Agent

1. ✅ **Read this entire plan** before starting implementation
2. ✅ **Read plans from other agents** (if delegated to multiple agents)
3. ✅ **Update context file** with research summary
4. ✅ **Implement based on this plan** (not before reading it!)
5. ✅ **Document deviations** if you deviate from recommendations

**Parent agent:** You are the implementer. Use Write, Edit, and Bash tools to perform the actual work based on this research.

---
**Plan Status:** [Draft/Final/Implemented]
**Last Updated:** [Date/Time]
