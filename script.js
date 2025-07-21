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
    SCORE_UPDATE_INTERVAL: 6,
};

const getEl = id => document.getElementById(id);
const ui = {
    canvas: getEl('gameCanvas'),
    ctx: getEl('gameCanvas').getContext('2d'),
    mainMenu: getEl('mainMenu'),
    gameOverScreen: getEl('gameOverScreen'),
    settingsScreen: getEl('settingsScreen'),
    pauseScreen: getEl('pauseScreen'),
    playButton: getEl('playButton'),
    restartButton: getEl('restartButton'),
    mainMenuButton: getEl('mainMenuButton'),
    settingsIcon: getEl('settingsIcon'),
    pauseIcon: getEl('pauseIcon'),
    backButton: getEl('backButton'),
    resumeButton: getEl('resumeButton'),
    pauseMainMenuButton: getEl('pauseMainMenuButton'),
    micSensitivitySlider: getEl('micSensitivity'),
    sfxVolumeSlider: getEl('sfxVolume'),
    musicVolumeSlider: getEl('musicVolume'),
    scoreEl: getEl('score'),
    finalScoreEl: getEl('finalScore'),
    mainMenuHighScoreEl: getEl('mainMenuHighScore'),
    gameOverHighScoreEl: getEl('gameOverHighScore'),
    explosionOverlay: getEl('explosionOverlay'),
    explosionGif: getEl('explosionGif'),
    mainMenuAnimations: getEl('mainMenuAnimations'),
};

let gameState = {
    currentState: 'menu',
    previousState: null,
    player: {},
    obstacles: [],
    score: 0,
    highScore: 0,
    frameCount: 0,
    glidingStartFrame: 0,
    countdownEndFrame: 0,
    animationFrameId: null,
    assets: { planeImage: null, explosionSound: null, clickSound: null, gameplayMusic: null, gameOverSound: null },
    settings: { micSensitivity: 0.02, sfxVolume: 0.5, musicVolume: 0.5 },
    tipStartFrame: -1,
    audioFadeInterval: null,
};

let audioState = {
    audioContext: null,
    analyser: null,
    mediaStreamSource: null,
    timeDomainData: null,
};

function resizeCanvas() {
    ui.canvas.width = window.innerWidth;
    ui.canvas.height = window.innerHeight;
}

function loadAsset(loader) {
    return new Promise(loader);
}

async function loadAssets() {
    try {
        const [planeImage, explosionSound, clickSound, gameplayMusic, gameOverSound] = await Promise.all([
            loadAsset(resolve => { const i = new Image(); i.onload = () => resolve(i); i.src = 'assets/plane.png'; }),
            loadAsset(resolve => { const a = new Audio(); a.oncanplaythrough = () => resolve(a); a.src = 'assets/sounds/splode.mp3'; }),
            loadAsset(resolve => { const a = new Audio(); a.oncanplaythrough = () => resolve(a); a.src = 'assets/sounds/click.mp3'; }),
            loadAsset(resolve => { const a = new Audio(); a.oncanplaythrough = () => resolve(a); a.src = 'assets/music/lifeofriley.mp3'; a.loop = true; }),
            loadAsset(resolve => { const a = new Audio(); a.oncanplaythrough = () => resolve(a); a.src = 'assets/sounds/dead.mp3'; })
        ]);
        gameState.assets = { planeImage, explosionSound, clickSound, gameplayMusic, gameOverSound };
        applySettings();
        ui.playButton.disabled = false;
        ui.playButton.textContent = 'Play';
    } catch (error) {
        console.error("Failed to load assets:", error);
        ui.playButton.textContent = 'Error Loading';
        alert('Could not load game assets. Please refresh the page.');
    }
}

function getBlowIntensity() {
    if (!audioState.analyser) return 0;
    audioState.analyser.getFloatTimeDomainData(audioState.timeDomainData);
    let sum = 0;
    for (let i = 0; i < audioState.timeDomainData.length; i++) {
        sum += audioState.timeDomainData[i] ** 2;
    }
    const rms = Math.sqrt(sum / audioState.timeDomainData.length);
    const minThreshold = 0.005;
    const maxThreshold = 0.25;
    if (rms > minThreshold) {
        const normalized = (rms - minThreshold) / (maxThreshold - minThreshold);
        return Math.min(1, Math.max(0, normalized));
    }
    return 0;
}

function setupGameAudio(stream) {
    audioState.audioContext = new(window.AudioContext || window.webkitAudioContext)();
    audioState.analyser = audioState.audioContext.createAnalyser();
    audioState.mediaStreamSource = audioState.audioContext.createMediaStreamSource(stream);
    audioState.mediaStreamSource.connect(audioState.analyser);
    audioState.timeDomainData = new Float32Array(audioState.analyser.frequencyBinCount);
}

function resetGameState() {
    const { canvas } = ui;
    gameState.player = {
        x: -100, y: canvas.height,
        width: 60, height: 30,
        targetX: canvas.width * CONFIG.PLAYER_START_X_RATIO,
        targetY: canvas.height * CONFIG.PLAYER_START_Y_RATIO,
        velocityX: 0, velocityY: 0, blowIntensity: 0,
        momentum: 0, rotation: 0
    };
    gameState.obstacles = [];
    
    const firstGapY = Math.random() * (canvas.height - CONFIG.OBSTACLE_GAP_HEIGHT - 100) + 50;
    gameState.obstacles.push({ x: canvas.width, y: firstGapY, id: 0 });

    gameState.score = 0;
    gameState.frameCount = 0;
    gameState.glidingStartFrame = 0;
    gameState.currentState = 'launching';
    gameState.tipStartFrame = -1;
}

function runGameLoop() {
    ui.ctx.clearRect(0, 0, ui.canvas.width, ui.canvas.height);
    const { currentState } = gameState;

    if (currentState === 'paused' || currentState === 'gameOver') {
        drawPlayer();
        updateAndDrawObstacles(false);
        drawUI();
        return;
    }
    
    switch (currentState) {
        case 'launching': updateLaunchAnimation(); break;
        case 'gliding': updateGlidingPhase(); break;
        case 'playing': updatePlayingPhase(); break;
        case 'countdown': updateCountdown(); break;
        case 'crashed': break;
    }

    drawPlayer();
    if (currentState !== 'launching') {
        updateAndDrawObstacles(currentState === 'playing');
    }
    drawUI();

    gameState.animationFrameId = requestAnimationFrame(runGameLoop);
}

function updateLaunchAnimation() {
    gameState.frameCount++;
    const progress = Math.min(gameState.frameCount / CONFIG.LAUNCH_DURATION_FRAMES, 1);
    const easeOut = 1 - (1 - progress) ** 3;
    const { player } = gameState;
    const startX = -100, startY = ui.canvas.height;
    const { targetX, targetY } = player;

    const controlX = startX + (targetX - startX) * 0.4;
    const controlY = startY - (startY - targetY) * 1.2;
    const baseX = (1 - easeOut) ** 2 * startX + 2 * (1 - easeOut) * easeOut * controlX + easeOut ** 2 * targetX;
    const baseY = (1 - easeOut) ** 2 * startY + 2 * (1 - easeOut) * easeOut * controlY + easeOut ** 2 * targetY;

    player.x = baseX + Math.sin(gameState.frameCount * 0.02) * 2 * easeOut;
    player.y = baseY + Math.sin(gameState.frameCount * 0.03) * 4 * easeOut;
    
    const dX = 2 * (1 - easeOut) * (controlX - startX) + 2 * easeOut * (targetX - controlX);
    const dY = 2 * (1 - easeOut) * (controlY - startY) + 2 * easeOut * (targetY - controlY);
    player.rotation = Math.atan2(dY, dX) * (1 - easeOut) + Math.cos(gameState.frameCount * 0.03) * 0.05 * easeOut;

    if (progress >= 1) {
        gameState.currentState = 'gliding';
        gameState.glidingStartFrame = gameState.frameCount;
    }
}

function updateCountdown() {
    gameState.frameCount++;
    if (gameState.frameCount >= gameState.countdownEndFrame) {
        gameState.currentState = gameState.previousState;
        gameState.previousState = null;
    }
}

function updateGlidingPhase() {
    gameState.frameCount++;
    const { player } = gameState;
    player.y = player.targetY + Math.sin(gameState.frameCount * 0.03) * 4;
    player.x = player.targetX + Math.sin(gameState.frameCount * 0.02) * 2;
    player.rotation = Math.cos(gameState.frameCount * 0.03) * 0.05;
    
    const blowIntensity = getBlowIntensity();
    if (blowIntensity > CONFIG.BLOW_INTENSITY_THRESHOLD || gameState.frameCount - gameState.glidingStartFrame > 180) { 
        gameState.currentState = 'playing';
        gameState.frameCount = 0;
        player.blowIntensity = blowIntensity;
        player.rotation = 0;
        player.x = player.targetX;
    }
}

function updatePlayingPhase() {
    gameState.frameCount++;
    const { player } = gameState;

    const rawBlow = getBlowIntensity();
    player.blowIntensity = player.blowIntensity * CONFIG.BLOW_SMOOTHING_FACTOR + rawBlow * (1 - CONFIG.BLOW_SMOOTHING_FACTOR);

    if (player.blowIntensity > CONFIG.BLOW_INTENSITY_THRESHOLD) {
        player.velocityY -= player.blowIntensity * CONFIG.PLAYER_LIFT_MULTIPLIER;
        player.momentum = Math.min(1, player.momentum + CONFIG.PLAYER_MOMENTUM_GAIN * player.blowIntensity);
    } else {
        player.momentum = Math.max(0, player.momentum - CONFIG.PLAYER_MOMENTUM_DECAY);
    }

    player.velocityY += CONFIG.PLAYER_GRAVITY + (player.momentum * CONFIG.PLAYER_MOMENTUM_GRAVITY_ADD);
    player.velocityY *= CONFIG.PLAYER_AIR_RESISTANCE;
    
    player.y += player.velocityY;
    player.velocityY = Math.max(CONFIG.PLAYER_MAX_VELOCITY_Y_UP, Math.min(CONFIG.PLAYER_MAX_VELOCITY_Y_DOWN, player.velocityY));

    if (player.y > ui.canvas.height - player.height) crashPlane(false);
    if (player.y < player.height / 2) {
        player.y = player.height / 2;
        player.velocityY = 0;
    }

    if (gameState.tipStartFrame === -1 && gameState.frameCount > 2700) { 
        gameState.tipStartFrame = gameState.frameCount;
    }

    if (gameState.frameCount % CONFIG.SCORE_UPDATE_INTERVAL === 0) {
        gameState.score++;
    }
}

function drawHandDrawnRect(ctx, x, y, width, height, obstacleId) {
    const seed = obstacleId * 12345;
    const seededRandom = index => {
        const r = Math.sin(seed + index) * 10000;
        return r - Math.floor(r);
    };
    
    ctx.beginPath();
    ctx.strokeStyle = '#2c3e50';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    const segments = 8, points = [];
    for (let i = 0; i <= segments; i++) points.push([x + (width * i / segments) + (seededRandom(i) - 0.5) * 4, y + (seededRandom(i + 100) - 0.5) * 3]);
    for (let i = 1; i <= segments; i++) points.push([x + width + (seededRandom(i + 200) - 0.5) * 3, y + (height * i / segments) + (seededRandom(i + 300) - 0.5) * 4]);
    for (let i = segments - 1; i >= 0; i--) points.push([x + (width * i / segments) + (seededRandom(i + 400) - 0.5) * 4, y + height + (seededRandom(i + 500) - 0.5) * 3]);
    for (let i = segments - 1; i >= 1; i--) points.push([x + (seededRandom(i + 600) - 0.5) * 3, y + (height * i / segments) + (seededRandom(i + 700) - 0.5) * 4]);
    
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
    ctx.closePath();
    ctx.stroke();
}

function updateAndDrawObstacles(shouldUpdate) {
    if (shouldUpdate && gameState.frameCount % CONFIG.OBSTACLE_SPAWN_INTERVAL === 0) {
        const gapY = Math.random() * (ui.canvas.height - CONFIG.OBSTACLE_GAP_HEIGHT - 100) + 50;
        gameState.obstacles.push({ x: ui.canvas.width, y: gapY, id: gameState.obstacles.length });
    }

    for (let i = gameState.obstacles.length - 1; i >= 0; i--) {
        const obs = gameState.obstacles[i];
        if (shouldUpdate) obs.x -= CONFIG.OBSTACLE_SPEED;

        drawHandDrawnRect(ui.ctx, obs.x, 0, CONFIG.OBSTACLE_WIDTH, obs.y, obs.id);
        drawHandDrawnRect(ui.ctx, obs.x, obs.y + CONFIG.OBSTACLE_GAP_HEIGHT, CONFIG.OBSTACLE_WIDTH, ui.canvas.height - obs.y - CONFIG.OBSTACLE_GAP_HEIGHT, obs.id + 1000);

        if (shouldUpdate) {
            const aspect = gameState.assets.planeImage.naturalWidth / gameState.assets.planeImage.naturalHeight;
            const planeHeight = 40, planeWidth = planeHeight * aspect;
            const playerRect = { x: gameState.player.x - planeWidth / 2, y: gameState.player.y - planeHeight / 2, width: planeWidth, height: planeHeight };
            const topPipeRect = { x: obs.x, y: 0, width: CONFIG.OBSTACLE_WIDTH, height: obs.y };
            const bottomPipeRect = { x: obs.x, y: obs.y + CONFIG.OBSTACLE_GAP_HEIGHT, width: CONFIG.OBSTACLE_WIDTH, height: ui.canvas.height };

            if (rectsOverlap(playerRect, topPipeRect) || rectsOverlap(playerRect, bottomPipeRect)) {
                crashPlane();
            }
        }
        if (obs.x + CONFIG.OBSTACLE_WIDTH < 0) gameState.obstacles.splice(i, 1);
    }
}

const rectsOverlap = (r1, r2) => r1.x < r2.x + r2.width && r1.x + r1.width > r2.x && r1.y < r2.y + r2.height && r1.y + r1.height > r2.y;

function crashPlane() {
    gameState.currentState = 'crashed';
    ui.pauseIcon.classList.add('hidden');

    if (gameState.assets.gameplayMusic) {
        clearInterval(gameState.audioFadeInterval);
        gameState.audioFadeInterval = null;
        gameState.assets.gameplayMusic.pause();
        gameState.assets.gameplayMusic.currentTime = 0;
    }

    showExplosion(gameState.player.x, gameState.player.y);
    setTimeout(() => {
        endGame();
        if (gameState.assets.gameOverSound) {
            gameState.assets.gameOverSound.play().catch(e => console.error("Game over sound failed:", e));
        }
        showScreen('gameOver');
    }, 1600);
}

function drawPlayer() {
    const { ctx } = ui;
    const { player, currentState, previousState, assets } = gameState;
    if (!assets.planeImage || currentState === 'crashed') return;
    
    ctx.save();
    ctx.translate(player.x, player.y);

    const effectiveState = currentState === 'countdown' ? previousState : currentState;
    const angle = effectiveState === 'playing' ? Math.atan2(player.velocityY, 5 + player.momentum) : player.rotation;
    
    ctx.rotate(angle);

    const h = 50, w = h * (assets.planeImage.naturalWidth / assets.planeImage.naturalHeight);
    ctx.drawImage(assets.planeImage, -w / 2, -h / 2, w, h);
    ctx.restore();
}

function drawUI() {
    const { ctx, canvas } = ui;
    if (gameState.currentState === 'gliding') {
        const framesIntoGliding = gameState.frameCount - gameState.glidingStartFrame;
        const totalGlideDuration = 900; 
        const fadeInDuration = 60;
        const fadeOutStart = totalGlideDuration - 120;

        let alpha = 0;
        if (framesIntoGliding < fadeInDuration) {
            alpha = framesIntoGliding / fadeInDuration; 
        } else if (framesIntoGliding >= fadeInDuration && framesIntoGliding < fadeOutStart) {
            alpha = 1; 
        } else if (framesIntoGliding >= fadeOutStart && framesIntoGliding < totalGlideDuration) {
            alpha = 1 - (framesIntoGliding - fadeOutStart) / (totalGlideDuration - fadeOutStart); 
        }
        
        ctx.save();
        ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
        ctx.font = '28px "Comic Neue", "Comic Sans MS", cursive';
        ctx.textAlign = 'center';
        ctx.globalAlpha = Math.max(0, alpha);
        ctx.fillText('💨 Blow into your mic to fly!', canvas.width / 2, 100);
        ctx.restore();
    } else if (gameState.currentState === 'countdown') {
        const remainingFrames = gameState.countdownEndFrame - gameState.frameCount;

        let overlayAlpha = 0.5;
        if (remainingFrames <= 60) { 
            overlayAlpha = (remainingFrames / 60) * 0.5;
        }

        ctx.save();
        ctx.fillStyle = `rgba(0, 0, 0, ${overlayAlpha})`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.restore();

        const countdownNumber = Math.ceil(remainingFrames / 60);
        
        const progress = (remainingFrames % 60) / 60;
        const scale = 1 + (1 - progress) * 0.2; 
        const alpha = Math.sin(progress * Math.PI); 

        if (countdownNumber > 0) {
            ctx.save();
            ctx.translate(canvas.width / 2, canvas.height / 2);
            ctx.scale(scale, scale);
            
            ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.9})`;
            ctx.font = '120px "Comic Neue", "Comic Sans MS", cursive';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            
            ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
            ctx.shadowBlur = 10;
            ctx.shadowOffsetX = 3;
            ctx.shadowOffsetY = 3;

            ctx.fillText(countdownNumber, 0, 0);
            ctx.restore();
        }
    }

    if (gameState.tipStartFrame !== -1) {
        const framesSinceTipStart = gameState.frameCount - gameState.tipStartFrame;
        const tipDuration = 480; 
        const fadeInDuration = 60;
        const fadeOutStart = tipDuration - 60;

        let alpha = 0;
        if (framesSinceTipStart < fadeInDuration) {
            alpha = framesSinceTipStart / fadeInDuration;
        } else if (framesSinceTipStart < fadeOutStart) {
            alpha = 1;
        } else if (framesSinceTipStart < tipDuration) {
            alpha = 1 - (framesSinceTipStart - fadeOutStart) / (tipDuration - fadeOutStart);
        }

        if (alpha > 0) {
            ctx.save();
            ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
            ctx.font = '20px "Comic Neue", "Comic Sans MS", cursive';
            ctx.textAlign = 'center';
            ctx.globalAlpha = alpha;
            ctx.fillText("PLEASE take a moment to pause the game if you feel yourself getting lightheaded or just need a break! :)", canvas.width / 2, 60);
            ctx.restore();
        }
    }

    ui.scoreEl.textContent = `Score: ${gameState.score}`;
}

function showExplosion(x, y) {
    const { explosionOverlay, explosionGif } = ui;
    explosionOverlay.style.left = `${x - 110}px`;
    explosionOverlay.style.top = `${y - 110}px`;
    explosionOverlay.style.display = 'block';
    explosionGif.src = 'assets/splode.gif?t=' + Date.now();

    const { explosionSound } = gameState.assets;
    explosionSound.currentTime = 0;
    explosionSound.volume = gameState.settings.sfxVolume;
    explosionSound.play().catch(e => console.error("Audio play failed:", e));
    setTimeout(() => explosionOverlay.style.display = 'none', 1600);
}

function createMainMenuAnimations() {
    if (!gameState.assets.planeImage) return;
    ui.mainMenuAnimations.innerHTML = '';
    for (let i = 0; i < 8; i++) {
        const plane = new Image();
        plane.src = gameState.assets.planeImage.src;
        plane.className = 'bg-plane';
        const size = Math.random() * 60 + 40;
        plane.style.width = `${size}px`;
        plane.style.top = `${Math.random() * 100}%`;
        const duration = Math.random() * 10 + 10;
        plane.style.setProperty('--glide-duration', `${duration}s`);
        plane.style.setProperty('--glide-delay', `${Math.random() * -duration}s`);
        plane.style.setProperty('--glide-y-excursion', `${(Math.random() - 0.5) * 100}px`);
        ui.mainMenuAnimations.appendChild(plane);
    }
}

function saveSettings() {
    localStorage.setItem('voiceGliderSettings', JSON.stringify(gameState.settings));
    localStorage.setItem('voiceGliderHighScore', gameState.highScore);
}

function loadSettings() {
    const saved = localStorage.getItem('voiceGliderSettings');
    if (saved) gameState.settings = { ...gameState.settings, ...JSON.parse(saved) };
    gameState.highScore = parseInt(localStorage.getItem('voiceGliderHighScore') || '0', 10);
    applySettings();
}

function updateSliderFill(slider) {
    const percentage = (slider.value - slider.min) / (slider.max - slider.min) * 100;
    slider.style.setProperty('--slider-fill', `linear-gradient(to right, #333 ${percentage}%, #ccc ${percentage}%)`);
}

function applySettings() {
    CONFIG.BLOW_INTENSITY_THRESHOLD = parseFloat(gameState.settings.micSensitivity);
    ui.micSensitivitySlider.value = gameState.settings.micSensitivity;
    updateSliderFill(ui.micSensitivitySlider);
    
    ui.sfxVolumeSlider.value = gameState.settings.sfxVolume;
    if (gameState.assets.clickSound) gameState.assets.clickSound.volume = gameState.settings.sfxVolume;
    if (gameState.assets.explosionSound) gameState.assets.explosionSound.volume = gameState.settings.sfxVolume;
    if (gameState.assets.gameOverSound) gameState.assets.gameOverSound.volume = gameState.settings.sfxVolume;
    updateSliderFill(ui.sfxVolumeSlider);

    ui.musicVolumeSlider.value = gameState.settings.musicVolume;
    if (gameState.assets.gameplayMusic) gameState.assets.gameplayMusic.volume = gameState.settings.musicVolume;
    updateSliderFill(ui.musicVolumeSlider);

    ui.mainMenuHighScoreEl.textContent = `High Score: ${gameState.highScore}`;
}

function playClickSound() {
    if (!gameState.assets.clickSound) return;
    const sound = gameState.assets.clickSound.cloneNode();
    sound.volume = gameState.settings.sfxVolume;
    sound.play().catch(e => console.error("Click sound failed:", e));
}

function fadeAudio(audio, { to, duration, from }) {
    if (!audio) return;
    clearInterval(gameState.audioFadeInterval);

    const targetVolume = to * gameState.settings.musicVolume;
    const startVolume = from !== undefined ? from * gameState.settings.musicVolume : audio.volume;
    
    audio.volume = startVolume;
    if (targetVolume > 0 && audio.paused) {
        audio.currentTime = audio.currentTime > 0 ? audio.currentTime : 0;
        audio.play().catch(e => console.error("Audio play failed:", e));
    }

    const steps = 50;
    const stepDuration = duration / steps;
    const volumeChange = targetVolume - startVolume;
    const volumeStep = volumeChange / steps;
    let currentStep = 0;

    gameState.audioFadeInterval = setInterval(() => {
        currentStep++;
        const newVolume = startVolume + (currentStep * volumeStep);

        if (currentStep >= steps) {
            audio.volume = targetVolume;
            if (targetVolume === 0) audio.pause();
            clearInterval(gameState.audioFadeInterval);
            gameState.audioFadeInterval = null;
        } else {
            audio.volume = newVolume;
        }
    }, stepDuration);
}

function pauseGame() {
    if (gameState.currentState === 'paused') return;
    cancelAnimationFrame(gameState.animationFrameId);
    gameState.previousState = gameState.currentState;
    gameState.currentState = 'paused';
    if (gameState.assets.gameplayMusic) {
        fadeAudio(gameState.assets.gameplayMusic, { to: 0, duration: 300 });
    }
    showScreen('pause');
}

function resumeGame() {
    if (gameState.currentState !== 'paused') return;
    if (gameState.assets.gameplayMusic) {
        fadeAudio(gameState.assets.gameplayMusic, { to: 1, duration: 500 });
    }
    
    gameState.currentState = 'countdown';
    gameState.countdownEndFrame = gameState.frameCount + 180; 

    showScreen('game');
    runGameLoop();
}

function transitionToScreen(targetScreenName) {
    const activeScreen = document.querySelector('.screen:not(.hidden)');
    if (activeScreen) {
        activeScreen.classList.add('fade-out');
        if (!ui.settingsIcon.classList.contains('hidden')) {
            ui.settingsIcon.classList.add('fade-out');
        }
        setTimeout(() => {
            activeScreen.classList.remove('fade-out');
            ui.settingsIcon.classList.remove('fade-out');
            showScreen(targetScreenName);
        }, 500);
    } else {
        showScreen(targetScreenName);
    }
}

function showScreen(screenName) {
    [ui.mainMenu, ui.gameOverScreen, ui.settingsScreen, ui.pauseScreen].forEach(s => s.classList.add('hidden'));
    [ui.scoreEl, ui.settingsIcon, ui.pauseIcon].forEach(el => el.classList.add('hidden'));

    if (screenName === 'menu') {
        gameState.currentState = 'menu';
        ui.mainMenu.classList.remove('hidden');
        ui.settingsIcon.classList.remove('hidden');
        ui.mainMenuHighScoreEl.textContent = `High Score: ${gameState.highScore}`;
        createMainMenuAnimations();
        if (gameState.animationFrameId) {
            cancelAnimationFrame(gameState.animationFrameId);
            gameState.animationFrameId = null;
        }
        ui.ctx.clearRect(0, 0, ui.canvas.width, ui.canvas.height);
    } else if (screenName === 'gameOver') {
        gameState.currentState = 'gameOver';
        ui.gameOverScreen.classList.remove('hidden');
        ui.finalScoreEl.textContent = `Final Score: ${gameState.score}`;
        ui.gameOverHighScoreEl.textContent = `High Score: ${gameState.highScore}`;
    } else if (screenName === 'game') {
        ui.scoreEl.classList.remove('hidden');
        ui.pauseIcon.classList.remove('hidden');
    } else if (screenName === 'settings') {
        gameState.currentState = 'settings';
        ui.settingsScreen.classList.remove('hidden');
    } else if (screenName === 'pause') {
        ui.pauseScreen.classList.remove('hidden');
        ui.scoreEl.classList.remove('hidden');
    }
}

function startGame() {
    const activeScreen = (gameState.currentState === 'menu') ? ui.mainMenu : ui.gameOverScreen;
    navigator.mediaDevices.getUserMedia({ audio: true })
        .then(stream => {
            activeScreen.classList.add('fade-out');
            if (!ui.settingsIcon.classList.contains('hidden')) {
                ui.settingsIcon.classList.add('fade-out');
            }
            setTimeout(() => {
                activeScreen.classList.remove('fade-out');
                ui.settingsIcon.classList.remove('fade-out');
                showScreen('game');
                if (gameState.assets.gameplayMusic) {
                    fadeAudio(gameState.assets.gameplayMusic, { to: 1, duration: 1000, from: 0 });
                }
                setupGameAudio(stream);
                resetGameState();
                if (gameState.animationFrameId) cancelAnimationFrame(gameState.animationFrameId);
                runGameLoop();
            }, 500);
        })
        .catch(err => {
            console.error("Microphone access denied:", err);
            alert('Microphone access is required to play. Please allow access and try again.');
        });
}

function endGame() {
    cancelAnimationFrame(gameState.animationFrameId);
    if (gameState.score > gameState.highScore) {
        gameState.highScore = gameState.score;
        saveSettings();
    }
    if (audioState.mediaStreamSource) {
        audioState.mediaStreamSource.mediaStream.getTracks().forEach(track => track.stop());
    }
    if (audioState.audioContext && audioState.audioContext.state !== 'closed') {
        audioState.audioContext.close();
    }
    audioState.audioContext = null;
}

function returnToMenu() {
    playClickSound();
    if (gameState.currentState === 'paused' || gameState.currentState === 'gameOver') {
        endGame();
    }
    transitionToScreen('menu');
}

window.addEventListener('resize', resizeCanvas);

ui.playButton.addEventListener('click', () => { playClickSound(); startGame(); });
ui.restartButton.addEventListener('click', () => { playClickSound(); startGame(); });
ui.mainMenuButton.addEventListener('click', returnToMenu);
ui.pauseMainMenuButton.addEventListener('click', returnToMenu);
ui.settingsIcon.addEventListener('click', () => { playClickSound(); transitionToScreen('settings'); });
ui.pauseIcon.addEventListener('click', () => { playClickSound(); pauseGame(); });
ui.resumeButton.addEventListener('click', () => { playClickSound(); resumeGame(); });
ui.backButton.addEventListener('click', () => { playClickSound(); transitionToScreen('menu'); });

ui.micSensitivitySlider.addEventListener('input', e => {
    gameState.settings.micSensitivity = e.target.value;
    CONFIG.BLOW_INTENSITY_THRESHOLD = parseFloat(e.target.value);
    updateSliderFill(e.target);
    saveSettings();
});

ui.sfxVolumeSlider.addEventListener('input', e => {
    gameState.settings.sfxVolume = e.target.value;
    if (gameState.assets.clickSound) gameState.assets.clickSound.volume = e.target.value;
    if (gameState.assets.explosionSound) gameState.assets.explosionSound.volume = e.target.value;
    if (gameState.assets.gameOverSound) gameState.assets.gameOverSound.volume = e.target.value;
    updateSliderFill(e.target);
    playClickSound();
    saveSettings();
});

ui.musicVolumeSlider.addEventListener('input', e => {
    gameState.settings.musicVolume = e.target.value;
    if (gameState.assets.gameplayMusic) gameState.assets.gameplayMusic.volume = e.target.value;
    updateSliderFill(e.target);
    saveSettings();
});

ui.playButton.disabled = true;
resizeCanvas();
loadSettings();
loadAssets().then(() => {
    if (gameState.currentState === 'menu') {
        createMainMenuAnimations();
    }
});
showScreen('menu');