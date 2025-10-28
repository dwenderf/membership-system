# Documentation Index

Welcome to the membership system documentation. This directory contains all technical documentation, feature specifications, and guides for the project.

## 📚 Documentation Structure

### 🎯 [Features](./features/)
Feature-related documentation organized by status:
- **[Completed](./features/completed/)** - Implemented features with PR references
- **[Planning](./features/planning/)** - Features being designed or next in pipeline
- **[Deferred](./features/deferred/)** - Features on hold or postponed

[View Features Documentation →](./features/README.md)

### 🏗️ [Architecture](./architecture/)
System-wide technical documentation:
- **[Database](./architecture/database.md)** - Database schema, tables, and relationships
- **[Email Architecture](./architecture/email-architecture.md)** - Email system design and integration

### 📖 [Guides](./guides/)
Setup and operational documentation:
- **[Development](./guides/development.md)** - Local development setup and workflows

### 📋 [PLANNING.md](./PLANNING.md)
Main project planning document containing:
- Project overview and requirements
- Tech stack and data models
- Implementation status and roadmap
- Future enhancements and priorities

## 🔍 Quick Links

### Recently Completed Features
- [Accounting Code Autocomplete](./features/completed/accounting-code-autocomplete.md) - PR #9 (Oct 27, 2025)
- [Timezone Configuration](./features/completed/timezone-configuration.md) - PR #8 (Oct 27, 2025)
- [Waitlist Management](./features/completed/waitlist-feature.md) - PR #5 (Oct 15, 2025)

### Active Planning
- [Payment Refactor Proposal](./features/planning/payment-refactor-proposal.md)
- [Payment Submission Tracking](./features/planning/payment-submission-tracking-enhancement.md)

## 🤝 Contributing to Documentation

### Adding New Features
1. Create planning document in `features/planning/`
2. When implemented, move to `features/completed/` and add:
   - Status header with PR number and date
   - Implementation details

### Documentation Standards
- Use clear, descriptive headings
- Include code examples where relevant
- Add diagrams for complex flows
- Keep documents up to date as code changes

### File Naming
- Use lowercase with hyphens: `feature-name.md`
- Be descriptive but concise
- Match feature name used in code/PRs

## 📝 Document Templates

See [Features README](./features/README.md) for templates for:
- Planning documents
- Completed feature documentation
- Deferred feature documentation
