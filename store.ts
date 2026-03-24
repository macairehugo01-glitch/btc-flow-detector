const setups: unknown[] = []

export function saveSetup(data: unknown) {
  setups.push(data)
  return data
}

export function getRecentSetups() {
  return setups.slice(-10)
}

export function getStats() {
  return {
    total: setups.length,
  }
}
