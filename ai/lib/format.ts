export function formatPrice(value: number, empty = '-') {
  if (!Number.isFinite(value)) return empty
  if (value === 0) return '0.00'
  const magnitude = Math.abs(value)
  if (magnitude >= 1000) {
    return value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }
  if (magnitude >= 1) return value.toFixed(2)
  if (magnitude >= 0.01) return value.toFixed(4)
  if (magnitude >= 0.0001) return value.toFixed(6)
  const digits = Math.min(12, Math.max(8, Math.ceil(-Math.log10(magnitude)) + 3))
  return value.toFixed(digits).replace(/0+$/, '').replace(/\.$/, '')
}

export function formatMoney(value: number) {
  return value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function formatSignedMoney(value: number) {
  return `${value >= 0 ? '+' : '-'}$${formatMoney(Math.abs(value))}`
}
