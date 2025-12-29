# Unused React Component Detector

A VS Code extension that helps you find and safely delete unused React components in your project.

## Features

- 🔍 **Smart Component Detection**: Automatically identifies React components by analyzing JSX syntax and React imports
- 📊 **Dependency Analysis**: Builds a complete dependency graph to track component usage
- ⚠️ **Safety Checks**: Verifies component safety before deletion, checking for:
  - Direct imports from other files
  - Indirect references (string mentions, comments)
  - Test file dependencies
  - Index file exports
  - Configuration file references
- 🎨 **Beautiful UI**: Clean, modern webview interface with VS Code theme integration
- 📈 **Statistics**: View summary stats including total unused components, safe/unsafe counts, and total size

## Usage

1. Open your React project in VS Code
2. Click the "Scan Unused Components" button in the status bar, or use the command palette:
   - Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac)
   - Type "Find Unused Components"
   - Select the command
3. Review the results in the webview panel
4. Delete components safely with one click (with confirmation)

## Commands

- `unused-component-detector.scan` - Scan for unused components
- `unused-component-detector.delete` - Delete a component (with safety check)

## Requirements

- VS Code 1.74.0 or higher
- A React project with TypeScript or JavaScript files

## Installation

1. Clone this repository
2. Run `npm install` to install dependencies
3. Run `npm run build` to compile TypeScript
4. Press `F5` to open a new VS Code window with the extension loaded

## Development

```bash
# Install dependencies
npm install

# Build the extension
npm run build

# Watch mode for development
npm run watch

# Package the extension
npm run package
```

## Project Structure

```
unused-component-detector/
├── src/
│   ├── extension.ts         # Main entry point
│   ├── scanner.ts           # Find components
│   ├── analyzer.ts          # Analyze dependencies
│   ├── safety.ts            # Check safety
│   └── ui.ts                # Webview UI
├── out/                     # Compiled output (auto-generated)
├── package.json             # Extension manifest
├── tsconfig.json            # TypeScript config
└── README.md                # This file
```

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

