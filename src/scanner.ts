import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Information about a React component
 */
export interface ComponentInfo {
    filePath: string;
    fileName: string;
    componentName: string;
    size: number;
    lastModified: Date;
}

/**
 * Options for scanning components
 */
export interface ScanOptions {
    excludePatterns?: string[];
    includePatterns?: string[];
}

/**
 * Converts a file name to PascalCase component name
 * Examples:
 *   user-profile.jsx → UserProfile
 *   userProfile.tsx → UserProfile
 *   user_profile.js → UserProfile
 *   index.tsx → Index
 */
export function toPascalCase(fileName: string): string {
    // Remove file extension
    const nameWithoutExt = path.parse(fileName).name;
    
    // Handle index files - use parent directory name
    if (nameWithoutExt === 'index') {
        return 'Index';
    }
    
    // Split by common separators: -, _, and camelCase boundaries
    const parts = nameWithoutExt
        .split(/[-_\s]+/)
        .flatMap(part => {
            // Split camelCase into parts
            return part.split(/(?=[A-Z])/);
        })
        .filter(part => part.length > 0);
    
    // Capitalize first letter of each part and join
    return parts
        .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
        .join('');
}

/**
 * Checks if a file contains React imports or JSX
 */
async function isReactComponent(uri: vscode.Uri): Promise<boolean> {
    try {
        const document = await vscode.workspace.openTextDocument(uri);
        const content = document.getText();
        
        // Check for React imports
        const hasReactImport = /import\s+.*\s+from\s+['"]react['"]/i.test(content) ||
                              /import\s+React\s+from\s+['"]react['"]/i.test(content) ||
                              /from\s+['"]react['"]/i.test(content);
        
        // Check for JSX syntax
        const hasJSX = /<[A-Z][a-zA-Z0-9]*|<\/[A-Z][a-zA-Z0-9]*|<\w+[^>]*>/.test(content);
        
        // Check for React component patterns
        const hasComponentPattern = 
            /(function|const|class)\s+[A-Z][a-zA-Z0-9]*\s*[=\(]/.test(content) ||
            /export\s+(default\s+)?(function|const|class)\s+[A-Z][a-zA-Z0-9]*/.test(content);
        
        // Must have React import/usage AND (JSX OR component pattern)
        return (hasReactImport || hasJSX) && (hasJSX || hasComponentPattern);
    } catch (error) {
        console.error(`Error reading file ${uri.fsPath}:`, error);
        return false;
    }
}

/**
 * Gets file statistics (size and last modified date)
 */
async function getFileStats(uri: vscode.Uri): Promise<{ size: number; lastModified: Date }> {
    try {
        const filePath = uri.fsPath;
        
        // Get file size from filesystem for more accurate size
        const fsStats = fs.statSync(filePath);
        
        return {
            size: fsStats.size,
            lastModified: fsStats.mtime
        };
    } catch (error) {
        console.error(`Error getting file stats for ${uri.fsPath}:`, error);
        return {
            size: 0,
            lastModified: new Date()
        };
    }
}

/**
 * Checks if a file should be excluded from scanning
 */
function shouldExcludeFile(uri: vscode.Uri, options?: ScanOptions): boolean {
    const filePath = uri.fsPath;
    
    // Always exclude node_modules
    if (filePath.includes('node_modules')) {
        return true;
    }
    
    // Check custom exclude patterns
    if (options?.excludePatterns) {
        for (const pattern of options.excludePatterns) {
            if (filePath.includes(pattern)) {
                return true;
            }
        }
    }
    
    return false;
}

/**
 * Scans the workspace for React components
 * @param options Optional scan configuration
 * @returns Promise resolving to an array of ComponentInfo
 */
export async function scanReactComponents(
    options?: ScanOptions
): Promise<ComponentInfo[]> {
    const components: ComponentInfo[] = [];
    
    try {
        // Get workspace folders
        const workspaceFolders = vscode.workspace.workspaceFolders;
        
        if (!workspaceFolders || workspaceFolders.length === 0) {
            vscode.window.showWarningMessage('No workspace folder found');
            return components;
        }
        
        // File patterns to search for
        const patterns = options?.includePatterns || [
            '**/*.{js,jsx,ts,tsx}'
        ];
        
        // Search for files matching the patterns
        for (const workspaceFolder of workspaceFolders) {
            for (const pattern of patterns) {
                const files = await vscode.workspace.findFiles(
                    new vscode.RelativePattern(workspaceFolder, pattern),
                    // Exclude node_modules and other common exclusions
                    '**/node_modules/**',
                    10000 // Limit to prevent performance issues
                );
                
                for (const file of files) {
                    // Additional exclusion check
                    if (shouldExcludeFile(file, options)) {
                        continue;
                    }
                    
                    // Check if file is a React component
                    const isComponent = await isReactComponent(file);
                    
                    if (isComponent) {
                        const fileName = path.basename(file.fsPath);
                        const componentName = toPascalCase(fileName);
                        const stats = await getFileStats(file);
                        
                        components.push({
                            filePath: file.fsPath,
                            fileName: fileName,
                            componentName: componentName,
                            size: stats.size,
                            lastModified: stats.lastModified
                        });
                    }
                }
            }
        }
        
        // Sort by file path for consistent results
        components.sort((a, b) => a.filePath.localeCompare(b.filePath));
        
        return components;
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        vscode.window.showErrorMessage(`Error scanning React components: ${errorMessage}`);
        console.error('Error scanning React components:', error);
        return components;
    }
}

/**
 * Scans a specific directory for React components
 * @param directoryPath Path to the directory to scan
 * @param options Optional scan configuration
 * @returns Promise resolving to an array of ComponentInfo
 */
export async function scanDirectory(
    directoryPath: string,
    options?: ScanOptions
): Promise<ComponentInfo[]> {
    const components: ComponentInfo[] = [];
    
    try {
        const pattern = new vscode.RelativePattern(
            directoryPath,
            '**/*.{js,jsx,ts,tsx}'
        );
        
        const files = await vscode.workspace.findFiles(
            pattern,
            '**/node_modules/**',
            10000
        );
        
        for (const file of files) {
            if (shouldExcludeFile(file, options)) {
                continue;
            }
            
            const isComponent = await isReactComponent(file);
            
            if (isComponent) {
                const fileName = path.basename(file.fsPath);
                const componentName = toPascalCase(fileName);
                const stats = await getFileStats(file);
                
                components.push({
                    filePath: file.fsPath,
                    fileName: fileName,
                    componentName: componentName,
                    size: stats.size,
                    lastModified: stats.lastModified
                });
            }
        }
        
        components.sort((a, b) => a.filePath.localeCompare(b.filePath));
        
        return components;
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        vscode.window.showErrorMessage(`Error scanning directory: ${errorMessage}`);
        console.error('Error scanning directory:', error);
        return components;
    }
}

