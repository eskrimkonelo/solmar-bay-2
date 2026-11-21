// Solmar Bay — the game loop, the screen state, and save/load. Main owns
// the loop and the screens (title, briefing, playing, paused, game over). It
// builds the world through the world module, steps it while playing, draws
// it every frame through the render module, and keeps the page HUD in step
// with the state. It tolerates a module that is not there yet by drawing a
// plain fallback picture instead of stopping, so later builders can plug
// their modules in one at a time.
(function () {
  var root = typeof window !== 'undefined' ? window : globalThis;
  root.Solmar = root.Solmar || {};
  var Solmar = root.Solmar;

  var SCREEN_TITLE = 'title';
  var SCREEN_BRIEFING = 'briefing';
  var SCREEN_PLAYING = 'playing';
  var SCREEN_PAUSED = 'paused';
  var SCREEN_GAMEOVER = 'gameover';

  var game = {
    screen: SCREEN_TITLE,
    state: null,
    city: null,
    rng: null,
    canvas: null,
    ctx: null,
    minimap: null,
    minimapCtx: null,
    lastTime: 0,
    running: false,
    muted: false
  };

  // ---- world setup -------------------------------------------------------

  function buildCity() {
    if (Solmar.City && typeof Solmar.City.build === 'function') {
      return Solmar.City.build(Solmar.Config.citySeed);
    }
    return null;
  }

  function buildState() {
    var rng = Solmar.Random.create(Solmar.Config.citySeed);
    game.rng = rng;
    var city = buildCity();
    game.city = city;
    if (Solmar.World && typeof Solmar.World.createState === 'function') {
      game.state = Solmar.World.createState(city, rng);
    } else {
      // Placeholder state until the world module lands: enough shape for
      // the HUD and the fallback picture to read.
      game.state = {
        time: 0,
        money: Solmar.Config.startMoney,
        health: Solmar.Config.playerHealth,
        wanted: 0,
        heat: 0,
        player: {
          x: Solmar.Config.startX,
          y: Solmar.Config.startY,
          angle: 0,
          speed: 0,
          onFoot: true,
          car: null,
          health: Solmar.Config.playerHealth,
          weapon: 'pistol',
          ammo: Solmar.Config.pistolAmmo
        },
        cars: [],
        pedestrians: [],
        police: [],
        particles: [],
        pickups: [],
        mission: null,
        camera: { x: Solmar.Config.startX, y: Solmar.Config.startY, zoom: 1, shake: 0 },
        stats: { distanceDriven: 0, crimes: 0, missionsDone: 0 }
      };
    }
    return game.state;
  }

  // ---- save / load -------------------------------------------------------

  function saveGame() {
    if (!game.state) return false;
    var data = {
      money: game.state.money,
      health: game.state.player ? game.state.player.health : game.state.health,
      missionIndex: game.state.mission ? game.state.mission.index : 0,
      playerX: game.state.player ? game.state.player.x : Solmar.Config.startX,
      playerY: game.state.player ? game.state.player.y : Solmar.Config.startY,
      wanted: game.state.wanted,
      time: game.state.time
    };
    try {
      window.localStorage.setItem(Solmar.Config.saveKey, JSON.stringify(data));
      return true;
    } catch (err) {
      return false;
    }
  }

  function loadGame() {
    var raw = null;
    try {
      raw = window.localStorage.getItem(Solmar.Config.saveKey);
    } catch (err) {
      return null;
    }
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (err) {
      return null;
    }
  }

  function applySave(save) {
    if (!save || !game.state) return;
    game.state.money = save.money || 0;
    game.state.wanted = save.wanted || 0;
    game.state.time = save.time || 0;
    if (game.state.player) {
      game.state.player.health = save.health || Solmar.Config.playerHealth;
      game.state.player.x = save.playerX || Solmar.Config.startX;
      game.state.player.y = save.playerY || Solmar.Config.startY;
      game.state.health = game.state.player.health;
    }
    if (game.state.mission) game.state.mission.index = save.missionIndex || 0;
  }

  // ---- screens -----------------------------------------------------------

  var overlay = null;
  var overlayTitle = null;
  var overlayBody = null;
  var overlayButton = null;

  function showOverlay(title, body, buttonLabel, onButton) {
    if (!overlay) return;
    overlayTitle.textContent = title;
    overlayBody.innerHTML = body;
    overlayButton.textContent = buttonLabel;
    overlayButton.onclick = onButton;
    overlay.classList.remove('hidden');
  }

  function hideOverlay() {
    if (overlay) overlay.classList.add('hidden');
  }

  function showTitle() {
    game.screen = SCREEN_TITLE;
    var save = loadGame();
    var continueLine = save
      ? '<p>You have a save: $' + save.money + ', mission ' + (save.missionIndex + 1) + ' of ' + Solmar.Config.missionCount + '.</p>'
      : '';
    showOverlay(
      'SOLMAR BAY',
      '<p>A sun-soaked coastal city. Drive, run, and stay out of trouble — or don\'t.</p>' +
        continueLine +
        '<p><strong>Controls:</strong> WASD or arrows to move and drive, mouse to aim, click to shoot, ' +
        'E to enter or leave a car, Shift to run, P or Escape to pause, M to mute.</p>',
      save ? 'Continue' : 'Start',
      function () {
        if (save) {
          buildState();
          applySave(save);
        } else {
          buildState();
        }
        startBriefing();
      }
    );
  }

  function startBriefing() {
    game.screen = SCREEN_BRIEFING;
    var mission = null;
    if (Solmar.Missions && typeof Solmar.Missions.chain === 'function') {
      var chain = Solmar.Missions.chain();
      var index = game.state.mission ? game.state.mission.index : 0;
      mission = chain[index] || chain[0];
    }
    var title = mission ? mission.title : Solmar.Config.missionTitles[0];
    var intro = mission ? mission.intro : 'A courier driver new to Solmar Bay takes one last job — and the city takes notice.';
    showOverlay(
      'Mission: ' + title,
      '<p>' + intro + '</p>',
      'Begin',
      function () {
        if (Solmar.World && typeof Solmar.World.beginBriefedMission === 'function') {
          Solmar.World.beginBriefedMission(game.state);
        }
        game.screen = SCREEN_PLAYING;
        hideOverlay();
      }
    );
  }

  function showPause() {
    game.screen = SCREEN_PAUSED;
    saveGame();
    showOverlay(
      'Paused',
      '<p>Progress saved. Take a breath — the bay will wait.</p>',
      'Resume',
      function () {
        game.screen = SCREEN_PLAYING;
        hideOverlay();
      }
    );
  }

  function showGameOver() {
    game.screen = SCREEN_GAMEOVER;
    showOverlay(
      'Busted — or worse',
      '<p>The run ends here. Your money and mission progress are saved.</p>',
      'Try again',
      function () {
        buildState();
        startBriefing();
      }
    );
  }

  // ---- HUD ---------------------------------------------------------------

  function starText(wanted) {
    var out = '';
    for (var i = 1; i <= 5; i++) out += i <= wanted ? '★' : '☆';
    return out;
  }

  function syncHud() {
    var state = game.state;
    if (!state) return;
    var healthBar = document.getElementById('health-fill');
    var healthText = document.getElementById('health-text');
    var moneyText = document.getElementById('money-text');
    var wantedText = document.getElementById('wanted-stars');
    var missionText = document.getElementById('mission-text');
    var speedText = document.getElementById('speed-text');
    var health = state.player ? state.player.health : state.health;
    if (healthBar) healthBar.style.width = Math.max(0, Math.min(100, health)) + '%';
    if (healthText) healthText.textContent = Math.ceil(health) + ' HP';
    if (moneyText) moneyText.textContent = '$' + Math.floor(state.money);
    if (wantedText) wantedText.textContent = starText(state.wanted);
    if (missionText) {
      missionText.textContent = state.mission && state.mission.objective
        ? state.mission.objective
        : 'Free roam — no active mission';
    }
    if (speedText) {
      // The world moves in pixels per second; one pixel is about a
      // quarter of a metre here, so px/s * 0.9 reads as km/h. (The old
      // factor of 3.6 treated a pixel as a full metre and showed a
      // cruising car at over 500 km/h.)
      var speed = state.player && !state.player.onFoot
        ? Math.abs(state.player.speed) * 0.9
        : 0;
      speedText.textContent = state.player && !state.player.onFoot
        ? Math.round(speed) + ' km/h'
        : '';
    }
  }

  // ---- fallback drawing --------------------------------------------------

  function drawFallback() {
    var ctx = game.ctx;
    if (!ctx) return;
    var palette = Solmar.Config.palette;
    ctx.fillStyle = palette.water;
    ctx.fillRect(0, 0, game.canvas.width, game.canvas.height);
    ctx.fillStyle = palette.sand;
    ctx.fillRect(0, game.canvas.height - 90, game.canvas.width, 90);
    ctx.fillStyle = palette.road;
    ctx.fillRect(0, game.canvas.height / 2 - 40, game.canvas.width, 80);
    ctx.fillStyle = palette.hudText;
    ctx.font = 'bold 42px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('SOLMAR BAY', game.canvas.width / 2, game.canvas.height / 2 - 60);
    ctx.font = '20px sans-serif';
    ctx.fillText('The city modules are still being built — the loop is running.', game.canvas.width / 2, game.canvas.height / 2 - 20);
  }

  // ---- events ------------------------------------------------------------

  function handleEvents(events) {
    if (!events) return;
    for (var i = 0; i < events.length; i++) {
      var event = events[i];
      if (event.type === 'missionComplete') {
        if (Solmar.Audio && typeof Solmar.Audio.play === 'function') {
          Solmar.Audio.play('missionComplete');
        }
      } else if (event.type === 'missionFailed') {
        showGameOver();
      } else if (event.type === 'playerDown') {
        showGameOver();
      } else if (event.type === 'message' && Solmar.Audio) {
        // Plain messages need no sound; the HUD already shows them.
      }
      if (Solmar.Audio && typeof Solmar.Audio.play === 'function' &&
          (event.type === 'shot' || event.type === 'explosion' || event.type === 'crash' ||
           event.type === 'pickup' || event.type === 'siren')) {
        Solmar.Audio.play(event.type, event);
      }
    }
  }

  // ---- the loop ----------------------------------------------------------

  function frame(now) {
    if (!game.running) return;
    var dt = Math.min(0.05, (now - game.lastTime) / 1000 || 0.016);
    game.lastTime = now;

    if (game.screen === SCREEN_PLAYING && game.state) {
      var events = null;
      if (Solmar.World && typeof Solmar.World.step === 'function') {
        events = Solmar.World.step(game.state, dt, Solmar.Input, game.city);
      }
      handleEvents(events);
      if (game.state.player && game.state.player.health <= 0) {
        showGameOver();
      }
      // Autosave every so often while playing.
      if (Math.floor(game.state.time) % 20 === 0 && game.state.time > 1) saveGame();
    }

    if (game.ctx) {
      if (Solmar.Render && typeof Solmar.Render.draw === 'function') {
        Solmar.Render.draw(game.ctx, game.state, game.city, game.screen);
      } else {
        drawFallback();
      }
    }
    if (game.minimapCtx && Solmar.Render && typeof Solmar.Render.drawMinimap === 'function') {
      Solmar.Render.drawMinimap(game.minimapCtx, game.state, game.city);
    }

    syncHud();
    window.requestAnimationFrame(frame);
  }

  // ---- wiring ------------------------------------------------------------

  function onKeyDown(event) {
    if (event.code === 'KeyP' || event.code === 'Escape') {
      if (game.screen === SCREEN_PLAYING) showPause();
      else if (game.screen === SCREEN_PAUSED) {
        game.screen = SCREEN_PLAYING;
        hideOverlay();
      }
    }
    if (event.code === 'KeyM') {
      game.muted = !game.muted;
      if (Solmar.Audio && typeof Solmar.Audio.setMuted === 'function') {
        Solmar.Audio.setMuted(game.muted);
      }
      var muteButton = document.getElementById('mute-button');
      if (muteButton) muteButton.textContent = game.muted ? 'Unmute (M)' : 'Mute (M)';
    }
  }

  function start() {
    game.canvas = document.getElementById('game-canvas');
    game.minimap = document.getElementById('minimap');
    overlay = document.getElementById('overlay');
    overlayTitle = document.getElementById('overlay-title');
    overlayBody = document.getElementById('overlay-body');
    overlayButton = document.getElementById('overlay-button');
    if (!game.canvas) return;
    game.canvas.width = Solmar.Config.canvasWidth;
    game.canvas.height = Solmar.Config.canvasHeight;
    game.ctx = game.canvas.getContext('2d');
    if (game.minimap) {
      game.minimapCtx = game.minimap.getContext('2d');
    }
    if (Solmar.Input && typeof Solmar.Input.attach === 'function') {
      Solmar.Input.attach(game.canvas);
    }
    if (Solmar.Audio && typeof Solmar.Audio.init === 'function') {
      Solmar.Audio.init();
    }
    var muteButton = document.getElementById('mute-button');
    if (muteButton) {
      muteButton.addEventListener('click', function () {
        game.muted = !game.muted;
        if (Solmar.Audio && typeof Solmar.Audio.setMuted === 'function') {
          Solmar.Audio.setMuted(game.muted);
        }
        muteButton.textContent = game.muted ? 'Unmute (M)' : 'Mute (M)';
      });
    }
    window.addEventListener('keydown', onKeyDown);

    // The shots module stages a named scene for screenshots when the page
    // carries ?shot=<scene>; otherwise the game opens on the title screen.
    var params = new URLSearchParams(window.location.search);
    var shot = params.get('shot');
    buildState();
    if (shot && Solmar.Shots && typeof Solmar.Shots.stage === 'function') {
      Solmar.Shots.stage(game.state, game.city, shot);
      if (shot === 'title') {
        // The title scene stages the title screen itself: show the
        // overlay and keep the screen on title, so the title shot is a
        // real render of the title screen instead of gameplay.
        showTitle();
      } else {
        game.screen = SCREEN_PLAYING;
        hideOverlay();
      }
    } else {
      showTitle();
    }

    game.running = true;
    game.lastTime = performance.now();
    window.requestAnimationFrame(frame);
  }

  // The live game object, so later builders can inspect the screen, the
  // state, and the city while playtesting.
  Solmar.Game = game;
  Solmar.Main = {
    start: start,
    saveGame: saveGame,
    loadGame: loadGame,
    showTitle: showTitle,
    showPause: showPause,
    showGameOver: showGameOver,
    screens: {
      title: SCREEN_TITLE,
      briefing: SCREEN_BRIEFING,
      playing: SCREEN_PLAYING,
      paused: SCREEN_PAUSED,
      gameover: SCREEN_GAMEOVER
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
