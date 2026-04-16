// ============================================================
// HANDBALL TRACKER - LIVE BROADCASTING MODULE
// ============================================================
// Add this to your existing handball tracker HTML
// This enables coaches to broadcast matches live to fans
// ============================================================

// Global variables for live broadcasting
let currentLiveMatchId = null;
let isLiveBroadcasting = false;
let liveUpdateQueue = [];
let processingQueue = false;

// ============================================================
// 1. INITIALIZE LIVE MATCH
// ============================================================

/**
 * Start broadcasting the current match live
 * Call this when coach clicks "Start Live Match" button
 */
async function startLiveMatch() {
  if (!currentUser) {
    alert('Please sign in to broadcast live matches');
    return;
  }

  if (!teamName || !opponent) {
    alert('Please set team names first');
    return;
  }

  try {
    // Create live match record
    const { data, error } = await _supabase
      .from('live_matches')
      .insert({
        coach_user_id: currentUser.id,
        team_name: teamName,
        opponent: opponent,
        is_live: true,
        score_home: stats.goals || 0,
        score_away: stats.goalsAgainst || 0,
        match_time_seconds: matchTimerSeconds || 0,
        current_half: currentHalf === 1 ? 'first' : 'second'
      })
      .select()
      .single();

    if (error) throw error;

    currentLiveMatchId = data.id;
    isLiveBroadcasting = true;

    // Update UI to show live status
    showLiveStatus(true);
    
    // Create shareable link
    const viewerUrl = `${window.location.origin}/watch-live.html?match=${currentLiveMatchId}`;
    showLiveMatchLink(viewerUrl);

    console.log('✅ Live match started:', currentLiveMatchId);
    console.log('📺 Viewer URL:', viewerUrl);

  } catch (error) {
    console.error('Error starting live match:', error);
    alert('Failed to start live match. Please try again.');
    logError('live_match_start_failed', error);
  }
}

/**
 * Stop broadcasting the current match
 */
async function stopLiveMatch() {
  if (!currentLiveMatchId) return;

  try {
    await _supabase.rpc('end_live_match', { 
      p_live_match_id: currentLiveMatchId 
    });

    isLiveBroadcasting = false;
    currentLiveMatchId = null;
    showLiveStatus(false);

    console.log('✅ Live match ended');

  } catch (error) {
    console.error('Error ending live match:', error);
    logError('live_match_end_failed', error);
  }
}

// ============================================================
// 2. BROADCAST EVENTS
// ============================================================

/**
 * Broadcast an event to all viewers
 * This gets called automatically when coaches record events
 */
async function broadcastEvent(eventType, player, detail = '') {
  if (!isLiveBroadcasting || !currentLiveMatchId) return;

  const matchTime = formatMatchTime(matchTimerSeconds);
  
  const eventData = {
    live_match_id: currentLiveMatchId,
    event_type: eventType,
    player_name: player ? player.name : null,
    player_number: player ? player.num : null,
    team_name: teamName,
    match_time_seconds: matchTimerSeconds,
    match_time_display: matchTime,
    score_home: stats.goals,
    score_away: stats.goalsAgainst,
    detail: detail
  };

  // Add to queue for batch processing
  liveUpdateQueue.push({ type: 'event', data: eventData });
  processLiveUpdateQueue();
}

/**
 * Update live match score
 */
async function updateLiveScore() {
  if (!isLiveBroadcasting || !currentLiveMatchId) return;

  liveUpdateQueue.push({
    type: 'score',
    data: {
      live_match_id: currentLiveMatchId,
      score_home: stats.goals,
      score_away: stats.goalsAgainst,
      match_time_seconds: matchTimerSeconds
    }
  });
  
  processLiveUpdateQueue();
}

/**
 * Process queued updates in batches to avoid rate limiting
 */
async function processLiveUpdateQueue() {
  if (processingQueue || liveUpdateQueue.length === 0) return;

  processingQueue = true;

  try {
    const updates = [...liveUpdateQueue];
    liveUpdateQueue = [];

    for (const update of updates) {
      if (update.type === 'event') {
        await _supabase.from('live_events').insert(update.data);
      } else if (update.type === 'score') {
        await _supabase.rpc('update_live_match_score', {
          p_live_match_id: update.data.live_match_id,
          p_score_home: update.data.score_home,
          p_score_away: update.data.score_away
        });
      }
    }
  } catch (error) {
    console.error('Error processing live updates:', error);
    logError('live_update_failed', error);
  } finally {
    processingQueue = false;

    // Process any new items that arrived while we were working
    if (liveUpdateQueue.length > 0) {
      setTimeout(processLiveUpdateQueue, 100);
    }
  }
}

// ============================================================
// 3. HOOK INTO EXISTING TRACKER FUNCTIONS
// ============================================================

/**
 * Wrap existing record functions to broadcast events
 * These replace/enhance your existing functions
 */

// Store original functions
const _originalRecordGoal = window.recordGoal;
const _originalRecordShot = window.recordShot;
const _originalRecordAssist = window.recordAssist;
const _originalRecordYellow = window.recordYellow;
const _originalRecordSuspension = window.recordSuspension;
const _originalRecordRed = window.recordRed;
const _originalConfirmShot = window.confirmShot;

// Enhanced recordGoal
window.recordGoal = function(player) {
  _originalRecordGoal(player);
  broadcastEvent('goal', player);
  updateLiveScore();
};

// Enhanced recordShot
window.recordShot = function(player) {
  _originalRecordShot(player);
  broadcastEvent('shot', player);
};

// Enhanced recordAssist
window.recordAssist = function(player) {
  _originalRecordAssist(player);
  broadcastEvent('assist', player);
};

// Enhanced recordYellow
window.recordYellow = function(player) {
  _originalRecordYellow(player);
  broadcastEvent('yellow', player);
};

// Enhanced recordSuspension
window.recordSuspension = function(player) {
  _originalRecordSuspension(player);
  broadcastEvent('suspension', player, '2-minute suspension');
};

// Enhanced recordRed
window.recordRed = function(player) {
  _originalRecordRed(player);
  broadcastEvent('red', player);
};

// Enhanced confirmShot (goalkeeper saves/goals against)
window.confirmShot = function() {
  const originalShotType = currentShotType;
  const originalGkPlayer = currentGkPlayer;
  const originalZone = selectedZone;
  
  _originalConfirmShot();
  
  if (originalShotType === 'save') {
    broadcastEvent('save', originalGkPlayer, getZoneName(originalZone));
  } else {
    broadcastEvent('goal_against', originalGkPlayer, getZoneName(originalZone));
    updateLiveScore();
  }
};

// Helper to get zone name
function getZoneName(zoneIdx) {
  const zones = ['Top Left', 'Top Center', 'Top Right', 'Bottom Left', 'Bottom Center', 'Bottom Right'];
  return zoneIdx !== null ? zones[zoneIdx] : 'Unknown zone';
}

// ============================================================
// 4. UI COMPONENTS
// ============================================================

/**
 * Show/hide live broadcasting status in UI
 */
function showLiveStatus(isLive) {
  const topbar = document.querySelector('.topbar');
  if (!topbar) return;

  // Remove existing live indicator if any
  const existingIndicator = document.getElementById('liveIndicator');
  if (existingIndicator) existingIndicator.remove();

  if (isLive) {
    // Add live indicator to topbar
    const indicator = document.createElement('div');
    indicator.id = 'liveIndicator';
    indicator.innerHTML = `
      <div style="
        display: flex;
        align-items: center;
        gap: 8px;
        background: rgba(255, 59, 59, 0.15);
        border: 1px solid var(--red);
        border-radius: 20px;
        padding: 6px 14px;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 1px;
        text-transform: uppercase;
        animation: pulse 2s ease-in-out infinite;
      ">
        <div style="
          width: 8px;
          height: 8px;
          background: var(--red);
          border-radius: 50%;
          animation: pulse 1.5s ease-in-out infinite;
        "></div>
        <span>🔴 BROADCASTING LIVE</span>
      </div>
    `;

    // Add pulse animation if not already defined
    if (!document.getElementById('liveAnimations')) {
      const style = document.createElement('style');
      style.id = 'liveAnimations';
      style.textContent = `
        @keyframes livePulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.6; transform: scale(1.05); }
        }
      `;
      document.head.appendChild(style);
    }

    topbar.insertBefore(indicator, topbar.firstChild);

    // Update stop button if exists
    const liveBtn = document.getElementById('liveBroadcastBtn');
    if (liveBtn) {
      liveBtn.textContent = '⏹ Stop Live';
      liveBtn.classList.add('danger');
      liveBtn.onclick = stopLiveMatch;
    }
  } else {
    // Reset button
    const liveBtn = document.getElementById('liveBroadcastBtn');
    if (liveBtn) {
      liveBtn.textContent = '🔴 Go Live';
      liveBtn.classList.remove('danger');
      liveBtn.onclick = startLiveMatch;
    }
  }
}

/**
 * Show shareable viewer link
 */
function showLiveMatchLink(url) {
  // Create modal/alert with shareable link
  const existingModal = document.getElementById('liveUrlModal');
  if (existingModal) existingModal.remove();

  const modal = document.createElement('div');
  modal.id = 'liveUrlModal';
  modal.innerHTML = `
    <div style="
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0,0,0,0.8);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
      backdrop-filter: blur(4px);
    " onclick="this.remove()">
      <div style="
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 16px;
        padding: 32px;
        max-width: 500px;
        width: 90%;
        box-shadow: 0 20px 60px rgba(0,0,0,0.5);
      " onclick="event.stopPropagation()">
        <div style="
          font-family: 'Bebas Neue', cursive;
          font-size: 28px;
          color: var(--accent);
          margin-bottom: 16px;
          text-align: center;
        ">
          🔴 Now Broadcasting Live!
        </div>
        
        <p style="
          color: var(--muted);
          margin-bottom: 24px;
          text-align: center;
          font-size: 14px;
        ">
          Share this link so fans can watch in real-time:
        </p>

        <div style="
          display: flex;
          gap: 8px;
          margin-bottom: 20px;
        ">
          <input 
            type="text" 
            value="${url}"
            readonly
            id="liveUrlInput"
            style="
              flex: 1;
              background: var(--surface2);
              border: 1px solid var(--border);
              color: var(--text);
              padding: 12px;
              border-radius: 8px;
              font-family: monospace;
              font-size: 13px;
            "
          />
          <button
            onclick="copyLiveUrl()"
            style="
              background: var(--accent);
              color: #000;
              border: none;
              padding: 12px 24px;
              border-radius: 8px;
              font-weight: 700;
              cursor: pointer;
              white-space: nowrap;
            "
          >
            📋 Copy
          </button>
        </div>

        <button
          onclick="document.getElementById('liveUrlModal').remove()"
          style="
            width: 100%;
            background: var(--surface2);
            border: 1px solid var(--border);
            color: var(--text);
            padding: 12px;
            border-radius: 8px;
            font-weight: 600;
            cursor: pointer;
          "
        >
          Got it!
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Auto-select the URL for easy copying
  setTimeout(() => {
    document.getElementById('liveUrlInput')?.select();
  }, 100);
}

/**
 * Copy live URL to clipboard
 */
function copyLiveUrl() {
  const input = document.getElementById('liveUrlInput');
  if (!input) return;

  input.select();
  document.execCommand('copy');

  // Show feedback
  const btn = event.target;
  const originalText = btn.textContent;
  btn.textContent = '✓ Copied!';
  btn.style.background = 'var(--green)';
  
  setTimeout(() => {
    btn.textContent = originalText;
    btn.style.background = 'var(--accent)';
  }, 2000);
}

// ============================================================
// 5. ADD UI BUTTON TO TOPBAR
// ============================================================

/**
 * Add "Go Live" button to the coach's topbar
 * Call this after the page loads
 */
function addLiveBroadcastButton() {
  const topbarControls = document.querySelector('.topbar-controls');
  if (!topbarControls) return;

  // Check if button already exists
  if (document.getElementById('liveBroadcastBtn')) return;

  const btn = document.createElement('button');
  btn.id = 'liveBroadcastBtn';
  btn.className = 'btn-sm';
  btn.textContent = '🔴 Go Live';
  btn.onclick = startLiveMatch;

  // Insert before export button
  const exportBtn = topbarControls.querySelector('.export');
  if (exportBtn) {
    topbarControls.insertBefore(btn, exportBtn);
  } else {
    topbarControls.appendChild(btn);
  }
}

// ============================================================
// 6. INITIALIZE ON PAGE LOAD
// ============================================================

// Wait for DOM to be ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeLiveBroadcasting);
} else {
  initializeLiveBroadcasting();
}

function initializeLiveBroadcasting() {
  // Add live broadcast button to UI
  addLiveBroadcastButton();

  // Check if there's an active live match for this user
  if (currentUser) {
    checkForActiveLiveMatch();
  }

  console.log('✅ Live broadcasting module initialized');
}

/**
 * Check if user has an active live match (in case of page reload)
 */
async function checkForActiveLiveMatch() {
  if (!currentUser) return;

  try {
    const { data, error } = await _supabase
      .from('live_matches')
      .select('id, is_live')
      .eq('coach_user_id', currentUser.id)
      .eq('is_live', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!error && data) {
      currentLiveMatchId = data.id;
      isLiveBroadcasting = true;
      showLiveStatus(true);
      console.log('📺 Resumed live match:', currentLiveMatchId);
    }
  } catch (error) {
    // No active match found, that's fine
  }
}

// ============================================================
// 7. AUTO-END MATCH ON PAGE UNLOAD (OPTIONAL)
// ============================================================

window.addEventListener('beforeunload', () => {
  if (isLiveBroadcasting) {
    // Send end signal (best effort)
    navigator.sendBeacon(
      `${SUPABASE_URL}/rest/v1/rpc/end_live_match`,
      JSON.stringify({ p_live_match_id: currentLiveMatchId })
    );
  }
});

// ============================================================
// 8. UTILITY FUNCTIONS
// ============================================================

/**
 * Format match time in MM:SS format
 */
function formatMatchTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

// Make functions globally available
window.startLiveMatch = startLiveMatch;
window.stopLiveMatch = stopLiveMatch;
window.broadcastEvent = broadcastEvent;
window.copyLiveUrl = copyLiveUrl;

console.log('📡 Live broadcasting functions loaded');
