export function isHackerNewsItemUrl(url: string): boolean {
  return /^https?:\/\/news\.ycombinator\.com\/item\?id=\d+/.test(url)
}

export function isSemanticCaptureSupportedUrl(url: string | undefined): boolean {
  return /^https?:\/\//.test(url ?? "")
}
