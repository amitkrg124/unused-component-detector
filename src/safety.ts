import * as vscode from 'vscode';
import * as path from 'path';
import { DependencyGraph } from './analyzer';

/**
 * Result of a safety check for component deletion
 */
export interface SafetyCheckResult {
    isSafe: boolean;
    warnings: string[];
    dependents: string[];
    recommendations: string[];
}

/**
 * Options for safety checking
 */
export interface SafetyCheckOptions {
    checkStringReferences?: boolean;
    checkTestFiles?: boolean;
    ignorePatterns?: string[];
}

/**
 * SafetyChecker class for verifying component deletion safety
 */
export class SafetyChecker {
    private projectRoot: string;

    constructor(projectRoot: string) {
        this.projectRoot = projectRoot;
    }

    /**
     * Checks if it's safe to delete a component
     * @param componentPath Path to the component file to check
     * @param dependencyGraph Dependency graph from DependencyAnalyzer
     * @param allContent Optional map of file paths to their content (for performance)
     * @param options Optional safety check configuration
     * @returns SafetyCheckResult with safety status and recommendations
     */
    async checkSafeDeletion(
        componentPath: string,
        dependencyGraph: DependencyGraph,
        allContent?: Map<string, string>,
        options?: SafetyCheckOptions
    ): Promise<SafetyCheckResult> {
        const warnings: string[] = [];
        const dependents: string[] = [];
        const recommendations: string[] = [];

        const opts: SafetyCheckOptions = {
            checkStringReferences: true,
            checkTestFiles: true,
            ignorePatterns: [],
            ...options
        };

        try {
            // Get component name and info
            const componentName = this.extractComponentName(componentPath);

            // Check direct imports from dependency graph
            const directDependents = dependencyGraph[componentPath] || [];
            dependents.push(...directDependents);

            if (directDependents.length > 0) {
                const testFiles = directDependents.filter(file => this.isTestFile(file));
                const nonTestFiles = directDependents.filter(file => !this.isTestFile(file));

                if (nonTestFiles.length > 0) {
                    warnings.push(
                        `Component "${componentName}" is directly imported by ${nonTestFiles.length} file(s):`
                    );
                    nonTestFiles.forEach(file => {
                        warnings.push(`  - ${this.getRelativePath(file)}`);
                    });
                    recommendations.push(
                        `Remove imports from ${nonTestFiles.length} file(s) before deleting`
                    );
                }

                if (testFiles.length > 0) {
                    warnings.push(
                        `Component has ${testFiles.length} test file(s) that import it:`
                    );
                    testFiles.forEach(file => {
                        warnings.push(`  - ${this.getRelativePath(file)}`);
                    });
                    recommendations.push(
                        `Consider updating or removing ${testFiles.length} test file(s)`
                    );
                }
            }

            // Check for indirect references (string mentions)
            let indirectRefs: string[] = [];
            if (opts.checkStringReferences) {
                indirectRefs = await this.findIndirectReferences(
                    componentPath,
                    componentName,
                    allContent,
                    opts.ignorePatterns || []
                );

                if (indirectRefs.length > 0) {
                    warnings.push(
                        `Found ${indirectRefs.length} potential indirect reference(s) to "${componentName}":`
                    );
                    indirectRefs.forEach(ref => {
                        warnings.push(`  - ${this.getRelativePath(ref)}`);
                    });
                    recommendations.push(
                        'Review indirect references - component name may be used as string or in comments'
                    );
                }
            }

            // Check for test files specifically
            if (opts.checkTestFiles) {
                const testFiles = await this.findTestFilesForComponent(
                    componentPath,
                    componentName,
                    allContent
                );

                if (testFiles.length > 0 && !directDependents.some(f => testFiles.includes(f))) {
                    warnings.push(
                        `Found ${testFiles.length} additional test file(s) that may reference this component:`
                    );
                    testFiles.forEach(file => {
                        warnings.push(`  - ${this.getRelativePath(file)}`);
                    });
                    recommendations.push('Review test files for component references');
                }
            }

            // Check if component is exported from index files
            const indexExports = await this.checkIndexExports(componentPath, componentName);
            if (indexExports.length > 0) {
                warnings.push(
                    `Component is exported from ${indexExports.length} index file(s):`
                );
                indexExports.forEach(file => {
                    warnings.push(`  - ${this.getRelativePath(file)}`);
                });
                recommendations.push('Remove exports from index files before deleting');
            }

            // Check for component usage in configuration files
            const configRefs = await this.findConfigReferences(componentPath, componentName);
            if (configRefs.length > 0) {
                warnings.push(
                    `Found references in ${configRefs.length} configuration file(s):`
                );
                configRefs.forEach(file => {
                    warnings.push(`  - ${this.getRelativePath(file)}`);
                });
                recommendations.push('Review configuration files for component references');
            }

            // Determine if deletion is safe
            const isSafe = warnings.length === 0 || 
                          (directDependents.length === 0 && 
                           (opts.checkStringReferences === false || indirectRefs.length === 0));

            // Add general recommendations if not safe
            if (!isSafe) {
                recommendations.unshift(
                    'Review all warnings before deleting this component',
                    'Consider using "Find All References" in VS Code to verify usage'
                );
            } else {
                recommendations.push('Component appears safe to delete');
            }

            return {
                isSafe,
                warnings,
                dependents: [...new Set(dependents)], // Remove duplicates
                recommendations
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            warnings.push(`Error during safety check: ${errorMessage}`);
            recommendations.push('Review the error and try again');

            return {
                isSafe: false,
                warnings,
                dependents,
                recommendations
            };
        }
    }

    /**
     * Extracts component name from file path
     */
    private extractComponentName(componentPath: string): string {
        const fileName = path.basename(componentPath, path.extname(componentPath));
        
        // Handle index files - try to use parent directory name
        if (fileName === 'index') {
            const parentDir = path.basename(path.dirname(componentPath));
            return this.toPascalCase(parentDir);
        }
        
        return this.toPascalCase(fileName);
    }

    /**
     * Converts a string to PascalCase
     */
    private toPascalCase(str: string): string {
        const parts = str
            .split(/[-_\s]+/)
            .flatMap(part => part.split(/(?=[A-Z])/))
            .filter(part => part.length > 0);
        
        return parts
            .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
            .join('');
    }

    /**
     * Checks if a file is a test file
     */
    private isTestFile(filePath: string): boolean {
        const fileName = path.basename(filePath);
        const testPatterns = [
            /\.test\.(tsx?|jsx?)$/i,
            /\.spec\.(tsx?|jsx?)$/i,
            /\.test\.(tsx?|jsx?)$/i,
            /test\.(tsx?|jsx?)$/i,
            /spec\.(tsx?|jsx?)$/i
        ];

        // Check if file is in a test directory
        const dirPath = path.dirname(filePath).toLowerCase();
        if (dirPath.includes('test') || dirPath.includes('__tests__') || dirPath.includes('spec')) {
            return true;
        }

        // Check filename patterns
        return testPatterns.some(pattern => pattern.test(fileName));
    }

    /**
     * Finds indirect references to component (string mentions, comments, etc.)
     */
    private async findIndirectReferences(
        componentPath: string,
        componentName: string,
        allContent?: Map<string, string>,
        ignorePatterns: string[] = []
    ): Promise<string[]> {
        const references: string[] = [];
        const normalizedPath = this.normalizePath(componentPath);
        const fileName = path.basename(componentPath, path.extname(componentPath));

        // Patterns to search for
        const searchPatterns = [
            componentName,
            fileName,
            path.basename(componentPath),
            this.toCamelCase(componentName),
            this.toKebabCase(componentName)
        ];

        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) {
                return references;
            }

            // Get all project files
            for (const workspaceFolder of workspaceFolders) {
                const pattern = new vscode.RelativePattern(
                    workspaceFolder,
                    '**/*.{js,jsx,ts,tsx,json,md}'
                );

                const files = await vscode.workspace.findFiles(
                    pattern,
                    '**/node_modules/**',
                    5000
                );

                for (const file of files) {
                    const filePath = file.fsPath;
                    const normalizedFilePath = this.normalizePath(filePath);

                    // Skip the component file itself
                    if (normalizedFilePath === normalizedPath) {
                        continue;
                    }

                    // Skip ignored patterns
                    if (ignorePatterns.some(pattern => filePath.includes(pattern))) {
                        continue;
                    }

                    // Get file content
                    let content: string;
                    if (allContent && allContent.has(filePath)) {
                        content = allContent.get(filePath)!;
                    } else {
                        try {
                            const document = await vscode.workspace.openTextDocument(file);
                            content = document.getText();
                        } catch {
                            continue;
                        }
                    }

                    // Check for string references (excluding import statements)
                    for (const searchPattern of searchPatterns) {
                        // Skip if pattern is too generic (single character)
                        if (searchPattern.length < 2) {
                            continue;
                        }

                        // Create regex to find mentions (but not in import statements)
                        const regex = new RegExp(
                            `(?!import.*from)['"]${this.escapeRegex(searchPattern)}['"]|['"]${this.escapeRegex(fileName)}['"]|\\b${this.escapeRegex(searchPattern)}\\b`,
                            'gi'
                        );

                        // Check if it's in a comment or string literal (not an import)
                        const lines = content.split('\n');
                        for (let i = 0; i < lines.length; i++) {
                            const line = lines[i];
                            
                            // Skip import/export lines
                            if (/^\s*(import|export)\s+/.test(line)) {
                                continue;
                            }

                            // Check for mentions
                            if (regex.test(line)) {
                                // Verify it's not just part of another word
                                const wordBoundaryRegex = new RegExp(
                                    `\\b${this.escapeRegex(searchPattern)}\\b`,
                                    'i'
                                );
                                
                                if (wordBoundaryRegex.test(line)) {
                                    if (!references.includes(filePath)) {
                                        references.push(filePath);
                                    }
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Error finding indirect references:', error);
        }

        return references;
    }

    /**
     * Finds test files that may reference the component
     */
    private async findTestFilesForComponent(
        _componentPath: string,
        componentName: string,
        allContent?: Map<string, string>
    ): Promise<string[]> {
        const testFiles: string[] = [];

        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) {
                return testFiles;
            }

            for (const workspaceFolder of workspaceFolders) {
                const pattern = new vscode.RelativePattern(
                    workspaceFolder,
                    '**/*.{test,spec}.{js,jsx,ts,tsx}'
                );

                const files = await vscode.workspace.findFiles(
                    pattern,
                    '**/node_modules/**',
                    5000
                );

                for (const file of files) {
                    if (this.isTestFile(file.fsPath)) {
                        let content: string;
                        if (allContent && allContent.has(file.fsPath)) {
                            content = allContent.get(file.fsPath)!;
                        } else {
                            try {
                                const document = await vscode.workspace.openTextDocument(file);
                                content = document.getText();
                            } catch {
                                continue;
                            }
                        }

                        // Check if test file mentions component
                        const componentRegex = new RegExp(
                            `\\b${this.escapeRegex(componentName)}\\b`,
                            'i'
                        );

                        if (componentRegex.test(content)) {
                            testFiles.push(file.fsPath);
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Error finding test files:', error);
        }

        return testFiles;
    }

    /**
     * Checks if component is exported from index files
     */
    private async checkIndexExports(
        componentPath: string,
        componentName: string
    ): Promise<string[]> {
        const indexFiles: string[] = [];
        const fileName = path.basename(componentPath);

        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) {
                return indexFiles;
            }

            for (const workspaceFolder of workspaceFolders) {
                const pattern = new vscode.RelativePattern(
                    workspaceFolder,
                    '**/index.{js,jsx,ts,tsx}'
                );

                const files = await vscode.workspace.findFiles(
                    pattern,
                    '**/node_modules/**',
                    1000
                );

                for (const file of files) {
                    try {
                        const document = await vscode.workspace.openTextDocument(file);
                        const content = document.getText();

                        // Check for export statements
                        const exportPatterns = [
                            new RegExp(`export\\s+.*from\\s+['"]${this.escapeRegex(this.getRelativePath(componentPath, path.dirname(file.fsPath)))}['"]`, 'i'),
                            new RegExp(`export\\s+.*\\b${this.escapeRegex(componentName)}\\b`, 'i'),
                            new RegExp(`export\\s+.*\\b${this.escapeRegex(fileName)}\\b`, 'i')
                        ];

                        for (const pattern of exportPatterns) {
                            if (pattern.test(content)) {
                                indexFiles.push(file.fsPath);
                                break;
                            }
                        }
                    } catch {
                        continue;
                    }
                }
            }
        } catch (error) {
            console.error('Error checking index exports:', error);
        }

        return indexFiles;
    }

    /**
     * Finds references in configuration files
     */
    private async findConfigReferences(
        componentPath: string,
        componentName: string
    ): Promise<string[]> {
        const configFiles: string[] = [];
        const configPatterns = [
            '**/*.config.{js,ts,json}',
            '**/webpack.config.{js,ts}',
            '**/vite.config.{js,ts}',
            '**/next.config.{js,ts}',
            '**/package.json',
            '**/tsconfig.json'
        ];

        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) {
                return configFiles;
            }

            for (const workspaceFolder of workspaceFolders) {
                for (const pattern of configPatterns) {
                    const files = await vscode.workspace.findFiles(
                        new vscode.RelativePattern(workspaceFolder, pattern),
                        '**/node_modules/**',
                        100
                    );

                    for (const file of files) {
                        try {
                            const document = await vscode.workspace.openTextDocument(file);
                            const content = document.getText();

                            const componentRegex = new RegExp(
                                `['"]${this.escapeRegex(componentName)}['"]|['"]${this.escapeRegex(path.basename(componentPath))}['"]`,
                                'i'
                            );

                            if (componentRegex.test(content)) {
                                configFiles.push(file.fsPath);
                            }
                        } catch {
                            continue;
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Error finding config references:', error);
        }

        return configFiles;
    }

    /**
     * Normalizes a file path for comparison
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
     * Gets relative path from project root
     */
    private getRelativePath(filePath: string, basePath?: string): string {
        const base = basePath || this.projectRoot;
        try {
            return path.relative(base, filePath);
        } catch {
            return filePath;
        }
    }

    /**
     * Escapes special regex characters
     */
    private escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    /**
     * Converts PascalCase to camelCase
     */
    private toCamelCase(str: string): string {
        return str.charAt(0).toLowerCase() + str.slice(1);
    }

    /**
     * Converts to kebab-case
     */
    private toKebabCase(str: string): string {
        return str
            .replace(/([a-z])([A-Z])/g, '$1-$2')
            .toLowerCase();
    }
}

