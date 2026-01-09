// PlayMatatu - Main Application JS

const API_BASE = '/api/v1';

// Wait for DOM to be ready
document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const stakeForm = document.getElementById('stake-form');
    const waitingPayment = document.getElementById('waiting-payment');
    const waitingMatch = document.getElementById('waiting-match');
    const matchFound = document.getElementById('match-found');
    const errorMessage = document.getElementById('error-message');
    const errorText = document.getElementById('error-text');
    const phoneInput = document.getElementById('phone');
    const stakeInput = document.getElementById('stake');
    const winAmount = document.getElementById('win-amount');
    const playBtn = document.getElementById('play-btn');
    const rulesLink = document.getElementById('rules-link');
    const rulesModal = document.getElementById('rules-modal');
    const gameUrlInput = document.getElementById('game-url');
    const copyUrlBtn = document.getElementById('copy-url-btn');
    const playGameBtn = document.getElementById('play-game-btn');

    // Commission rate (10%)
    const COMMISSION_RATE = 0.10;
    const MIN_STAKE = 1000;

    // Calculate potential winnings
    function calculateWinnings(stake) {
        const totalPot = stake * 2;
        const commission = totalPot * COMMISSION_RATE;
        return totalPot - commission;
    }

    // Update win display when stake changes
    if (stakeInput) {
        stakeInput.addEventListener('input', () => {
            const stake = parseInt(stakeInput.value) || 0;
            if (stake >= MIN_STAKE && winAmount) {
                winAmount.textContent = calculateWinnings(stake).toLocaleString();
            } else if (winAmount) {
                winAmount.textContent = '0';
            }
        });
    }

    // Format phone number
    function formatPhone(phone) {
        // Remove all non-digits
        let digits = phone.replace(/\D/g, '');

        // Handle Uganda numbers
        if (digits.startsWith('0')) {
            digits = '256' + digits.substring(1);
        }
        if (!digits.startsWith('256')) {
            digits = '256' + digits;
        }

        return '+' + digits;
    }

    // Validate phone number
    function validatePhone(phone) {
        const formatted = formatPhone(phone);
        // Uganda phone: +256 followed by 9 digits
        return /^\+256[0-9]{9}$/.test(formatted);
    }

    // Show error
    function showError(message) {
        if (stakeForm) stakeForm.classList.add('d-none');
        if (waitingPayment) waitingPayment.classList.add('d-none');
        if (waitingMatch) waitingMatch.classList.add('d-none');
        if (matchFound) matchFound.classList.add('d-none');
        if (errorMessage) {
            errorMessage.classList.remove('d-none');
            if (errorText) errorText.textContent = message;
        }
    }

    // Show waiting for payment
    function showWaitingPayment() {
        if (stakeForm) stakeForm.classList.add('d-none');
        if (waitingPayment) waitingPayment.classList.remove('d-none');
    }

    // Show waiting for match
    function showWaitingMatch() {
        if (waitingPayment) waitingPayment.classList.add('d-none');
        if (waitingMatch) waitingMatch.classList.remove('d-none');
    }

    // Show match found with game URL
    function showMatchFound(gameLink) {
        if (waitingMatch) waitingMatch.classList.add('d-none');
        if (matchFound) matchFound.classList.remove('d-none');

        if (gameUrlInput) {
            gameUrlInput.value = gameLink;
        }
        if (playGameBtn) {
            playGameBtn.href = gameLink;
        }
    }

    // Initiate stake (DUMMY PAYMENT - auto-approves)
    async function initiateStake(phone, stake) {
        try {
            const response = await fetch(`${API_BASE}/game/stake`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    phone_number: formatPhone(phone),
                    stake_amount: stake
                })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Failed to initiate stake');
            }

            return data;
        } catch (error) {
            throw error;
        }
    }

    // Handle play button click
    if (playBtn) {
        playBtn.addEventListener('click', async () => {
            const phone = phoneInput.value.trim();
            const stake = parseInt(stakeInput.value);

            // Validate phone
            if (!validatePhone(phone)) {
                alert('Please enter a valid Uganda phone number');
                return;
            }

            // Validate stake
            if (!stake || stake < MIN_STAKE) {
                alert(`Minimum stake is ${MIN_STAKE.toLocaleString()} UGX`);
                return;
            }

            playBtn.disabled = true;
            playBtn.textContent = 'Processing...';

            try {
                // Initiate stake payment (DUMMY - auto-approved)
                const stakeResult = await initiateStake(phone, stake);

                console.log('Stake result:', stakeResult);

                // Store player ID for potential reconnection
                localStorage.setItem('playerId', stakeResult.player_id);

                // Check if immediately matched
                if (stakeResult.status === 'matched') {
                    // Show match found screen with game link
                    showMatchFound(stakeResult.game_link);
                    return;
                }

                // Not matched yet, show waiting and poll for match
                showWaitingMatch();

                // Poll for match
                const matchResult = await pollMatchStatus(stakeResult.player_id);

                // Show match found screen with game link
                showMatchFound(matchResult.game_link);

            } catch (error) {
                showError(error.message);
                playBtn.disabled = false;
                playBtn.textContent = '🎮 Play Now';
            }
        });
    }

    // Poll for matchmaking status
    async function pollMatchStatus(playerId) {
        const maxAttempts = 180; // 15 minutes (5s intervals)
        let attempts = 0;

        return new Promise((resolve, reject) => {
            const poll = async () => {
                try {
                    const response = await fetch(`${API_BASE}/game/queue/status?player_id=${playerId}`);
                    const data = await response.json();

                    console.log('Match poll result:', data);

                    if (data.status === 'matched') {
                        console.log('Match found! Game link:', data.game_link);
                        resolve(data);
                        return;
                    }

                    if (data.status === 'not_found') {
                        reject(new Error('Session expired. Please try again.'));
                        return;
                    }

                    // Still queued, continue polling
                    attempts++;
                    if (attempts >= maxAttempts) {
                        reject(new Error('No opponent found. Please try again later.'));
                        return;
                    }

                    console.log(`Still waiting... (attempt ${attempts}/${maxAttempts})`);
                    setTimeout(poll, 3000); // Poll every 3 seconds
                } catch (error) {
                    console.error('Polling error:', error);
                    reject(error);
                }
            };

            poll();
        });
    }

    // Rules modal - using Bootstrap modal
    let rulesModalInstance;
    if (typeof bootstrap !== 'undefined' && rulesModal) {
        rulesModalInstance = new bootstrap.Modal(rulesModal);
    }

    if (rulesLink) {
        rulesLink.addEventListener('click', (e) => {
            e.preventDefault();
            if (rulesModalInstance) {
                rulesModalInstance.show();
            }
        });
    }

    // Copy URL button handler
    if (copyUrlBtn && gameUrlInput) {
        copyUrlBtn.addEventListener('click', () => {
            gameUrlInput.select();
            navigator.clipboard.writeText(gameUrlInput.value).then(() => {
                copyUrlBtn.textContent = '✓ Copied!';
                setTimeout(() => {
                    copyUrlBtn.textContent = '📋 Copy';
                }, 2000);
            }).catch(() => {
                // Fallback for older browsers
                document.execCommand('copy');
                copyUrlBtn.textContent = '✓ Copied!';
                setTimeout(() => {
                    copyUrlBtn.textContent = '📋 Copy';
                }, 2000);
            });
        });
    }

    // No need to handle game links here - they go directly to /g/{token} route

    console.log('PlayMatatu loaded');
});