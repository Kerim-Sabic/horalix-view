type ImageCache = Map<string, HTMLImageElement>;
type InflightTracker = Set<string>;

export const touchImageCache = (
  cache: ImageCache,
  url: string,
  image: HTMLImageElement,
  maxSize: number,
) => {
  if (cache.has(url)) {
    cache.delete(url);
  }
  cache.set(url, image);
  while (cache.size > maxSize) {
    const oldest = cache.keys().next().value;
    if (!oldest) break;
    cache.delete(oldest);
  }
};

export const preloadImage = (
  cache: ImageCache,
  inflight: InflightTracker,
  url: string,
  maxSize: number,
) => {
  if (!url) return;
  const existing = cache.get(url);
  if (existing) {
    touchImageCache(cache, url, existing, maxSize);
    return;
  }
  if (inflight.has(url)) return;
  inflight.add(url);
  const image = new Image();
  image.decoding = 'async';
  image.onload = () => inflight.delete(url);
  image.onerror = () => inflight.delete(url);
  image.src = url;
  touchImageCache(cache, url, image, maxSize);
};
