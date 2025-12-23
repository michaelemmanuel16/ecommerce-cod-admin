# User Research Methods & Artifacts

## User Research Overview

User research helps understand user needs, behaviors, and pain points before and during design.

**Research goals:**
- Understand who your users are
- Discover their needs and goals
- Identify pain points and frustrations
- Validate design decisions
- Inform feature prioritization

## User Personas

### What is a User Persona?

A fictional character representing a user type, based on research data.

**Components:**
- Name and photo
- Demographics (age, location, occupation)
- Goals and motivations
- Pain points and frustrations
- Behaviors and tech proficiency
- Quote capturing their attitude

### When to Create Personas

- Early in the project (after initial research)
- When you have data from real users
- Before designing major features
- To align team on target users

### Persona Template Structure

```
[Photo] [Name]
[Age] • [Occupation] • [Location]

Background:
[Brief description of role, experience, context]

Goals:
• [Primary goal]
• [Secondary goal]
• [Tertiary goal]

Frustrations:
• [Main pain point]
• [Secondary frustration]
• [Challenge they face]

Behaviors:
• [How they work]
• [Technology usage]
• [Communication preferences]

Tech Proficiency: [Low / Medium / High]

Quote:
"[Something they might say that captures their perspective]"
```

### Example Personas for E-Commerce Admin

**Admin Manager - Sarah Chen**
- 35 • Operations Manager • Accra, Ghana
- Goals: Oversee team, track performance, ensure customer satisfaction
- Frustrations: Manual processes, delayed reports, communication gaps
- Tech proficiency: High

**Delivery Agent - Kwame Osei**
- 28 • Delivery Driver • Kumasi, Ghana
- Goals: Complete deliveries quickly, maximize earnings, avoid errors
- Frustrations: Poor navigation, unclear instructions, payment delays
- Tech proficiency: Medium

**Sales Representative - Ama Asare**
- 24 • Sales Rep • Tema, Ghana
- Goals: Process orders fast, track commissions, respond to customers
- Frustrations: Slow order entry, missing customer info, unclear policies
- Tech proficiency: Medium

## User Journey Maps

### What is a Journey Map?

A visualization of the user's experience over time, showing actions, thoughts, and emotions.

**Components:**
- Phases/stages of the journey
- User actions at each stage
- Thoughts and emotions
- Pain points and opportunities
- Touchpoints (where they interact)

### Journey Map Structure

```
Persona: [Name]
Scenario: [What they're trying to accomplish]

Phases:
  1. [Phase name] → 2. [Phase name] → 3. [Phase name] → 4. [Phase name]

For each phase:
  Actions: [What they do]
  Thoughts: [What they think]
  Emotions: [😊 😐 😟 emotional state]
  Pain Points: [Problems they encounter]
  Opportunities: [How to improve]
  Touchpoints: [Systems/people they interact with]
```

### Example Journey Map

**Scenario: Processing a new COD order (Sales Rep)**

```
Phase 1: Receive Customer Call
Actions: Answer phone, gather customer info
Thoughts: "I need to collect accurate delivery details"
Emotions: 😐 Neutral
Pain Points: No script, forget to ask important questions
Opportunities: Add guided form with required fields
Touchpoints: Phone, Order form

Phase 2: Create Order
Actions: Open admin, fill order form, select products
Thoughts: "Where's that product? This takes too long"
Emotions: 😟 Frustrated
Pain Points: Product search is slow, many clicks required
Opportunities: Quick search, autofill, keyboard shortcuts
Touchpoints: Admin dashboard, product catalog

Phase 3: Confirm with Customer
Actions: Read back order details, get confirmation
Thoughts: "Did I get everything right?"
Emotions: 😐 Uncertain
Pain Points: No order summary preview
Opportunities: Add summary screen before submit
Touchpoints: Phone, Order preview

Phase 4: Submit Order
Actions: Click submit, wait for confirmation
Thoughts: "Hope this goes through..."
Emotions: 😊 Relieved (if successful) / 😟 Anxious (if error)
Pain Points: No loading feedback, cryptic errors
Opportunities: Clear status, better error messages
Touchpoints: Submit button, confirmation screen
```

## User Stories

### What is a User Story?

A simple description of a feature from the user's perspective.

**Format:**
```
As a [type of user],
I want [goal/desire],
So that [benefit/value].
```

### Acceptance Criteria

Define what "done" means for the story.

**Format:**
```
Given [context/precondition],
When [action],
Then [expected outcome].
```

### Example User Stories

**Story 1:**
```
As a delivery agent,
I want to see optimized delivery routes,
So that I can complete deliveries faster and save fuel.

Acceptance Criteria:
- Given I have multiple deliveries assigned,
  When I view my route,
  Then deliveries should be ordered by optimal path
- Given I'm on a delivery,
  When I tap the address,
  Then it should open in Google Maps with navigation
```

**Story 2:**
```
As an admin manager,
I want to view real-time delivery status,
So that I can quickly respond to customer inquiries.

Acceptance Criteria:
- Given an order is out for delivery,
  When I view the order details,
  Then I should see current delivery status and agent location
- Given delivery status changes,
  When I'm viewing the dashboard,
  Then the status should update automatically without refresh
```

## Jobs to Be Done (JTBD)

### What is JTBD?

Focus on the "job" users are trying to accomplish, not just features.

**Format:**
```
When [situation],
I want to [motivation],
So I can [expected outcome].
```

### Example JTBD

**Delivery agent:**
```
When I arrive at a delivery address but can't find the customer,
I want to quickly contact them with one tap,
So I can complete the delivery without wasting time.
```

**Admin manager:**
```
When I need to understand why delivery rates are dropping,
I want to see delivery performance analytics by agent and region,
So I can identify and address the root cause.
```

## User Research Methods

### Qualitative Methods

**1. User Interviews**
- One-on-one conversations
- 30-60 minutes
- Open-ended questions
- Uncover motivations and pain points

**Interview questions guide:**
- Background: "Tell me about your role..."
- Current process: "Walk me through how you..."
- Pain points: "What's frustrating about..."
- Goals: "What would make your job easier?"
- Context: "How often do you...?"

**2. Contextual Inquiry**
- Observe users in their environment
- Ask questions while they work
- Understand real-world constraints
- Note workarounds and inefficiencies

**3. Usability Testing**
- Watch users complete tasks
- Think-aloud protocol
- Identify confusion and errors
- 5 users typically find 85% of issues

**Usability test tasks:**
- "Create a new order for customer X"
- "Find orders from last week"
- "Change order status to delivered"
- "Generate a sales report"

### Quantitative Methods

**1. Analytics Review**
- Page views and user flows
- Bounce rates
- Completion rates
- Time on task
- Error rates

**Key metrics to track:**
- Orders created per day/week
- Average order creation time
- Error rate in order entry
- Delivery success rate
- Customer satisfaction scores

**2. Surveys**
- Structured questionnaires
- Rating scales (1-5, NPS)
- Large sample sizes
- Statistical analysis

**Survey questions:**
- How satisfied are you with [feature]? (1-5)
- How often do you use [feature]? (Daily / Weekly / Rarely)
- What's your biggest challenge with [task]?
- On a scale of 1-10, how likely are you to recommend this to a colleague?

**3. A/B Testing**
- Compare two versions
- Measure impact on metrics
- Data-driven decisions

**A/B test examples:**
- Button placement (left vs right)
- Form layout (single column vs two column)
- Navigation structure
- Call-to-action text

### Card Sorting

**Purpose:** Understand how users group and categorize information

**Open card sorting:**
- Users create their own categories
- Uncover mental models
- Good for early IA work

**Closed card sorting:**
- Users sort into predefined categories
- Validate existing structure
- Good for testing navigation

## User Testing Checklist

### Pre-Test

- [ ] Define research goals
- [ ] Create test scenarios and tasks
- [ ] Recruit representative users
- [ ] Prepare prototype or product
- [ ] Write screening questions
- [ ] Schedule sessions
- [ ] Prepare consent forms
- [ ] Set up recording tools

### During Test

- [ ] Welcome and build rapport
- [ ] Explain think-aloud protocol
- [ ] Start with easy warm-up task
- [ ] Observe without helping
- [ ] Ask follow-up questions
- [ ] Note behaviors and quotes
- [ ] Record session (with permission)
- [ ] Thank participant

### Post-Test

- [ ] Debrief and document findings
- [ ] Identify patterns across users
- [ ] Prioritize issues (severity × frequency)
- [ ] Create actionable recommendations
- [ ] Share findings with team
- [ ] Plan design iterations

## Empathy Mapping

### What is an Empathy Map?

A collaborative tool to understand users' internal experience.

**Four quadrants:**
```
Says:                    Thinks:
[Direct quotes]          [Internal thoughts]

Does:                    Feels:
[Observed behaviors]     [Emotions]
```

### Example Empathy Map

**Persona: Sales Rep (Ama) - Processing orders**

```
Says:
"The system is slow during peak hours"
"Customers get impatient waiting for me to enter details"
"I wish I could search products faster"

Thinks:
"Did I select the right product?"
"I hope I didn't make a mistake"
"This is taking too long, customer might change their mind"

Does:
- Writes notes on paper while talking to customer
- Keeps product list open in separate tab
- Double-checks every field before submitting
- Calls supervisor when encountering errors

Feels:
- Frustrated by slow load times
- Anxious about making errors
- Pressured by waiting customers
- Relieved when order submits successfully
```

## Affinity Mapping

### Purpose

Organize and find patterns in qualitative research data.

**Process:**
1. Write each observation/quote on a sticky note
2. Group related notes together
3. Name each group
4. Identify themes and patterns
5. Prioritize themes by importance

**Example groupings from user interviews:**
```
Theme: Order Entry Speed
- "Product search is too slow"
- "Too many clicks to create order"
- "No keyboard shortcuts"
- "Form doesn't save progress"

Theme: Error Handling
- "Error messages don't make sense"
- "Lose all data when error occurs"
- "Don't know what went wrong"
- "Have to start over"

Theme: Customer Communication
- "No way to send order confirmation to customer"
- "Can't share tracking link"
- "Customers call asking for updates"
```

## Prioritization Frameworks

### MoSCoW Method

**Must have:** Critical for launch
**Should have:** Important but not critical
**Could have:** Nice to have
**Won't have:** Out of scope for now

### Value vs Effort Matrix

```
           High Value
              |
Could have    |    Must have
              |
--------------+--------------
              |
Won't have    |    Should have
              |
           Low Effort
```

### RICE Framework

**Reach:** How many users affected?
**Impact:** How much improvement? (Minimal=0.25, Low=0.5, Medium=1, High=2, Massive=3)
**Confidence:** How confident in estimates? (50%, 80%, 100%)
**Effort:** How much work? (person-weeks)

**Score = (Reach × Impact × Confidence) / Effort**

## Research Deliverables

### Research Report Structure

```
1. Executive Summary
   - Key findings
   - Top recommendations

2. Research Goals
   - What we wanted to learn
   - Research questions

3. Methodology
   - Methods used
   - Participant details
   - Timeline

4. Findings
   - Observations
   - Quotes
   - Data

5. Insights
   - Patterns identified
   - Themes

6. Recommendations
   - Prioritized actions
   - Design implications

7. Appendix
   - Interview guides
   - Survey questions
   - Raw data
```

### Presentation Tips

**Do:**
- Lead with key insights
- Use quotes and videos
- Show data visualizations
- Provide actionable recommendations
- Include participant demographics

**Don't:**
- Bury insights in details
- Use jargon
- Present without context
- Forget to prioritize
- Skip recommendations

## Continuous Research

### Building a Research Practice

**Regular activities:**
- Monthly user interviews
- Quarterly usability tests
- Ongoing analytics review
- Feedback collection in product
- Support ticket analysis

**Research repository:**
- Store all research artifacts
- Tag by theme, date, feature
- Make findings searchable
- Share with entire team
- Update as you learn more

### Feedback Loops

**In-app feedback:**
- Feedback widget
- Rating prompts
- Survey links
- Feature requests

**Support channels:**
- Customer support tickets
- Live chat transcripts
- Email feedback
- Phone call notes

**Usage data:**
- Feature adoption rates
- Drop-off points
- Error frequency
- Task completion times

## Ethical Considerations

### Privacy & Consent

- [ ] Get informed consent
- [ ] Explain how data will be used
- [ ] Allow participants to withdraw
- [ ] Anonymize data
- [ ] Secure storage of recordings
- [ ] Delete data when no longer needed

### Inclusive Research

- [ ] Recruit diverse participants
- [ ] Test with assistive technologies
- [ ] Consider varying digital literacy
- [ ] Account for different contexts
- [ ] Test in multiple languages if applicable
- [ ] Include edge cases and power users

### Compensation

- [ ] Compensate participants fairly
- [ ] Value their time
- [ ] Provide compensation upfront
- [ ] Offer flexibility in format (cash, gift card)
