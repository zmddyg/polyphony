import { lookup } from 'node:dns';
import { request } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { Readable } from 'node:stream';
import { checkServerIdentity } from 'node:tls';

const excludedAddresses = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3],
]) excludedAddresses.addSubnet(network, prefix, 'ipv4');
for (const [network, prefix] of [
  ['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20],
]) excludedAddresses.addSubnet(network, prefix, 'ipv6');
const globalUnicast = new BlockList();
globalUnicast.addSubnet('2000::', 3, 'ipv6');
const tunRange = new BlockList();
tunRange.addSubnet('198.18.0.0', 15, 'ipv4');

export function isPublicAddress(address, allowTunAddress = false) {
  const family = isIP(address);
  if (family === 4) return !excludedAddresses.check(address, 'ipv4') &&
    (allowTunAddress || !tunRange.check(address, 'ipv4'));
  return family === 6 && globalUnicast.check(address, 'ipv6') && !excludedAddresses.check(address, 'ipv6');
}

const rejectedHost = () => new Error('外部资料服务需要白名单中的 HTTPS 域名与可访问地址。');

export function createPinnedHttpsFetch(allowUrl) {
  return function pinnedHttpsFetch(value, { signal, headers } = {}) {
    const url = allowUrl(value instanceof URL ? value.href : value);
    if (!url || url.protocol !== 'https:' || url.hostname.startsWith('[') || isIP(url.hostname)) {
      return Promise.reject(rejectedHost());
    }

    // Only the exact allowlisted hostname may use a TUN Fake-IP. Preserve the
    // hostname for TLS verification and return only screened DNS answers.
    function publicLookup(hostname, options, callback) {
      if (hostname !== url.hostname) return callback(rejectedHost());
      lookup(hostname, { all: true }, (error, addresses) => {
        if (error) return callback(error);
        const eligible = addresses.filter(entry => !options.family || entry.family === options.family);
        if (!eligible.length || addresses.some(entry => !isPublicAddress(entry.address, true))) {
          return callback(rejectedHost());
        }
        if (options.all) callback(null, eligible);
        else callback(null, eligible[0].address, eligible[0].family);
      });
    }

    return new Promise((resolve, reject) => {
      const req = request(url, {
        method: 'GET', signal, headers, lookup: publicLookup, agent: false,
        servername: url.hostname, checkServerIdentity, rejectUnauthorized: true,
      }, response => {
        const status = response.statusCode;
        resolve({
          status, ok: status >= 200 && status < 300, url: url.href, redirected: false,
          headers: new Headers(response.headers), body: Readable.toWeb(response),
        });
      });
      req.once('error', reject);
      req.end();
    });
  };
}
