const API_BASE = 'http://localhost:3000/api';

let currentUserId = 'user1';
let botInterval = null;
let activeBots = [];

// Утилиты
function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        alert(`ID скопирован: ${text}`);
    }).catch(() => {
        // Fallback для старых браузеров
        const textArea = document.createElement('textarea');
        textArea.value = text;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        alert(`ID скопирован: ${text}`);
    });
}

function showTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.remove('active');
    });
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    document.getElementById(`${tabName}-tab`).classList.add('active');
    event.target.classList.add('active');
}

async function apiCall(endpoint, options = {}) {
    try {
        const response = await fetch(`${API_BASE}${endpoint}`, {
            headers: {
                'Content-Type': 'application/json',
                ...options.headers,
            },
            ...options,
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Request failed');
        }
        
        return await response.json();
    } catch (error) {
        alert(`Ошибка: ${error.message}`);
        throw error;
    }
}

// Загрузка аукционов
async function loadAuctions() {
    try {
        const auctions = await apiCall('/auctions/active');
        const container = document.getElementById('auctions-list');
        
        if (auctions.length === 0) {
            container.innerHTML = '<p>Нет активных аукционов</p>';
            return;
        }
        
        container.innerHTML = auctions.map(auction => `
            <div class="auction-card" onclick="showAuctionDetails('${auction._id}')">
                <h3>${auction.title}</h3>
                <span class="status ${auction.status}">${auction.status}</span>
                <div class="auction-info">
                    <p><strong>ID:</strong> <code style="font-size: 0.9em; background: #f0f0f0; padding: 2px 6px; border-radius: 3px; cursor: pointer;" onclick="event.stopPropagation(); copyToClipboard('${auction._id}')" title="Нажмите, чтобы скопировать">${auction._id}</code></p>
                    <p>Раунд: ${auction.currentRound} / ${auction.winnersPerRound?.length || Math.ceil(auction.totalItems / auction.itemsPerRound)}</p>
                    <p>Победителей в текущем раунде: ${auction.rounds[auction.currentRound - 1]?.winningSlots || (auction.winnersPerRound?.[auction.currentRound - 1]) || auction.itemsPerRound}</p>
                    <p>Минимальная ставка: ${auction.minBid}</p>
                    <p>Ставок: ${auction.bids?.length || 0}</p>
                </div>
                ${auction.status === 'active' ? `
                    <div class="bid-form">
                        <input type="number" id="bid-${auction._id}" placeholder="Сумма ставки" min="${auction.minBid}" step="0.01" onclick="event.stopPropagation()">
                        <button class="btn btn-primary" onclick="placeBid('${auction._id}', event)">Поставить ставку</button>
                    </div>
                ` : ''}
            </div>
        `).join('');
    } catch (error) {
        console.error('Error loading auctions:', error);
    }
}

// Показать детали аукциона
async function showAuctionDetails(auctionId) {
    try {
        const auction = await apiCall(`/auctions/${auctionId}`);
        const modal = document.getElementById('auction-modal');
        const details = document.getElementById('auction-details');
        
        const currentRound = auction.rounds[auction.currentRound - 1];
        const timeLeft = currentRound ? Math.max(0, Math.floor((new Date(currentRound.endTime) - new Date()) / 1000)) : 0;
        const winningSlots = currentRound?.winningSlots || auction.itemsPerRound;
        const maxRounds = auction.winnersPerRound?.length || Math.ceil(auction.totalItems / auction.itemsPerRound);
        
        // Загрузить лидерборд для расчета максимальной ставки
        let leaderboard = [];
        try {
            leaderboard = await apiCall(`/auctions/${auctionId}/round/${auction.currentRound}/leaderboard`);
        } catch (e) {
            console.error('Error loading leaderboard:', e);
        }
        
        // Вычислить минимальную и максимальную ставку для ползунка
        const minBid = auction.minBid;
        const maxBidAmount = leaderboard.length > 0 ? Math.max(...leaderboard.map(b => b.amount)) : minBid;
        const maxBid = maxBidAmount * 1.1; // +10% от максимальной ставки
        const topBidThreshold = leaderboard.length >= winningSlots ? leaderboard[winningSlots - 1].amount : minBid;
        
        details.innerHTML = `
            <h2>${auction.title}</h2>
            <p><strong>ID:</strong> <code style="font-size: 0.9em; background: #f0f0f0; padding: 2px 6px; border-radius: 3px; cursor: pointer;" onclick="copyToClipboard('${auction._id}')" title="Нажмите, чтобы скопировать">${auction._id}</code></p>
            <p>${auction.description || 'Нет описания'}</p>
            
            <div class="round-info">
                <h4>Текущий раунд: ${auction.currentRound} / ${maxRounds}</h4>
                ${currentRound ? `
                    <p>Статус: <span class="status ${currentRound.status}">${currentRound.status}</span></p>
                    <p>Победных мест в раунде: ${winningSlots}</p>
                    <p>Ставок в раунде: ${currentRound.totalBids}</p>
                    ${currentRound.status === 'active' ? `
                        <div class="countdown">Осталось: ${formatTime(timeLeft)}</div>
                    ` : ''}
                ` : ''}
            </div>
            
            ${currentRound && currentRound.status === 'active' ? `
                <div class="bid-form">
                    <h4>Сделать ставку</h4>
                    <div class="bid-slider-container">
                        <label for="bid-slider-${auction._id}">Сумма ставки:</label>
                        <div class="slider-wrapper">
                            <input type="range" 
                                   id="bid-slider-${auction._id}" 
                                   min="${minBid}" 
                                   max="${maxBid.toFixed(2)}" 
                                   step="0.01" 
                                   value="${minBid}"
                                   oninput="updateBidValue('${auction._id}', this.value)">
                            <div class="slider-labels">
                                <span>${minBid}</span>
                                <span id="bid-value-${auction._id}">${minBid}</span>
                                <span>${maxBid.toFixed(2)}</span>
                            </div>
                            ${leaderboard.length >= winningSlots ? `
                                <div class="slider-threshold" style="left: ${((topBidThreshold - minBid) / (maxBid - minBid) * 100)}%">
                                    <div class="threshold-line"></div>
                                    <div class="threshold-label">Топ ${winningSlots}</div>
                                </div>
                            ` : ''}
                        </div>
                    </div>
                    <button class="btn btn-primary" onclick="placeBidFromSlider('${auction._id}')">Поставить ставку</button>
                </div>
            ` : ''}
            
            <div class="leaderboard">
                <h4>Топ ставок текущего раунда</h4>
                <div id="leaderboard-${auction._id}">Загрузка...</div>
            </div>
            
            ${currentRound && currentRound.winners && currentRound.winners.length > 0 ? `
                <div class="winners-list">
                    <h4>Победители раунда ${auction.currentRound}</h4>
                    ${currentRound.winners.map((winner, idx) => `
                        <div class="winner-item">
                            ${idx + 1}. User ${winner.userId} - ${winner.bidAmount}
                        </div>
                    `).join('')}
                </div>
            ` : ''}
        `;
        
        modal.style.display = 'block';
        
        // Загрузить лидерборд
        if (currentRound) {
            loadLeaderboard(auctionId, auction.currentRound, winningSlots);
        }
        
        // Обновлять таймер каждую секунду
        if (currentRound && currentRound.status === 'active') {
            const timer = setInterval(() => {
                const timeLeft = Math.max(0, Math.floor((new Date(currentRound.endTime) - new Date()) / 1000));
                const countdownEl = details.querySelector('.countdown');
                if (countdownEl) {
                    countdownEl.textContent = `Осталось: ${formatTime(timeLeft)}`;
                }
                if (timeLeft === 0) {
                    clearInterval(timer);
                }
            }, 1000);
        }
    } catch (error) {
        console.error('Error loading auction details:', error);
    }
}

function updateBidValue(auctionId, value) {
    const valueEl = document.getElementById(`bid-value-${auctionId}`);
    if (valueEl) {
        valueEl.textContent = parseFloat(value).toFixed(2);
    }
}

async function placeBidFromSlider(auctionId) {
    const slider = document.getElementById(`bid-slider-${auctionId}`);
    if (!slider || !slider.value) {
        alert('Выберите сумму ставки');
        return;
    }
    
    const amount = parseFloat(slider.value);
    await placeBid(auctionId, null, amount);
}

function closeModal() {
    document.getElementById('auction-modal').style.display = 'none';
}

function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

async function loadLeaderboard(auctionId, roundNumber, winningSlots = null) {
    try {
        const leaderboard = await apiCall(`/auctions/${auctionId}/round/${roundNumber}/leaderboard`);
        const container = document.getElementById(`leaderboard-${auctionId}`);
        
        if (leaderboard.length === 0) {
            container.innerHTML = '<p>Пока нет ставок</p>';
            return;
        }
        
        // Если winningSlots не передан, попробовать получить из аукциона
        if (!winningSlots) {
            try {
                const auction = await apiCall(`/auctions/${auctionId}`);
                const currentRound = auction.rounds[auction.currentRound - 1];
                winningSlots = currentRound?.winningSlots || auction.itemsPerRound;
            } catch (e) {
                winningSlots = leaderboard.length; // Fallback
            }
        }
        
        container.innerHTML = leaderboard.map((bid, idx) => {
            const isTop = idx < winningSlots;
            return `
                <div class="leaderboard-item ${isTop ? 'top-bid' : ''}">
                    <span>${idx + 1}. User ${bid.userId} ${isTop ? '🏆' : ''}</span>
                    <span><strong>${bid.amount.toFixed(2)}</strong></span>
                </div>
            `;
        }).join('');
    } catch (error) {
        console.error('Error loading leaderboard:', error);
    }
}

// Разместить ставку
async function placeBid(auctionId, event, amount = null) {
    if (event) event.stopPropagation();
    
    // Если amount не передан, пытаемся получить из input или slider
    if (!amount) {
        const inputId = `bid-${auctionId}`;
        const modalInputId = `modal-bid-${auctionId}`;
        const sliderId = `bid-slider-${auctionId}`;
        
        const input = document.getElementById(inputId) || document.getElementById(modalInputId);
        const slider = document.getElementById(sliderId);
        
        if (slider && slider.value) {
            amount = parseFloat(slider.value);
        } else if (input && input.value) {
            amount = parseFloat(input.value);
        } else {
            alert('Введите сумму ставки');
            return;
        }
    }
    
    try {
        await apiCall(`/auctions/${auctionId}/bid`, {
            method: 'POST',
            body: JSON.stringify({
                userId: currentUserId,
                amount: amount,
            }),
        });
        
        alert('Ставка размещена!');
        
        // Очистить поля
        const inputId = `bid-${auctionId}`;
        const modalInputId = `modal-bid-${auctionId}`;
        const sliderId = `bid-slider-${auctionId}`;
        const input = document.getElementById(inputId) || document.getElementById(modalInputId);
        const slider = document.getElementById(sliderId);
        if (input) input.value = '';
        if (slider) slider.value = slider.min;
        
        await loadAuctions();
        
        // Обновить детали, если модальное окно открыто
        const modal = document.getElementById('auction-modal');
        if (modal.style.display === 'block') {
            await showAuctionDetails(auctionId);
        }
    } catch (error) {
        console.error('Error placing bid:', error);
    }
}

// Функция для обновления формы победителей по раундам
function updateWinnersPerRound() {
    const totalItems = parseInt(document.getElementById('total-items').value) || 10;
    const numRounds = parseInt(document.getElementById('num-rounds').value) || 4;
    const container = document.getElementById('winners-per-round-container');
    const sumDiv = document.getElementById('winners-sum');
    
    if (!container) return;
    
    // Вычислить равномерное распределение
    const baseValue = Math.floor(totalItems / numRounds);
    const remainder = totalItems % numRounds;
    
    container.innerHTML = '';
    let currentSum = 0;
    
    for (let i = 0; i < numRounds; i++) {
        const value = i < remainder ? baseValue + 1 : baseValue;
        currentSum += value;
        
        const roundDiv = document.createElement('div');
        roundDiv.className = 'form-group';
        roundDiv.style.marginBottom = '10px';
        roundDiv.innerHTML = `
            <label style="display: inline-block; width: 150px;">Раунд ${i + 1}:</label>
            <input type="number" 
                   class="winners-per-round-input" 
                   min="1" 
                   value="${value}" 
                   data-round="${i}"
                   style="width: 100px; padding: 8px; border: 2px solid #e0e0e0; border-radius: 4px;"
                   onchange="updateWinnersSum()">
        `;
        container.appendChild(roundDiv);
    }
    
    updateWinnersSum();
}

// Функция для обновления суммы победителей
function updateWinnersSum() {
    const totalItems = parseInt(document.getElementById('total-items').value) || 0;
    const inputs = document.querySelectorAll('.winners-per-round-input');
    const sumDiv = document.getElementById('winners-sum');
    
    if (!sumDiv) return;
    
    let sum = 0;
    inputs.forEach(input => {
        sum += parseInt(input.value) || 0;
    });
    
    sumDiv.textContent = `Сумма: ${sum} / ${totalItems}`;
    
    if (sum === totalItems) {
        sumDiv.style.color = '#28a745';
        sumDiv.innerHTML = `✓ Сумма: ${sum} / ${totalItems}`;
    } else if (sum > totalItems) {
        sumDiv.style.color = '#dc3545';
        sumDiv.innerHTML = `✗ Сумма: ${sum} / ${totalItems} (превышена на ${sum - totalItems})`;
    } else {
        sumDiv.style.color = '#ffc107';
        sumDiv.innerHTML = `⚠ Сумма: ${sum} / ${totalItems} (не хватает ${totalItems - sum})`;
    }
}

// Создать аукцион
document.getElementById('create-auction-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    // Получить winnersPerRound из формы
    const inputs = document.querySelectorAll('.winners-per-round-input');
    const winnersPerRound = Array.from(inputs).map(input => parseInt(input.value) || 0);
    const totalItems = parseInt(document.getElementById('total-items').value);
    
    // Проверить, что сумма равна totalItems
    const sum = winnersPerRound.reduce((a, b) => a + b, 0);
    if (sum !== totalItems) {
        alert(`Сумма победителей по раундам (${sum}) должна равняться общему количеству товаров (${totalItems})!`);
        return;
    }
    
    // Вычислить itemsPerRound как среднее значение (для обратной совместимости)
    const itemsPerRound = Math.max(...winnersPerRound);
    
    const data = {
        title: document.getElementById('auction-title').value,
        description: document.getElementById('auction-description').value,
        totalItems: totalItems,
        itemsPerRound: itemsPerRound, // Для обратной совместимости
        winnersPerRound: winnersPerRound, // Новое поле
        roundDuration: parseInt(document.getElementById('round-duration').value),
        minBid: parseFloat(document.getElementById('min-bid').value),
        antiSnipingWindow: parseInt(document.getElementById('anti-sniping').value),
    };
    
    try {
        const auction = await apiCall('/auctions', {
            method: 'POST',
            body: JSON.stringify(data),
        });
        
        // Запустить аукцион
        await apiCall(`/auctions/${auction._id}/start`, {
            method: 'POST',
        });
        
        alert('Аукцион создан и запущен!');
        e.target.reset();
        updateWinnersPerRound(); // Сбросить форму победителей
        showTab('auctions');
        await loadAuctions();
    } catch (error) {
        console.error('Error creating auction:', error);
    }
});

// Загрузить профиль пользователя
async function loadUserProfile() {
    const userId = document.getElementById('user-id').value || currentUserId;
    currentUserId = userId;
    
    try {
        // Создать или получить пользователя
        const user = await apiCall(`/users/${userId}`, {
            method: 'POST',
            body: JSON.stringify({ username: `User ${userId}` }),
        });
        
        document.getElementById('user-info').innerHTML = `
            <h3>Профиль пользователя</h3>
            <p>User ID: ${user.userId}</p>
            <p>Username: ${user.username || 'N/A'}</p>
            <div class="balance">Баланс: ${user.balance.toFixed(2)}</div>
        `;
        
        // Загрузить транзакции
        const transactions = await apiCall(`/users/${userId}/transactions?limit=20`);
        const transactionsContainer = document.getElementById('transactions');
        
        transactionsContainer.innerHTML = `
            <h3>История транзакций</h3>
            ${transactions.length === 0 ? '<p>Нет транзакций</p>' : transactions.map(tx => `
                <div class="transaction-item">
                    <div class="type">${tx.type.toUpperCase()}</div>
                    <div class="amount">${tx.amount > 0 ? '+' : ''}${tx.amount.toFixed(2)}</div>
                    <div class="date">${new Date(tx.createdAt).toLocaleString()}</div>
                    <div>${tx.description || ''}</div>
                </div>
            `).join('')}
        `;
    } catch (error) {
        console.error('Error loading user profile:', error);
    }
}

// Пополнить баланс
async function depositBalance() {
    const userId = document.getElementById('user-id').value || currentUserId;
    const amount = parseFloat(document.getElementById('deposit-amount').value);
    
    if (!amount || amount <= 0) {
        alert('Введите корректную сумму');
        return;
    }
    
    try {
        await apiCall(`/users/${userId}/deposit`, {
            method: 'POST',
            body: JSON.stringify({ amount }),
        });
        
        alert('Баланс пополнен!');
        document.getElementById('deposit-amount').value = '';
        await loadUserProfile();
    } catch (error) {
        console.error('Error depositing:', error);
    }
}

// Управление ботами
async function startBots() {
    const count = parseInt(document.getElementById('bot-count').value) || 5;
    const interval = parseInt(document.getElementById('bot-interval').value) || 1000;
    const auctionId = document.getElementById('bot-auction-id').value;
    
    if (!auctionId) {
        alert('Введите ID аукциона');
        return;
    }
    
    // Остановить существующих ботов
    stopBots();
    
    // Получить информацию об аукционе
    try {
        const auction = await apiCall(`/auctions/${auctionId}`);
        
        if (auction.status !== 'active') {
            alert('Аукцион не активен');
            return;
        }
        
        activeBots = [];
        
        for (let i = 0; i < count; i++) {
            const botId = `bot_${Date.now()}_${i}`;
            activeBots.push(botId);
            
            // Создать пользователя для бота
            await apiCall(`/users/${botId}`, {
                method: 'POST',
                body: JSON.stringify({ username: `Bot ${i + 1}` }),
            });
            
            // Пополнить баланс
            await apiCall(`/users/${botId}/deposit`, {
                method: 'POST',
                body: JSON.stringify({ amount: 10000 }),
            });
        }
        
        // Запустить интервал для ставок
        botInterval = setInterval(async () => {
            for (const botId of activeBots) {
                try {
                    const minBid = auction.minBid;
                    const bidAmount = minBid + Math.random() * 100; // Случайная ставка от min до min+100
                    
                    await apiCall(`/auctions/${auctionId}/bid`, {
                        method: 'POST',
                        body: JSON.stringify({
                            userId: botId,
                            amount: Math.round(bidAmount * 100) / 100,
                        }),
                    });
                } catch (error) {
                    // Игнорировать ошибки (недостаточно средств и т.д.)
                }
            }
        }, interval);
        
        document.getElementById('bot-status').innerHTML = `
            <div class="bot-status active">
                <strong>Боты запущены!</strong><br>
                Количество: ${count}<br>
                Интервал: ${interval}мс<br>
                Аукцион: ${auction.title}
            </div>
        `;
    } catch (error) {
        let errorMessage = error.message || 'Неизвестная ошибка';
        
        // Улучшенные сообщения об ошибках
        if (errorMessage.includes('Invalid auction ID format') || errorMessage.includes('Cast to ObjectId')) {
            errorMessage = 'Неверный формат ID аукциона. Убедитесь, что вы скопировали полный ID из карточки аукциона.';
        } else if (errorMessage.includes('Auction not found')) {
            errorMessage = 'Аукцион не найден. Проверьте правильность ID.';
        } else if (errorMessage.includes('not active')) {
            errorMessage = 'Аукцион не активен. Запустите аукцион перед использованием ботов.';
        }
        
        alert(`Ошибка запуска ботов: ${errorMessage}`);
    }
}

function stopBots() {
    if (botInterval) {
        clearInterval(botInterval);
        botInterval = null;
    }
    activeBots = [];
    document.getElementById('bot-status').innerHTML = '<div>Боты остановлены</div>';
}

// Закрыть модальное окно при клике вне его
window.onclick = function(event) {
    const modal = document.getElementById('auction-modal');
    if (event.target === modal) {
        closeModal();
    }
}

// Автозагрузка при старте
document.addEventListener('DOMContentLoaded', () => {
    loadAuctions();
    loadUserProfile();
    updateWinnersPerRound(); // Инициализировать форму победителей
    
    // Обновлять аукционы каждые 5 секунд
    setInterval(loadAuctions, 5000);
});

