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

class MonitoringUI {
    private refreshBtn: HTMLElement | null;
    private lastUpdateTime: HTMLElement | null;
    private modal: HTMLElement | null;
    private closeModalBtn: HTMLElement | null;
    private historyContent: HTMLElement | null;
    private serviceRows: NodeListOf<HTMLElement>;

    constructor() {
        this.refreshBtn = document.getElementById('refresh-btn');
        this.lastUpdateTime = document.getElementById('last-update-time');
        this.modal = document.getElementById('history-modal');
        this.closeModalBtn = document.querySelector('.close-modal');
        this.historyContent = document.getElementById('history-content');
        this.serviceRows = document.querySelectorAll('.service-row');
        
        console.log('MonitoringUI constructor:', {
            refreshBtn: this.refreshBtn,
            lastUpdateTime: this.lastUpdateTime,
            modal: this.modal,
            closeModalBtn: this.closeModalBtn,
            historyContent: this.historyContent,
            serviceRowsCount: this.serviceRows.length
        });
    }

    public init(): void {
        this.setupEventListeners();
        this.updateLastUpdateTime();
        this.setupAutoRefresh();
    }

    private updateLastUpdateTime(): void {
        if (!this.lastUpdateTime) return;
        const now = new Date();
        this.lastUpdateTime.textContent = now.toLocaleTimeString();
    }

    // Обновление данных через API
    public async refreshData(silent: boolean = false): Promise<void> {
        try {
            const response = await fetch('/api/status');
            const data = await response.json() as APIResponse<Service[]>;

            if (data.success && data.data) {
                this.updateServicesTable(data.data);
                this.updateStatsCards(data.data);
                this.updateLastUpdateTime();
                if (!silent) {
                    this.showNotification({ message: 'Данные обновлены', type: 'success' });
                }
            }
        } catch (error) {
            console.error('Ошибка при обновлении данных:', error);
            if (!silent) {
                this.showNotification({ 
                    message: 'Ошибка при обновлении данных', 
                    type: 'error' 
                });
            }
        }
    }

    private updateServicesTable(services: Service[]): void {
        services.forEach(service => {
            const row = document.querySelector(`.service-row[data-service-id="${service.id}"]`);
            if (!row) return;

            // Обновление статуса
            const statusBadge = row.querySelector('.status-badge');
            if (statusBadge) {
                statusBadge.className = `status-badge status-${service.status.toLowerCase()}`;
                statusBadge.textContent = service.status;
            }

            // Обновление счетчика неудач
            const failureCount = row.querySelector('.failure-count');
            if (failureCount) {
                failureCount.textContent = service.failureCount.toString();
            }

            // Обновление времени последней проверки
            const lastCheckCell = row.querySelector('.service-last-check');
            if (lastCheckCell && service.lastCheck) {
                lastCheckCell.textContent = new Date(service.lastCheck * 1000).toLocaleString();
            }
        });
    }

    private updateStatsCards(services: Service[]): void {
        const total = services.length;
        const okCount = services.filter(s => s.status === 'OK').length;
        const warningCount = services.filter(s => s.status === 'WARNING').length;
        const errorCount = services.filter(s => s.status === 'ERROR').length;

        // Обновляем DOM
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
        console.log('loadServiceHistory called:', serviceId, serviceName);
        try {
            const response = await fetch(`/api/service/${serviceId}/checks?limit=20`);
            const data = await response.json() as APIResponse<ChecksResponse>;
            console.log('History API response:', data);

            if (data.success && data.data) {
                this.showHistoryModal(serviceName, data.data.checks);
            } else {
                console.log('History API error:', data.error);
            }
        } catch (error) {
            console.error('Ошибка при загрузке истории:', error);
            this.showNotification({
                message: 'Ошибка при загрузке истории',
                type: 'error'
            });
        }
    }

    private showHistoryModal(serviceName: string, checks: Check[]): void {
        const modal = this.modal;
        const historyContent = this.historyContent;
        console.log('showHistoryModal called:', serviceName, checks.length, modal, historyContent);
        if (!modal || !historyContent) {
            console.error('Modal or historyContent not found');
            return;
        }

        // Обновляем заголовок
        const header = modal.querySelector('.modal-header h3');
        if (header) {
            header.textContent = `История проверок: ${serviceName}`;
        }

        // Генерируем контент
        let html = '';

        if (checks.length === 0) {
            html = '<p class="no-history">История проверок отсутствует</p>';
        } else {
            html = `
                <div class="history-table">
                    <table>
                        <thead>
                            <tr>
                                <th>Время</th>
                                <th>Статус</th>
                                <th>Время отклика</th>
                                <th>Ошибка</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${checks.map(check => `
                                <tr>
                                    <td>${new Date(check.checkedAt * 1000).toLocaleString()}</td>
                                    <td>
                                        <span class="history-status status-${check.status}">
                                            ${check.status === 'success' ? 'Успех' : 'Ошибка'}
                                        </span>
                                    </td>
                                    <td>${check.responseTime ? check.responseTime + 'мс' : '—'}</td>
                                    <td class="error-message">${check.errorMessage || '—'}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;
        }

        historyContent.innerHTML = html;
        console.log('Adding active class to modal, current classes:', modal.className);
        modal.classList.add('active');
        console.log('After adding active class:', modal.className);
    }

    private async forceCheckService(serviceId: string, serviceName: string): Promise<void> {
        try {
            const response = await fetch(`/api/service/${serviceId}/check`, {
                method: 'POST'
            });
            const data = await response.json() as APIResponse<any>;

            if (data.success) {
                this.showNotification({ 
                    message: `Проверка сервиса "${serviceName}" выполнена`, 
                    type: 'success' 
                });
                // Обновляем данные через 1 секунду
                setTimeout(() => this.refreshData(true), 1000);
            } else {
                this.showNotification({ 
                    message: `Ошибка при проверке: ${data.error}`, 
                    type: 'error' 
                });
            }
        } catch (error) {
            console.error('Ошибка при принудительной проверке:', error);
            this.showNotification({ 
                message: 'Ошибка при принудительной проверке', 
                type: 'error' 
            });
        }
    }

    private showNotification(options: NotificationOptions): void {
        const { message, type = 'info' } = options;

        // Создаем элемент уведомления
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.innerHTML = `
            <span>${message}</span>
            <button class="notification-close">&times;</button>
        `;

        // Добавляем стили
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

        // Кнопка закрытия
        const closeBtn = notification.querySelector('.notification-close');
        closeBtn?.addEventListener('click', () => {
            notification.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => notification.remove(), 300);
        });

        // Автоматическое закрытие через 5 секунд
        setTimeout(() => {
            if (notification.parentNode) {
                notification.style.animation = 'slideOut 0.3s ease';
                setTimeout(() => notification.remove(), 300);
            }
        }, 5000);

        // Добавляем в DOM
        document.body.appendChild(notification);

        // Добавляем стили анимации если их нет
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
        // Кнопка обновления
        this.refreshBtn?.addEventListener('click', () => {
            this.refreshData(false);
        });

        // Модальное окно
        this.closeModalBtn?.addEventListener('click', () => {
            this.modal?.classList.remove('active');
        });

        this.modal?.addEventListener('click', (e: Event) => {
            if (e.target === this.modal && this.modal) {
                this.modal.classList.remove('active');
            }
        });

        // Обработчики для кнопок в строках сервисов
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

        // Добавляем стили для истории если их нет
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
        // Автоматическое обновление каждые 30 секунд
        setInterval(() => this.refreshData(true), 30000);
    }
}

// Инициализация при загрузке DOM
document.addEventListener('DOMContentLoaded', () => {
    const ui = new MonitoringUI();
    ui.init();
});