# Backend Testing Guide

## Overview

This directory contains all test files for the E-commerce COD Admin Dashboard backend API.

## Test Structure

```
src/__tests__/
├── unit/              # Unit tests for individual functions/controllers
├── integration/       # Integration tests for complete workflows
├── mocks/             # Mock data and utilities
├── setup.ts           # Test environment setup
└── README.md          # This file
```

## Running Tests

### Run all tests
```bash
npm test
```

### Run tests in watch mode
```bash
npm run test:watch
```

### Run tests with coverage
```bash
npm run test:coverage
```

### Run only unit tests
```bash
npm run test:unit
```

### Run only integration tests
```bash
npm run test:integration
```

## Writing Tests

### Unit Test Example

```typescript
import { describe, it, expect, beforeEach } from '@jest/globals';
import { yourFunction } from '../../path/to/function';
import { prismaMock } from '../mocks/prisma.mock';

describe('Your Function', () => {
  beforeEach(() => {
    // Setup before each test
  });

  it('should do something', async () => {
    // Arrange
    prismaMock.model.findUnique.mockResolvedValue({ id: '123' });

    // Act
    const result = await yourFunction();

    // Assert
    expect(result).toBeDefined();
  });
});
```

### Integration Test Example

```typescript
import { describe, it, expect } from '@jest/globals';
import request from 'supertest';
import app from '../../server';

describe('API Endpoint', () => {
  it('should return expected response', async () => {
    const response = await request(app)
      .get('/api/endpoint')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('data');
  });
});
```

## Test Coverage Goals

- Overall coverage: 70%+
- Critical paths: 90%+
- Controllers: 80%+
- Services: 80%+
- Utilities: 70%+

## Best Practices

1. **Isolate tests**: Each test should be independent
2. **Mock external dependencies**: Use mocks for database, APIs, etc.
3. **Clear test names**: Describe what the test does
4. **Arrange-Act-Assert**: Follow AAA pattern
5. **Clean up**: Reset mocks and state between tests
6. **Test edge cases**: Include error scenarios

## Common Mocks

### Prisma Client
```typescript
import { prismaMock } from '../mocks/prisma.mock';

prismaMock.user.findUnique.mockResolvedValue({ id: '123' });
```

### Authentication
```typescript
const mockUser = { id: '123', role: 'admin' };
mockReq.user = mockUser;
```

## Troubleshooting

### Tests timing out
- Increase timeout in jest.config.js
- Check for unresolved promises
- Ensure all async operations complete

### Mocks not working
- Verify mock paths match actual imports
- Clear mocks between tests
- Check mock setup in beforeEach

### Coverage not accurate
- Ensure all source files are included
- Check coverage ignore patterns
- Run coverage with --verbose flag
