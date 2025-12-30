# Component Pruner

**Scan, detect and safely remove unused React components from your codebase.**

Keep your React projects clean and maintainable by identifying and removing components that are no longer in use. Reduce bundle size, improve build times, and maintain a cleaner codebase.

## Features

### Intelligent Component Detection
- Automatically scans your entire React/TypeScript project
- Detects all React components (functional, class-based, arrow functions)
- Supports `.js`, `.jsx`, `.ts`, and `.tsx` files

### Dependency Analysis
- Builds a complete dependency graph of your project
- Tracks both static and dynamic imports
- Handles ES6 imports, CommonJS require, and dynamic `import()`

### Safety-First Approach
- Pre-deletion safety checks to prevent accidental removal
- Identifies components exported from index files
- Shows which files import each component
- Warns about test file dependencies

### Fast & Optimized
- Parallel file processing for quick scans
- Smart caching to avoid redundant operations
- Handles large codebases efficiently (10,000+ files)

### Easy to Use
- One-click scanning from status bar
- Clean UI showing all unused components
- Direct file navigation with single click
- Safe deletion with confirmation

## Installation

1. Install from [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=amitkrg124.unused-component-detector)
2. Reload VS Code

## Usage

### Method 1: Status Bar
Click the **"Scan Unused Components"** button in the bottom status bar.

### Method 2: Command Palette
1. Open Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
2. Type **"Find Unused Components"**
3. Press Enter

### Viewing Results
- Green badge = Safe to delete
- Red badge = Has dependencies (review before deleting)
- Click any component to open its file
- Click "Delete" to safely remove the component

## Requirements

- VS Code 1.80.0 or higher
- React/TypeScript project

## Extension Settings

This extension works out of the box with no configuration needed.

## Supported File Types

- JavaScript (`.js`)
- JSX (`.jsx`)
- TypeScript (`.ts`)
- TypeScript JSX (`.tsx`)

## How It Works

1. **Scan Phase**: Finds all React components in your workspace
2. **Analysis Phase**: Builds import/export dependency graph
3. **Detection Phase**: Identifies components with zero imports
4. **Safety Phase**: Validates each component is safe to delete
5. **Display Phase**: Shows results in an interactive panel

## Contributing

Contributions are welcome! This project is **open for contribution**.

### How to Contribute

1. **Fork** the repository
2. **Clone** your fork locally
3. Create a new **branch** for your feature/fix
4. Make your changes
5. **Test** your changes locally
6. Submit a **Pull Request**

### Development Setup

```bash
# Clone the repository
git clone https://github.com/amitkrg124/unused-component-detector.git

# Install dependencies
npm install

# Compile TypeScript
npm run build

# Run in development mode
npm run watch

# Press F5 in VS Code to launch Extension Development Host
```

### Contribution Ideas

- Add support for Vue/Angular components
- Improve detection algorithms
- Add more safety checks
- Enhance UI/UX
- Add unit tests
- Improve documentation
- Bug fixes and performance improvements

## Known Issues

- May not detect components used only via string interpolation
- Dynamic imports with variable paths are not tracked

## Release Notes

### 1.0.3
- Major performance optimization (5-10x faster)
- Parallel file processing
- Smart caching system
- Reduced memory usage

### 1.0.2
- Added icon support
- Fixed activation events

### 1.0.1
- Initial marketplace release
- Basic scanning functionality

## License

MIT

## Author

**Amit Kumar** ([@amitkrg124](https://github.com/amitkrg124))

---

**Enjoy cleaning up your React projects!**

If you find this extension helpful, please consider:
- Giving it a star on [GitHub](https://github.com/amitkrg124/unused-component-detector)
- Rating it on the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=amitkrg124.unused-component-detector)
- Sharing it with your team
