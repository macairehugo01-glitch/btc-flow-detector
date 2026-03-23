@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700&family=Inter:wght@300;400;500;600;700&display=swap');

@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --bg-primary: #0a0b0e;
  --bg-secondary: #0f1117;
  --bg-card: #13151c;
  --bg-hover: #1a1d27;
  --bg-border: #1e2130;

  --accent-green: #00d4a8;
  --accent-red: #ff4757;
  --accent-yellow: #ffd43b;
  --accent-blue: #4dabf7;
  --accent-purple: #9775fa;

  --text-primary: #e8eaf0;
  --text-secondary: #8892a4;
  --text-muted: #4a5568;
}

* {
  box-sizing: border-box;
  padding: 0;
  margin: 0;
}

html,
body {
  max-width: 100vw;
  overflow-x: hidden;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-family: 'Inter', system-ui, sans-serif;
}

/* Scrollbar styling */
::-webkit-scrollbar {
  width: 4px;
  height: 4px;
}

::-webkit-scrollbar-track {
  background: var(--bg-secondary);
}

::-webkit-scrollbar-thumb {
  background: var(--bg-border);
  border-radius: 2px;
}

::-webkit-scrollbar-thumb:hover {
  background: var(--text-muted);
}

/* Chart containers */
.chart-container {
  position: relative;
  width: 100%;
}

/* Mono font for prices/numbers */
.font-mono {
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
}

/* Glowing effects */
.glow-green {
  box-shadow: 0 0 12px rgba(0, 212, 168, 0.2);
}

.glow-red {
  box-shadow: 0 0 12px rgba(255, 71, 87, 0.2);
}

.glow-yellow {
  box-shadow: 0 0 12px rgba(255, 212, 59, 0.15);
}

/* Signal badge animations */
@keyframes signal-pulse {
  0%, 100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.7;
    transform: scale(0.98);
  }
}

.signal-active {
  animation: signal-pulse 2s ease-in-out infinite;
}

/* Scan line effect on cards */
.scan-line::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(0, 212, 168, 0.3), transparent);
  animation: scan 4s linear infinite;
}

@keyframes scan {
  0% { transform: translateY(0); opacity: 0; }
  10% { opacity: 1; }
  90% { opacity: 1; }
  100% { transform: translateY(100%); opacity: 0; }
}

/* Blink cursor */
.cursor-blink::after {
  content: '|';
  animation: blink 1s step-end infinite;
  color: var(--accent-green);
}

@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}
