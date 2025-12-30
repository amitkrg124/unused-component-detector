import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { getCachedContent } from './scanner';

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
 * Optimized with caching and parallel processing
 */
export class DependencyAnalyzer {
    private projectRoot: string;
    private dependencyGraph: DependencyGraph = {};
    private fileImports: Map<string, FileImport[]> = new Map();
    private allProjectFiles: string[] = [];

    constructor(projectRoot: string) {
        this.projectRoot = projectRoot;
    }

    /**
     * Analyzes imports for given component paths and builds a dependency graph
     * Optimized with parallel file reading and caching
     */
    async analyzeImports(
        componentPaths: string[],
        projectRoot: string
    ): Promise<DependencyGraph> {
        this.projectRoot = projectRoot;
        this.dependencyGraph = {};
        this.fileImports = new Map();

        try {
            // Get all project files (single call)
            this.allProjectFiles = await this.getAllProjectFiles();

            // Extract imports from all files in parallel batches
            await this.extractAllImportsParallel();

            // Build dependency graph for each component
            const normalizedComponentPaths = new Map<string, string>();
            for (const componentPath of componentPaths) {
                normalizedComponentPaths.set(
                    this.normalizePath(componentPath),
                    componentPath
                );
            }

            // Process all file imports once
            for (const [filePath, imports] of this.fileImports.entries()) {
                for (const importInfo of imports) {
                    const resolvedPath = this.resolveImportPath(
                        importInfo.importPath,
                        filePath
                    );

                    // Check if this import matches any component
                    for (const [normalizedPath, originalPath] of normalizedComponentPaths) {
                        if (this.pathsMatch(resolvedPath, normalizedPath)) {
                            if (!this.dependencyGraph[originalPath]) {
                                this.dependencyGraph[originalPath] = [];
                            }
                            if (!this.dependencyGraph[originalPath].includes(filePath)) {
                                this.dependencyGraph[originalPath].push(filePath);
                            }
                        }
                    }
                }
            }

            // Initialize empty arrays for components with no imports
            for (const componentPath of componentPaths) {
                if (!this.dependencyGraph[componentPath]) {
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
     * Extract imports from all files in parallel
     */
    private async extractAllImportsParallel(): Promise<void> {
        const batchSize = 100;

        for (let i = 0; i < this.allProjectFiles.length; i += batchSize) {
            const batch = this.allProjectFiles.slice(i, i + batchSize);

            await Promise.all(
                batch.map(async (filePath) => {
                    const imports = await this.extractImportsFast(filePath);
                    if (imports.length > 0) {
                        this.fileImports.set(filePath, imports);
                    }
                })
            );
        }
    }

    /**
     * Fast import extraction using cached content
     */
    private async extractImportsFast(filePath: string): Promise<FileImport[]> {
        const imports: FileImport[] = [];

        try {
            const content = await getCachedContent(filePath);
            if (!content) return imports;

            // Combined regex for better performance
            // ES6 static imports
            const es6Regex = /import\s+(?:(?:\*\s+as\s+\w+)|(?:\{[^}]*\})|(?:\w+)|(?:\w+\s*,\s*\{[^}]*\}))\s+from\s+['"]([^'"]+)['"]/g;

            let match;
            while ((match = es6Regex.exec(content)) !== null) {
                const importPath = match[1];
                if (this.isLocalModule(importPath)) {
                    imports.push({ importPath, isDynamic: false, sourceFile: filePath });
                }
            }

            // Dynamic imports
            const dynamicRegex = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
            while ((match = dynamicRegex.exec(content)) !== null) {
                const importPath = match[1];
                if (this.isLocalModule(importPath)) {
                    imports.push({ importPath, isDynamic: true, sourceFile: filePath });
                }
            }

            // CommonJS require
            const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
            while ((match = requireRegex.exec(content)) !== null) {
                const importPath = match[1];
                if (this.isLocalModule(importPath)) {
                    imports.push({ importPath, isDynamic: false, sourceFile: filePath });
                }
            }
        } catch (error) {
            // Silently ignore errors for individual files
        }

        return imports;
    }

    /**
     * Check if import is a local module (not external)
     */
    private isLocalModule(importPath: string): boolean {
        return importPath.startsWith('.') || importPath.startsWith('/');
    }

    /**
     * Finds unused components (components with zero imports)
     */
    findUnused(componentPaths: string[]): string[] {
        const unused: string[] = [];

        for (const componentPath of componentPaths) {
            const imports = this.dependencyGraph[componentPath];
            if (!imports || imports.length === 0) {
                unused.push(componentPath);
            }
        }

        return unused;
    }

    /**
     * Gets ImportInfo for a specific component
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
     * Gets all project files (single optimized call)
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
                    '**/*.{js,jsx,ts,tsx}'
                );

                const foundFiles = await vscode.workspace.findFiles(
                    pattern,
                    '**/node_modules/**',
                    10000
                );

                for (const file of foundFiles) {
                    files.push(file.fsPath);
                }
            }
        } catch (error) {
            console.error('Error getting project files:', error);
        }

        return files;
    }

    /**
     * Resolves a relative import path to an absolute path
     * Optimized with fewer fs.existsSync calls
     */
    private resolveImportPath(importPath: string, sourceFile: string): string {
        if (path.isAbsolute(importPath)) {
            return this.normalizePath(importPath);
        }

        const sourceDir = path.dirname(sourceFile);
        let resolvedPath = path.resolve(sourceDir, importPath);

        // Quick check if exact path exists
        if (fs.existsSync(resolvedPath)) {
            // Check if it's a directory
            try {
                if (fs.statSync(resolvedPath).isDirectory()) {
                    const indexFiles = ['index.tsx', 'index.ts', 'index.jsx', 'index.js'];
                    for (const indexFile of indexFiles) {
                        const indexPath = path.join(resolvedPath, indexFile);
                        if (fs.existsSync(indexPath)) {
                            return this.normalizePath(indexPath);
                        }
                    }
                }
            } catch {
                // Not a directory
            }
            return this.normalizePath(resolvedPath);
        }

        // Try common extensions
        const extensions = ['.tsx', '.ts', '.jsx', '.js'];
        for (const ext of extensions) {
            const testPath = resolvedPath + ext;
            if (fs.existsSync(testPath)) {
                return this.normalizePath(testPath);
            }
        }

        // Try as directory with index
        const indexFiles = ['index.tsx', 'index.ts', 'index.jsx', 'index.js'];
        for (const indexFile of indexFiles) {
            const indexPath = path.join(resolvedPath, indexFile);
            if (fs.existsSync(indexPath)) {
                return this.normalizePath(indexPath);
            }
        }

        return this.normalizePath(resolvedPath);
    }

    /**
     * Normalizes a file path for consistent comparison
     */
    private normalizePath(filePath: string): string {
        let normalized = path.normalize(filePath);

        if (!path.isAbsolute(normalized)) {
            normalized = path.resolve(this.projectRoot, normalized);
        }

        normalized = path.resolve(normalized);
        return normalized.replace(/\\/g, '/');
    }

    /**
     * Checks if two paths match
     */
    private pathsMatch(path1: string, path2: string): boolean {
        const normalized1 = this.normalizePath(path1);
        const normalized2 = this.normalizePath(path2);

        if (normalized1 === normalized2) {
            return true;
        }

        // Check without extensions
        const path1NoExt = normalized1.replace(/\.(tsx?|jsx?|mjs|cjs)$/, '');
        const path2NoExt = normalized2.replace(/\.(tsx?|jsx?|mjs|cjs)$/, '');

        if (path1NoExt === path2NoExt) {
            return true;
        }

        // Check if one is index file of the other
        const path1Dir = path.dirname(normalized1);
        const path2Dir = path.dirname(normalized2);
        const path1Base = path.basename(normalized1, path.extname(normalized1));
        const path2Base = path.basename(normalized2, path.extname(normalized2));

        if ((path1Base === 'index' && path1Dir === path2NoExt) ||
            (path2Base === 'index' && path2Dir === path1NoExt)) {
            return true;
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

    /**
     * Get all project files (for use by other modules)
     */
    getAllFiles(): string[] {
        return this.allProjectFiles;
    }
}
