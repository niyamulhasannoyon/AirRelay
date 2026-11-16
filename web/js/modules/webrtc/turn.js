class Turn {
  _username = null;
  _credential = null;
  _expiration = null;

  getServers = async () => {
    try {
      await this._getCredentials();
    } catch (err) {
      console.warn('Could not fetch TURN credentials, falling back to public STUN:', err);
    }

    const host = window.location.hostname;
    // Always provide resilient Google STUN servers for WebRTC direct NAT traversal
    const servers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
    ];

    const isLocal = !host || host === 'localhost' || host === '127.0.0.1' || host.startsWith('192.168.') || host.startsWith('10.');
    if (isLocal) {
      servers.push({ urls: `stun:${host}:3478` });
    }

    // Include TURN relay endpoints if credentials were successfully minted
    if (this._username && this._credential) {
      servers.push({
        urls: [
          `turn:${host}:3478`,
          `turn:${host}:3478?transport=tcp`,
        ],
        username: this._username,
        credential: this._credential,
      });
    }

    return servers;
  };

  _getCredentials = async (retries = 3, timeoutMs = 5000) => {
    const now = Math.floor(Date.now() / 1000);

    // Check if cached token is still valid
    if (this._expiration !== null && this._expiration > now) {
      return { username: this._username, credential: this._credential };
    }

    let lastError = null;
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

        const response = await fetch("/api/credentials", {
          method: "GET",
          signal: controller ? controller.signal : undefined,
        });
        if (timer) clearTimeout(timer);

        if (!response.ok) {
          throw new Error(`Credential endpoint returned HTTP ${response.status}`);
        }

        const data = await response.json();
        const token = data?.token;
        if (!token) throw new Error("No token in credential response");

        const payload = this._decodeJwt(token);
        this._username = payload.username;
        this._credential = payload.credential;
        this._expiration = payload.exp - 10; // Subtract 10 seconds for safety
        return { username: this._username, credential: this._credential };
      } catch (err) {
        lastError = err;
        if (attempt < retries) {
          await new Promise(r => setTimeout(r, attempt * 800));
        }
      }
    }

    throw lastError || new Error("Failed to get credentials after retries.");
  };

  _decodeJwt(token) {
    // JWTs are base64url-encoded (with padding stripped); normalize for atob().
    const parts = (token || '').split('.');
    if (parts.length < 2) throw new Error('Malformed JWT.');
    let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4 !== 0) b64 += '=';
    return JSON.parse(atob(b64));
  }
}

export const turn = new Turn();
