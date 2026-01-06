import * as vscode from 'vscode';
import { PortManager, PortInfo } from './portManager';

export class PortProvider implements vscode.TreeDataProvider<PortItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<PortItem | undefined | null | void> = new vscode.EventEmitter<PortItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<PortItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private portManager: PortManager;
    private ports: PortInfo[] = [];
    private filter: string = '';

    constructor() {
        this.portManager = new PortManager();
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    setFilter(filter: string) {
        this.filter = filter.toLowerCase();
        vscode.commands.executeCommand('setContext', 'xport:hasFilter', !!this.filter);
        this.refresh();
    }
    
    clearFilter() {
        this.setFilter('');
    }

    getTreeItem(element: PortItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: PortItem): Thenable<PortItem[]> {
        if (element) {
            return Promise.resolve([]);
        }

        return this.portManager.getPorts().then(ports => {
            this.ports = ports;
            
            let filteredPorts = ports;
            if (this.filter) {
                filteredPorts = ports.filter(p => 
                    p.port.toString().includes(this.filter) ||
                    p.processName.toLowerCase().includes(this.filter) ||
                    p.pid.toString().includes(this.filter)
                );
            }

            return filteredPorts.map(p => new PortItem(p));
        });
    }

    async killPort(item: PortItem): Promise<void> {
        try {
            await this.portManager.killProcess(item.portInfo.pid);
            vscode.window.showInformationMessage(`进程 ${item.portInfo.processName} (PID: ${item.portInfo.pid}) 已停止`);
            this.refresh();
        } catch (error: any) {
            vscode.window.showErrorMessage(`停止进程失败: ${error.message}`);
        }
    }
}

export class PortItem extends vscode.TreeItem {
    constructor(
        public readonly portInfo: PortInfo
    ) {
        super(`${portInfo.port} - ${portInfo.processName}`, vscode.TreeItemCollapsibleState.None);
        
        this.tooltip = `Port: ${portInfo.port}\nProcess: ${portInfo.processName}\nPID: ${portInfo.pid}\nProtocol: ${portInfo.protocol}`;
        this.description = `PID: ${portInfo.pid}`;
        
        this.contextValue = 'portItem';
        
        // Use a built-in icon
        this.iconPath = new vscode.ThemeIcon('plug');
    }
}
