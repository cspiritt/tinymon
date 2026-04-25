interface Service {
    id: string;
    name: string;
    type: string;
    address: string;
    interval: number;
    failureCount: number;
    status: 'OK' | 'WARNING' | 'ERROR' | 'unknown';
    lastCheck: number;
    lastStatus: string;
    createdAt: number;
    group?: string;
    warn_before?: number;
    check_at?: string;
    ssl_days_until_expiry?: number;
    ssl_expiry_date?: number;
}

interface Check {
    id: number;
    status: 'success' | 'failure';
    responseTime: number | null;
    errorMessage: string | null;
    checkedAt: number;
}

interface APIResponse<T> {
    success: boolean;
    data?: T;
    error?: string;
    timestamp?: number;
}

interface ChecksResponse {
    service: {
        id: string;
        name: string;
    };
    checks: Check[];
}

interface NotificationOptions {
    message: string;
    type?: 'success' | 'error' | 'info';
}

/**
 * Date formatting utility for client-side
 * Uses locale from meta tag "date-format"
 */
class DateFormatter {
    private static instance: DateFormatter;
    private locale: string;

    private constructor() {
        const dateFormatMeta = document.querySelector('meta[name="date-format"]');
        this.locale = dateFormatMeta?.getAttribute('content') || 'en-US';
    }

    public static getInstance(): DateFormatter {
        if (!DateFormatter.instance) {
            DateFormatter.instance = new DateFormatter();
        }
        return DateFormatter.instance;
    }

    /**
     * Format date using configured locale
     */
    public format(date: Date | number | string): string {
        const dateObj = typeof date === 'string' || typeof date === 'number'
            ? new Date(date)
            : date;

        try {
            return dateObj.toLocaleString(this.locale, {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false
            });
        } catch (error) {
            // Fallback to default locale if specified locale is invalid
            console.warn(`Invalid locale "${this.locale}", falling back to "en-US"`);
            return dateObj.toLocaleString('en-US', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false
            });
        }
    }
}

// Global date formatter instance
const dateFormatter = DateFormatter.getInstance();

class MonitoringUI {
    private refreshBtn: HTMLElement | null;
    private lastUpdateTime: HTMLElement | null;
    private modal: HTMLElement | null;
    private closeModalBtn: HTMLElement | null;
    private historyContent: HTMLElement | null;
    private serviceRows: NodeListOf<HTMLElement>;
    private groupHeaders: NodeListOf<HTMLElement>;
    private groupBodies: NodeListOf<HTMLElement>;

    constructor() {
        this.refreshBtn = document.getElementById('refresh-btn');
        this.lastUpdateTime = document.getElementById('last-update-time');
        this.modal = document.getElementById('history-modal');
        this.closeModalBtn = document.querySelector('.close-modal');
        this.historyContent = document.getElementById('history-content');
        this.serviceRows = document.querySelectorAll('.service-row');
        this.groupHeaders = document.querySelectorAll('.group-header');
        this.groupBodies = document.querySelectorAll('.group-body');

        console.log('MonitoringUI constructor:', {
            refreshBtn: this.refreshBtn,
            lastUpdateTime: this.lastUpdateTime,
            modal: this.modal,
            closeModalBtn: this.closeModalBtn,
            historyContent: this.historyContent,
            serviceRowsCount: this.serviceRows.length,
            groupHeadersCount: this.groupHeaders.length,
            groupBodiesCount: this.groupBodies.length
        });
    }

    /**
     * Fetch wrapper with authentication error handling
     */
    private async apiFetch(url: string, options?: RequestInit): Promise<Response> {
        try {
            const response = await fetch(url, options);
            
            // If we get 401, redirect to login page
            if (response.status === 401) {
                window.location.href = '/login';
                throw new Error('Authentication required');
            }
            
            return response;
        } catch (error) {
            console.error('Network error:', error);
            throw error;
        }
    }

    public init(): void {
        this.setupEventListeners();
        this.setupGroupHandlers();
        this.updateLastUpdateTime();
        this.setupAutoRefresh();
        // Load initial data immediately
        this.refreshData(true);
    }

    private setupGroupHandlers(): void {
        this.groupHeaders.forEach(header => {
            header.addEventListener('click', () => {
                const groupName = header.getAttribute('data-group-name');
                if (!groupName) return;
                
                const groupBody = document.querySelector(`.group-body[data-group-name="${groupName}"]`);
                if (!groupBody) return;
                
                const isCollapsed = header.classList.contains('collapsed');
                
                // Toggle state
                header.classList.toggle('collapsed');
                header.classList.toggle('expanded');
                groupBody.classList.toggle('collapsed');
                groupBody.classList.toggle('expanded');

                // Rotate the chevron
                const chevron = header.querySelector('.group-chevron');
                if (chevron && chevron instanceof HTMLElement) {
                    chevron.style.transform = isCollapsed ? 'rotate(0deg)' : 'rotate(-90deg)';
                }
            });
        });
    }

    private updateLastUpdateTime(): void {
        if (!this.lastUpdateTime) return;
        const now = new Date();
        this.lastUpdateTime.textContent = dateFormatter.format(now);
    }

    // Update data via API
    public async refreshData(silent: boolean = false): Promise<void> {
        try {
            const response = await this.apiFetch('/api/status');
            const data = await response.json() as APIResponse<Service[]>;

            if (data.success && data.data) {
                this.updateServicesTable(data.data);
                this.updateStatsCards(data.data);
                this.updateLastUpdateTime();
                if (!silent) {
                    this.showNotification({ message: 'Data updated', type: 'success' });
                }
            }
        } catch (error) {
            console.error('Error updating data:', error);
            if (!silent) {
                this.showNotification({ 
                    message: 'Error updating data', 
                    type: 'error' 
                });
            }
        }
    }

    private updateServicesTable(services: Service[]): void {
        services.forEach(service => {
            const row = document.querySelector(`.service-row[data-service-id="${service.id}"]`);
            if (!row) return;

            // Update status
            const statusBadge = row.querySelector('.status-badge');
            if (statusBadge) {
                statusBadge.className = `status-badge status-${service.status.toLowerCase()}`;
                
                // For SSL services, add certificate expiration info
                if (service.type === 'ssl' && service.ssl_days_until_expiry !== undefined && service.ssl_days_until_expiry !== null) {
                    if (service.ssl_days_until_expiry <= 0) {
                        statusBadge.textContent = `${service.status} (${Math.abs(service.ssl_days_until_expiry)} days ago)`;
                    } else {
                        statusBadge.textContent = `${service.status} (${service.ssl_days_until_expiry} days)`;
                    }
                } else {
                    statusBadge.textContent = service.status;
                }
            }

            // Update failure count
            const failureCount = row.querySelector('.failure-count');
            if (failureCount) {
                failureCount.textContent = service.failureCount.toString();
            }

            // Update last check time
            const lastCheckCell = row.querySelector('.service-last-check');
            if (lastCheckCell && service.lastCheck) {
                lastCheckCell.textContent = dateFormatter.format(service.lastCheck * 1000);
            }
        });
    }

    private updateStatsCards(services: Service[]): void {
        const total = services.length;
        const okCount = services.filter(s => s.status === 'OK').length;
        const warningCount = services.filter(s => s.status === 'WARNING').length;
        const errorCount = services.filter(s => s.status === 'ERROR').length;

        // Update DOM
        const totalElement = document.querySelector('.stat-card.total .stat-number');
        const okElement = document.querySelector('.stat-card.ok .stat-number');
        const warningElement = document.querySelector('.stat-card.warning .stat-number');
        const errorElement = document.querySelector('.stat-card.error .stat-number');

        if (totalElement) totalElement.textContent = total.toString();
        if (okElement) okElement.textContent = okCount.toString();
        if (warningElement) warningElement.textContent = warningCount.toString();
        if (errorElement) errorElement.textContent = errorCount.toString();
    }

    private async loadServiceHistory(serviceId: string, serviceName: string): Promise<void> {
        try {
            const response = await this.apiFetch(`/api/service/${serviceId}/checks?limit=100`);
            const data = await response.json() as APIResponse<ChecksResponse>;
            console.log('History API response:', data);

            if (data.success && data.data) {
                this.showHistoryModal(serviceName, data.data.checks);
            } else {
                console.log('History API error:', data.error);
            }
        } catch (error) {
            console.error('Error loading history:', error);
            this.showNotification({
                message: 'Error loading history',
                type: 'error'
            });
        }
    }

    private showHistoryModal(serviceName: string, checks: Check[]): void {
        const modal = this.modal;
        const historyContent = this.historyContent;
        if (!modal || !historyContent) {
            console.error('Modal or historyContent not found');
            return;
        }

        // Update header
        const header = modal.querySelector('.modal-header h3');
        if (header) {
            header.textContent = `Check history: ${serviceName}`;
        }

        // Sort by time ascending so chart and table share the same index order
        const sorted = [...checks].sort((a, b) => a.checkedAt - b.checkedAt);

        // Generate content
        let html = '';

        if (sorted.length === 0) {
            html = '<p class="no-history">No check history available</p>';
        } else {
            // Render chart above the table
            html += this.renderHistoryChart(sorted);
            html += `
                <div class="history-table">
                    <table>
                        <thead>
                            <tr>
                                <th>Time</th>
                                <th>Status</th>
                                <th>Response time</th>
                                <th>Error</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${sorted.slice().reverse().map((check, ri) => {
                                const originalIndex = sorted.length - 1 - ri;
                                return `
                                <tr data-check-index="${originalIndex}">
                                    <td>${dateFormatter.format(check.checkedAt * 1000)}</td>
                                    <td>
                                        <span class="history-status status-${check.status}">
                                            ${check.status === 'success' ? 'Success' : 'Error'}
                                        </span>
                                    </td>
                                    <td>${check.responseTime ? check.responseTime + 'ms' : '—'}</td>
                                    <td class="error-message">${check.errorMessage || '—'}</td>
                                </tr>
                            `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            `;
        }

        historyContent.innerHTML = html;
        modal.classList.add('active');

        // Attach chart point click handlers after rendering
        const svg = historyContent.querySelector<SVGSVGElement>('.history-chart');
        svg?.addEventListener('click', (e: Event) => {
            const target = e.target as SVGElement;
            const circle = target.closest<SVGCircleElement>('.chart-point');
            if (!circle) return;

            const index = parseInt(circle.getAttribute('data-check-index') || '', 10);
            if (isNaN(index)) return;

            this.selectHistoryRow(index);
        });
    }

    private renderHistoryChart(sorted: Check[]): string {
        const count = sorted.length;
        if (count === 0) return '';

        const width = 800;
        const height = 220;
        const pad = { top: 15, right: 15, bottom: 35, left: 50 };
        const plotW = width - pad.left - pad.right;
        const plotH = height - pad.top - pad.bottom;

        // Find max response time for Y-axis scale
        const maxRt = Math.max(...sorted.map(c => c.responseTime || 0), 1);
        const yMax = Math.ceil(maxRt * 1.1);

        // X-axis is divided into 100 fixed slots so points fill left to right
        // without stretching the chart area as new checks come in
        const totalSlots = 100;
        const xPos = (i: number) =>
            pad.left + (i / (totalSlots - 1)) * plotW;
        const yPos = (v: number) =>
            pad.top + plotH - (v / yMax) * plotH;
        const bottomY = pad.top + plotH;

        // Helper to get point color by status
        const pointColor = (status: string) =>
            status === 'success' ? '#2ecc71' : '#e74c3c';

        // Build SVG
        let svg = `<svg class="history-chart" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">`;

        // Grid lines + Y-axis labels
        const gridCount = 5;
        for (let i = 0; i <= gridCount; i++) {
            const y = pad.top + (i / gridCount) * plotH;
            const label = Math.round(yMax - (i / gridCount) * yMax);
            svg += `<line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}" stroke="#e9ecef" stroke-width="1"/>`;
            svg += `<text x="${pad.left - 6}" y="${y + 4}" text-anchor="end" fill="#6c757d" font-size="11">${label}ms</text>`;
        }

        // X-axis labels (every 10th check + always the last point)
        const labelStep = 10;
        for (let i = 0; i < count; i += labelStep) {
            const x = pad.left + (i / (totalSlots - 1)) * plotW;
            const d = new Date(sorted[i].checkedAt * 1000);
            const label = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
            svg += `<text x="${x}" y="${height - 5}" text-anchor="end" fill="#6c757d" font-size="10">${label}</text>`;
        }
        // Always label the last point
        const lastI = count - 1;
        if (lastI % labelStep !== 0) {
            const x = pad.left + (lastI / (totalSlots - 1)) * plotW;
            const d = new Date(sorted[lastI].checkedAt * 1000);
            const label = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
            svg += `<text x="${x}" y="${height - 5}" text-anchor="end" fill="#6c757d" font-size="10">${label}</text>`;
        }

        // Area fill segments — each segment matches the line colour above it, with low opacity
        for (let i = 0; i < count - 1; i++) {
            const x1 = xPos(i);
            const y1 = yPos(sorted[i].responseTime || 0);
            const x2 = xPos(i + 1);
            const y2 = yPos(sorted[i + 1].responseTime || 0);
            const color = pointColor(sorted[i].status);
            svg += `<polygon points="${x1},${y1} ${x2},${y2} ${x2},${bottomY} ${x1},${bottomY}" fill="${color}" fill-opacity="0.12"/>`;
        }

        // Line segments — each segment coloured by the left point's status
        for (let i = 0; i < count - 1; i++) {
            const x1 = xPos(i);
            const y1 = yPos(sorted[i].responseTime || 0);
            const x2 = xPos(i + 1);
            const y2 = yPos(sorted[i + 1].responseTime || 0);
            const color = pointColor(sorted[i].status);
            svg += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="2" stroke-linecap="round"/>`;
        }

        // Points
        sorted.forEach((c, i) => {
            const x = xPos(i);
            const y = yPos(c.responseTime || 0);
            svg += `<circle class="chart-point" cx="${x}" cy="${y}" r="4.5" fill="${pointColor(c.status)}" stroke="#fff" stroke-width="2" cursor="pointer" data-check-index="${i}"/>`;
        });

        svg += '</svg>';
        return svg;
    }

    private selectHistoryRow(index: number): void {
        const table = this.historyContent?.querySelector('.history-table table');
        if (!table) return;

        // Remove previous highlight
        table.querySelectorAll('.history-row-selected').forEach(el => {
            el.classList.remove('history-row-selected');
        });

        // Highlight the target row
        const row = table.querySelector<HTMLElement>(`tr[data-check-index="${index}"]`);
        if (row) {
            row.classList.add('history-row-selected');
            row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }

    private async forceCheckService(serviceId: string, serviceName: string): Promise<void> {
        try {
            const response = await this.apiFetch(`/api/service/${serviceId}/check`, {
                method: 'POST'
            });
            const data = await response.json() as APIResponse<any>;

            if (data.success) {
                this.showNotification({
                    message: `Service check "${serviceName}" completed`,
                    type: 'success'
                });
                // Update data after 1 second
                setTimeout(() => this.refreshData(true), 1000);
            } else {
                this.showNotification({
                    message: `Error during check: ${data.error}`,
                    type: 'error'
                });
            }
        } catch (error) {
            console.error('Error during forced check:', error);
            this.showNotification({
                message: 'Error during forced check',
                type: 'error'
            });
        }
    }

    private showNotification(options: NotificationOptions): void {
        const { message, type = 'info' } = options;

        // Create notification element
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.innerHTML = `
            <span>${message}</span>
            <button class="notification-close">&times;</button>
        `;

        // Add styles
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 15px 20px;
            border-radius: 8px;
            color: white;
            font-weight: 500;
            z-index: 10000;
            display: flex;
            align-items: center;
            justify-content: space-between;
            min-width: 300px;
            max-width: 400px;
            animation: slideIn 0.3s ease;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        `;

        if (type === 'success') {
            notification.style.background = '#2ecc71';
        } else if (type === 'error') {
            notification.style.background = '#e74c3c';
        } else {
            notification.style.background = '#3498db';
        }

        // Close button
        const closeBtn = notification.querySelector('.notification-close');
        closeBtn?.addEventListener('click', () => {
            notification.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => notification.remove(), 300);
        });

        // Auto-close after 5 seconds
        setTimeout(() => {
            if (notification.parentNode) {
                notification.style.animation = 'slideOut 0.3s ease';
                setTimeout(() => notification.remove(), 300);
            }
        }, 5000);

        // Add to DOM
        document.body.appendChild(notification);

        // Add animation styles if missing
        if (!document.querySelector('style[data-notification-animations]')) {
            const style = document.createElement('style');
            style.setAttribute('data-notification-animations', 'true');
            style.textContent = `
                @keyframes slideIn {
                    from {
                        transform: translateX(100%);
                        opacity: 0;
                    }
                    to {
                        transform: translateX(0);
                        opacity: 1;
                    }
                }
                @keyframes slideOut {
                    from {
                        transform: translateX(0);
                        opacity: 1;
                    }
                    to {
                        transform: translateX(100%);
                        opacity: 0;
                    }
                }
            `;
            document.head.appendChild(style);
        }
    }

    private setupEventListeners(): void {
        // Refresh button
        this.refreshBtn?.addEventListener('click', () => {
            this.refreshData(false);
        });

        // Modal window
        this.closeModalBtn?.addEventListener('click', () => {
            this.modal?.classList.remove('active');
        });

        this.modal?.addEventListener('click', (e: Event) => {
            if (e.target === this.modal && this.modal) {
                this.modal.classList.remove('active');
            }
        });

        // Handlers for service row buttons
        this.serviceRows.forEach((row: HTMLElement) => {
            const serviceId = row.getAttribute('data-service-id') || '';
            const serviceName = row.querySelector('.service-name')?.textContent?.trim() || '';
            const checkBtn = row.querySelector('.check-btn');
            const historyBtn = row.querySelector('.history-btn');

            if (!serviceId) {
                console.warn('Service row missing data-service-id attribute', row);
                return;
            }

            checkBtn?.addEventListener('click', () => {
                this.forceCheckService(serviceId, serviceName);
            });

            historyBtn?.addEventListener('click', () => {
                this.loadServiceHistory(serviceId, serviceName);
            });
        });

        // Add history styles if missing
        if (!document.querySelector('style[data-history-styles]')) {
            const historyStyles = document.createElement('style');
            historyStyles.setAttribute('data-history-styles', 'true');
            historyStyles.textContent = `
                .history-table table {
                    width: 100%;
                    border-collapse: collapse;
                }
                .history-table th,
                .history-table td {
                    padding: 10px;
                    border-bottom: 1px solid #e9ecef;
                    text-align: left;
                }
                .history-table th {
                    background: #f8f9fa;
                    font-weight: 600;
                    color: #2c3e50;
                }
                .history-status {
                    padding: 4px 10px;
                    border-radius: 12px;
                    font-size: 0.8rem;
                    font-weight: 600;
                    text-transform: uppercase;
                }
                .history-status.status-success {
                    background: #d4edda;
                    color: #155724;
                }
                .history-status.status-failure {
                    background: #f8d7da;
                    color: #721c24;
                }
                .error-message {
                    font-family: monospace;
                    font-size: 0.85rem;
                    color: #dc3545;
                    max-width: 500px;
                    word-wrap: break-word;
                    white-space: normal;
                }
                .no-history {
                    text-align: center;
                    padding: 40px 20px;
                    color: #6c757d;
                    font-style: italic;
                }
                .history-chart {
                    width: 100%;
                    height: auto;
                    margin-bottom: 20px;
                    background: #fafbfc;
                    border-radius: 8px;
                    border: 1px solid #e9ecef;
                }
                .history-row-selected {
                    background: #fff3cd !important;
                    outline: 2px solid #ffc107;
                    outline-offset: -2px;
                }
                .history-row-selected td {
                    background: #fff3cd !important;
                }
            `;
            document.head.appendChild(historyStyles);
        }
    }

    private setupAutoRefresh(): void {
        // Auto-refresh every 30 seconds
        setInterval(() => this.refreshData(true), 30000);
    }
}

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
    const ui = new MonitoringUI();
    ui.init();
});