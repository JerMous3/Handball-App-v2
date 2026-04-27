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
  if (!window.currentUser) {
    alert('Please sign in to broadcast live matches');
    return;
  }

  // Get team names from the topbar brand element
  const topbarBrand = document.getElementById('topbarBrand') || document.querySelector('.topbar-brand');
  let teamName = '';
  let opponent = '';
  
  if (topbarBrand && topbarBrand.textContent) {
    const brandText = topbarBrand.textContent.replace('⬡', '').trim();
    if (brandText.includes(' vs ')) {
      const parts = brandText.split(' vs ');
      teamName = parts[0].trim();
      opponent = parts[1].trim();
    }
  }
  
  // Fallback: try to get from scoreboard teams
  if (!teamName || !opponent) {
    const scoreboardTeams = document.querySelector('.scoreboard-teams');
    if (scoreboardTeams) {
      const teamSpans = scoreboardTeams.querySelectorAll('span');
      if (teamSpans.length >= 3) {
        teamName = teamSpans[0].textContent.trim();
        opponent = teamSpans[2].textContent.trim(); // Index 2 because index 1 is the dash
      }
    }
  }

  console.log('📝 Team names detected:', teamName, 'vs', opponent);

  if (!teamName || !opponent || teamName === 'Home' || opponent === 'Away') {
    alert('Please set team names before going live!\n\nMake sure you entered team names when starting the match.');
    return;
  }

  try {
    // Get current match state
    const scoreHome = parseInt(document.getElementById('sbHome')?.textContent || '0');
    const scoreAway = parseInt(document.getElementById('sbAway')?.textContent || '0');
    const timerText = document.getElementById('matchTimer')?.textContent || '00:00';
    const timerParts = timerText.split(':');
    const matchTimeSeconds = (parseInt(timerParts[0]) * 60) + parseInt(timerParts[1] || '0');
    const halfLabel = document.getElementById('timerLabel')?.textContent || '1st Half';
    const currentHalf = halfLabel.includes('2nd') ? 'second' : 'first';

    // Create live match record
    const { data, error } = await _supabase
      .from('live_matches')
      .insert({
        coach_user_id: window.currentUser.id,
        team_name: teamName,
        opponent: opponent,
        is_live: true,
        score_home: scoreHome,
        score_away: scoreAway,
        match_time_seconds: matchTimeSeconds,
        current_half: currentHalf
      })
      .select()
      .single();

    if (error) throw error;

    currentLiveMatchId = data.id;
    isLiveBroadcasting = true;

    // Update UI to show live status
    showLiveStatus(true);
    
    // Create shareable link
    const viewerUrl = `${window.location.origin}/watch.html?match=${currentLiveMatchId}`;
    showLiveMatchLink(viewerUrl);

    // Start syncing timer every 5 seconds
    try {
      startTimerSync();
    } catch (error) {
      console.error('❌ Failed to start timer sync:', error);
    }
    
    // Track analytics (non-blocking)
    trackMatchAnalytics(data.id, teamName, opponent).catch(err => {
      console.log('Analytics tracking failed (non-critical):', err);
    });

    console.log('✅ Live match started:', currentLiveMatchId);
    console.log('📺 Viewer URL:', viewerUrl);

  } catch (error) {
    console.error('Error starting live match:', error);
    alert('Failed to start live match. Please try again.');
    if (typeof logError === 'function') {
      logError('live_match_start_failed', error);
    }
  }
}

/**
 * Stop broadcasting the current match
 */
async function stopLiveMatch() {
  if (!currentLiveMatchId) return;

  // Confirmation before stopping
  if (!confirm('Stop live broadcasting?\n\nViewers will no longer see updates from this match.')) {
    return;
  }

  try {
    // Stop timer sync
    if (window.liveTimerInterval) {
      clearInterval(window.liveTimerInterval);
      window.liveTimerInterval = null;
    }

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

/**
 * Sync match timer to database every 5 seconds
 */
function startTimerSync() {
  // Clear any existing interval
  if (window.liveTimerInterval) {
    clearInterval(window.liveTimerInterval);
  }

  console.log('🔄 Starting timer sync...');

  // Update timer every 5 seconds
  window.liveTimerInterval = setInterval(() => {
    if (!isLiveBroadcasting || !currentLiveMatchId) {
      console.log('⏹️ Stopping timer sync - not broadcasting');
      clearInterval(window.liveTimerInterval);
      return;
    }

    // Get current match time from DOM
    const timerElement = document.getElementById('matchTimer');
    const timerText = timerElement?.textContent || '00:00';
    const timerParts = timerText.split(':');
    const matchTimeSeconds = (parseInt(timerParts[0]) * 60) + parseInt(timerParts[1] || '0');
    
    console.log('⏱️ Syncing timer:', timerText, '=', matchTimeSeconds, 'seconds');
    
    // Get current half
    const halfLabel = document.getElementById('timerLabel')?.textContent || '1st Half';
    const currentHalf = halfLabel.includes('2nd') ? 'second' : 'first';

    // Update in database
    _supabase
      .from('live_matches')
      .update({
        match_time_seconds: matchTimeSeconds,
        current_half: currentHalf
      })
      .eq('id', currentLiveMatchId)
      .then(({ data, error }) => {
        if (error) {
          console.error('❌ Timer sync error:', error);
        } else {
          console.log('✅ Timer synced:', matchTimeSeconds, 'seconds');
        }
      });
  }, 5000); // Every 5 seconds

  console.log('⏱️ Timer sync started - updating every 5 seconds');
}

// ============================================================
// ANALYTICS TRACKING
// ============================================================

/**
 * Track match analytics (usage metrics)
 * Non-blocking - failures are logged but don't break functionality
 */
async function trackMatchAnalytics(matchId, teamName, opponent) {
  try {
    // Only track if user exists
    if (!window.currentUser) return;
    
    const analyticsData = {
      match_id: matchId,
      coach_id: window.currentUser.id,
      team_name: teamName,
      opponent: opponent,
      started_at: new Date().toISOString(),
      platform: navigator.platform,
      user_agent: navigator.userAgent
    };
    
    // Try to insert analytics - create table if it doesn't exist
    const { error } = await _supabase
      .from('match_analytics')
      .insert(analyticsData);
    
    if (error) {
      // If table doesn't exist, that's ok - analytics is optional
      console.log('📊 Analytics: Table not yet created (optional feature)');
    } else {
      console.log('📊 Analytics tracked');
    }
  } catch (error) {
    // Fail silently - analytics should never break core functionality
    console.log('📊 Analytics tracking skipped:', error.message);
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

  // Get current match time from DOM
  const timerText = document.getElementById('matchTimer')?.textContent || '00:00';
  const timerParts = timerText.split(':');
  const matchTimeSeconds = (parseInt(timerParts[0]) * 60) + parseInt(timerParts[1] || '0');
  const matchTime = timerText;

  // Get team name from topbar
  const topbarBrand = document.getElementById('topbarBrand') || document.querySelector('.topbar-brand');
  let teamName = 'Home Team';
  if (topbarBrand && topbarBrand.textContent) {
    const brandText = topbarBrand.textContent.replace('⬡', '').trim();
    if (brandText.includes(' vs ')) {
      teamName = brandText.split(' vs ')[0].trim();
    }
  }
  
  const eventData = {
    live_match_id: currentLiveMatchId,
    event_type: eventType,
    player_name: player ? player.name : null,
    player_number: player ? player.num : null,
    team_name: teamName,
    match_time_seconds: matchTimeSeconds,
    match_time_display: matchTime,
    score_home: parseInt(document.getElementById('sbHome')?.textContent || '0'),
    score_away: parseInt(document.getElementById('sbAway')?.textContent || '0'),
    detail: detail
  };

  // Add to queue for batch processing
  liveUpdateQueue.push({ type: 'event', data: eventData });
  processLiveUpdateQueue();
}

/**
 * Update live match score (debounced to batch rapid updates)
 */
let scoreUpdateTimeout;
async function updateLiveScore() {
  console.log('📊 updateLiveScore called, broadcasting:', isLiveBroadcasting, 'matchId:', currentLiveMatchId);
  
  if (!isLiveBroadcasting || !currentLiveMatchId) {
    console.log('⏭️ Skipping score update - not broadcasting or no match ID');
    return;
  }

  // Clear any pending update
  clearTimeout(scoreUpdateTimeout);
  
  // Debounce - wait 1 second to batch multiple rapid score changes
  scoreUpdateTimeout = setTimeout(() => {
    // Get scores from DOM
    const scoreHome = parseInt(document.getElementById('sbHome')?.textContent || '0');
    const scoreAway = parseInt(document.getElementById('sbAway')?.textContent || '0');
    
    console.log('📊 Queuing score update:', scoreHome, '-', scoreAway);
    
    // Get match time from DOM
    const timerText = document.getElementById('matchTimer')?.textContent || '00:00';
    const timerParts = timerText.split(':');
    const matchTimeSeconds = (parseInt(timerParts[0]) * 60) + parseInt(timerParts[1] || '0');

    liveUpdateQueue.push({
      type: 'score',
      data: {
        live_match_id: currentLiveMatchId,
        score_home: scoreHome,
        score_away: scoreAway,
        match_time_seconds: matchTimeSeconds
      }
    });
    
    processLiveUpdateQueue();
  }, 1000); // Wait 1 second before updating
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
        const { error } = await _supabase.from('live_events').insert(update.data);
        if (error) {
          console.error('❌ Event insert failed:', error);
          if (typeof logError === 'function') {
            logError('broadcast_event_failed', new Error(error.message), {
              event_type: update.data.event_type,
              match_id: currentLiveMatchId,
              error_details: error
            });
          }
        }
      } else if (update.type === 'score') {
        console.log('📊 Processing score update:', update.data.score_home, '-', update.data.score_away);
        const { error } = await _supabase.rpc('update_live_match_score', {
          p_live_match_id: update.data.live_match_id,
          p_score_home: update.data.score_home,
          p_score_away: update.data.score_away
        });
        if (error) {
          console.error('❌ Score update failed:', error);
          if (typeof logError === 'function') {
            logError('broadcast_score_failed', new Error(error.message), {
              match_id: currentLiveMatchId,
              error_details: error
            });
          }
        } else {
          console.log('✅ Score updated successfully:', update.data.score_home, '-', update.data.score_away);
        }
      }
    }
  } catch (error) {
    console.error('Error processing live updates:', error);
    if (typeof logError === 'function') {
      logError('live_update_queue_failed', error, {
        match_id: currentLiveMatchId,
        queue_length: liveUpdateQueue.length
      });
    }
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
 * MUST be called AFTER initMatch() runs
 */

// Store original functions (will be set when wrapLiveBroadcastFunctions is called)
let _originalRecordGoal;
let _originalRecordShot;
let _originalRecordAssist;
let _originalRecordYellow;
let _originalRecordSuspension;
let _originalRecordRed;
let _originalConfirmShot;
let _functionsWrapped = false;

window.wrapLiveBroadcastFunctions = function() {
  if (_functionsWrapped) {
    console.log('✅ Functions already wrapped');
    return;
  }
  
  console.log('🔄 Wrapping record functions for live broadcasting...');
  
  // Store original functions
  _originalRecordGoal = window.recordGoal;
  _originalRecordShot = window.recordShot;
  _originalRecordAssist = window.recordAssist;
  _originalRecordYellow = window.recordYellow;
  _originalRecordSuspension = window.recordSuspension;
  _originalRecordRed = window.recordRed;
  _originalConfirmShot = window.confirmShot;
  
  if (!_originalRecordGoal) {
    console.error('❌ Cannot wrap functions - window.recordGoal not defined yet!');
    return;
  }
  
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
    const originalShotType = window.currentShotType;
    const originalGkPlayer = window.currentGkPlayer;
    const originalZone = window.selectedZone;
    
    _originalConfirmShot();
    
    if (originalShotType === 'save') {
      broadcastEvent('save', originalGkPlayer, getZoneName(originalZone));
    } else {
      broadcastEvent('goal_against', originalGkPlayer, getZoneName(originalZone));
      updateLiveScore();
    }
  };
  
  _functionsWrapped = true;
  console.log('✅ Functions wrapped successfully!');
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
  // Remove existing live indicator if any (cleanup from old versions)
  const existingIndicator = document.getElementById('liveIndicator');
  if (existingIndicator) existingIndicator.remove();

  if (isLive) {
    // Update desktop live button to "Stop Live"
    const liveBtn = document.getElementById('liveBroadcastBtn');
    if (liveBtn) {
      liveBtn.textContent = '⏹ Stop Live';
      liveBtn.classList.add('danger');
      liveBtn.onclick = stopLiveMatch;
    }
    
    // Update mobile live button to "Stop Live"
    const mobileLiveBtn = document.getElementById('mobileLiveBtn');
    if (mobileLiveBtn) {
      mobileLiveBtn.textContent = '⏹ Stop Live';
      mobileLiveBtn.style.background = 'rgba(255, 193, 7, 0.15)';
      mobileLiveBtn.style.borderColor = '#ffc107';
      mobileLiveBtn.style.color = '#ffc107';
      mobileLiveBtn.onclick = stopLiveMatch;
    }
  } else {
    // Reset desktop button
    const liveBtn = document.getElementById('liveBroadcastBtn');
    if (liveBtn) {
      liveBtn.textContent = '🔴 Go Live';
      liveBtn.classList.remove('danger');
      liveBtn.onclick = startLiveMatch;
    }
    
    // Reset mobile button
    const mobileLiveBtn = document.getElementById('mobileLiveBtn');
    if (mobileLiveBtn) {
      mobileLiveBtn.textContent = '🔴 Go Live';
      mobileLiveBtn.style.background = 'rgba(255, 59, 59, 0.15)';
      mobileLiveBtn.style.borderColor = 'var(--red)';
      mobileLiveBtn.style.color = 'var(--red)';
      mobileLiveBtn.onclick = startLiveMatch;
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
          onclick="shareLiveUrl('${url}')"
          style="
            width: 100%;
            background: var(--accent2);
            color: #000;
            border: none;
            padding: 12px;
            border-radius: 8px;
            font-weight: 700;
            cursor: pointer;
            margin-bottom: 12px;
          "
        >
          📱 Share Link
        </button>

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
 * Share live URL using native share API
 */
function shareLiveUrl(url) {
  if (navigator.share) {
    navigator.share({
      title: 'Watch Live Match',
      text: 'Watch our handball match live!',
      url: url
    }).then(() => {
      console.log('✅ Share successful');
    }).catch((error) => {
      console.log('Share cancelled or failed:', error);
      // Fallback to copy
      copyLiveUrl();
    });
  } else {
    // Fallback for browsers without share API
    copyLiveUrl();
    alert('Link copied! Share it with your fans.');
  }
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
  // Try both possible topbar locations
  const topbarControls = document.querySelector('.topbar-controls') || document.querySelector('.topbar-right');
  if (!topbarControls) {
    console.error('Could not find topbar element (.topbar-controls or .topbar-right)');
    return;
  }

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
  
  console.log('✅ Live broadcast button added to topbar');
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
  if (window.currentUser) {
    checkForActiveLiveMatch();
  }

  console.log('✅ Live broadcasting module initialized');
}

/**
 * Check if user has an active live match (in case of page reload)
 */
async function checkForActiveLiveMatch() {
  if (!window.currentUser) return;

  try {
    const { data, error } = await _supabase
      .from('live_matches')
      .select('id, is_live')
      .eq('coach_user_id', window.currentUser.id)
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
window.shareLiveUrl = shareLiveUrl;

console.log('📡 Live broadcasting functions loaded');
