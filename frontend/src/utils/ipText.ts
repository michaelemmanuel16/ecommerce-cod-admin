/** The address as a person reads it: the IPv4-in-IPv6 prefix is dropped, and a loopback address (a local run) says so. */
export const ipText = (ip: string): string => {
  const plain = ip.replace(/^::ffff:/i, '');
  return plain === '::1' || plain === '127.0.0.1' ? 'this computer' : plain;
};
