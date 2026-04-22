import net from 'net';

/**
 * TCP ping - host availability check via TCP connection
 * @param host - host or IP address
 * @param port - port (default 80)
 * @param timeout - timeout in milliseconds
 * @returns true if host is available
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
 * IP address availability check with automatic port detection
 * @param address - IP address or host
 * @param timeout - timeout in milliseconds
 * @returns true if host is available
 */
async function checkIpAddress(address: string, timeout = 5000): Promise<boolean> {
  // Try to determine default port
  // If address contains port (e.g., 1.1.1.1:53), use it
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

  // Try several standard ports
  const commonPorts = [80, 443, 22, 53, 8080];

  for (const testPort of commonPorts) {
    try {
      const isAlive = await tcpPing(host, testPort, timeout);
      if (isAlive) {
        return true;
      }
    } catch (err) {
      // Continue trying other ports
    }
  }

  // If no port responded, try specified port (or 80 by default)
  return tcpPing(host, port, timeout);
}

export {
  tcpPing,
  checkIpAddress
};