import net from 'net';

/**
 * TCP ping - проверка доступности хоста через TCP соединение
 * @param host - хост или IP адрес
 * @param port - порт (по умолчанию 80)
 * @param timeout - таймаут в миллисекундах
 * @returns true если хост доступен
 */
function tcpPing(host: string, port = 80, timeout = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let resolved = false;

    const onSuccess = () => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        resolve(true);
      }
    };

    const onError = (err?: Error) => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        resolve(false);
      }
    };

    socket.setTimeout(timeout);

    socket.on('connect', onSuccess);
    socket.on('timeout', onError);
    socket.on('error', onError);

    try {
      socket.connect(port, host);
    } catch (err) {
      onError(err as Error);
    }
  });
}

/**
 * Проверка доступности IP адреса с автоопределением порта
 * @param address - IP адрес или хост
 * @param timeout - таймаут в миллисекундах
 * @returns true если хост доступен
 */
async function checkIpAddress(address: string, timeout = 5000): Promise<boolean> {
  // Пытаемся определить порт по умолчанию
  // Если адрес содержит порт (например, 1.1.1.1:53), используем его
  let host = address;
  let port = 80;

  if (address.includes(':')) {
    const parts = address.split(':');
    host = parts[0];
    const portPart = parseInt(parts[1], 10);
    if (!isNaN(portPart) && portPart > 0 && portPart <= 65535) {
      port = portPart;
    }
  }

  // Пробуем несколько стандартных портов
  const commonPorts = [80, 443, 22, 53, 8080];

  for (const testPort of commonPorts) {
    try {
      const isAlive = await tcpPing(host, testPort, timeout);
      if (isAlive) {
        return true;
      }
    } catch (err) {
      // Продолжаем пробовать другие порты
    }
  }

  // Если ни один порт не ответил, пробуем указанный порт (или 80 по умолчанию)
  return tcpPing(host, port, timeout);
}

export {
  tcpPing,
  checkIpAddress
};