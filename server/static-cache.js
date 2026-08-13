const NO_STORE = "no-cache, no-store, must-revalidate";

export function staticResponseHeaders(pathname, contentType, { fallback = false } = {}) {
  const isHtml = fallback || pathname === "/" || pathname.endsWith(".html");
  if (isHtml) {
    return {
      "content-type": contentType,
      "cache-control": NO_STORE,
      pragma: "no-cache",
      expires: "0",
    };
  }

  const fingerprintedAsset = /^\/assets\/[^/]+-[A-Za-z0-9_-]+\.(?:css|js)$/.test(pathname);
  return {
    "content-type": contentType,
    "cache-control": fingerprintedAsset
      ? "public, max-age=31536000, immutable"
      : "public, max-age=3600",
  };
}
