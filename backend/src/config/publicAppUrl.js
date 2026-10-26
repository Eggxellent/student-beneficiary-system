const { isIP } = require('node:net');

function normalizeHostname(hostname) {
  return hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.+$/, '');
}

function getIPv4Octets(hostname) {
  if (isIP(hostname) !== 4) return null;
  return hostname.split('.').map(Number);
}

function isNonPublicIPv4(hostname) {
  const octets = getIPv4Octets(hostname);
  if (!octets) return false;

  const [a, b, c] = octets;
  return a === 0
    || a === 10
    || a === 127
    || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 192 && b === 0 && (c === 0 || c === 2))
    || (a === 192 && b === 88 && c === 99)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113);
}

function parseIPv6Words(hostname) {
  let address = hostname.toLowerCase();

  if (address.includes('.')) {
    const lastColon = address.lastIndexOf(':');
    const embeddedIPv4 = address.slice(lastColon + 1);
    const octets = getIPv4Octets(embeddedIPv4);
    if (!octets) return null;

    const high = ((octets[0] << 8) | octets[1]).toString(16);
    const low = ((octets[2] << 8) | octets[3]).toString(16);
    address = `${address.slice(0, lastColon + 1)}${high}:${low}`;
  }

  const halves = address.split('::');
  if (halves.length > 2) return null;

  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const gap = halves.length === 2 ? 8 - left.length - right.length : 0;
  if ((halves.length === 2 && gap < 1) || (halves.length === 1 && left.length !== 8)) return null;

  const parts = halves.length === 2 ? [...left, ...Array(gap).fill('0'), ...right] : left;
  if (parts.length !== 8 || parts.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  return parts.map((part) => parseInt(part, 16));
}

function isNonPublicIPv6(hostname) {
  if (isIP(hostname) !== 6) return false;

  const words = parseIPv6Words(hostname);
  if (!words) return true;
  const firstFiveZero = words.slice(0, 5).every((word) => word === 0);
  const firstSixZero = words.slice(0, 6).every((word) => word === 0);

  if (words.every((word) => word === 0)) return true;
  if (firstSixZero && words[6] === 0 && words[7] === 1) return true;

  // Preserve IPv4-mapped IPv6 only when its embedded IPv4 address is public.
  if (firstFiveZero && words[5] === 0xffff) {
    const embeddedIPv4 = `${words[6] >> 8}.${words[6] & 0xff}.${words[7] >> 8}.${words[7] & 0xff}`;
    return isNonPublicIPv4(embeddedIPv4);
  }

  // Deprecated IPv4-compatible IPv6 addresses are not public verification origins.
  if (firstSixZero) return true;

  const first = words[0];
  const second = words[1];
  const third = words[2];
  const inGlobalUnicast = first >= 0x2000 && first <= 0x3fff;
  const documentation = first === 0x2001 && second === 0x0db8;
  const benchmarking = first === 0x2001 && second === 0x0002 && third === 0;
  const orchid = first === 0x2001 && (second & 0xfff0) === 0x0010;
  const orchidV2 = first === 0x2001 && (second & 0xfff0) === 0x0020;
  const sixToFour = first === 0x2002;

  return !inGlobalUnicast || documentation || benchmarking || orchid || orchidV2 || sixToFour;
}

function isLocalHostname(hostname) {
  return hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname === 'localhost.localdomain'
    || hostname.endsWith('.localhost.localdomain')
    || ['localhost4', 'localhost6', 'localhost4.localdomain4', 'localhost6.localdomain6'].includes(hostname);
}

function isLoopbackAddress(hostname) {
  const octets = getIPv4Octets(hostname);
  if (octets) return octets[0] === 127;
  if (isIP(hostname) !== 6) return false;
  const words = parseIPv6Words(hostname);
  return Boolean(words && words.slice(0, 7).every((word) => word === 0) && words[7] === 1);
}

function isReservedHostname(hostname) {
  const reservedExampleDomains = ['example.com', 'example.net', 'example.org'];
  return !hostname.includes('.')
    || /\.(?:local|localdomain|lan|home|internal|intranet|test|invalid|example)$/.test(hostname)
    || hostname.endsWith('.home.arpa')
    || reservedExampleDomains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

function getPublicAppOrigin(value = process.env.PUBLIC_APP_URL, nodeEnv = process.env.NODE_ENV) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('PUBLIC_APP_URL is required to generate student QR codes');
  }

  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error('PUBLIC_APP_URL must be an absolute HTTP or HTTPS origin');
  }

  const authority = value.trim().match(/^[a-z][a-z\d+.-]*:\/\/([^/?#]*)/i)?.[1] || '';
  const hostname = normalizeHostname(parsed.hostname);
  const ipVersion = isIP(hostname);
  // Local HTTP is allowed only with NODE_ENV=development and the documented loopback PUBLIC_APP_URL.
  const localDevelopment = nodeEnv === 'development'
    && (isLocalHostname(hostname) || isLoopbackAddress(hostname));
  const nonPublicAddress = ipVersion === 4
    ? isNonPublicIPv4(hostname)
    : ipVersion === 6
      ? isNonPublicIPv6(hostname)
      : isLocalHostname(hostname) || isReservedHostname(hostname);
  const invalidProtocol = !['http:', 'https:'].includes(parsed.protocol)
    || (parsed.protocol === 'http:' && !localDevelopment)
    || (parsed.protocol === 'https:' && nonPublicAddress && !localDevelopment);

  if (
    !authority
    || authority.includes('@')
    || parsed.username
    || parsed.password
    || parsed.pathname !== '/'
    || parsed.search
    || parsed.hash
    || invalidProtocol
    || (nonPublicAddress && !localDevelopment)
    || (nodeEnv === 'production' && parsed.protocol !== 'https:')
  ) {
    throw new Error('PUBLIC_APP_URL must be a public HTTPS origin; only explicit NODE_ENV=development permits local loopback URLs');
  }

  return parsed.origin;
}

function buildStudentVerificationUrl(token, value = process.env.PUBLIC_APP_URL, nodeEnv = process.env.NODE_ENV) {
  const url = new URL('/verify', getPublicAppOrigin(value, nodeEnv));
  url.hash = new URLSearchParams({ token }).toString();
  return url.toString();
}

module.exports = { getPublicAppOrigin, buildStudentVerificationUrl };
