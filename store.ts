// ═════════════════════════════════════════════════════════════════════════
// PATCH store.ts — 3 modifications PRÉCISES, rien d'autre à toucher.
// Chaque bloc ci-dessous montre AVANT → APRÈS pour un endroit du fichier.
// ═════════════════════════════════════════════════════════════════════════

// ─── 1. Étendre le type SlotKey ────────────────────────────────────────────

// AVANT :
// export type SlotKey = 'BTC-1h' | 'ETH-1h' | 'SOL-1h' | 'XRP-1h'

// APRÈS :
export type SlotKey =
  | 'BTC-1h' | 'ETH-1h' | 'SOL-1h' | 'XRP-1h'
  | 'BTC-15m-v2' | 'ETH-15m-v2' | 'SOL-15m-v2'


// ─── 2. Étendre ALL_SLOTS ───────────────────────────────────────────────────

// AVANT :
// const ALL_SLOTS: SlotKey[] = ['BTC-1h', 'ETH-1h', 'SOL-1h', 'XRP-1h']

// APRÈS :
const ALL_SLOTS: SlotKey[] = [
  'BTC-1h', 'ETH-1h', 'SOL-1h', 'XRP-1h',
  'BTC-15m-v2', 'ETH-15m-v2', 'SOL-15m-v2',
]


// ─── 3. Étendre initialState.slots ──────────────────────────────────────────

// AVANT :
// const initialState: PersistedState = {
//   setups: [],
//   slots: {
//     'BTC-1h': { ...DEFAULT_SLOT },
//     'ETH-1h': { ...DEFAULT_SLOT },
//     'SOL-1h': { ...DEFAULT_SLOT },
//     'XRP-1h': { ...DEFAULT_SLOT },
//   },
// }

// APRÈS :
const initialState: PersistedState = {
  setups: [],
  slots: {
    'BTC-1h': { ...DEFAULT_SLOT },
    'ETH-1h': { ...DEFAULT_SLOT },
    'SOL-1h': { ...DEFAULT_SLOT },
    'XRP-1h': { ...DEFAULT_SLOT },
    'BTC-15m-v2': { ...DEFAULT_SLOT },
    'ETH-15m-v2': { ...DEFAULT_SLOT },
    'SOL-15m-v2': { ...DEFAULT_SLOT },
  },
}

// ─── RIEN D'AUTRE À CHANGER ─────────────────────────────────────────────────
// La boucle de migration existante :
//   for (const slot of ALL_SLOTS) { if (!state.slots[slot]) state.slots[slot] = { ...DEFAULT_SLOT } }
// initialisera automatiquement les 3 nouveaux slots au premier démarrage
// après déploiement (fichier journal existant sans ces clés). Aucune
// modification de cette boucle n'est nécessaire.
//
// getSlotStats(), getAllPositions() itèrent déjà sur ALL_SLOTS — elles
// incluront automatiquement les 3 nouveaux slots une fois le patch
// ci-dessus appliqué, sans modification supplémentaire.
