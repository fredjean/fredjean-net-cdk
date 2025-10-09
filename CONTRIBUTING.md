# Contributing to fredjean-net-cdk

Thank you for your interest in contributing to this project!

## Development Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/fredjean/fredjean-net-cdk.git
   cd fredjean-net-cdk
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Build the project**
   ```bash
   npm run build
   ```

4. **Run tests**
   ```bash
   npm test
   ```

## Making Changes

1. **Create a branch** for your changes
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes** and ensure they follow the existing code style

3. **Write or update tests** to cover your changes

4. **Build and test** your changes
   ```bash
   npm run build
   npm test
   ```

5. **Verify CDK synthesis** works correctly
   ```bash
   npx cdk synth
   ```

6. **Commit your changes** with a clear message
   ```bash
   git commit -m "Add feature: description of your changes"
   ```

7. **Push to your fork** and create a pull request

## Code Style

- Use TypeScript for all code
- Follow the existing code structure and patterns
- Add JSDoc comments for public APIs
- Ensure all tests pass
- Keep commits atomic and well-described

## Testing

- Write unit tests for all new functionality
- Use the existing test patterns from `test/static-website-stack.test.ts`
- Ensure test coverage doesn't decrease

## Pull Request Process

1. Update the README.md with details of changes if needed
2. Update the EXAMPLES.md if adding new configuration options
3. Ensure all tests pass
4. Request review from maintainers
5. Address any feedback

## Reporting Issues

When reporting issues, please include:
- A clear description of the problem
- Steps to reproduce
- Expected vs actual behavior
- CDK version and environment details
- Error messages or logs

## Questions?

Feel free to open an issue for questions or discussions about the project.
