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
            const response = await this.apiFetch(`/api/service/${serviceId}/checks?limit=20`);
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

        // Generate content
        let html = '';

        if (checks.length === 0) {
            html = '<p class="no-history">No check history available</p>';
        } else {
            html = `
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
                            ${checks.map(check => `
                                <tr>
                                    <td>${dateFormatter.format(check.checkedAt * 1000)}</td>
                                    <td>
                                        <span class="history-status status-${check.status}">
                                            ${check.status === 'success' ? 'Success' : 'Error'}
                                        </span>
                                    </td>
                                    <td>${check.responseTime ? check.responseTime + 'ms' : '—'}</td>
                                    <td class="error-message">${check.errorMessage || '—'}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;
        }

        historyContent.innerHTML = html;
        modal.classList.add('active');
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
                    max-width: 200px;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                .no-history {
                    text-align: center;
                    padding: 40px 20px;
                    color: #6c757d;
                    font-style: italic;
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