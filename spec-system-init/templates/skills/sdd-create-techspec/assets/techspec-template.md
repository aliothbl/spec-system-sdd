# Technical Specification: [Feature Name]

## Executive Summary

[Give a short technical view of the solution approach. Summarize the main architectural decisions and the implementation strategy in 1-2 paragraphs.]

## System Architecture

### Component Overview

[Short description of the main components and their responsibilities:

- Component names and primary functions **List every new or modified component**
- Main relationships between components
- Data flow overview]

## Implementation Design

### Main Interfaces

[Define the main service interfaces (≤20 lines per example, in the project's main language):

```
// Pseudocode example — use the project's language
interface ServiceName {
    methodName(input: Type): Output
}
```

]

### Data Models

[Define the essential data structures:

- Main domain entities (if applicable)
- Request/response types
- Database schemas (if applicable)]

### API Endpoints

[List API endpoints, if applicable:

- Method and path (e.g. `POST /api/v0/resource`)
- Short description
- Request/response format references]

## Integration Points

[Include only if the feature requires external integrations:

- External services or APIs
- Authentication requirements
- Error-handling approach]

## Testing Approach

### Unit Tests

[Describe the unit test strategy:

- Main components to test
- Mock requirements (external services only)
- Critical test scenarios]

### Integration Tests

[If needed, describe integration tests:

- Components to test together
- Test data requirements]

### E2E Tests

[If needed, describe E2E tests:

- Test the frontend together with the backend **using the project's E2E tool (e.g. Playwright)**]

## Development Sequencing

### Build Order

[Define the implementation sequence:

1. First component/feature (why first)
2. Second component/feature (dependencies)
3. Subsequent components
4. Integration and tests]

### Technical Dependencies

[List any blocking dependencies:

- Required infrastructure
- External service availability]

## Monitoring and Observability

[Define the monitoring approach using the project's EXISTING observability infrastructure (if none exists, propose the minimum viable — do not invent a stack):

- Metrics to expose (in the format of the project's metrics stack)
- Main logs and log levels
- Integration with the dashboards/tools the project already uses]

## Technical Considerations

### Key Decisions

[Document the important technical decisions:

- Chosen approach and rationale
- Trade-offs considered
- Rejected alternatives and why]

### Known Risks

[Identify technical risks:

- Potential challenges
- Mitigation approaches
- Areas needing research]

### Standard Skills Compliance

[Check the applicable skills — the project's `.claude/skills/` folder and relevant user-level skills (e.g. `frontend-design` for UI features, if installed) — and list them below:]

### Relevant and Dependent Files

[List relevant and dependent files here]
