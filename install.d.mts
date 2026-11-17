export function installSkill(project: string, host?: 'codex' | 'claude', options?: { autoCheck?: boolean }): Promise<string>;
export function uninstallSkill(project: string, host?: 'codex' | 'claude'): Promise<string>;
