import * as cp from 'child_process';
import * as os from 'os';

export interface PortInfo {
    port: number;
    pid: number;
    processName: string;
    protocol: string;
}

export class PortManager {
    
    public async getPorts(): Promise<PortInfo[]> {
        const platform = os.platform();
        if (platform === 'win32') {
            return this.getPortsWindows();
        } else {
            return this.getPortsUnix(); // macOS and Linux
        }
    }

    public async killProcess(pid: number): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                process.kill(pid, 'SIGKILL');
                resolve();
            } catch (e: any) {
                // Fallback for Windows if process.kill fails or permission issues
                const cmd = os.platform() === 'win32' 
                    ? `taskkill /F /PID ${pid}` 
                    : `kill -9 ${pid}`;
                
                cp.exec(cmd, (err) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve();
                    }
                });
            }
        });
    }

    private getPortsWindows(): Promise<PortInfo[]> {
        return new Promise((resolve, reject) => {
            // netstat -ano
            cp.exec('netstat -ano', (err, stdout) => {
                if (err) {
                    // netstat might fail if not in path, but usually it is.
                    // resolve empty if fails? or reject?
                    // Let's return empty and log error to console
                    console.error('netstat error:', err);
                    resolve([]);
                    return;
                }

                const lines = stdout.toString().split('\n');
                const ports: PortInfo[] = [];

                // Skip header lines
                // Proto  Local Address          Foreign Address        State           PID
                // TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1234

                for (const line of lines) {
                    const parts = line.trim().split(/\s+/);
                    if (parts.length < 5) continue;

                    const proto = parts[0];
                    const localAddr = parts[1];
                    const state = parts[3]; // might be State or Foreign Address depending on UDP
                    const pidStr = parts[parts.length - 1]; // PID is usually last

                    if (!/^\d+$/.test(pidStr)) continue; // PID must be number

                    // We mainly care about LISTENING ports for TCP
                    if (proto.toUpperCase().startsWith('TCP') && state.toUpperCase() !== 'LISTENING') {
                        continue;
                    }
                    
                    // For UDP there is no "LISTENING" state usually shown in netstat -ano in same way, 
                    // sometimes it just lists them.
                    
                    const pid = parseInt(pidStr, 10);
                    if (pid === 0) continue; // System Idle Process

                    // Extract port from localAddr (IP:Port or [IP]:Port)
                    const lastColonIndex = localAddr.lastIndexOf(':');
                    if (lastColonIndex === -1) continue;
                    
                    const portStr = localAddr.substring(lastColonIndex + 1);
                    const port = parseInt(portStr, 10);

                    if (isNaN(port)) continue;

                    ports.push({
                        port,
                        pid,
                        processName: '', // Will fetch later
                        protocol: proto
                    });
                }

                // Deduplicate by PID and Port (TCP/UDP separate)
                // Actually netstat output might have duplicates for same socket
                const uniquePorts = this.deduplicatePorts(ports);
                
                // Fetch process names
                this.fillProcessNamesWindows(uniquePorts).then(updatedPorts => {
                    resolve(updatedPorts);
                });
            });
        });
    }

    private unescapeName(name: string): string {
        // 处理lsof输出中的转义序列，如\x20表示空格，\xYY表示其他字符
        // 直接使用正则表达式全局替换所有的\xXX转义序列
        return name.replace(/\\x([0-9A-Fa-f]{2})/g, (match, hex) => {
            // 将十六进制字符串转换为十进制数字
            const charCode = parseInt(hex, 16);
            
            // 特殊处理空格字符，因为空格在显示时容易被忽略
            if (charCode === 0x20) {
                return ' '; // 直接返回空格
            }
            
            // 对于其他字符，尝试转换为对应的字符
            try {
                // 使用String.fromCharCode直接转换
                return String.fromCharCode(charCode);
            } catch (e) {
                // 如果转换失败，返回原始匹配
                return match;
            }
        }).replace(/�/g, '未知'); // 可选：移除无效字符标记
    }

    private async fillProcessNamesWindows(ports: PortInfo[]): Promise<PortInfo[]> {
        // We can use `tasklist` to get all processes and map them, which is faster than one by one.
        // `tasklist /FO CSV`
        return new Promise((resolve) => {
            cp.exec('tasklist /FO CSV /NH', (err, stdout) => {
                if (err) {
                    resolve(ports); // Return without names if fails
                    return;
                }

                const lines = stdout.toString().split('\n');
                const pidMap = new Map<number, string>();

                for (const line of lines) {
                    // "Image Name","PID","Session Name","Session#","Mem Usage"
                    // "chrome.exe","1234","Console","1","12,345 K"
                    // Parse CSV line simply
                    const parts = line.trim().match(/"([^"]*)"/g);
                    if (!parts || parts.length < 2) continue;

                    const name = parts[0].replace(/"/g, '');
                    const pid = parseInt(parts[1].replace(/"/g, ''), 10);

                    pidMap.set(pid, name);
                }

                for (const p of ports) {
                    if (pidMap.has(p.pid)) {
                        p.processName = pidMap.get(p.pid)!;
                        p.processName = this.unescapeName(p.processName);
                    }
                }
                resolve(ports);
            });
        });
    }

    private getPortsUnix(): Promise<PortInfo[]> {
        return new Promise((resolve) => {
            // lsof -i -P -n
            // Output example:
            // COMMAND     PID    USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
            // loginwindow 104 guxiu   22u  IPv4 0x...      0t0  TCP *:62985 (LISTEN)
            
            // Note: -P no port names, -n no host names
            cp.exec('lsof -i -P -n', (err, stdout) => {
                if (err) {
                    // lsof returns exit code 1 if no files found (no ports listening?)
                    // or if command not found.
                    console.error('lsof error (might be empty):', err);
                    resolve([]); 
                    return;
                }

                const lines = stdout.toString().split('\n');
                const ports: PortInfo[] = [];

                // Skip header
                for (let i = 1; i < lines.length; i++) {
                    const line = lines[i].trim();
                    if (!line) continue;

                    const parts = line.split(/\s+/);
                    if (parts.length < 9) continue;

                    const command = parts[0];
                    const pidStr = parts[1];
                    const protocol = parts[7]; // TCP or UDP usually, but column index varies?
                    // Let's count from end or use regex? 
                    // lsof output is fixed width-ish but fields can be empty? No, lsof -i usually fills fields.
                    // COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME
                    // 0       1   2    3  4    5      6        7    8

                    // NAME column (last) contains address:port
                    // *:8080 (LISTEN)
                    const nameCol = parts[parts.length - 1]; // (LISTEN) or address
                    const addressCol = parts[parts.length - 2]; // address if (LISTEN) is last?
                    
                    let address = '';
                    let state = '';

                    if (nameCol.includes('(')) {
                        state = nameCol;
                        address = addressCol;
                    } else {
                        address = nameCol;
                    }

                    // Filter TCP listening
                    const nodeType = parts[4]; // IPv4 or IPv6
                    const transport = parts[7]; // TCP or UDP (actually usually in node column? No.)
                    // lsof columns:
                    // COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME
                    // node type is IPv4/6.
                    
                    // Actually checking "TCP" or "UDP" in line is safer.
                    const isTCP = line.includes('TCP');
                    const isUDP = line.includes('UDP');
                    
                    if (isTCP && !line.includes('(LISTEN)')) {
                        continue;
                    }

                    // Extract port
                    const lastColon = address.lastIndexOf(':');
                    if (lastColon === -1) continue;
                    const portStr = address.substring(lastColon + 1);
                    const port = parseInt(portStr, 10);
                    
                    if (isNaN(port)) continue;

                    ports.push({
                        port,
                        pid: parseInt(pidStr, 10),
                        processName: this.unescapeName(command),
                        protocol: isUDP ? 'UDP' : 'TCP'
                    });
                }

                resolve(this.deduplicatePorts(ports));
            });
        });
    }

    private deduplicatePorts(ports: PortInfo[]): PortInfo[] {
        const seen = new Set<string>();
        const result: PortInfo[] = [];

        for (const p of ports) {
            const key = `${p.port}-${p.protocol}-${p.pid}`;
            if (!seen.has(key)) {
                seen.add(key);
                result.push(p);
            }
        }
        return result.sort((a, b) => a.port - b.port);
    }
}
