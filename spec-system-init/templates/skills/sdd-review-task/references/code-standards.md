# Fallback Code Standards

Apply an item ONLY when the project defines nothing about it (CLAUDE.md, CONSTITUTION.md, linter/formatter config, established style of the touched code). A project convention always wins.

## Naming
- **camelCase**: methods, functions, variables
- **PascalCase**: classes, interfaces
- **kebab-case**: files, directories
- Code identifiers in English
- No abbreviations; no names over 30 characters
- Functions start with a verb

## Design
- No magic numbers — use named constants
- Each function performs a single clear action
- Maximum 3 parameters per function (use an object for more)
- A function does mutation OR query, never both
- Maximum 2 nesting levels for conditionals; prefer early returns
- No boolean flag parameters that toggle behavior
- Maximum 50 lines per method, 300 lines per class

## Formatting
- No blank lines within methods/functions
- Avoid comments — code should be self-explanatory
- One variable per line, declared close to its use
