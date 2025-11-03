# Contributing to E-Commerce COD Admin

Thank you for your interest in contributing! This document provides guidelines for contributing to the project.

## Code of Conduct

### Our Pledge

We pledge to make participation in our project a harassment-free experience for everyone, regardless of age, body size, disability, ethnicity, gender identity and expression, level of experience, nationality, personal appearance, race, religion, or sexual identity and orientation.

### Our Standards

**Positive Behavior:**
- Using welcoming and inclusive language
- Being respectful of differing viewpoints
- Gracefully accepting constructive criticism
- Focusing on what is best for the community

**Unacceptable Behavior:**
- Trolling, insulting/derogatory comments, and personal attacks
- Public or private harassment
- Publishing others' private information without permission
- Other conduct which could reasonably be considered inappropriate

## How to Contribute

### Reporting Bugs

**Before Submitting:**
- Check if the bug has already been reported
- Use the latest version of the code
- Verify the bug is reproducible

**Bug Report Should Include:**
- Clear, descriptive title
- Steps to reproduce
- Expected vs. actual behavior
- Screenshots (if applicable)
- Environment details (OS, Node version, browser)
- Error messages and stack traces

### Suggesting Features

**Feature Request Should Include:**
- Clear description of the feature
- Use cases and benefits
- Possible implementation approach
- Mock-ups or examples (if applicable)

### Pull Requests

**Process:**

1. **Fork the Repository**
   ```bash
   git clone https://github.com/yourusername/ecommerce-cod-admin.git
   cd ecommerce-cod-admin
   ```

2. **Create a Branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

3. **Make Changes**
   - Follow coding standards
   - Write tests
   - Update documentation

4. **Commit Changes**
   ```bash
   git add .
   git commit -m "Add feature: your feature description"
   ```

5. **Push to Fork**
   ```bash
   git push origin feature/your-feature-name
   ```

6. **Open Pull Request**
   - Provide clear description
   - Reference related issues
   - Include screenshots/examples

## Development Guidelines

### Code Style

**TypeScript:**
- Use TypeScript for all new code
- Define interfaces for data structures
- Use type annotations
- Avoid `any` type when possible

**Naming Conventions:**
- Variables/Functions: camelCase
- Classes/Types: PascalCase
- Constants: UPPER_SNAKE_CASE
- Files: kebab-case

**Example:**
```typescript
// Good
interface UserData {
  id: string;
  email: string;
}

const getUserById = async (userId: string): Promise<UserData> => {
  // implementation
};

// Avoid
const get_user = (id) => {
  // implementation
};
```

### Testing

**Required:**
- Write tests for new features
- Maintain test coverage >80%
- All tests must pass before PR

**Example Test:**
```typescript
describe('OrderService', () => {
  it('should create order successfully', async () => {
    const order = await orderService.create(mockData);
    expect(order).toBeDefined();
    expect(order.status).toBe('PENDING');
  });
});
```

### Documentation

**Required:**
- JSDoc comments for public functions
- Update README if needed
- Add examples for new features
- Update API documentation

**Example:**
```typescript
/**
 * Creates a new order in the system
 * @param data - Order creation data
 * @returns Created order with generated ID
 * @throws {ValidationError} If data is invalid
 */
async function createOrder(data: CreateOrderDto): Promise<Order> {
  // implementation
}
```

### Commit Messages

**Format:**
```
type(scope): subject

body

footer
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

**Examples:**
```
feat(orders): add bulk status update functionality

Allows users to update multiple orders at once via Kanban board.
Includes validation and error handling.

Closes #123
```

```
fix(auth): resolve token expiration issue

Token was not refreshing correctly after expiration.
Now implements proper refresh logic.

Fixes #456
```

## Project Structure

```
ecommerce-cod-admin/
├── backend/           # Backend API
├── frontend/          # React frontend
├── docs/             # Documentation
├── tests/            # E2E tests
└── scripts/          # Utility scripts
```

## Review Process

### What We Look For

1. **Code Quality**
   - Follows style guide
   - Well-structured and readable
   - Proper error handling

2. **Tests**
   - Adequate test coverage
   - Tests are passing
   - Edge cases covered

3. **Documentation**
   - Code is documented
   - README updated if needed
   - API docs updated

4. **Performance**
   - No performance regressions
   - Efficient algorithms
   - Proper database queries

### Review Timeline

- Initial review within 3-5 business days
- Follow-up reviews within 1-2 business days
- Merge after approval from 2 maintainers

## Getting Help

- **Documentation**: Check existing docs
- **Issues**: Search existing issues
- **Discussions**: Use GitHub Discussions
- **Email**: dev@example.com

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

Thank you for contributing to E-Commerce COD Admin!

**Last Updated:** 2025-10-08
