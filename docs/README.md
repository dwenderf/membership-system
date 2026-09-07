# Documentation Index

Welcome to the membership system documentation. This directory contains technical documentation and guides for the project.

## 📚 Documentation Structure

### 🏗️ [Architecture](./architecture/)
System-wide technical documentation:
- **[Database](./architecture/database.md)** - Database schema, tables, and relationships
- **[Email Architecture](./architecture/email-architecture.md)** - Email system design and integration

### 📖 [Guides](./guides/)
Setup and operational documentation:
- **[Development](./guides/development.md)** - Local development setup and workflows
- **[Coding Standards](./guides/coding-standards.md)** - Conventions for code in this repo

### 🧪 [Testing](./testing/)
Testing guides for specific subsystems, e.g. **[Payment Plans](./testing/payment-plans-testing-guide.md)**.

### 🔧 [Troubleshooting](./troubleshooting/)
Write-ups of past incidents and their resolutions.

### 📋 [PLANNING.md](./PLANNING.md)
Main project planning document containing:
- Project overview and requirements
- Tech stack and data models
- Implementation status and roadmap
- Future enhancements and priorities

## 🎯 Feature Work and Issue Tracking

**Feature specs, bug reports, and planning live in [GitHub Issues](https://github.com/dwenderf/membership-system/issues), not in this directory.**

Open an issue to propose a feature, report a bug, or track work in progress. Design discussion belongs in the issue thread and its linked pull requests, so that tracking, review, and history stay in one place.

This directory is for durable reference documentation — architecture, setup guides, standards, and troubleshooting — that outlives any single change.

> The former `docs/features/` tree (`planning/`, `completed/`, `deferred/`) was removed in favor of GitHub Issues. Its contents remain in git history if you need them.

## 🤝 Contributing to Documentation

### Documentation Standards
- Use clear, descriptive headings
- Include code examples where relevant
- Add diagrams for complex flows
- Keep documents up to date as code changes

### File Naming
- Use lowercase with hyphens: `feature-name.md`
- Be descriptive but concise
- Match the feature name used in code and PRs
