import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Information about component imports
 */
export interface ImportInfo {
    componentPath: string;
    importedFrom: string[];
    importCount: number;
}

/**
 * Dependency graph mapping component paths to files that import them
 */
export interface DependencyGraph {
    [componentPath: string]: string[];
}

/**
 * Options for dependency analysis
 */
export interface AnalyzeOptions {
    excludePatterns?: string[];
    includePatterns?: string[];
}

/**
 * Extracted import information from a file
 */
interface FileImport {
    importPath: string;
    isDynamic: boolean;
    sourceFile: string;
}

/**
 * DependencyAnalyzer class for analyzing React component dependencies
 */
export class DependencyAnalyzer {
    private projectRoot: string;
    private dependencyGraph: DependencyGraph = {};
    private fileImports: Map<string, FileImport[]> = new Map();

    constructor(projectRoot: string) {
        this.projectRoot = projectRoot;
    }

    /**
     * Analyzes imports for given component paths and builds a dependency graph
     * @param componentPaths Array of component file paths to analyze
     * @param projectRoot Root directory of the project
     * @returns DependencyGraph mapping component paths to files that import them
     */
    async analyzeImports(
        componentPaths: string[],
        projectRoot: string
    ): Promise<DependencyGraph> {
        this.projectRoot = projectRoot;
        this.dependencyGraph = {};
        this.fileImports = new Map();

        try {
            // Get all project files
            const allFiles = await this.getAllProjectFiles();

            // Extract imports from all files
            for (const filePath of allFiles) {
                const imports = await this.extractImports(filePath);
                if (imports.length > 0) {
                    this.fileImports.set(filePath, imports);
                }
            }

            // Build dependency graph for each component
            for (const componentPath of componentPaths) {
                const normalizedComponentPath = this.normalizePath(componentPath);
                const importingFiles: string[] = [];

                // Check each file's imports
                for (const [filePath, imports] of this.fileImports.entries()) {
                    for (const importInfo of imports) {
                        const resolvedPath = this.resolveImportPath(
                            importInfo.importPath,
                            filePath
                        );

                        if (this.pathsMatch(resolvedPath, normalizedComponentPath)) {
                            importingFiles.push(filePath);
                        }
                    }
                }

                if (importingFiles.length > 0) {
                    this.dependencyGraph[componentPath] = importingFiles;
                } else {
                    // Initialize with empty array to track unused components
                    this.dependencyGraph[componentPath] = [];
                }
            }

            return this.dependencyGraph;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`Error analyzing imports: ${errorMessage}`);
            console.error('Error analyzing imports:', error);
            return this.dependencyGraph;
        }
    }

    /**
     * Finds unused components (components with zero imports)
     * @param componentPaths Array of component file paths to check
     * @returns Array of unused component paths
     */
    findUnused(componentPaths: string[]): string[] {
        const unused: string[] = [];

        for (const componentPath of componentPaths) {
            const imports = this.dependencyGraph[componentPath];
            
            // Component is unused if it has no imports or empty array
            if (!imports || imports.length === 0) {
                unused.push(componentPath);
            }
        }

        return unused;
    }

    /**
     * Gets ImportInfo for a specific component
     * @param componentPath Path to the component
     * @returns ImportInfo object
     */
    getImportInfo(componentPath: string): ImportInfo {
        const importedFrom = this.dependencyGraph[componentPath] || [];
        
        return {
            componentPath,
            importedFrom,
            importCount: importedFrom.length
        };
    }

    /**
     * Gets all project files (excluding node_modules)
     */
    private async getAllProjectFiles(): Promise<string[]> {
        const files: string[] = [];
        
        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return files;
            }

            for (const workspaceFolder of workspaceFolders) {
                const pattern = new vscode.RelativePattern(
                    workspaceFolder,
                    '**/*.{js,jsx,ts,tsx,mjs,cjs}'
                );

                const foundFiles = await vscode.workspace.findFiles(
                    pattern,
                    '**/node_modules/**',
                    10000
                );

                for (const file of foundFiles) {
                    const filePath = file.fsPath;
                    if (!filePath.includes('node_modules')) {
                        files.push(filePath);
                    }
                }
            }
        } catch (error) {
            console.error('Error getting project files:', error);
        }

        return files;
    }

    /**
     * Extracts all import statements from a file
     * Handles both ES6 and CommonJS imports, static and dynamic
     */
    private async extractImports(filePath: string): Promise<FileImport[]> {
        const imports: FileImport[] = [];

        try {
            const uri = vscode.Uri.file(filePath);
            const document = await vscode.workspace.openTextDocument(uri);
            const content = document.getText();

            // Extract ES6 static imports
            // Matches: import X from 'path', import { X } from 'path', import * as X from 'path'
            const es6StaticRegex = /import\s+(?:(?:\*\s+as\s+\w+)|(?:\{[^}]*\})|(?:\w+)|(?:\w+\s*,\s*\{[^}]*\})|(?:\w+\s*,\s*\*\s+as\s+\w+))\s+from\s+['"]([^'"]+)['"]/g;
            
            let match;
            while ((match = es6StaticRegex.exec(content)) !== null) {
                const importPath = match[1];
                // Skip node_modules and built-in modules
                if (!this.isExternalModule(importPath)) {
                    imports.push({
                        importPath,
                        isDynamic: false,
                        sourceFile: filePath
                    });
                }
            }

            // Extract ES6 dynamic imports
            // Matches: import('path'), import("path"), await import('path')
            const es6DynamicRegex = /(?:await\s+)?import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
            
            while ((match = es6DynamicRegex.exec(content)) !== null) {
                const importPath = match[1];
                if (!this.isExternalModule(importPath)) {
                    imports.push({
                        importPath,
                        isDynamic: true,
                        sourceFile: filePath
                    });
                }
            }

            // Extract CommonJS require statements
            // Matches: require('path'), require("path"), const X = require('path')
            const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
            
            while ((match = requireRegex.exec(content)) !== null) {
                const importPath = match[1];
                if (!this.isExternalModule(importPath)) {
                    imports.push({
                        importPath,
                        isDynamic: false,
                        sourceFile: filePath
                    });
                }
            }

            // Extract CommonJS dynamic require
            // Matches: require.resolve('path')
            const requireResolveRegex = /require\.resolve\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
            
            while ((match = requireResolveRegex.exec(content)) !== null) {
                const importPath = match[1];
                if (!this.isExternalModule(importPath)) {
                    imports.push({
                        importPath,
                        isDynamic: true,
                        sourceFile: filePath
                    });
                }
            }

        } catch (error) {
            console.error(`Error extracting imports from ${filePath}:`, error);
        }

        return imports;
    }

    /**
     * Checks if an import path is an external module (node_modules or built-in)
     */
    private isExternalModule(importPath: string): boolean {
        // External modules start with a package name (no ./ or ../)
        // Or are built-in Node.js modules
        if (importPath.startsWith('.') || importPath.startsWith('/')) {
            return false;
        }

        // Check for scoped packages (@scope/package)
        if (importPath.startsWith('@')) {
            return true;
        }

        // Check for built-in Node.js modules (common ones)
        const builtInModules = [
            'fs', 'path', 'os', 'http', 'https', 'url', 'util', 'crypto',
            'stream', 'events', 'buffer', 'child_process', 'cluster', 'dgram',
            'dns', 'net', 'readline', 'repl', 'tls', 'tty', 'vm', 'zlib',
            'assert', 'console', 'module', 'process', 'querystring', 'string_decoder',
            'timers', 'v8', 'worker_threads'
        ];

        if (builtInModules.includes(importPath.split('/')[0])) {
            return true;
        }

        // If it doesn't start with . or /, it's likely an external package
        return !importPath.includes('./') && !importPath.includes('../');
    }

    /**
     * Resolves a relative import path to an absolute path
     * Handles various path formats and extensions
     */
    private resolveImportPath(importPath: string, sourceFile: string): string {
        // If already absolute, return as is
        if (path.isAbsolute(importPath)) {
            return this.normalizePath(importPath);
        }

        // Get directory of source file
        const sourceDir = path.dirname(sourceFile);

        // Resolve relative path
        let resolvedPath = path.resolve(sourceDir, importPath);
        
        // Try to resolve with common extensions if file doesn't exist
        if (!fs.existsSync(resolvedPath)) {
            const extensions = ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.cjs'];
            
            for (const ext of extensions) {
                const testPath = resolvedPath + ext;
                if (fs.existsSync(testPath)) {
                    resolvedPath = testPath;
                    break;
                }
            }
            
            // If still not found, check if it's a directory with index file
            if (!fs.existsSync(resolvedPath)) {
                try {
                    if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isDirectory()) {
                        const indexFiles = ['index.tsx', 'index.ts', 'index.jsx', 'index.js'];
                        for (const indexFile of indexFiles) {
                            const indexPath = path.join(resolvedPath, indexFile);
                            if (fs.existsSync(indexPath)) {
                                resolvedPath = indexPath;
                                break;
                            }
                        }
                    }
                } catch {
                    // Path doesn't exist or can't be accessed
                }
            }
        } else {
            // Path exists, check if it's a directory with index file
            try {
                if (fs.statSync(resolvedPath).isDirectory()) {
                    const indexFiles = ['index.tsx', 'index.ts', 'index.jsx', 'index.js'];
                    for (const indexFile of indexFiles) {
                        const indexPath = path.join(resolvedPath, indexFile);
                        if (fs.existsSync(indexPath)) {
                            resolvedPath = indexPath;
                            break;
                        }
                    }
                }
            } catch {
                // Not a directory or can't be accessed
            }
        }

        // If still doesn't exist, try without extension (might be a directory)
        if (!fs.existsSync(resolvedPath)) {
            // Check if it's a directory with index file
            try {
                if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isDirectory()) {
                    const indexFiles = ['index.tsx', 'index.ts', 'index.jsx', 'index.js'];
                    for (const indexFile of indexFiles) {
                        const indexPath = path.join(resolvedPath, indexFile);
                        if (fs.existsSync(indexPath)) {
                            resolvedPath = indexPath;
                            break;
                        }
                    }
                }
            } catch {
                // Path doesn't exist, return normalized version anyway
            }
        }

        return this.normalizePath(resolvedPath);
    }

    /**
     * Normalizes a file path for consistent comparison
     */
    private normalizePath(filePath: string): string {
        // Normalize path separators and resolve to absolute
        let normalized = path.normalize(filePath);
        
        // Convert to absolute if relative
        if (!path.isAbsolute(normalized)) {
            normalized = path.resolve(this.projectRoot, normalized);
        }
        
        // Resolve any . or .. segments
        normalized = path.resolve(normalized);
        
        // Convert to forward slashes for consistency (Windows compatibility)
        normalized = normalized.replace(/\\/g, '/');
        
        return normalized;
    }

    /**
     * Checks if two paths match (handles various path formats)
     */
    private pathsMatch(path1: string, path2: string): boolean {
        const normalized1 = this.normalizePath(path1);
        const normalized2 = this.normalizePath(path2);

        // Exact match
        if (normalized1 === normalized2) {
            return true;
        }

        // Check without extensions
        const path1NoExt = normalized1.replace(/\.(tsx?|jsx?|mjs|cjs)$/, '');
        const path2NoExt = normalized2.replace(/\.(tsx?|jsx?|mjs|cjs)$/, '');

        if (path1NoExt === path2NoExt) {
            return true;
        }

        // Check if one path is an index file of the other
        const path1Dir = path.dirname(normalized1);
        const path2Dir = path.dirname(normalized2);
        const path1Base = path.basename(normalized1, path.extname(normalized1));
        const path2Base = path.basename(normalized2, path.extname(normalized2));

        // If one is index and directories match
        if ((path1Base === 'index' && path1Dir === path2NoExt) ||
            (path2Base === 'index' && path2Dir === path1NoExt)) {
            return true;
        }

        // Check if paths point to same file (handle symlinks and case differences)
        try {
            const stat1 = fs.statSync(normalized1);
            const stat2 = fs.statSync(normalized2);
            
            // Compare by inode on Unix systems, or by path on Windows
            if (process.platform !== 'win32' && stat1.ino && stat2.ino) {
                return stat1.ino === stat2.ino;
            }
        } catch {
            // Files don't exist, rely on path comparison
        }

        return false;
    }

    /**
     * Gets the dependency graph
     */
    getDependencyGraph(): DependencyGraph {
        return { ...this.dependencyGraph };
    }

    /**
     * Gets all files that import a specific component
     */
    getImporters(componentPath: string): string[] {
        return this.dependencyGraph[componentPath] || [];
    }

    /**
     * Gets all components imported by a specific file
     */
    getImports(filePath: string): string[] {
        const imports = this.fileImports.get(filePath) || [];
        return imports.map(imp => imp.importPath);
    }
}

