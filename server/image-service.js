export function imageServiceRoute(path, method) {
  const suffix = path.replace(/^\/api\/images/, '');
  if (method === 'GET' && suffix === '/health') return suffix;
  if (method === 'POST' && suffix === '/jobs') return suffix;
  if (method === 'GET' && /^\/(jobs|images)\/[a-f0-9]{32}$/.test(suffix)) return suffix;
  throw new Error('Unsupported image service request.');
}
