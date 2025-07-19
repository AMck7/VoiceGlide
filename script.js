const CONFIG = {
    PLAYER_LIFT_MULTIPLIER: 0.5,
    PLAYER_GRAVITY: 0.15,
    PLAYER_MOMENTUM_GRAVITY_ADD: 0.1,
    PLAYER_MOMENTUM_GAIN: 0.015,
    PLAYER_MOMENTUM_DECAY: 0.015,
    PLAYER_AIR_RESISTANCE: 0.98,
    PLAYER_MAX_VELOCITY_Y_UP: -5,
    PLAYER_MAX_VELOCITY_Y_DOWN: 7,
    PLAYER_START_X_RATIO: 0.2,
    PLAYER_START_Y_RATIO: 0.5,
    OBSTACLE_SPEED: 4,
    OBSTACLE_WIDTH: 60,
    OBSTACLE_GAP_HEIGHT: 300,
    OBSTACLE_SPAWN_INTERVAL: 180,
    BLOW_INTENSITY_THRESHOLD: 0.02,
    BLOW_SMOOTHING_FACTOR: 0.6,
    LAUNCH_DURATION_FRAMES: 150,
    CRASH_ANIMATION_DURATION: 180,
    SCORE_UPDATE_INTERVAL: 60,
};

const ui = {
    canvas: document.getElementById('gameCanvas'),
    ctx: document.getElementById('gameCanvas').getContext('2d'),
    mainMenu: document.getElementById('mainMenu'),
    gameOverScreen: document.getElementById('gameOverScreen'),
    playButton: document.getElementById('playButton'),
    restartButton: document.getElementById('restartButton'),
    mainMenuButton: document.getElementById('mainMenuButton'),
    scoreEl: document.getElementById('score'),
    finalScoreEl: document.getElementById('finalScore'),
    explosionOverlay: document.getElementById('explosionOverlay'),
    explosionGif: document.getElementById('explosionGif'),
};

let gameState = {
    currentState: 'menu',
    player: {},
    obstacles: [],
    score: 0,
    frameCount: 0,
    glidingStartFrame: 0,
    animationFrameId: null,
    assets: {
        planeImage: null,
        explosionSound: null,
    }
};

let audioState = {
    audioContext: null,
    analyser: null,
    mediaStreamSource: null,
    blowHistory: [],
};

function resizeCanvas() {
    ui.canvas.width = window.innerWidth;
    ui.canvas.height = window.innerHeight;
}

function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
    });
}

function loadAudio(src) {
    return new Promise((resolve, reject) => {
        const audio = new Audio();
        audio.oncanplaythrough = () => resolve(audio);
        audio.onerror = reject;
        audio.preload = 'auto';
        audio.src = src;
    });
}

async function loadAssets() {
    try {
        const [planeImage, explosionSound] = await Promise.all([
            loadImage('plane.png'),
            loadAudio('splode.mp3'),
        ]);
        gameState.assets.planeImage = planeImage;
        gameState.assets.explosionSound = explosionSound;

        ui.playButton.disabled = false;
        ui.playButton.textContent = 'Take Flight';
    } catch (error) {
        console.error("Failed to load assets:", error);
        ui.playButton.textContent = 'Error Loading Assets';
        alert('Could not load game assets. Please refresh the page to try again.');
    }
}

function getBlowIntensity() {
    if (!audioState.analyser) return 0;

    const bufferLength = audioState.analyser.frequencyBinCount;
    const timeDomainData = new Float32Array(bufferLength);
    const frequencyData = new Uint8Array(bufferLength);

    audioState.analyser.getFloatTimeDomainData(timeDomainData);
    audioState.analyser.getByteFrequencyData(frequencyData);

    let sum = 0;
    for (let i = 0; i < bufferLength; i++) {
        sum += timeDomainData[i] * timeDomainData[i];
    }
    const rms = Math.sqrt(sum / bufferLength);

    let blowStrength = 0;
    const minThreshold = 0.005;
    const maxThreshold = 0.25;

    if (rms > minThreshold) {
        const normalizedVolume = (rms - minThreshold) / (maxThreshold - minThreshold);
        blowStrength = Math.min(1, Math.max(0, normalizedVolume));
    }

    audioState.blowHistory.push(blowStrength);
    if (audioState.blowHistory.length > 5) {
        audioState.blowHistory.shift();
    }
    return audioState.blowHistory.reduce((acc, val) => acc + val, 0) / audioState.blowHistory.length;
}

function setupGameAudio(stream) {
    audioState.audioContext = new(window.AudioContext || window.webkitAudioContext)();
    audioState.analyser = audioState.audioContext.createAnalyser();
    audioState.mediaStreamSource = audioState.audioContext.createMediaStreamSource(stream);
    audioState.mediaStreamSource.connect(audioState.analyser);
}

function resetGameState() {
    const {
        canvas
    } = ui;
    gameState.player = {
        x: -100,
        y: canvas.height,
        width: 60,
        height: 30,
        targetX: canvas.width * CONFIG.PLAYER_START_X_RATIO,
        targetY: canvas.height * CONFIG.PLAYER_START_Y_RATIO,
        velocityX: 0,
        velocityY: 0,
        blowIntensity: 0,
        momentum: 0,
        rotation: 0,
        crashTimer: 0,
    };
    gameState.obstacles = [];
    gameState.score = 0;
    gameState.frameCount = 0;
    gameState.glidingStartFrame = 0;
    audioState.blowHistory = [];
    gameState.currentState = 'launching';
}

function runGameLoop() {
    ui.ctx.clearRect(0, 0, ui.canvas.width, ui.canvas.height);

    const {
        currentState
    } = gameState;

    switch (currentState) {
        case 'launching':
            updateLaunchAnimation();
            break;
        case 'gliding':
            updateGlidingPhase();
            break;
        case 'playing':
            updatePlayingPhase();
            break;
        case 'crashed':
            break;
        case 'gameOver':
            return;
    }

    drawPlayer();
    if (currentState === 'playing' || currentState === 'crashed') {
        updateAndDrawObstacles();
    }
    drawUI();

    gameState.animationFrameId = requestAnimationFrame(runGameLoop);
}

function updateLaunchAnimation() {
    gameState.frameCount++;
    const progress = Math.min(gameState.frameCount / CONFIG.LAUNCH_DURATION_FRAMES, 1);
    const easeOut = 1 - Math.pow(1 - progress, 3);

    const {
        player
    } = gameState;
    const startX = -100;
    const startY = ui.canvas.height;
    const targetX = player.targetX;
    const targetY = player.targetY;

    const controlX = startX + (targetX - startX) * 0.4;
    const controlY = startY - (startY - targetY) * 1.2;
    const baseX = (1 - easeOut) ** 2 * startX + 2 * (1 - easeOut) * easeOut * controlX + easeOut ** 2 * targetX;
    const baseY = (1 - easeOut) ** 2 * startY + 2 * (1 - easeOut) * easeOut * controlY + easeOut ** 2 * targetY;

    const wobbleY = Math.sin(gameState.frameCount * 0.03) * 4;
    const wobbleX = Math.sin(gameState.frameCount * 0.02) * 2;
    const wobbleRot = Math.cos(gameState.frameCount * 0.03) * 0.05;

    player.x = baseX + (wobbleX * easeOut);
    player.y = baseY + (wobbleY * easeOut);

    const dX = 2 * (1 - easeOut) * (controlX - startX) + 2 * easeOut * (targetX - controlX);
    const dY = 2 * (1 - easeOut) * (controlY - startY) + 2 * easeOut * (targetY - controlY);
    const pathAngle = Math.atan2(dY, dX);

    player.rotation = (pathAngle * (1 - easeOut)) + (wobbleRot * easeOut);

    if (progress >= 1) {
        gameState.currentState = 'gliding';
        gameState.glidingStartFrame = gameState.frameCount;
    }
}

function updateGlidingPhase() {
    gameState.frameCount++;

    gameState.player.y = gameState.player.targetY + Math.sin(gameState.frameCount * 0.03) * 4;
    gameState.player.x = gameState.player.targetX + Math.sin(gameState.frameCount * 0.02) * 2;
    gameState.player.rotation = Math.cos(gameState.frameCount * 0.03) * 0.05;

    const blowIntensity = getBlowIntensity();
    if (blowIntensity > CONFIG.BLOW_INTENSITY_THRESHOLD) {
        gameState.currentState = 'playing';
        gameState.frameCount = 0;
        gameState.player.blowIntensity = blowIntensity;
        gameState.player.rotation = 0;
    }

    if (gameState.frameCount - gameState.glidingStartFrame > 900) {
        gameState.currentState = 'playing';
        gameState.frameCount = 0;
    }
}

function updatePlayingPhase() {
    gameState.frameCount++;

    const blowIntensity = getBlowIntensity();
    gameState.player.blowIntensity = gameState.player.blowIntensity * CONFIG.BLOW_SMOOTHING_FACTOR + blowIntensity * (1 - CONFIG.BLOW_SMOOTHING_FACTOR);

    if (gameState.player.blowIntensity > CONFIG.BLOW_INTENSITY_THRESHOLD) {
        const lift = gameState.player.blowIntensity * CONFIG.PLAYER_LIFT_MULTIPLIER;
        gameState.player.velocityY -= lift;
        gameState.player.momentum = Math.min(1, gameState.player.momentum + CONFIG.PLAYER_MOMENTUM_GAIN * gameState.player.blowIntensity);
    } else {
        gameState.player.momentum = Math.max(0, gameState.player.momentum - CONFIG.PLAYER_MOMENTUM_DECAY);
    }

    const gravity = CONFIG.PLAYER_GRAVITY + (gameState.player.momentum * CONFIG.PLAYER_MOMENTUM_GRAVITY_ADD);
    gameState.player.velocityY += gravity;
    gameState.player.velocityY *= CONFIG.PLAYER_AIR_RESISTANCE;
    gameState.player.velocityX = gameState.player.momentum * 0.5;

    gameState.player.y += gameState.player.velocityY;
    gameState.player.x += gameState.player.velocityX;
    gameState.player.velocityY = Math.max(CONFIG.PLAYER_MAX_VELOCITY_Y_UP, Math.min(CONFIG.PLAYER_MAX_VELOCITY_Y_DOWN, gameState.player.velocityY));

    if (gameState.player.y > ui.canvas.height - gameState.player.height) {
        crashPlane(false);
    }
    if (gameState.player.y < gameState.player.height / 2) {
        gameState.player.y = gameState.player.height / 2;
        gameState.player.velocityY = 0;
    }

    if (gameState.frameCount % CONFIG.SCORE_UPDATE_INTERVAL === 0) {
        gameState.score++;
    }
}

function updateAndDrawObstacles() {
    const {
        player
    } = gameState;

    if (gameState.currentState === 'playing' && gameState.frameCount % CONFIG.OBSTACLE_SPAWN_INTERVAL === 0) {
        const gapY = Math.random() * (ui.canvas.height - CONFIG.OBSTACLE_GAP_HEIGHT - 100) + 50;
        gameState.obstacles.push({
            x: ui.canvas.width,
            y: gapY,
        });
    }

    ui.ctx.fillStyle = 'black';
    for (let i = gameState.obstacles.length - 1; i >= 0; i--) {
        const obs = gameState.obstacles[i];
        if (gameState.currentState !== 'crashed') {
            obs.x -= CONFIG.OBSTACLE_SPEED;
        }

        ui.ctx.fillRect(obs.x, 0, CONFIG.OBSTACLE_WIDTH, obs.y);
        ui.ctx.fillRect(obs.x, obs.y + CONFIG.OBSTACLE_GAP_HEIGHT, CONFIG.OBSTACLE_WIDTH, ui.canvas.height);

        const playerRect = {
            x: player.x - player.width / 2,
            y: player.y - player.height / 2,
            width: player.width,
            height: player.height
        };
        const topPipeRect = {
            x: obs.x,
            y: 0,
            width: CONFIG.OBSTACLE_WIDTH,
            height: obs.y
        };
        const bottomPipeRect = {
            x: obs.x,
            y: obs.y + CONFIG.OBSTACLE_GAP_HEIGHT,
            width: CONFIG.OBSTACLE_WIDTH,
            height: ui.canvas.height
        };

        if (gameState.currentState === 'playing' && (rectsOverlap(playerRect, topPipeRect) || rectsOverlap(playerRect, bottomPipeRect))) {
            crashPlane(player.y < obs.y + CONFIG.OBSTACLE_GAP_HEIGHT / 2);
        }

        if (obs.x + CONFIG.OBSTACLE_WIDTH < 0) {
            gameState.obstacles.splice(i, 1);
        }
    }
}

function rectsOverlap(rect1, rect2) {
    return rect1.x < rect2.x + rect2.width &&
        rect1.x + rect1.width > rect2.x &&
        rect1.y < rect2.y + rect2.height &&
        rect1.y + rect1.height > rect2.y;
}

function crashPlane(hitTop) {
    gameState.currentState = 'crashed';
    showExplosion(gameState.player.x, gameState.player.y);

    setTimeout(() => {
        endGame();
    }, 1600);
}

function drawPlayer() {
    const {
        ctx
    } = ui;
    const {
        player,
        currentState
    } = gameState;

    const imageToUse = gameState.assets.planeImage;
    if (!imageToUse) return;

    if (currentState === 'crashed') {
        return;
    }

    ctx.save();
    ctx.translate(player.x, player.y);

    if (currentState === 'playing') {
        const angle = Math.atan2(player.velocityY, 5 + player.momentum);
        ctx.rotate(angle);
    } else {
        ctx.rotate(player.rotation);
    }

    const targetHeight = 120;
    const aspectRatio = imageToUse.naturalWidth / imageToUse.naturalHeight;
    const w = targetHeight * aspectRatio;
    const h = targetHeight;

    const scale = 1 + (player.momentum * 0.2);
    ctx.drawImage(imageToUse, -(w * scale) / 2, -(h * scale) / 2, w * scale, h * scale);

    ctx.restore();
}

function drawUI() {
    if (gameState.currentState === 'gliding') {
        ui.ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
        ui.ctx.font = '28px Courier New';
        ui.ctx.textAlign = 'center';
        ui.ctx.fillText('💨 Blow to start flying!', ui.canvas.width / 2, 100);
    }
    ui.scoreEl.textContent = `${gameState.score} meters`;
}

function showExplosion(x, y) {
    ui.explosionOverlay.style.left = `${x - 100}px`;
    ui.explosionOverlay.style.top = `${y - 100}px`;
    ui.explosionOverlay.style.display = 'block';

    ui.explosionGif.src = 'splode.gif?t=' + new Date().getTime();
    gameState.assets.explosionSound.currentTime = 0;
    gameState.assets.explosionSound.play().catch(e => console.error("Audio play failed:", e));

    setTimeout(() => {
        ui.explosionOverlay.style.display = 'none';
    }, 1600);
}

function showScreen(screenName) {
    ui.mainMenu.classList.add('hidden');
    ui.gameOverScreen.classList.add('hidden');
    ui.scoreEl.classList.add('hidden');

    if (screenName === 'menu') {
        ui.mainMenu.classList.remove('hidden');
    } else if (screenName === 'gameOver') {
        ui.gameOverScreen.classList.remove('hidden');
        ui.finalScoreEl.textContent = `Final Distance: ${gameState.score} meters`;
    } else if (screenName === 'game') {
        ui.scoreEl.classList.remove('hidden');
    }
}

function startGame() {
    navigator.mediaDevices.getUserMedia({
            audio: true
        })
        .then(stream => {
            showScreen('game');
            setupGameAudio(stream);
            resetGameState();
            if (gameState.animationFrameId) {
                cancelAnimationFrame(gameState.animationFrameId);
            }
            runGameLoop();
        })
        .catch(err => {
            console.error("Microphone access denied:", err);
            alert('Microphone access is required to play. Please allow access and try again.');
        });
}

function endGame() {
    gameState.currentState = 'gameOver';
    showScreen('gameOver');

    if (audioState.mediaStreamSource) {
        audioState.mediaStreamSource.mediaStream.getTracks().forEach(track => track.stop());
    }
    if (audioState.audioContext && audioState.audioContext.state !== 'closed') {
        audioState.audioContext.close();
    }
    audioState.audioContext = null;
}

window.addEventListener('resize', resizeCanvas);
ui.playButton.addEventListener('click', startGame);
ui.restartButton.addEventListener('click', startGame);
ui.mainMenuButton.addEventListener('click', () => showScreen('menu'));

ui.playButton.disabled = true;
resizeCanvas();
loadAssets();
showScreen('menu');