/**
 * PlayMatatu - Game Client
 * Handles WebSocket communication and game UI
 */

(function() {
    'use strict';

    // Card image URL helper using deckofcardsapi.com static images
    function getCardImageUrl(card) {
        // Convert card object to image code
        // card format: { suit: "hearts", rank: "7" }
        const rankMap = {
            'A': 'A', '2': '2', '3': '3', '4': '4', '5': '5',
            '6': '6', '7': '7', '8': '8', '9': '9', '10': '0',
            'J': 'J', 'Q': 'Q', 'K': 'K'
        };
        const suitMap = {
            'hearts': 'H', 'diamonds': 'D', 'clubs': 'C', 'spades': 'S'
        };
        
        const rank = rankMap[card.rank] || card.rank;
        const suit = suitMap[card.suit] || card.suit.charAt(0).toUpperCase();
        const code = rank + suit;
        
        // Using deckofcardsapi.com static card images
        return `https://deckofcardsapi.com/static/img/${code}.png`;
    }

    // Get card back image
    function getCardBackUrl() {
        return 'https://deckofcardsapi.com/static/img/back.png';
    }

    // Suit symbols
    const suitSymbols = {
        'hearts': '♥',
        'diamonds': '♦',
        'clubs': '♣',
        'spades': '♠'
    };

    // Suit colors
    const suitColors = {
        'hearts': '#e74c3c',
        'diamonds': '#e74c3c',
        'clubs': '#2c3e50',
        'spades': '#2c3e50'
    };

    // Game state
    let gameState = {
        gameId: null,
        gameToken: null,
        playerToken: null,
        playerId: null,
        myHand: [],
        opponentCardCount: 0,
        topCard: null,
        currentSuit: null,
        targetSuit: null, // The "Chop" suit
        myTurn: false,
        drawStack: 0,
        deckCount: 0,
        connected: false,
        pendingAce: null, // Card waiting for suit selection (Ace is wild suit)
        canPass: false // Flag to show PASS button after drawing
    };

    // WebSocket connection
    let ws = null;
    let reconnectAttempts = 0;
    const MAX_RECONNECT_ATTEMPTS = 5;

    // DOM Elements - use optional chaining since some may not exist
    const elements = {
        stakeAmount: document.getElementById('stake-amount'),
        prizeAmount: document.getElementById('prize-amount'),
        opponentCards: document.getElementById('opponent-cards'),
        opponentHand: document.getElementById('opponent-hand'),
        deckCount: document.getElementById('deck-count'),
        discardPile: document.getElementById('discard-pile'),
        currentSuit: document.getElementById('current-suit'),
        suitDisplay: document.getElementById('suit-display'),
        gameMessage: document.getElementById('game-message'),
        messageText: document.getElementById('message-text'),
        turnIndicator: document.getElementById('turn-indicator'),
        turnText: document.getElementById('turn-text'),
        playerCards: document.getElementById('player-cards'),
        playerHand: document.getElementById('player-hand'),
        actions: document.getElementById('actions'),
        drawBtn: document.getElementById('draw-btn'),
        passBtn: document.getElementById('pass-btn'),
        suitSelector: document.getElementById('suit-selector'),
        disconnectWarning: document.getElementById('disconnect-warning'),
        countdown: document.getElementById('countdown')
    };

    // Initialize game
    function init() {
        // Get game token and player token from URL
        const urlParams = new URLSearchParams(window.location.search);
        gameState.gameToken = urlParams.get('token') || getFromPath();
        const playerToken = urlParams.get('pt'); // Player token for authentication

        if (!gameState.gameToken || !playerToken) {
            showMessage('Invalid game link. Please try again.', 'danger');
            return;
        }

        // Store player token for reconnection
        gameState.playerToken = playerToken;
        localStorage.setItem('playerToken_' + gameState.gameToken, playerToken);

        // Connect to WebSocket
        connectWebSocket();

        // Setup event listeners
        setupEventListeners();
    }

    // Setup event listeners
    function setupEventListeners() {
        // Turn indicator click (for passing)
        if (elements.turnIndicator) {
            elements.turnIndicator.addEventListener('click', function() {
                if (gameState.canPass && gameState.myTurn) {
                    onPassClick();
                }
            });
        }

        // Draw button
        const drawBtn = document.getElementById('deck-btn');
        if (drawBtn) {
            drawBtn.addEventListener('click', function() {
                if (!gameState.myTurn) return;
                if (!ws || ws.readyState !== WebSocket.OPEN) {
                    showMessage('Not connected!', 'danger');
                    return;
                }
                ws.send(JSON.stringify({ type: 'draw_card', data: {} }));
            });
        }

        // Suit selector buttons (for Ace wild suit)
        const suitOptions = document.querySelectorAll('.suit-option');
        suitOptions.forEach(option => {
            option.addEventListener('click', function() {
                const suit = this.getAttribute('onclick').match(/selectSuit\('(\w+)'\)/)[1];
                selectSuit(suit);
            });
        });
    }

    // Extract token from path like /g/TOKEN
    function getFromPath() {
        const path = window.location.pathname;
        const match = path.match(/\/g\/([a-zA-Z0-9]+)/);
        return match ? match[1] : null;
    }

    // Connect to WebSocket
    function connectWebSocket() {
        // Prevent multiple simultaneous connection attempts
        if (ws && ws.readyState === WebSocket.CONNECTING) {
            console.log('WebSocket connection already in progress, skipping...');
            return;
        }

        // Close existing connection if any
        if (ws) {
            ws.close();
        }

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/api/v1/game/${gameState.gameToken}/ws?token=${gameState.gameToken}&pt=${gameState.playerToken}`;

        console.log('Connecting to WebSocket:', wsUrl);

        ws = new WebSocket(wsUrl);

        ws.onopen = function() {
            console.log('WebSocket connected');
            gameState.connected = true;
            
            // Show reconnect success if this was a reconnect
            if (reconnectAttempts > 0) {
                showMessage('Reconnected!', 'success');
            }
            
            reconnectAttempts = 0;
            hideDisconnectWarning();
        };

        ws.onmessage = function(event) {
            try {
                const data = JSON.parse(event.data);
                console.log('Received:', data);
                handleMessage(data);
            } catch (error) {
                console.error('Error parsing WebSocket message:', error);
                console.log('Raw message:', event.data);
                showMessage('Connection error. Reconnecting...', 'warning');
                ws.close();
            }
        };

        ws.onclose = function() {
            console.log('WebSocket disconnected');
            gameState.connected = false;
            attemptReconnect();
        };

        ws.onerror = function(error) {
            console.error('WebSocket error:', error);
        };
    }

    // Attempt to reconnect
    function attemptReconnect() {
        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            reconnectAttempts++;
            showMessage('Reconnecting... (' + reconnectAttempts + '/' + MAX_RECONNECT_ATTEMPTS + ')', 'warning');
            setTimeout(connectWebSocket, 1000 * reconnectAttempts); // 1s, 2s, 3s, etc.
        } else {
            showMessage('Connection lost. Click to refresh.', 'danger');
            // Add click handler to refresh
            if (elements.gameMessage) {
                elements.gameMessage.style.cursor = 'pointer';
                elements.gameMessage.onclick = function() {
                    window.location.reload();
                };
            }
        }
    }

    // Handle incoming WebSocket messages
    function handleMessage(data) {
        switch (data.type) {
            case 'waiting_for_opponent':
                showWaitingScreen(data.message);
                break;

            case 'game_starting':
                hideWaitingScreen();
                showMessage(data.message, 'info');
                // Don't initialize UI here - wait for game_state message with actual cards
                // Show turn announcement after brief delay
                setTimeout(function() {
                    if (gameState.myTurn) {
                        showMessage('Your turn! Play a card 🎮', 'success');
                    } else {
                        showMessage('Opponent goes first ⏳', 'info');
                    }
                }, 1000);
                break;

            case 'game_state':
            case 'game_update':
                updateGameState(data);
                break;

            case 'card_played':
                handleCardPlayed(data);
                break;

            case 'cards_drawn':
                handleCardsDrawn(data);
                break;

            case 'opponent_drew':
                handleOpponentDrew(data);
                break;

            case 'turn_passed':
                handleTurnPassed(data);
                break;

            case 'player_connected':
                showMessage('Opponent connected!', 'success');
                break;

            case 'player_disconnected':
                showDisconnectWarning();
                break;

            case 'error':
                showMessage(data.message, 'danger');
                break;

            default:
                console.log('Unknown message type:', data.type);
        }
    }

    // Update game state from server
    function updateGameState(data) {
        try {
            gameState.gameId = data.game_id;
            gameState.playerId = data.my_id; // Set player ID for winner comparison
            gameState.myHand = data.my_hand || [];
            gameState.opponentCardCount = data.opponent_card_count || 0;
            gameState.topCard = data.top_card;
            gameState.currentSuit = data.current_suit;
            gameState.targetSuit = data.target_suit; // The "Chop" suit
            gameState.myTurn = data.my_turn;
            gameState.drawStack = data.draw_stack || 0;
            gameState.deckCount = data.deck_count || 0;
            gameState.stakeAmount = data.stake_amount || 0;
            
            console.log('opponent_card_count from server:', data.opponent_card_count, 'stored:', gameState.opponentCardCount);
            
            // Display target suit indicator
            if (gameState.targetSuit) {
                showTargetSuit(gameState.targetSuit);
            }
            
            if (data.winner) {
                handleGameOver({
                    isWinner: data.winner === gameState.playerId,
                    winType: data.win_type,
                    playerPoints: data.player_points,
                    opponentPoints: data.opponent_points
                });
                return;
            }

            // Don't render if game is still waiting (no cards dealt yet)
            if (data.status === 'WAITING' || !data.my_hand || data.my_hand.length === 0) {
                console.log('Game in waiting state, not rendering cards yet');
                return;
            }

            // Initialize UI on first game state with cards
            hideWaitingScreen();

            // Update UI
            renderOpponentHand();
            renderPlayerHand();
            renderDiscardPile();
            renderTurnIndicator();
            updatePlayerState();
        } catch (error) {
            console.error('Error updating game state:', error);
            console.log('Game data:', data);
            showMessage('Error updating game. Please refresh.', 'danger');
        }
    }

    // Render the entire game UI
    function renderGame() {
        renderStakeInfo();
        renderOpponentHand();
        renderDeck();
        renderDiscardPile();
        renderCurrentSuit();
        renderPlayerHand();
        renderTurnIndicator();
        renderActions();
    }

    // Render stake and prize info
    function renderStakeInfo() {
        if (elements.stakeAmount) {
            elements.stakeAmount.textContent = gameState.stakeAmount.toLocaleString();
        }
        if (elements.prizeAmount) {
            const prize = Math.floor(gameState.stakeAmount * 2 * 0.9);
            elements.prizeAmount.textContent = prize.toLocaleString();
        }
    }

    // Render opponent's hand (card backs)
    function renderOpponentHand() {
        if (!elements.opponentHand) return;
        
        elements.opponentHand.innerHTML = '';
        if (elements.opponentCards) {
            elements.opponentCards.textContent = gameState.opponentCardCount + ' cards';
        }

        for (let i = 0; i < gameState.opponentCardCount; i++) {
            const card = document.createElement('img');
            card.src = getCardBackUrl();
            card.className = 'playing-card card-back';
            card.alt = 'Card back';
            card.style.width = '50px';
            card.style.marginLeft = i > 0 ? '-20px' : '0';
            elements.opponentHand.appendChild(card);
        }
    }

    // Render deck
    function renderDeck() {
        if (elements.deckCount) {
            elements.deckCount.textContent = gameState.deckCount;
        }
    }

    // Render discard pile (top card)
    function renderDiscardPile() {
        if (!elements.discardPile) return;

        elements.discardPile.innerHTML = '';
        
        // Don't show anything if no card has been played yet
        if (!gameState.topCard || !gameState.topCard.rank || !gameState.topCard.suit) return;
        
        const card = document.createElement('img');
        card.src = getCardImageUrl(gameState.topCard);
        card.className = 'playing-card top-card';
        card.alt = gameState.topCard.rank + ' of ' + gameState.topCard.suit;
        card.style.width = '70px';
        
        // Add random rotation for ramshackled discard pile look
        const randomRotation = (Math.random() - 0.5) * 20; // -10 to +10 degrees
        const randomX = (Math.random() - 0.5) * 10; // -5 to +5 px
        const randomY = (Math.random() - 0.5) * 10; // -5 to +5 px
        card.style.transform = `rotate(${randomRotation}deg) translate(${randomX}px, ${randomY}px)`;
        card.style.transition = 'transform 0.3s ease';
        
        elements.discardPile.appendChild(card);
    }

    // Render current suit indicator (especially after 8 is played)
    function renderCurrentSuit() {
        if (!elements.currentSuit || !elements.suitDisplay) return;

        if (gameState.currentSuit) {
            elements.currentSuit.classList.remove('d-none');
            const symbol = suitSymbols[gameState.currentSuit] || '?';
            const color = suitColors[gameState.currentSuit] || '#000';
            elements.suitDisplay.innerHTML = '<span style="color: ' + color + '; font-size: 2rem;">' + symbol + '</span>';
        } else {
            elements.currentSuit.classList.add('d-none');
        }
    }

    // Render player's hand
    function renderPlayerHand() {
        if (!elements.playerHand) return;

        elements.playerHand.innerHTML = '';
        if (elements.playerCards) {
            elements.playerCards.textContent = gameState.myHand.length + ' cards';
        }

        gameState.myHand.forEach(function(card, index) {
            const cardEl = document.createElement('img');
            cardEl.src = getCardImageUrl(card);
            cardEl.className = 'playing-card player-card';
            cardEl.alt = card.rank + ' of ' + card.suit;
            cardEl.style.width = '60px';
            cardEl.style.cursor = gameState.myTurn ? 'pointer' : 'default';
            cardEl.dataset.index = index;
            cardEl.dataset.card = JSON.stringify(card);
            
            if (gameState.myTurn && canPlayCard(card)) {
                cardEl.classList.add('playable');
            }
            
            cardEl.addEventListener('click', function() { onCardClick(card, index); });
            elements.playerHand.appendChild(cardEl);
        });
    }

    // Check if a card can be played
    // Classic Ugandan Matatu rules:
    // - Ace is wild suit (can be played on anything EXCEPT a 2)
    // - 2s can only be countered with 2s when there's a draw stack
    // - Regular cards must match by suit or rank
    function canPlayCard(card) {
        if (!gameState.topCard) return true;
        
        // If there's a draw stack, only 2s can be played to counter
        if (gameState.drawStack > 0) {
            return card.rank === '2';
        }
        
        // Ace is wild suit - can be played on anything EXCEPT a 2
        if (card.rank === 'A') {
            return gameState.topCard.rank !== '2';
        }
        
        // Check suit or rank match
        return card.suit === gameState.currentSuit || card.rank === gameState.topCard.rank;
    }

    // Render turn indicator
    function renderTurnIndicator() {
        if (!elements.turnIndicator) return;

        if (gameState.myTurn) {
            if (gameState.canPass) {
                // Show PASS button after drawing
                elements.turnIndicator.className = 'badge fs-5 px-4 py-2 rounded-pill bg-warning text-dark';
                elements.turnIndicator.style.cursor = 'pointer';
                elements.turnIndicator.textContent = 'PASS';
            } else {
                elements.turnIndicator.className = 'badge fs-5 px-4 py-2 rounded-pill bg-success';
                elements.turnIndicator.style.cursor = 'default';
                elements.turnIndicator.textContent = 'PLAY';
            }
        } else {
            elements.turnIndicator.className = 'badge fs-5 px-4 py-2 rounded-pill bg-secondary';
            elements.turnIndicator.style.cursor = 'default';
            elements.turnIndicator.textContent = "WAIT";
        }
    }

    // Render action buttons
    function renderActions() {
        if (!elements.actions || !elements.drawBtn || !elements.passBtn) return;

        if (gameState.myTurn) {
            elements.actions.classList.remove('d-none');
            
            if (gameState.drawStack > 0) {
                elements.drawBtn.textContent = '🎯 Draw ' + gameState.drawStack + ' Cards';
            } else {
                elements.drawBtn.textContent = '🎯 Draw Card';
            }
        } else {
            elements.actions.classList.add('d-none');
        }
    }

    // Handle card click
    function onCardClick(card, index) {
        if (!gameState.myTurn) {
            showMessage("It's not your turn!", 'warning');
            return;
        }

        if (!canPlayCard(card)) {
            showMessage("You can't play that card!", 'warning');
            return;
        }

        // If playing an Ace, need to select suit first (Ace is wild suit in classic Matatu)
        if (card.rank === 'A') {
            gameState.pendingAce = card;
            showSuitSelector();
            return;
        }

        // Play the card
        playCard(card);
    }

    // Play a card
    function playCard(card, declaredSuit) {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            showMessage('Not connected!', 'danger');
            return;
        }

        var cardCode = card.rank + card.suit.charAt(0).toUpperCase();
        
        var message = {
            type: 'play_card',
            data: {
                card: cardCode
            }
        };

        if (declaredSuit) {
            message.data.declared_suit = declaredSuit;
        }

        ws.send(JSON.stringify(message));
    }

    // Handle draw button click
    function onDrawClick() {
        if (!gameState.myTurn) return;

        if (!ws || ws.readyState !== WebSocket.OPEN) {
            showMessage('Not connected!', 'danger');
            return;
        }

        ws.send(JSON.stringify({ type: 'draw_card', data: {} }));
    }

    // Handle pass button click
    function onPassClick() {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify({ type: 'pass_turn', data: {} }));
        gameState.canPass = false;
        renderTurnIndicator();
    }

    // Show suit selector for Aces
    function showSuitSelector() {
        if (elements.suitSelector) {
            elements.suitSelector.classList.remove('d-none');
        }
    }

    // Hide suit selector
    function hideSuitSelector() {
        if (elements.suitSelector) {
            elements.suitSelector.classList.add('d-none');
        }
    }

    // Handle suit selection (for Ace - wild suit)
    function onSuitSelect(suit) {
        if (gameState.pendingAce) {
            playCard(gameState.pendingAce, suit);
            gameState.pendingAce = null;
            hideSuitSelector();
        }
    }

    // Handle card played event
    function handleCardPlayed(data) {
        // Reset pass flag when a card is played
        gameState.canPass = false;
        renderTurnIndicator();
        
        if (data.effect && data.effect.message) {
            showMessage(data.effect.message, 'info');
        }

        if (data.game_over) {
            handleGameOver({
                isWinner: data.winner === gameState.playerId,
                winType: data.win_type,
                playerPoints: data.player_points,
                opponentPoints: data.opponent_points
            });
        }
    }

    // Handle cards drawn event
    function handleCardsDrawn(data) {
        if (data.cards) {
            // Add drawn cards to hand
            data.cards.forEach(function(c) { gameState.myHand.push(c); });
            renderPlayerHand();
        }

        // After drawing, player can play a card or pass
        gameState.canPass = true;
        renderTurnIndicator();
        showMessage('Drew ' + data.count + ' card(s). Play a card or pass your turn.', 'info');
    }

    // Handle opponent drew cards
    function handleOpponentDrew(data) {
        showMessage('Opponent drew ' + data.count + ' card(s)', 'info');
        gameState.opponentCardCount += data.count;
        renderOpponentHand();
    }

    // Handle turn passed
    function handleTurnPassed(data) {
        showMessage('Turn passed', 'info');
    }

    // Handle game over
    function handleGameOver(gameData) {
        // Handle both old boolean format and new object format
        var won = typeof gameData === 'boolean' ? gameData : gameData.isWinner;
        var winType = (typeof gameData === 'object' && gameData.winType) ? gameData.winType : 'classic';
        var playerPoints = typeof gameData === 'object' ? gameData.playerPoints : undefined;
        var opponentPoints = typeof gameData === 'object' ? gameData.opponentPoints : undefined;
        
        var modalEl = document.getElementById('game-over-modal');
        if (!modalEl) return;
        
        // Get all elements
        var resultEmoji = document.getElementById('result-emoji');
        var resultTitle = document.getElementById('result-title');
        var resultMessage = document.getElementById('result-message');
        var winTypeBadge = document.getElementById('win-type-badge');
        var pointsCard = document.getElementById('points-card');
        var playerPointsEl = document.getElementById('player-points');
        var opponentPointsEl = document.getElementById('opponent-points');
        var resultPrize = document.getElementById('result-prize');
        var prizeAmount = document.getElementById('prize-amount');

        if (won) {
            var prize = Math.floor(gameState.stakeAmount * 2 * 0.9);
            
            // Emoji and title
            if (resultEmoji) resultEmoji.textContent = '🎉';
            if (resultTitle) resultTitle.textContent = 'Victory!';
            
            // Win type badge
            if (winTypeBadge) {
                if (winType === 'chop') {
                    winTypeBadge.innerHTML = '<span class="badge bg-warning text-dark px-3 py-2 fs-6">🎯 Chop Win</span>';
                } else {
                    winTypeBadge.innerHTML = '<span class="badge bg-success px-3 py-2 fs-6">✨ Classic Win</span>';
                }
            }
            
            // Message
            if (resultMessage) {
                if (winType === 'chop') {
                    resultMessage.textContent = 'You won with the lowest points!';
                } else {
                    resultMessage.textContent = 'You cleared your hand first!';
                }
            }
            
            // Points (for chop wins)
            if (winType === 'chop' && playerPoints !== undefined && opponentPoints !== undefined) {
                if (pointsCard) pointsCard.style.display = 'block';
                if (playerPointsEl) playerPointsEl.textContent = playerPoints;
                if (opponentPointsEl) opponentPointsEl.textContent = opponentPoints;
            } else {
                if (pointsCard) pointsCard.style.display = 'none';
            }
            
            // Prize
            if (resultPrize) {
                resultPrize.className = 'card border-0 mb-4 bg-success';
            }
            if (prizeAmount) {
                prizeAmount.className = 'fs-1 fw-bold text-white';
                prizeAmount.textContent = prize.toLocaleString() + ' UGX';
            }
        } else {
            // Loss styling
            if (resultEmoji) resultEmoji.textContent = '😢';
            if (resultTitle) resultTitle.textContent = 'Game Over';
            
            // Win type badge
            if (winTypeBadge) {
                if (winType === 'chop') {
                    winTypeBadge.innerHTML = '<span class="badge bg-warning text-dark px-3 py-2 fs-6">🎯 Chop Loss</span>';
                } else {
                    winTypeBadge.innerHTML = '<span class="badge bg-secondary px-3 py-2 fs-6">Classic Loss</span>';
                }
            }
            
            // Message
            if (resultMessage) {
                if (winType === 'chop') {
                    resultMessage.textContent = 'Opponent won with lower points.';
                } else {
                    resultMessage.textContent = 'Opponent cleared their hand first.';
                }
            }
            
            // Points (for chop wins)
            if (winType === 'chop' && playerPoints !== undefined && opponentPoints !== undefined) {
                if (pointsCard) pointsCard.style.display = 'block';
                if (playerPointsEl) playerPointsEl.textContent = playerPoints;
                if (opponentPointsEl) opponentPointsEl.textContent = opponentPoints;
            } else {
                if (pointsCard) pointsCard.style.display = 'none';
            }
            
            // Prize/Loss
            if (resultPrize) {
                resultPrize.className = 'card border-0 mb-4 bg-danger';
            }
            if (prizeAmount) {
                prizeAmount.className = 'fs-1 fw-bold text-white';
                prizeAmount.textContent = '-' + gameState.stakeAmount.toLocaleString() + ' UGX';
            }
        }
        
        // Show modal
        var modal = new bootstrap.Modal(modalEl);
        modal.show();
    }

    // Show message
    function showMessage(text, type) {
        type = type || 'info';
        if (elements.gameMessage && elements.messageText) {
            elements.gameMessage.classList.remove('d-none', 'alert-info', 'alert-success', 'alert-warning', 'alert-danger');
            elements.gameMessage.classList.add('alert-' + type);
            elements.messageText.textContent = text;

            // Auto-hide after 3 seconds
            setTimeout(function() {
                elements.gameMessage.classList.add('d-none');
            }, 3000);
        }
    }

    // Show disconnect warning
    function showDisconnectWarning() {
        if (elements.disconnectWarning) {
            elements.disconnectWarning.classList.remove('d-none');
            startCountdown(120);
        }
    }

    // Hide disconnect warning
    function hideDisconnectWarning() {
        if (elements.disconnectWarning) {
            elements.disconnectWarning.classList.add('d-none');
        }
    }

    // Countdown timer
    var countdownInterval = null;
    function startCountdown(seconds) {
        if (countdownInterval) clearInterval(countdownInterval);
        
        var remaining = seconds;
        updateCountdownDisplay(remaining);
        
        countdownInterval = setInterval(function() {
            remaining--;
            updateCountdownDisplay(remaining);
            
            if (remaining <= 0) {
                clearInterval(countdownInterval);
                showMessage('Opponent forfeited. You win!', 'success');
            }
        }, 1000);
    }

    function updateCountdownDisplay(seconds) {
        if (elements.countdown) {
            var mins = Math.floor(seconds / 60);
            var secs = seconds % 60;
            elements.countdown.textContent = mins + ':' + (secs < 10 ? '0' : '') + secs;
        }
    }

    // ========================================
    // UI RENDERING FUNCTIONS
    // ========================================

    // Create a card element
    function createCardElement(type, cardData = null) {
        const cardEl = document.createElement('div');
        cardEl.className = 'game-card';
        cardEl.style.width = '100px';
        cardEl.style.height = '140px';
        
        const faceEl = document.createElement('div');
        faceEl.className = `card-face card-${type}`;
        
        if (type === 'back') {
            faceEl.innerHTML = '<img src="/images/logo.png" alt="Matatu">';
        } else if (cardData) {
            const suitSymbols = {
                'hearts': '♥',
                'diamonds': '♦',
                'clubs': '♣',
                'spades': '♠'
            };
            
            const isRed = cardData.suit === 'hearts' || cardData.suit === 'diamonds';
            if (isRed) faceEl.classList.add('red');
            
            faceEl.innerHTML = `
                <div style="position: absolute; top: 8px; left: 8px; font-size: 1rem; line-height: 1;">
                    ${cardData.rank}<br><span style="font-size: 1.2rem;">${suitSymbols[cardData.suit]}</span>
                </div>
                <div style="font-size: 2.5rem; margin: 0;">
                    ${suitSymbols[cardData.suit]}
                </div>
                <div style="position: absolute; bottom: 8px; right: 8px; font-size: 1rem; transform: rotate(180deg); line-height: 1;">
                    ${cardData.rank}<br><span style="font-size: 1.2rem;">${suitSymbols[cardData.suit]}</span>
                </div>
            `;
        }
        
        cardEl.appendChild(faceEl);
        return cardEl;
    }

    // Render opponent hand (face-down cards)
    function renderOpponentHand() {
        const container = document.getElementById('opponent-hand');
        if (!container) return;
        
        const cardCount = gameState.opponentCardCount || 0;
        console.log('renderOpponentHand called - cardCount:', cardCount);
        
        // Don't clear if we're rendering the same or more cards
        if (cardCount === 0 && container.children.length > 0) {
            console.log('Skipping opponent render - would clear existing cards');
            return;
        }
        
        container.innerHTML = '';
        
        for (let i = 0; i < cardCount; i++) {
            const cardEl = createCardElement('back');
            cardEl.style.animationDelay = `${i * 0.1}s`;
            cardEl.style.setProperty('--random', Math.random());
            container.appendChild(cardEl);
        }
        
        console.log('Opponent cards rendered:', container.children.length);
    }

    // Render player hand
    function renderPlayerHand() {
        const container = document.getElementById('player-hand');
        if (!container) {
            console.error('Player hand container not found');
            return;
        }
        
        container.innerHTML = '';
        const playerHand = gameState.myHand || [];
        
        console.log('Rendering player hand:', playerHand.length, 'cards', playerHand);
        
        playerHand.forEach((card, index) => {
            console.log('Creating card:', card);
            const cardEl = createCardElement('front', card);
            cardEl.style.animationDelay = `${index * 0.1}s`;
            cardEl.style.setProperty('--random', Math.random());
            
            if (gameState.myTurn) {
                cardEl.onclick = () => onCardClick(card, cardEl);
            }
            
            container.appendChild(cardEl);
        });
        
        updatePlayerState();
    }

    // Render discard pile
    function renderDiscardPile() {
        const container = document.getElementById('discard-pile');
        if (!container) return;
        
        container.innerHTML = '';
        
        // Only show card if one has been played and has valid properties
        if (gameState.topCard && gameState.topCard.rank && gameState.topCard.suit) {
            const cardEl = createCardElement('front', gameState.topCard);
            
            // Add random rotation for ramshackled discard pile look
            const randomRotation = (Math.random() - 0.5) * 20; // -10 to +10 degrees
            const randomX = (Math.random() - 0.5) * 10; // -5 to +5 px
            const randomY = (Math.random() - 0.5) * 10; // -5 to +5 px
            cardEl.style.transform = `rotate(${randomRotation}deg) translate(${randomX}px, ${randomY}px)`;
            cardEl.style.transition = 'transform 0.3s ease';
            
            container.appendChild(cardEl);
        }
        
        // Update deck count
        const deckCountEl = document.getElementById('deck-count');
        if (deckCountEl) {
            deckCountEl.textContent = gameState.deckCount || 0;
        }
    }

    // Handle card click
    function onCardClick(card, cardEl) {
        if (!gameState.myTurn) {
            showMessage("It's not your turn!", 'warning');
            return;
        }
        
        // Check if it's an Ace (wild suit)
        if (card.rank === 'A') {
            gameState.pendingAce = { card, cardEl };
            showSuitSelector();
            return;
        }
        
        // Send play_card message to server
        if (ws && ws.readyState === WebSocket.OPEN) {
            const cardCode = card.rank + card.suit.charAt(0).toUpperCase();
            ws.send(JSON.stringify({
                type: 'play_card',
                data: {
                    card: cardCode
                }
            }));
        }
    }

    // Show suit selector for Aces
    function showSuitSelector() {
        const selector = document.getElementById('suit-selector');
        if (selector) {
            selector.style.display = 'block';
        }
    }

    // Hide suit selector
    function hideSuitSelector() {
        const selector = document.getElementById('suit-selector');
        if (selector) {
            selector.style.display = 'none';
        }
    }

    // Select suit for Ace
    function selectSuit(suit) {
        if (gameState.pendingAce) {
            const card = gameState.pendingAce.card;
            const cardEl = gameState.pendingAce.cardEl;
            
            // Send play_card with declared_suit
            if (ws && ws.readyState === WebSocket.OPEN) {
                const cardCode = card.rank + card.suit.charAt(0).toUpperCase();
                ws.send(JSON.stringify({
                    type: 'play_card',
                    data: {
                        card: cardCode,
                        declared_suit: suit
                    }
                }));
            }
            
            gameState.pendingAce = null;
        }
        hideSuitSelector();
    }

    // Update player state - disable moves if not your turn
    function updatePlayerState() {
        const isYourTurn = gameState.myTurn;
        
        // Get player and opponent hands
        const playerHand = document.getElementById('player-hand');
        const opponentHand = document.getElementById('opponent-hand');
        
        // Visual feedback for whose turn it is
        if (isYourTurn) {
            if (playerHand) playerHand.classList.add('your-turn');
            if (opponentHand) opponentHand.classList.remove('your-turn');
        } else {
            if (playerHand) playerHand.classList.remove('your-turn');
            if (opponentHand) opponentHand.classList.add('your-turn');
        }
        
        // Update all cards
        document.querySelectorAll('#player-hand .game-card').forEach(card => {
            if (isYourTurn) {
                card.classList.remove('disabled-card');
                card.style.pointerEvents = 'auto';
                card.style.opacity = '1';
            } else {
                card.classList.add('disabled-card');
                card.style.pointerEvents = 'none';
                card.style.opacity = '0.6';
            }
        });
        
        // Update deck
        const deckContainer = document.getElementById('deck-btn');
        if (deckContainer) {
            if (isYourTurn) {
                deckContainer.style.pointerEvents = 'auto';
                deckContainer.style.opacity = '1';
            } else {
                deckContainer.style.pointerEvents = 'none';
                deckContainer.style.opacity = '0.5';
            }
        }
    }

    // Initialize game UI
    function initializeGameUI() {
        renderOpponentHand();
        renderPlayerHand();
        renderDiscardPile();
        updatePlayerState();
    }

    // Show waiting screen
    function showWaitingScreen(message) {
        const waitingRoom = document.getElementById('waiting-room');
        const gameScreen = document.getElementById('game-screen');
        const waitingMessage = document.getElementById('waiting-message');
        
        if (waitingRoom) waitingRoom.style.display = 'flex';
        if (gameScreen) gameScreen.style.display = 'none';
        if (waitingMessage) waitingMessage.textContent = message || 'Waiting for opponent...';
    }

    // Hide waiting screen
    function hideWaitingScreen() {
        const waitingRoom = document.getElementById('waiting-room');
        const gameScreen = document.getElementById('game-screen');
        
        if (waitingRoom) waitingRoom.style.display = 'none';
        if (gameScreen) gameScreen.style.display = 'flex';
    }
    
    // Show target suit indicator
    function showTargetSuit(suit) {
        const indicator = document.getElementById('target-suit-indicator');
        const symbol = document.getElementById('target-suit-symbol');
        
        if (!indicator || !symbol) return;
        
        const suitSymbols = {
            'hearts': '♥',
            'diamonds': '♦',
            'clubs': '♣',
            'spades': '♠'
        };
        
        const suitColors = {
            'hearts': '#e74c3c',
            'diamonds': '#e74c3c',
            'clubs': '#2c3e50',
            'spades': '#2c3e50'
        };
        
        symbol.textContent = suitSymbols[suit] || '?';
        symbol.style.color = suitColors[suit] || '#fff';
        indicator.style.display = 'block';
    }

    // Start when DOM is ready
    document.addEventListener('DOMContentLoaded', () => {
        init();
        // Don't render game UI until game starts - will be triggered by game_starting message
    });
    
    // Expose selectSuit to global scope for HTML onclick handlers
    window.selectSuit = selectSuit;

})();

