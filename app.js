// Bulk Trade Leaderboard — Frontend Logic (Hybrid Technical Redesign)
// ═════════════════════════════════════════════════════════════════════════

const API_BASE = window.location.origin.startsWith('http') ? window.location.origin : 'http://localhost:3000';
const REFRESH_INTERVAL = 15000;

let currentPeriod = 'day';

// Formatting Helpers
const formatUSD = (val) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val);
const formatCompact = (val) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 }).format(val);
const formatNumber = (val) => new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(val);
const shortenAddress = (addr) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;
const formatTime = (ts) => {
    if (!ts) return '—';
    const diff = Date.now() - ts;
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff/60000)}m ago`;
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

// Data Fetching
async function updateStats() {
    try {
        const [internalRes, externalRes] = await Promise.all([
            fetch(`${API_BASE}/api/stats`),
            fetch(`${API_BASE}/api/overview`)
        ]);

        const internal = await internalRes.json();
        const external = await externalRes.json();

        // Update Internal Stats
        document.getElementById('stat-active-24h').textContent = formatNumber(internal.users.today);
        document.getElementById('stat-total-users').textContent = formatNumber(internal.users.total);
        document.getElementById('stat-volume-24h').textContent = formatCompact(internal.volume.today);
        document.getElementById('stat-volume-7d').textContent = formatCompact(internal.volume.week);

        // Update External (Bulk API) Stats
        if (external && !external.error) {
            const oi = parseFloat(external.openInterest?.totalUsd || 0) || 0;
            document.getElementById('stat-oi').textContent = formatCompact(oi);
            const change = parseFloat(external.volume24hChange || 0) || 0;
            const changeEl = document.getElementById('stat-change');
            changeEl.textContent = `${change > 0 ? '+' : ''}${change.toFixed(2)}%`;
            changeEl.style.color = change >= 0 ? 'var(--neon-green)' : 'var(--neon-red)';
        }

        document.getElementById('connection-status').className = 'status-badge status-live';
    } catch (err) {
        console.error('Stats Update Error:', err);
        document.getElementById('connection-status').className = 'status-badge status-error';
    }
}

async function updateLeaderboard() {
    try {
        const res = await fetch(`${API_BASE}/api/leaderboard?period=${currentPeriod}`);
        const data = await res.json();

        const tbody = document.getElementById('leaderboard-body');
        tbody.innerHTML = '';

        if (data.traders && data.traders.length > 0) {
            data.traders.forEach(trader => {
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td><span class="rank-val">#${trader.rank}</span></td>
                    <td>
                        <div class="address-val" title="${trader.address}">
                            ${shortenAddress(trader.address)}
                        </div>
                    </td>
                    <td>${formatNumber(trader.tradeCount)}</td>
                    <td><span class="vol-val">${formatUSD(trader.totalVolume)}</span></td>
                    <td><span style="color: var(--text-secondary); font-size: 0.8rem;">${formatTime(trader.lastTrade)}</span></td>
                `;
                tbody.appendChild(row);
            });
        } else {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 3rem; color: var(--text-secondary);">No data found for this period.</td></tr>`;
        }
    } catch (err) {
        console.error('Leaderboard Update Error:', err);
    }
}

// Event Listeners
document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentPeriod = btn.dataset.period;
        updateLeaderboard();
    });
});

// Init
function init() {
    updateStats();
    updateLeaderboard();
    setInterval(updateStats, REFRESH_INTERVAL);
    setInterval(updateLeaderboard, REFRESH_INTERVAL);
}

document.addEventListener('DOMContentLoaded', init);
