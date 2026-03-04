function intToFixedHex(value: number): string {
  return (value >>> 0).toString(16).padStart(8, "0")
}

export function hashUrl(url: string): string {
  let h1 = 0x9e3779b9
  let h2 = 0x85ebca6b

  for (let i = 0; i < url.length; i += 1) {
    const code = url.charCodeAt(i)
    h1 = Math.imul(h1 ^ code, 0x85ebca77)
    h2 = Math.imul(h2 ^ code, 0xc2b2ae3d)
  }

  return `${intToFixedHex(h1)}${intToFixedHex(h2)}`.slice(0, 16)
}
