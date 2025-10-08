# Frontend Testing Guide

## Overview

This directory contains all test files for the E-commerce COD Admin Dashboard frontend application.

## Test Structure

```
src/__tests__/
├── components/        # Component tests
├── pages/            # Page/view tests
├── stores/           # State management tests
├── utils/            # Utility function tests
├── setup.ts          # Test environment setup
└── README.md         # This file
```

## Running Tests

### Run all tests
```bash
npm test
```

### Run tests with UI
```bash
npm run test:ui
```

### Run tests with coverage
```bash
npm run test:coverage
```

### Run tests in watch mode
```bash
npm test -- --watch
```

## Writing Tests

### Component Test Example

```typescript
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '../utils/test-utils';
import YourComponent from '../../components/YourComponent';

describe('YourComponent', () => {
  it('renders correctly', () => {
    render(<YourComponent />);
    expect(screen.getByText('Expected Text')).toBeInTheDocument();
  });

  it('handles user interaction', () => {
    render(<YourComponent />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('Updated Text')).toBeInTheDocument();
  });
});
```

### Store Test Example

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { useYourStore } from '../../stores/yourStore';

describe('YourStore', () => {
  beforeEach(() => {
    useYourStore.setState({ /* reset state */ });
  });

  it('updates state correctly', () => {
    const { updateData } = useYourStore.getState();
    updateData({ key: 'value' });

    const state = useYourStore.getState();
    expect(state.data.key).toBe('value');
  });
});
```

## Test Coverage Goals

- Overall coverage: 70%+
- Components: 75%+
- Stores: 85%+
- Pages: 65%+
- Utilities: 80%+

## Best Practices

1. **Use custom render**: Import from test-utils for consistent setup
2. **Test user behavior**: Focus on what users see and do
3. **Avoid implementation details**: Test outcomes, not internals
4. **Mock external dependencies**: API calls, routers, etc.
5. **Use semantic queries**: Prefer getByRole over getByTestId
6. **Test accessibility**: Ensure components are accessible

## Custom Test Utils

### render()
Custom render with router and provider wrapping:
```typescript
import { render } from '../utils/test-utils';

render(<YourComponent />);
```

### Mock Data
Pre-defined mock objects for testing:
```typescript
import { mockUser, mockOrder, mockProduct } from '../utils/test-utils';
```

## Common Testing Scenarios

### Testing Forms
```typescript
it('submits form with valid data', async () => {
  render(<YourForm />);

  await userEvent.type(screen.getByLabelText('Email'), 'test@example.com');
  await userEvent.type(screen.getByLabelText('Password'), 'password123');
  await userEvent.click(screen.getByRole('button', { name: /submit/i }));

  expect(mockSubmit).toHaveBeenCalledWith({
    email: 'test@example.com',
    password: 'password123',
  });
});
```

### Testing Async Operations
```typescript
it('loads and displays data', async () => {
  render(<YourComponent />);

  expect(screen.getByText('Loading...')).toBeInTheDocument();

  await waitFor(() => {
    expect(screen.getByText('Data loaded')).toBeInTheDocument();
  });
});
```

### Testing User Events
```typescript
import userEvent from '@testing-library/user-event';

it('handles click events', async () => {
  const user = userEvent.setup();
  render(<YourComponent />);

  await user.click(screen.getByRole('button'));
  expect(screen.getByText('Clicked')).toBeInTheDocument();
});
```

## Mocking

### Mock API Calls
```typescript
vi.mock('../../services/api.service', () => ({
  apiService: {
    getData: vi.fn(() => Promise.resolve({ data: [] })),
  },
}));
```

### Mock Router
```typescript
vi.mock('react-router-dom', () => ({
  ...vi.importActual('react-router-dom'),
  useNavigate: () => vi.fn(),
  useParams: () => ({ id: '123' }),
}));
```

## Troubleshooting

### Component not rendering
- Check if all required props are provided
- Verify router/provider wrappers
- Look for console errors

### Queries not finding elements
- Use screen.debug() to see rendered output
- Check element accessibility
- Verify timing with waitFor()

### Async tests failing
- Add proper waitFor() wrappers
- Check promise resolution
- Verify mock return values
