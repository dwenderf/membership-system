# Tournament System - Board Presentation
## Chelsea Challenge 2025 & Beyond

**Presented to:** NYCPHA Board of Directors
**Date:** January 2026
**Purpose:** Approval to integrate tournament registration into membership system

---

## The Opportunity

The NYCPHA hosts the **Chelsea Challenge** annually on Memorial Day Weekend - our signature tournament featuring 3-4 divisions with up to 60 participants.

**Current Challenge:**
Tournament registration is currently handled manually or through external systems, which means:
- Participants create separate accounts on different platforms
- Payment and accounting must be reconciled manually
- We can't easily see which participants are existing members
- Limited data collection for team assignments
- No integration with our member dashboard

**The Proposal:**
Integrate tournament registration directly into our existing membership system, creating a seamless experience for participants and powerful tools for admins.

---

## What Participants Will Experience

### Finding the Tournament

Participants visit our website and see a new "Tournaments" section:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
         NYCPHA - Upcoming Tournaments
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  🏆 Chelsea Challenge 2025
      Memorial Day Weekend • May 24-26, 2025

      4 Divisions: B, C1, C2, D
      $150 Early Bird Registration (until April 1)

      [View Details]  [Register Now]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Registration Process

**Step 1: Membership Check**
Before registering, the system ensures they have a qualifying membership.

For **existing NYCPHA members**: ✅ Already have what they need
For **non-members**: Choose between:
- Standard Adult Membership ($400/year) - Full benefits
- Chelsea Challenge 2025 Membership (FREE) - Tournament only

*This ensures everyone has agreed to our code of conduct and we have insurance coverage.*

**Step 2: Registration Type**
Participants choose how they're registering:
- **Drop-in:** "I need to be assigned to a team"
- **Team:** "An admin will assign me to a specific team"

**Step 3: Division Preference** (for drop-in)
Select preferred skill level: B, C1, C2, or D

**Step 4: Participant Questionnaire**
We collect information needed for team assignments:
- Hockey experience (text description)
- Previous teams played on
- Location / Country (some come from outside USA)
- Pronouns
- Jersey size (S, M, L, XL, XXL, Goalie)
- Positions played (LW, RW, C, D, G) - can select multiple

**Step 5: Payment**
Secure payment via Stripe (same system we use for memberships)
- Price automatically adjusts based on early bird / regular / late pricing
- Immediate confirmation email

**Step 6: Dashboard**
After registration, participants see their tournament in their member dashboard:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
         My Upcoming Events
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  🏒 Spring Scrimmage - March 15
      Event Registration

  🏆 Chelsea Challenge 2025 - May 24-26
      Tournament Registration
      Status: Registered (awaiting team assignment)
      Division Preference: C1

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### After Team Assignment

Once admins assign participants to teams, they receive an email notification and see their team in the dashboard:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
         My Teams
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  NYCPHA Recreational League
  🟢 Team | Full-Time Skater
  Fall/Winter 2025

  Chelsea Challenge - Blue Devils
  🏆 Tournament Team | C1 Division
  Memorial Day Weekend 2025
  Positions: LW, C | Jersey #12

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## What Admins Will Experience

### Creating a Tournament

Admins create tournaments through our existing admin panel:

**New Section: Admin → Tournaments**

**Create Tournament Form:**
- Tournament name and description
- Start/end dates
- Registration window (when registration opens/closes)
- Maximum participants (optional capacity limit)
- Base price

**Pricing Tiers** (optional):
- Early Bird: $150 (March 1 - April 1)
- Regular: $175 (April 2 - May 1)
- Late: $200 (May 2 - May 15)

*System automatically applies the correct price based on registration date*

**Divisions:**
- Add divisions (B, C1, C2, D)
- Set max teams per division (e.g., 6 teams)

**Membership Requirements:**
Select which memberships qualify (can be multiple):
- ☑ Standard Adult Membership
- ☑ Chelsea Challenge 2025 Membership
- ☐ LGBTQ+ Membership

**Privacy Settings:**
- Set data retention date (e.g., 90 days after tournament)
- System auto-deletes participant info after this date

**Status:**
- Draft (hidden from public - work in progress)
- Active (visible and accepting registrations)

### Managing Registrations

**Tournament Dashboard** shows real-time stats:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Chelsea Challenge 2025                🟢 Active
  Memorial Day Weekend • May 24-26, 2025
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Quick Stats
  ────────────────────────────────────────────
  45 Total Registrations
  ├─ 42 Paid ($6,300)
  ├─ 2 Pending
  └─ 1 Failed

  12 On Waitlist

  4 Divisions
  16 Teams Created
  38 Participants Assigned to Teams
  7 Awaiting Team Assignment

  Current Price: $175 (Regular)
  Next Tier: Late ($200) on May 2

  [View Registrations]  [Manage Teams]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Registration List

View all registrations with search and filters:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Tournament Registrations

  Filters: [All] [Paid] [Pending] [Drop-in] [Team]
  Search: [___________________________] 🔍

  Export: [CSV] [Excel]

┌────────────────────────────────────────────┐
│ Name         Type    Division Status  Team │
├────────────────────────────────────────────┤
│ John Smith   Drop-in C1      ✓ Paid  Blue │
│ Jane Doe     Drop-in C2      ⏳ Pend  -    │
│ Alex Taylor  Team    B       ✓ Paid  Red   │
└────────────────────────────────────────────┘
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Click on any registration** to see full details:
- Contact info (email, phone)
- Hockey experience and previous teams
- Location, pronouns, jersey size
- Preferred positions
- Payment status and amount
- Team assignment (if assigned)

**Export to CSV/Excel** for offline work:
- All participant data in spreadsheet format
- Filter before export (e.g., only C1 division)
- Useful for printing roster sheets

### Creating Teams & Assigning Participants

**Step 1: Create Teams**

Admins create teams within divisions:

```
Division: C1 - Intermediate Competitive
Max Teams: 6 | Current: 4 teams

┌ Blue Devils (10 players) ─────────────┐
│ [Manage Roster] [Edit Team]           │
└────────────────────────────────────────┘

┌ Red Wings (12 players) ────────────────┐
│ [Manage Roster] [Edit Team]           │
└────────────────────────────────────────┘

[+ Add Team to C1 Division]
```

**Step 2: Assign Participants**

Click "Manage Roster" to see team assignment interface:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Blue Devils - C1 Division

  Team Roster (10 players)
  ────────────────────────────────────────────
  #  Name         Positions   Jersey Size
  12 John Smith   LW, C       L           [X]
  7  Jane Doe     RW, D       M           [X]
  ...

  Unassigned Participants (7)
  ────────────────────────────────────────────
  Filter: [C1 Division Preference ▼]

  Name          Positions    Jersey Size
  Alex Taylor   LW, RW       XL       [+ Add]
  Chris Lee     C, D         L        [+ Add]
  ...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**When admin clicks [+ Add]:**
- Participant is assigned to team
- Participant receives email: "You've been assigned to Blue Devils (C1)!"
- Participant sees team in their dashboard
- Admin can assign jersey number and confirm positions

### Waitlist Management

When tournament reaches capacity:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Waitlist (12 people)

  Pos  Name           Division  Email
  ───  ────────────── ────────  ────────────
  1    Sarah Johnson  C1        sarah@...  [Admit]
  2    Mike Chen      C2        mike@...   [Admit]
  3    Lisa Park      D         lisa@...   [Admit]
  ...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Click [Admit]:**
- System generates special bypass code
- Sends email to participant: "A spot opened up!"
- Participant can complete registration within 48 hours

---

## Key Benefits

### For Participants

✅ **One Account** - Same login for memberships, teams, and tournaments
✅ **Easy Registration** - Guided process with clear steps
✅ **Secure Payment** - Same trusted Stripe system
✅ **Unified Dashboard** - See all activities in one place
✅ **Email Notifications** - Confirmation, team assignments, updates
✅ **Privacy Protection** - Data automatically deleted after tournament

### For Admins

✅ **Centralized Management** - Everything in one admin panel
✅ **Automatic Accounting** - Syncs with Xero like memberships do
✅ **Smart Team Assignment** - See participant details before assigning
✅ **Real-time Stats** - Know exactly where you stand (registrations, revenue, capacity)
✅ **Flexible Pricing** - Early bird / regular / late pricing automatic
✅ **Waitlist System** - Handle capacity professionally
✅ **Export Tools** - CSV/Excel for offline work
✅ **No Reconciliation** - Payments flow directly into accounting

### For NYCPHA

✅ **Member Engagement** - Non-members become members through tournaments
✅ **Data Insights** - Understand participant demographics and preferences
✅ **Professional Experience** - Polished registration process
✅ **Cost Savings** - No external tournament platform fees
✅ **Brand Consistency** - All NYCPHA activities in one place
✅ **Scalability** - Can handle multiple tournaments per year
✅ **Insurance Compliance** - Everyone has a membership (required for coverage)

---

## What We Need from the Board

### Decision #1: Membership Qualification ⚠️ REQUIRED

**Question:** How should we handle membership requirements for tournaments?

**Context:** Tournaments need membership for insurance/liability, but we want to make it easy for non-members to participate.

**Options:**

**A) Free Tournament Membership (Simplest)**
- Create "Chelsea Challenge 2025" membership (free)
- Existing members get it automatically
- Non-members can get it during registration
- Simple to implement, easy to understand

**B) Multiple Qualifying Memberships (Flexible)**
- Admin selects which memberships qualify (checkbox list)
- Example: Standard Adult OR Chelsea Challenge 2025
- More complex, but reusable for other events
- Could be applied system-wide later

**C) Hybrid**
- Use option B for tournaments only
- Keep single membership requirement for regular teams/events

**Board Decision Needed:** Which option do you prefer?

---

### Decision #2: Refund Policy

**Question:** What should our refund policy be for tournament registrations?

**Context:**
- Early bird pricing means someone might pay $150 now, but current price is $175
- Need clear policy for cancellations

**Considerations:**
- **Early cancellations** (e.g., 30+ days before): Full refund?
- **Late cancellations** (e.g., <14 days before): Partial or no refund?
- **No-shows**: No refund?

**Board Decision Needed:** Define refund policy for tournaments

---

### Decision #3: Data Retention

**Question:** How long should we keep participant information after tournaments?

**Proposal:** 90 days after tournament ends

**What gets deleted:**
- Hockey experience descriptions
- Previous teams
- Pronouns, jersey size, positions
- Location/country

**What's preserved:**
- Basic user account (name, email)
- Payment records (for accounting)
- Team assignment (historical record)

**Board Decision Needed:** Approve 90-day retention policy?

---

### Decision #4: Waitlist Management

**Question:** Should waitlist admissions be automatic or manual?

**Options:**

**A) Manual (Recommended)**
- Admin sees waitlist, clicks "Admit" when ready
- Gives control over timing
- Can coordinate with pricing tiers

**B) Automatic**
- When someone refunds, next person auto-admitted
- Faster but less control
- Could admit at inconvenient times

**Board Decision Needed:** Manual or automatic?

---

### Decision #5: Implementation Priority

**Question:** Should we prioritize this for Chelsea Challenge 2025 (Memorial Day)?

**Timeline Consideration:**
- Memorial Day Weekend 2025 is approximately 4 months away
- Registration typically opens 2-3 months before event
- Need time for internal testing before public launch

**Board Decision Needed:**
- Is Chelsea Challenge 2025 the target?
- Or test with a smaller tournament first?

---

## What Happens Next

### If Board Approves

**Immediate Next Steps:**
1. Resolve the 5 decisions above
2. Begin development (Phase 1 - Core System)
3. Create test tournament in staging environment
4. Internal testing with board members

**Phase 1 (MVP):**
- Public tournament pages and registration
- Payment processing (Stripe)
- Accounting sync (Xero)
- Admin tournament management
- Email confirmations
- Dashboard integration

**Phase 2:**
- Team assignment interface
- Position and jersey number tracking
- Team assignment notifications

**Phase 3:**
- Waitlist automation
- Capacity management

**Timeline:** No specific dates - Board prioritizes based on Chelsea Challenge deadline

### Testing Plan

Before public launch:
1. **Internal testing** - Board members test registration flow
2. **Pilot tournament** - Small event to validate system
3. **Feedback loop** - Incorporate learnings
4. **Public launch** - Open Chelsea Challenge registration

---

## Additional Opportunities

### Beyond Chelsea Challenge

Once the system is built, we can use it for:

**Other NYCPHA-Hosted Tournaments**
- Fall tournaments
- Specialty events
- Multi-day clinics

**External Tournaments**
- Track NYCPHA members attending external tournaments
- Group registrations for away events
- Simplified version (no team assignments)

**Future Enhancements** (not in initial build):
- Tournament brackets and scheduling
- Team messaging
- Mobile app integration
- Merchandise add-ons (t-shirts, etc.)
- Post-tournament surveys and feedback

---

## Questions & Discussion

### Common Questions

**Q: Can we still use external platforms if needed?**
A: Yes, this doesn't prevent using other systems, but offers an integrated alternative.

**Q: What if someone doesn't want to create an account?**
A: Account creation is required for insurance/liability (need membership) and payment processing. Process is streamlined - takes 2 minutes.

**Q: Can we customize the questionnaire per tournament?**
A: Yes! The participant questionnaire is flexible and can be customized for each tournament.

**Q: What about international participants?**
A: System supports international addresses and phone numbers. Country selection is included in the questionnaire.

**Q: How do we handle team deposits or group payments?**
A: Initial version is individual registration only. Group payments could be a future enhancement.

**Q: What if we want to change pricing after some people registered?**
A: People who already registered keep the price they paid (locked at time of payment). New registrations pay the new price.

**Q: Can participants update their information after registering?**
A: Yes, they can contact admins or we can add a "edit registration" feature.

---

## Recommendation

**We recommend moving forward with this integrated tournament system because:**

1. **Member Experience** - Creates a seamless experience for participants across all NYCPHA activities

2. **Operational Efficiency** - Eliminates manual reconciliation and data entry for tournament registrations

3. **Cost Effective** - Leverages existing infrastructure (payment, accounting, email) we've already built and paid for

4. **Professional** - Presents a polished, cohesive brand experience

5. **Scalable** - Can support multiple tournaments per year without additional platform costs

6. **Data-Driven** - Provides insights into participant demographics and preferences

**The system is designed to:**
- ✅ Support Chelsea Challenge 2025
- ✅ Scale to future tournaments
- ✅ Integrate seamlessly with existing membership system
- ✅ Require minimal training for admins (familiar interface)
- ✅ Protect participant privacy (auto-delete data)

---

## Appendix: Technical Details

For board members interested in technical specifics, a comprehensive 2,000+ line technical planning document is available at:

`/docs/features/planning/tournament-system.md`

This includes:
- Complete database design
- API specifications
- Security & privacy architecture
- Integration details
- Testing plans
- Implementation phases

---

## Board Vote

**Motion:** Approve development of integrated tournament registration system for Chelsea Challenge 2025

**Requires Board Decision On:**
1. Membership qualification approach (A, B, or C)
2. Refund policy
3. Data retention timeline (90 days recommended)
4. Waitlist management (manual recommended)
5. Implementation priority (Chelsea Challenge 2025 target)

---

**Presented by:** David Wender, NYCPHA
**Date:** January 2026
**Status:** Awaiting Board Approval

**Questions?** Contact: [your-email@nycpha.org]
