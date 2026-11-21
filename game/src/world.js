// Solmar Bay — the simulation. The world module owns the shared game
// state (player, cars, pedestrians, police, wanted level, money, health,
// the active mission, elapsed time) and advances it by one frame: player
// movement and driving, car physics and collisions, computer-driven
// traffic that keeps to its lane and slows for obstacles, pedestrians who
// wander and flee, a wanted level that rises on crimes and falls when the
// player stays out of trouble, police who pursue, combat, pickups, and
// mission progress. Each step returns a list of events for the main module
// to announce and the audio module to play. Shooting is hit-scan: a shot
// travels instantly along the aim line and is stopped by the first building
// in its way, so the state needs no separate list of bullets.
(function () {
  var root = typeof window !== 'undefined' ? window : globalThis;
  root.Solmar = root.Solmar || {};
  var Solmar = root.Solmar;

  // --- small helpers ----------------------------------------------------------

  function clamp(value, low, high) {
    return value < low ? low : (value > high ? high : value);
  }

  function distance(ax, ay, bx, by) {
    var dx = ax - bx;
    var dy = ay - by;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function angleTo(ax, ay, bx, by) {
    return Math.atan2(by - ay, bx - ax);
  }

  // Shortest signed turn from one angle to another, in (-PI, PI].
  function angleDelta(from, to) {
    var d = to - from;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d <= -Math.PI) d += Math.PI * 2;
    return d;
  }

  function keyDown(input, first, second) {
    if (!input) return false;
    if (typeof input.isEitherDown === 'function') return input.isEitherDown(first, second);
    if (input.keys) return !!(input.keys[first] || input.keys[second]);
    return false;
  }

  function keyHeld(input, code) {
    if (!input) return false;
    if (typeof input.isDown === 'function') return input.isDown(code);
    return !!(input.keys && input.keys[code]);
  }

  // --- car models ---------------------------------------------------------------

  // Top speed and acceleration multiplier by model kind.
  var MODEL_TUNING = {
    sedan: { top: 430, accel: 1.0 },
    hatch: { top: 400, accel: 0.95 },
    truck: { top: 350, accel: 0.8 },
    sport: { top: 520, accel: 1.25 },
    police: { top: 470, accel: 1.15 }
  };

  function modelTopSpeed(model) {
    var tuning = MODEL_TUNING[model] || MODEL_TUNING.sedan;
    return tuning.top;
  }

  function modelAccel(model) {
    var tuning = MODEL_TUNING[model] || MODEL_TUNING.sedan;
    return tuning.accel;
  }

  // --- building collision, with a coarse spatial grid per city --------------------

  var gridCity = null;
  var gridCells = null;
  var GRID_CELL = 320;

  function gridKey(cx, cy) {
    return cx + ',' + cy;
  }

  function buildGrid(city) {
    gridCells = {};
    gridCity = city;
    for (var i = 0; i < city.buildings.length; i++) {
      var b = city.buildings[i];
      var x0 = Math.floor(b.x / GRID_CELL);
      var x1 = Math.floor((b.x + b.w) / GRID_CELL);
      var y0 = Math.floor(b.y / GRID_CELL);
      var y1 = Math.floor((b.y + b.h) / GRID_CELL);
      for (var cx = x0; cx <= x1; cx++) {
        for (var cy = y0; cy <= y1; cy++) {
          var key = gridKey(cx, cy);
          if (!gridCells[key]) gridCells[key] = [];
          gridCells[key].push(b);
        }
      }
    }
  }

  // The building whose rectangle contains the point, or null. Only the grid
  // cell the point falls in is searched, so this stays cheap per frame.
  function buildingAtPoint(city, x, y) {
    if (!city) return null;
    if (gridCity !== city) buildGrid(city);
    var list = gridCells[gridKey(Math.floor(x / GRID_CELL), Math.floor(y / GRID_CELL))];
    if (!list) return null;
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b;
    }
    return null;
  }

  // A circle of radius r at (x, y) is blocked when its centre or its edge
  // touches a building or leaves the city bounds.
  function circleBlocked(city, x, y, r) {
    if (!city) return false;
    if (x < r || y < r || x > city.width - r || y > city.height - r) return true;
    if (buildingAtPoint(city, x, y)) return true;
    // Sample the rim so a wide body cannot clip a corner.
    for (var a = 0; a < 8; a++) {
      var ang = (a / 8) * Math.PI * 2;
      if (buildingAtPoint(city, x + Math.cos(ang) * r, y + Math.sin(ang) * r)) return true;
    }
    return false;
  }

  // True when a building stands anywhere along the segment from (x1, y1)
  // to (x2, y2), sampled every 40 pixels. Used for bullet line of sight.
  function segmentBlocked(city, x1, y1, x2, y2) {
    if (!city) return false;
    var len = distance(x1, y1, x2, y2);
    var steps = Math.max(1, Math.ceil(len / 40));
    for (var i = 1; i < steps; i++) {
      var t = i / steps;
      if (buildingAtPoint(city, x1 + (x2 - x1) * t, y1 + (y2 - y1) * t)) return true;
    }
    return false;
  }

  // --- state creation --------------------------------------------------------------

  var nextCarId = 1;

  function makeCar(state, rng, city, opts) {
    var Config = Solmar.Config;
    var spot = opts.spot || Solmar.City.pickRoadPoint(city, rng);
    var model = opts.model || rng.pick(['sedan', 'sedan', 'hatch', 'truck', 'sport']);
    var car = {
      id: nextCarId++,
      x: spot.x,
      y: spot.y,
      angle: opts.angle !== undefined ? opts.angle : spot.angle,
      speed: 0,
      steering: 0,
      color: opts.color || rng.pick(Config.carPaints),
      model: model,
      health: Config.carHealth,
      driver: opts.driver || null,
      parked: !!opts.parked,
      smoking: false,
      burning: false,
      exploded: false,
      // Traffic routing: which road the car follows, how far along it, and
      // which way it travels; parked cars and the player's car ignore these.
      roadIndex: opts.roadIndex !== undefined ? opts.roadIndex : -1,
      roadT: opts.roadT !== undefined ? opts.roadT : 0,
      roadDir: opts.roadDir !== undefined ? opts.roadDir : 1,
      laneOffset: opts.laneOffset || 0,
      cruiseSpeed: 0,
      blockedTime: 0
    };
    if (car.driver === 'traffic') {
      car.cruiseSpeed = rng.range(Config.trafficSpeedSlow, Config.trafficSpeedFast);
      if (car.model === 'truck') car.cruiseSpeed *= 0.8;
      if (car.model === 'sport') car.cruiseSpeed *= 1.2;
    }
    return car;
  }

  function makePedestrian(state, rng, city) {
    var spot = Solmar.City.pickSidewalkPoint(city, rng);
    var dest = Solmar.City.pickSidewalkPoint(city, rng);
    return {
      x: spot.x,
      y: spot.y,
      angle: rng.range(0, Math.PI * 2),
      speed: 0,
      destX: dest.x,
      destY: dest.y,
      state: 'walk',
      health: 50,
      fleeTimer: 0,
      threatX: 0,
      threatY: 0
    };
  }

  function makePickup(state, rng, city, kind) {
    var Config = Solmar.Config;
    var spot = Solmar.City.pickSidewalkPoint(city, rng);
    return {
      x: spot.x,
      y: spot.y,
      kind: kind || (rng.chance(0.5) ? 'health' : 'ammo'),
      amount: kind === 'ammo' ? Config.ammoPickup : Config.healthPickup
    };
  }

  function createState(city, rng) {
    var Config = Solmar.Config;
    var state = {
      time: 0,
      money: Config.startMoney,
      health: Config.playerHealth,
      wanted: 0,
      heat: 0,
      player: {
        x: Config.startX,
        y: Config.startY,
        angle: 0,
        speed: 0,
        onFoot: true,
        car: null,
        health: Config.playerHealth,
        weapon: 'pistol',
        ammo: Config.pistolAmmo,
        fireCooldown: 0,
        enterCooldown: 0
      },
      cars: [],
      pedestrians: [],
      police: [],
      particles: [],
      pickups: [],
      mission: null,
      camera: { x: Config.startX, y: Config.startY, zoom: Config.cameraZoom, shake: 0 },
      stats: { distanceDriven: 0, crimes: 0, missionsDone: 0 },
      // Extra working fields the modules share (not part of the saved game).
      skids: [],
      rng: rng,
      lastCrimeTime: -100,
      lastShot: null,
      policeSpawnCooldown: 0,
      pickupTimer: 0,
      sirenOn: false
    };

    if (city) {
      // Traffic: most cars drive, a few sit parked along the streets.
      for (var i = 0; i < Config.trafficCount; i++) {
        var parked = i < 6;
        var roadIndex = rng.nextInt(0, city.roads.length);
        var road = city.roads[roadIndex];
        var t = rng.range(0.1, 0.9);
        var dir = rng.chance(0.5) ? 1 : -1;
        var roadAngle = Math.atan2(road.y2 - road.y1, road.x2 - road.x1);
        if (dir < 0) roadAngle += Math.PI;
        var car = makeCar(state, rng, city, {
          roadIndex: roadIndex,
          roadT: t,
          roadDir: dir,
          laneOffset: road.width / 4,
          angle: roadAngle,
          driver: parked ? null : 'traffic',
          parked: parked
        });
        // Parked cars hug the road edge instead of sitting in a lane.
        if (parked) {
          var px = -(road.y2 - road.y1);
          var py = road.x2 - road.x1;
          var plen = Math.sqrt(px * px + py * py) || 1;
          car.x = road.x1 + (road.x2 - road.x1) * t + (px / plen) * (road.width / 2 - 14);
          car.y = road.y1 + (road.y2 - road.y1) * t + (py / plen) * (road.width / 2 - 14);
        }
        state.cars.push(car);
      }
      for (var p = 0; p < Config.pedestrianCount; p++) {
        state.pedestrians.push(makePedestrian(state, rng, city));
      }
      for (var k = 0; k < 8; k++) {
        state.pickups.push(makePickup(state, rng, city));
      }
    }
    return state;
  }

  // --- events and effects -----------------------------------------------------------

  function addHeat(state, amount, events, label) {
    var Config = Solmar.Config;
    state.heat = clamp(state.heat + amount, 0, 100);
    state.lastCrimeTime = state.time;
    state.stats.crimes++;
    if (label) events.push({ type: 'message', text: label });
  }

  function spawnParticles(state, x, y, count, color, speed, life, size) {
    for (var i = 0; i < count; i++) {
      if (state.particles.length > 400) state.particles.shift();
      var ang = state.rng.range(0, Math.PI * 2);
      var sp = state.rng.range(speed * 0.3, speed);
      state.particles.push({
        x: x,
        y: y,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp,
        life: state.rng.range(life * 0.5, life),
        maxLife: life,
        size: state.rng.range(size * 0.6, size * 1.4),
        color: color,
        kind: 'dot'
      });
    }
  }

  function explodeAt(state, x, y, events, radius) {
    var Config = Solmar.Config;
    spawnParticles(state, x, y, 26, '#ff9a3c', 260, 0.9, 7);
    spawnParticles(state, x, y, 14, '#555555', 120, 1.4, 10);
    spawnParticles(state, x, y, 10, '#ffd166', 320, 0.5, 5);
    state.camera.shake = Math.max(state.camera.shake, Config.shakeOnExplosion);
    events.push({ type: 'explosion', x: x, y: y });
    // Anything close takes a heavy hit.
    for (var i = 0; i < state.cars.length; i++) {
      var car = state.cars[i];
      if (distance(car.x, car.y, x, y) < radius) damageCar(state, car, 60, events);
    }
    for (var j = 0; j < state.pedestrians.length; j++) {
      var ped = state.pedestrians[j];
      if (distance(ped.x, ped.y, x, y) < radius) ped.health = 0;
    }
    var player = state.player;
    if (distance(player.x, player.y, x, y) < radius) {
      player.health -= 30;
      state.health = player.health;
    }
    for (var p = 0; p < state.police.length; p++) {
      var cop = state.police[p];
      if (distance(cop.x, cop.y, x, y) < radius) cop.health -= 60;
    }
  }

  function damageCar(state, car, amount, events) {
    var Config = Solmar.Config;
    // A car that already blew up takes no further damage; its health
    // stays at zero so the rest of the game treats it as a wreck.
    if (car.exploded) return;
    car.health -= amount;
    car.smoking = car.health < Config.carSmokeAt;
    car.burning = car.health < Config.carFireAt;
    if (car.health <= 0) {
      car.health = 0;
      car.burning = true;
      car.exploded = true;
      explodeAt(state, car.x, car.y, events, 130);
      if (car.driver === 'player') {
        // The player's car blew up under them; they climb out hurt.
        state.player.onFoot = true;
        state.player.car = null;
        state.player.speed = 0;
        state.player.health -= 15;
        state.health = state.player.health;
        car.driver = null;
        events.push({ type: 'message', text: 'Your car exploded!' });
      } else if (car.driver === 'traffic') {
        car.driver = null;
        car.parked = true;
      }
    }
  }

  // --- the player ---------------------------------------------------------------------

  function nearestCar(state, x, y, maxDist) {
    var best = null;
    var bestD = maxDist;
    for (var i = 0; i < state.cars.length; i++) {
      var car = state.cars[i];
      if (car.health <= 0) continue;
      var d = distance(car.x, car.y, x, y);
      if (d < bestD) { bestD = d; best = car; }
    }
    return best;
  }

  function enterCar(state, events) {
    var Config = Solmar.Config;
    var player = state.player;
    var car = nearestCar(state, player.x, player.y, 78);
    if (!car) return;
    if (car.driver === 'traffic') {
      // Pull the driver out onto the sidewalk, fleeing.
      var driver = makePedestrian(state, state.rng, state.cityRef);
      driver.x = car.x + 40;
      driver.y = car.y;
      driver.state = 'flee';
      driver.fleeTimer = 2.5;
      driver.threatX = player.x;
      driver.threatY = player.y;
      state.pedestrians.push(driver);
      car.driver = null;
      addHeat(state, Config.heatStealCar, events, 'You stole a car!');
    } else if (car.parked) {
      addHeat(state, Config.heatStealCar, events, 'You stole a parked car!');
      car.parked = false;
    }
    car.driver = 'player';
    player.car = car;
    player.onFoot = false;
    player.speed = 0;
    player.x = car.x;
    player.y = car.y;
    player.angle = car.angle;
  }

  function exitCar(state, events) {
    var player = state.player;
    var car = player.car;
    if (!car) return;
    car.driver = null;
    car.speed = 0;
    player.car = null;
    player.onFoot = true;
    player.speed = 0;
    // Step out on the car's right side, clear of the body.
    var side = player.angle + Math.PI / 2;
    player.x = car.x + Math.cos(side) * 34;
    player.y = car.y + Math.sin(side) * 34;
    player.angle = car.angle;
  }

  function fireWeapon(state, events) {
    var Config = Solmar.Config;
    var player = state.player;
    if (player.ammo <= 0) {
      events.push({ type: 'message', text: 'Out of ammo — find an ammo pickup.' });
      player.fireCooldown = 0.5;
      return;
    }
    player.ammo--;
    player.fireCooldown = Config.fireInterval;
    var muzzleX = player.x + Math.cos(player.angle) * 22;
    var muzzleY = player.y + Math.sin(player.angle) * 22;
    spawnParticles(state, muzzleX, muzzleY, 4, '#ffd166', 140, 0.15, 4);
    events.push({ type: 'shot', x: player.x, y: player.y, angle: player.angle });
    state.lastShot = { x: player.x, y: player.y, time: state.time };
    addHeat(state, Config.heatShoot, events, null);

    // Hit-scan: the nearest thing near the aim line, inside range, with a
    // clear line of sight, takes the hit.
    var endX = player.x + Math.cos(player.angle) * Config.bulletRange;
    var endY = player.y + Math.sin(player.angle) * Config.bulletRange;
    var bestD = Config.bulletRange;
    var hitKind = null;
    var hitRef = null;
    function consider(tx, ty, radius, kind, ref) {
      var dx = tx - player.x;
      var dy = ty - player.y;
      var along = dx * Math.cos(player.angle) + dy * Math.sin(player.angle);
      if (along < 0 || along > bestD) return;
      var across = Math.abs(-dx * Math.sin(player.angle) + dy * Math.cos(player.angle));
      if (across > radius + 10) return;
      if (segmentBlocked(state.cityRef, player.x, player.y, tx, ty)) return;
      bestD = along;
      hitKind = kind;
      hitRef = ref;
    }
    for (var i = 0; i < state.pedestrians.length; i++) {
      var ped = state.pedestrians[i];
      consider(ped.x, ped.y, 14, 'pedestrian', ped);
    }
    for (var j = 0; j < state.police.length; j++) {
      var cop = state.police[j];
      consider(cop.x, cop.y, cop.kind === 'car' ? 26 : 14, 'police', cop);
    }
    for (var c = 0; c < state.cars.length; c++) {
      var car = state.cars[c];
      if (car.driver === 'player') continue;
      consider(car.x, car.y, 26, 'car', car);
    }
    if (!hitKind) return;
    spawnParticles(state, hitRef.x, hitRef.y, 6, '#e05252', 120, 0.4, 4);
    if (hitKind === 'pedestrian') {
      hitRef.health -= Config.bulletDamage;
      if (hitRef.health <= 0) {
        addHeat(state, Config.heatHitPedestrian, events, 'You hit a pedestrian!');
      }
    } else if (hitKind === 'police') {
      hitRef.health -= Config.bulletDamage;
      if (hitRef.health <= 0) {
        events.push({ type: 'message', text: 'You took down an officer!' });
      }
    } else if (hitKind === 'car') {
      damageCar(state, hitRef, Config.bulletDamage, events);
    }
  }

  function updatePlayerOnFoot(state, dt, input, city, events) {
    var Config = Solmar.Config;
    var player = state.player;
    var ix = 0;
    var iy = 0;
    if (keyDown(input, 'KeyW', 'ArrowUp')) iy -= 1;
    if (keyDown(input, 'KeyS', 'ArrowDown')) iy += 1;
    if (keyDown(input, 'KeyA', 'ArrowLeft')) ix -= 1;
    if (keyDown(input, 'KeyD', 'ArrowRight')) ix += 1;
    var moving = ix !== 0 || iy !== 0;
    var speed = keyHeld(input, 'ShiftLeft') || keyHeld(input, 'ShiftRight')
      ? Config.runSpeed : Config.walkSpeed;
    if (moving) {
      var len = Math.sqrt(ix * ix + iy * iy);
      var stepX = (ix / len) * speed * dt;
      var stepY = (iy / len) * speed * dt;
      // Move one axis at a time so the player slides along walls.
      if (!circleBlocked(city, player.x + stepX, player.y, Config.playerRadius)) {
        player.x += stepX;
      }
      if (!circleBlocked(city, player.x, player.y + stepY, Config.playerRadius)) {
        player.y += stepY;
      }
      player.speed = speed;
    } else {
      player.speed = 0;
    }

    // Aim with the mouse: the aim line runs from the player through the
    // mouse position in the world.
    if (input && typeof input.mouseCanvasX === 'number') {
      var cam = state.camera;
      var mouseWorldX = cam.x + (input.mouseCanvasX - Config.canvasWidth / 2) / cam.zoom;
      var mouseWorldY = cam.y + (input.mouseCanvasY - Config.canvasHeight / 2) / cam.zoom;
      player.angle = Math.atan2(mouseWorldY - player.y, mouseWorldX - player.x);
    }

    player.fireCooldown -= dt;
    player.enterCooldown -= dt;
    if (keyHeld(input, 'KeyE') && player.enterCooldown <= 0) {
      player.enterCooldown = 0.4;
      enterCar(state, events);
    }
    if (input && input.mouseDown && player.fireCooldown <= 0) {
      fireWeapon(state, events);
    }
  }

  function updatePlayerDriving(state, dt, input, city, events) {
    var Config = Solmar.Config;
    var player = state.player;
    var car = player.car;
    if (!car || car.health <= 0) {
      player.onFoot = true;
      player.car = null;
      player.speed = 0;
      return;
    }
    var top = modelTopSpeed(car.model);
    var forward = keyDown(input, 'KeyW', 'ArrowUp');
    var braking = keyDown(input, 'KeyS', 'ArrowDown');
    var steerLeft = keyDown(input, 'KeyA', 'ArrowLeft');
    var steerRight = keyDown(input, 'KeyD', 'ArrowRight');

    if (forward) car.speed += Config.carAccel * modelAccel(car.model) * dt;
    if (braking) {
      if (car.speed > 10) car.speed -= Config.carBrake * dt;
      else car.speed -= Config.carAccel * 0.6 * dt;
    }
    // Rolling resistance and a softer top speed off the road.
    car.speed -= car.speed * 0.6 * dt;
    var onRoad = Solmar.City.isDrivable(city, car.x, car.y);
    var limit = onRoad ? top : top * 0.55;
    car.speed = clamp(car.speed, -Config.carReverseSpeed, limit);

    var steer = 0;
    if (steerLeft) steer -= 1;
    if (steerRight) steer += 1;
    // Steering bites harder at speed but fades to nothing when stopped,
    // and reverses when backing up.
    var steerAuthority = clamp(Math.abs(car.speed) / 120, 0, 1);
    var dirSign = car.speed >= 0 ? 1 : -1;
    car.angle += steer * Config.carTurnRate * steerAuthority * dirSign * dt;
    car.steering = steer;

    var nx = car.x + Math.cos(car.angle) * car.speed * dt;
    var ny = car.y + Math.sin(car.angle) * car.speed * dt;
    var radius = Config.carLength / 2 - 4;
    if (circleBlocked(city, nx, ny, radius)) {
      // A hard stop against a building: bounce, take damage, leave a mark.
      if (Math.abs(car.speed) > 90) {
        damageCar(state, car, Config.carDamagePerHit, events);
        events.push({ type: 'crash', x: car.x, y: car.y });
        spawnParticles(state, car.x, car.y, 8, '#e8e8e8', 160, 0.5, 4);
        state.camera.shake = Math.max(state.camera.shake, Config.shakeOnCrash);
      }
      car.speed *= -0.25;
    } else {
      // Skid marks while turning hard at speed.
      if (Math.abs(car.speed) > 200 && steer !== 0) {
        if (state.skids.length > 200) state.skids.shift();
        state.skids.push({ x1: car.x, y1: car.y, x2: nx, y2: ny, life: Config.skidMarkLife });
      }
      car.x = nx;
      car.y = ny;
      state.stats.distanceDriven += Math.abs(car.speed) * dt;
      if (!onRoad && Math.abs(car.speed) > 150) {
        spawnParticles(state, car.x, car.y, 1, '#b8a888', 60, 0.6, 5);
      }
    }

    // A burning car keeps losing health until it goes up. The particle
    // pass handles the smoke, the damage, and the explosion, so driving
    // only keeps the player in sync with the car.
    player.x = car.x;
    player.y = car.y;
    player.angle = car.angle;
    player.speed = car.speed;

    player.enterCooldown -= dt;
    if (keyHeld(input, 'KeyE') && player.enterCooldown <= 0) {
      player.enterCooldown = 0.4;
      exitCar(state, events);
    }
  }

  // --- traffic ------------------------------------------------------------------

  // The roads that meet at a point, for choosing the next road at a junction.
  var nodeCacheCity = null;
  var nodeCache = null;

  function nodeMap(city) {
    if (nodeCacheCity === city && nodeCache) return nodeCache;
    var map = {};
    for (var i = 0; i < city.roads.length; i++) {
      var r = city.roads[i];
      var a = Math.round(r.x1) + ',' + Math.round(r.y1);
      var b = Math.round(r.x2) + ',' + Math.round(r.y2);
      if (!map[a]) map[a] = [];
      if (!map[b]) map[b] = [];
      map[a].push(i);
      map[b].push(i);
    }
    nodeCacheCity = city;
    nodeCache = map;
    return map;
  }

  function roadLength(road) {
    return distance(road.x1, road.y1, road.x2, road.y2);
  }

  function updateTrafficCar(state, car, dt, city, events) {
    var Config = Solmar.Config;
    if (car.parked || car.driver !== 'traffic' || car.health <= 0) return;
    if (car.roadIndex < 0 || car.roadIndex >= city.roads.length) {
      car.roadIndex = state.rng.nextInt(0, city.roads.length);
      car.roadT = 0;
      car.roadDir = 1;
    }
    var road = city.roads[car.roadIndex];
    var len = roadLength(road) || 1;

    // Another car ahead in the same lane: match its speed instead of
    // driving through it. Parked cars sit on the road's right-hand side,
    // so they only block traffic travelling that way.
    var targetSpeed = car.cruiseSpeed;
    for (var i = 0; i < state.cars.length; i++) {
      var other = state.cars[i];
      if (other === car || other.roadIndex !== car.roadIndex) continue;
      if (other.parked) {
        if (car.roadDir !== 1) continue;
        var pgap = (other.roadT - car.roadT) * len;
        if (pgap > 0 && pgap < 95) targetSpeed = 0;
        continue;
      }
      if (other.roadDir !== car.roadDir) continue;
      var gap = (other.roadT - car.roadT) * car.roadDir * len;
      if (gap > 0 && gap < 95) targetSpeed = Math.min(targetSpeed, Math.max(0, other.speed));
    }
    // The player's car right in front: stop for it.
    var player = state.player;
    if (!player.onFoot && player.car) {
      var pdx = player.car.x - car.x;
      var pdy = player.car.y - car.y;
      var ahead = pdx * Math.cos(car.angle) + pdy * Math.sin(car.angle);
      var aside = Math.abs(-pdx * Math.sin(car.angle) + pdy * Math.cos(car.angle));
      if (ahead > 0 && ahead < 85 && aside < 30) targetSpeed = 0;
    }

    if (targetSpeed === 0) {
      // Stuck behind something: wait it out rather than swinging into
      // the oncoming lane.
      car.blockedTime += dt;
    } else {
      car.blockedTime = 0;
    }

    car.speed += clamp(targetSpeed - car.speed, -260 * dt, 200 * dt);
    car.roadT += (car.speed * dt / len) * car.roadDir;

    // Reached the end of the road: pick a new road at the junction.
    if (car.roadT >= 1 || car.roadT <= 0) {
      var endX = car.roadT >= 1 ? road.x2 : road.x1;
      var endY = car.roadT >= 1 ? road.y2 : road.y1;
      var key = Math.round(endX) + ',' + Math.round(endY);
      var choices = nodeMap(city)[key] || [];
      var next = -1;
      for (var c = 0; c < 8 && choices.length > 0; c++) {
        var cand = choices[state.rng.nextInt(0, choices.length)];
        if (cand !== car.roadIndex) { next = cand; break; }
      }
      if (next < 0) {
        // Dead end: turn around on the same road.
        car.roadDir = -car.roadDir;
        car.roadT = clamp(car.roadT, 0, 1);
      } else {
        var nextRoad = city.roads[next];
        car.roadIndex = next;
        if (Math.round(nextRoad.x1) === Math.round(endX) && Math.round(nextRoad.y1) === Math.round(endY)) {
          car.roadDir = 1;
          car.roadT = 0;
        } else {
          car.roadDir = -1;
          car.roadT = 1;
        }
        // The lane offset is always the right-hand side of the direction
        // of travel; the side flip in the position math handles the rest.
        car.laneOffset = road.width / 4;
      }
      road = city.roads[car.roadIndex];
      len = roadLength(road) || 1;
    }

    // Position from the road centreline plus the lane offset to the right
    // of the direction of travel.
    var dx = (road.x2 - road.x1) / len;
    var dy = (road.y2 - road.y1) / len;
    var along = car.roadT;
    var px = road.x1 + (road.x2 - road.x1) * along;
    var py = road.y1 + (road.y2 - road.y1) * along;
    var side = car.roadDir >= 0 ? 1 : -1;
    var ox = -dy * side;
    var oy = dx * side;
    car.x = px + ox * car.laneOffset;
    car.y = py + oy * car.laneOffset;
    car.angle = Math.atan2(dy * car.roadDir, dx * car.roadDir);
  }

  function updateTraffic(state, dt, city, events) {
    for (var i = 0; i < state.cars.length; i++) {
      updateTrafficCar(state, state.cars[i], dt, city, events);
    }
    // Car-on-car collisions, checked in the first car's own frame: two
    // cars only touch when they overlap along the direction of travel
    // and across it. A plain circle check would flag cars passing in
    // opposite lanes as a crash, since the lanes are only 32 pixels apart.
    for (var a = 0; a < state.cars.length; a++) {
      var carA = state.cars[a];
      if (carA.health <= 0) continue;
      var fwdX = Math.cos(carA.angle);
      var fwdY = Math.sin(carA.angle);
      for (var b = a + 1; b < state.cars.length; b++) {
        var carB = state.cars[b];
        if (carB.health <= 0) continue;
        var dx = carB.x - carA.x;
        var dy = carB.y - carA.y;
        var along = dx * fwdX + dy * fwdY;
        var aside = Math.abs(-dx * fwdY + dy * fwdX);
        if (Math.abs(along) < 48 && aside < 24) {
          var d = distance(carA.x, carA.y, carB.x, carB.y) || 1;
          var push = (48 - Math.abs(along)) / 2;
          var nx = dx / d;
          var ny = dy / d;
          carA.x -= nx * push;
          carA.y -= ny * push;
          carB.x += nx * push;
          carB.y += ny * push;
          var rel = Math.abs(carA.speed - carB.speed);
          if (rel > 120) {
            damageCar(state, carA, 6, events);
            damageCar(state, carB, 6, events);
            if (carA.driver === 'player' || carB.driver === 'player') {
              events.push({ type: 'crash', x: (carA.x + carB.x) / 2, y: (carA.y + carB.y) / 2 });
              spawnParticles(state, (carA.x + carB.x) / 2, (carA.y + carB.y) / 2, 6, '#e8e8e8', 140, 0.4, 4);
            }
          }
        }
      }
    }
  }

  // --- pedestrians ------------------------------------------------------------------

  function updatePedestrians(state, dt, city, events) {
    var Config = Solmar.Config;
    var player = state.player;
    for (var i = state.pedestrians.length - 1; i >= 0; i--) {
      var ped = state.pedestrians[i];
      if (ped.health <= 0) {
        spawnParticles(state, ped.x, ped.y, 8, '#e05252', 100, 0.6, 5);
        state.pedestrians.splice(i, 1);
        continue;
      }
      // A recent gunshot nearby, or a fast car bearing down, sends them
      // running the other way.
      if (ped.state !== 'flee') {
        if (state.lastShot && state.time - state.lastShot.time < 1.5 &&
            distance(ped.x, ped.y, state.lastShot.x, state.lastShot.y) < 420) {
          ped.state = 'flee';
          ped.fleeTimer = 2.5;
          ped.threatX = state.lastShot.x;
          ped.threatY = state.lastShot.y;
        } else {
          for (var c = 0; c < state.cars.length; c++) {
            var car = state.cars[c];
            if (Math.abs(car.speed) < 100) continue;
            var d = distance(ped.x, ped.y, car.x, car.y);
            if (d < 90) {
              ped.state = 'flee';
              ped.fleeTimer = 2;
              ped.threatX = car.x;
              ped.threatY = car.y;
              break;
            }
          }
        }
      }
      if (ped.state === 'flee') {
        ped.fleeTimer -= dt;
        var away = angleTo(ped.threatX, ped.threatY, ped.x, ped.y);
        ped.angle = away;
        var fx = ped.x + Math.cos(away) * Config.pedestrianFleeSpeed * dt;
        var fy = ped.y + Math.sin(away) * Config.pedestrianFleeSpeed * dt;
        if (Solmar.City.isWalkable(city, fx, fy)) { ped.x = fx; ped.y = fy; }
        ped.speed = Config.pedestrianFleeSpeed;
        if (ped.fleeTimer <= 0) ped.state = 'walk';
      } else {
        var destD = distance(ped.x, ped.y, ped.destX, ped.destY);
        if (destD < 24) {
          var spot = Solmar.City.pickSidewalkPoint(city, state.rng);
          ped.destX = spot.x;
          ped.destY = spot.y;
        } else {
          var heading = angleTo(ped.x, ped.y, ped.destX, ped.destY);
          ped.angle = heading;
          var nx = ped.x + Math.cos(heading) * Config.pedestrianSpeed * dt;
          var ny = ped.y + Math.sin(heading) * Config.pedestrianSpeed * dt;
          if (Solmar.City.isWalkable(city, nx, ny)) { ped.x = nx; ped.y = ny; }
          else {
            var spot2 = Solmar.City.pickSidewalkPoint(city, state.rng);
            ped.destX = spot2.x;
            ped.destY = spot2.y;
          }
          ped.speed = Config.pedestrianSpeed;
        }
      }
      // A moving car that runs a pedestrian down.
      for (var k = 0; k < state.cars.length; k++) {
        var hitCar = state.cars[k];
        if (Math.abs(hitCar.speed) < 60 || hitCar.health <= 0) continue;
        if (distance(ped.x, ped.y, hitCar.x, hitCar.y) < 30) {
          ped.health = 0;
          spawnParticles(state, ped.x, ped.y, 8, '#e05252', 100, 0.6, 5);
          if (hitCar.driver === 'player') {
            addHeat(state, Config.heatHitPedestrian, events, 'You hit a pedestrian!');
            damageCar(state, hitCar, 4, events);
          }
          break;
        }
      }
    }
  }

  // --- wanted level and police ----------------------------------------------------------

  function wantedLevelFor(heat) {
    var Config = Solmar.Config;
    var level = 0;
    for (var i = 0; i < Config.wantedThresholds.length; i++) {
      if (heat >= Config.wantedThresholds[i]) level = i;
    }
    return level;
  }

  function nearestPoliceDistance(state) {
    var best = Infinity;
    for (var i = 0; i < state.police.length; i++) {
      var d = distance(state.police[i].x, state.police[i].y, state.player.x, state.player.y);
      if (d < best) best = d;
    }
    return best;
  }

  function spawnPolice(state, city, events) {
    var Config = Solmar.Config;
    var player = state.player;
    // A pursuit car when the player is driving or the heat is high, an
    // officer on foot otherwise.
    var asCar = !player.onFoot || state.wanted >= 3;
    if (asCar) {
      var spot = Solmar.City.pickRoadPoint(city, state.rng);
      // Try a few times to land reasonably near the player, but not on top.
      for (var t = 0; t < 6; t++) {
        var d = distance(spot.x, spot.y, player.x, player.y);
        if (d > 350 && d < 1100) break;
        spot = Solmar.City.pickRoadPoint(city, state.rng);
      }
      state.police.push({
        kind: 'car',
        x: spot.x,
        y: spot.y,
        angle: spot.angle,
        speed: 0,
        target: player,
        health: Config.carHealth,
        shootCooldown: 0,
        grabTime: 0,
        ramCooldown: 0
      });
    } else {
      var walk = Solmar.City.pickSidewalkPoint(city, state.rng);
      for (var u = 0; u < 6; u++) {
        var dd = distance(walk.x, walk.y, player.x, player.y);
        if (dd > 250 && dd < 800) break;
        walk = Solmar.City.pickSidewalkPoint(city, state.rng);
      }
      state.police.push({
        kind: 'foot',
        x: walk.x,
        y: walk.y,
        angle: 0,
        speed: 0,
        target: player,
        health: 50,
        shootCooldown: 1,
        grabTime: 0,
        ramCooldown: 0
      });
    }
    events.push({ type: 'siren', on: true });
  }

  function updatePolice(state, dt, city, events) {
    var Config = Solmar.Config;
    var player = state.player;
    var wanted = state.wanted;

    // Without a city there is nowhere to spawn pursuit from.
    if (!city) {
      state.police.length = 0;
      return;
    }

    // Numbers follow the wanted level; when it falls to zero the police
    // stand down and leave.
    if (wanted === 0) {
      if (state.police.length > 0) {
        state.police.length = 0;
        if (state.sirenOn) {
          state.sirenOn = false;
          events.push({ type: 'siren', on: false });
        }
      }
      return;
    }
    var desired = Config.policePerStar[wanted] || 0;
    state.policeSpawnCooldown -= dt;
    if (state.police.length < desired && state.policeSpawnCooldown <= 0) {
      state.policeSpawnCooldown = 1.5;
      spawnPolice(state, city, events);
      state.sirenOn = true;
    }

    for (var i = state.police.length - 1; i >= 0; i--) {
      var cop = state.police[i];
      if (cop.health <= 0) {
        if (cop.kind === 'car') explodeAt(state, cop.x, cop.y, events, 120);
        else spawnParticles(state, cop.x, cop.y, 8, '#4a90e2', 100, 0.6, 5);
        state.police.splice(i, 1);
        continue;
      }
      var d = distance(cop.x, cop.y, player.x, player.y);
      if (d > 1800) {
        // Lost the trail far away: despawn and let a fresh unit spawn near.
        state.police.splice(i, 1);
        continue;
      }
      if (cop.kind === 'car') {
        var heading = angleTo(cop.x, cop.y, player.x, player.y);
        var turn = clamp(angleDelta(cop.angle, heading), -1, 1);
        cop.angle += turn * 3.2 * dt;
        cop.speed = clamp(cop.speed + 420 * dt, 0, Config.policeCarSpeed);
        var nx = cop.x + Math.cos(cop.angle) * cop.speed * dt;
        var ny = cop.y + Math.sin(cop.angle) * cop.speed * dt;
        if (!circleBlocked(city, nx, ny, 24)) {
          cop.x = nx;
          cop.y = ny;
        } else {
          // Blocked by a building: swing around it instead of pushing.
          cop.angle += 1.6 * dt;
          cop.speed *= 0.7;
        }
        // Ramming the player's car.
        cop.ramCooldown -= dt;
        if (!player.onFoot && player.car && d < 70 && cop.ramCooldown <= 0) {
          cop.ramCooldown = 1.2;
          damageCar(state, player.car, Config.policeRamDamage, events);
          events.push({ type: 'crash', x: player.x, y: player.y });
          spawnParticles(state, player.x, player.y, 6, '#e8e8e8', 140, 0.4, 4);
          state.camera.shake = Math.max(state.camera.shake, Config.shakeOnCrash);
        }
        if (cop.burning) {
          cop.health -= 2 * dt;
          spawnParticles(state, cop.x, cop.y, 1, '#555555', 50, 1.0, 8);
        }
      } else {
        // An officer on foot: run the player down, and shoot when close.
        var fheading = angleTo(cop.x, cop.y, player.x, player.y);
        cop.angle = fheading;
        var step = Config.policeFootSpeed * dt;
        var fx = cop.x + Math.cos(fheading) * step;
        var fy = cop.y + Math.sin(fheading) * step;
        if (Solmar.City.isWalkable(city, fx, fy)) { cop.x = fx; cop.y = fy; }
        cop.speed = Config.policeFootSpeed;
        cop.shootCooldown -= dt;
        if (d < 320 && wanted >= 2 && cop.shootCooldown <= 0 && player.onFoot) {
          cop.shootCooldown = 1.4;
          events.push({ type: 'shot', x: cop.x, y: cop.y, angle: fheading });
          spawnParticles(state, cop.x + Math.cos(fheading) * 20, cop.y + Math.sin(fheading) * 20, 3, '#ffd166', 120, 0.15, 4);
          if (!segmentBlocked(city, cop.x, cop.y, player.x, player.y) && state.rng.chance(0.4)) {
            player.health -= 8;
            state.health = player.health;
            spawnParticles(state, player.x, player.y, 4, '#e05252', 100, 0.4, 4);
          }
        }
        if (d < Config.policeCatchDistance && player.onFoot) {
          cop.grabTime += dt;
          if (cop.grabTime > 1.5) {
            player.health = 0;
            state.health = 0;
            events.push({ type: 'playerDown', reason: 'busted' });
          }
        } else {
          cop.grabTime = 0;
        }
      }
    }
  }

  function updateWanted(state, dt, events) {
    var Config = Solmar.Config;
    var quietFor = state.time - state.lastCrimeTime;
    var nearPolice = nearestPoliceDistance(state);
    if (quietFor > 4) {
      var rate = Config.wantedDecayPerSecond;
      if (nearPolice > 600) rate += Config.wantedDecayHiddenBonus;
      else rate *= 0.5;
      state.heat = clamp(state.heat - rate * dt, 0, 100);
    }
    // Fleeing from the police while wanted keeps the heat simmering.
    if (state.wanted > 0 && nearPolice < 500) {
      state.heat = clamp(state.heat + Config.heatPerSecondFleeing * dt, 0, 100);
    }
    var level = wantedLevelFor(state.heat);
    if (level !== state.wanted) {
      state.wanted = level;
      if (level > 0) {
        events.push({ type: 'message', text: 'Wanted level ' + level + ' — the police are after you!' });
        events.push({ type: 'siren', on: true });
        state.sirenOn = true;
      } else {
        events.push({ type: 'message', text: 'You lost them. The heat is off.' });
        events.push({ type: 'siren', on: false });
        state.sirenOn = false;
      }
    }
  }

  // --- pickups, particles, camera ---------------------------------------------------

  function updatePickups(state, dt, city, events) {
    var player = state.player;
    for (var i = state.pickups.length - 1; i >= 0; i--) {
      var pickup = state.pickups[i];
      if (distance(pickup.x, pickup.y, player.x, player.y) < Solmar.Config.pickupRadius + 14) {
        if (pickup.kind === 'health') {
          player.health = Math.min(Solmar.Config.playerHealth, player.health + pickup.amount);
          state.health = player.health;
          events.push({ type: 'pickup', kind: 'health', x: pickup.x, y: pickup.y });
          events.push({ type: 'message', text: 'Health +' + pickup.amount });
        } else {
          player.ammo += pickup.amount;
          events.push({ type: 'pickup', kind: 'ammo', x: pickup.x, y: pickup.y });
          events.push({ type: 'message', text: 'Ammo +' + pickup.amount });
        }
        state.pickups.splice(i, 1);
      }
    }
    state.pickupTimer -= dt;
    if (state.pickupTimer <= 0 && state.pickups.length < 6) {
      state.pickupTimer = 20;
      state.pickups.push(makePickup(state, state.rng, city));
    }
  }

  function updateParticles(state, dt, events) {
    for (var i = state.particles.length - 1; i >= 0; i--) {
      var p = state.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        state.particles.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= (1 - 2 * dt);
      p.vy *= (1 - 2 * dt);
    }
    for (var s = state.skids.length - 1; s >= 0; s--) {
      state.skids[s].life -= dt;
      if (state.skids[s].life <= 0) state.skids.splice(s, 1);
    }
    // Damaged cars trail smoke.
    for (var c = 0; c < state.cars.length; c++) {
      var car = state.cars[c];
      if (car.smoking && car.health > 0 && state.rng.chance(0.3)) {
        spawnParticles(state, car.x, car.y, 1, '#666666', 40, 1.2, 7);
      }
      if (car.burning && car.health > 0) {
        spawnParticles(state, car.x, car.y, 2, '#ff9a3c', 90, 0.5, 6);
        // Burn damage goes through damageCar so the car explodes
        // exactly once, instead of decaying past zero unnoticed.
        damageCar(state, car, 2 * dt, events);
      }
    }
  }

  function updateCamera(state, dt) {
    var Config = Solmar.Config;
    var player = state.player;
    var lag = Math.min(1, dt * 6);
    state.camera.x += (player.x - state.camera.x) * lag;
    state.camera.y += (player.y - state.camera.y) * lag;
    state.camera.zoom = Config.cameraZoom;
    state.camera.shake = Math.max(0, state.camera.shake - Config.shakeDecay * dt);
  }

  // --- missions -----------------------------------------------------------------------

  function fallbackMissionTarget(state, city) {
    // A road point a good drive away from the player.
    for (var t = 0; t < 20; t++) {
      var spot = Solmar.City.pickRoadPoint(city, state.rng);
      if (distance(spot.x, spot.y, state.player.x, state.player.y) > 700) return spot;
    }
    return Solmar.City.pickRoadPoint(city, state.rng);
  }

  function startMission(state, index) {
    var Config = Solmar.Config;
    if (Solmar.Missions && typeof Solmar.Missions.start === 'function') {
      var started = Solmar.Missions.start(state, index);
      if (started) {
        state.mission = started;
        return started;
      }
    }
    // Fallback when the missions module is not there yet: a plain
    // drive-to-the-marker job with the config's title and reward.
    var city = state.cityRef;
    var spot = city ? fallbackMissionTarget(state, city) : { x: 1600, y: 1200 };
    var mission = {
      index: index,
      id: 'mission-' + index,
      title: Config.missionTitles[index] || 'Job ' + (index + 1),
      objective: 'Drive to the marker',
      phase: 'active',
      target: { x: spot.x, y: spot.y, label: 'Drop-off' },
      progress: 0,
      timer: 0
    };
    state.mission = mission;
    return mission;
  }

  function beginBriefedMission(state) {
    var index = state.mission ? state.mission.index : 0;
    return startMission(state, index);
  }

  function completeMission(state, mission, events) {
    var Config = Solmar.Config;
    var reward = Config.missionRewards[mission.index] || 0;
    state.money += reward;
    state.stats.missionsDone++;
    events.push({ type: 'missionComplete', reward: reward, index: mission.index, title: mission.title });
    events.push({ type: 'message', text: 'Mission complete! +$' + reward });
    if (mission.index + 1 < Config.missionCount) {
      startMission(state, mission.index + 1);
    } else {
      state.mission = null;
      events.push({ type: 'message', text: 'All missions complete — Solmar Bay is yours.' });
    }
  }

  function updateMission(state, dt, city, events) {
    var mission = state.mission;
    if (!mission) return;
    if (Solmar.Missions && typeof Solmar.Missions.update === 'function') {
      var extra = Solmar.Missions.update(state, dt, city) || [];
      for (var i = 0; i < extra.length; i++) events.push(extra[i]);
      return;
    }
    // Fallback: reach the marker to finish, run out the timer to fail.
    if (mission.phase === 'active' && mission.target) {
      var d = distance(state.player.x, state.player.y, mission.target.x, mission.target.y);
      mission.progress = clamp(1 - d / 2000, 0, 1);
      if (d < Solmar.Config.missionMarkerRadius) {
        completeMission(state, mission, events);
        return;
      }
    }
    if (mission.timer > 0) {
      mission.timer -= dt;
      if (mission.timer <= 0) {
        events.push({ type: 'missionFailed', index: mission.index, reason: 'time' });
        state.mission = null;
      }
    }
  }

  // --- the step --------------------------------------------------------------------------

  function step(state, dt, input, city) {
    var events = [];
    if (!state) return events;
    state.cityRef = city;
    dt = clamp(dt, 0, 0.05);
    state.time += dt;

    if (state.player.onFoot) updatePlayerOnFoot(state, dt, input, city, events);
    else updatePlayerDriving(state, dt, input, city, events);

    if (city) {
      updateTraffic(state, dt, city, events);
      updatePedestrians(state, dt, city, events);
    }
    updatePolice(state, dt, city, events);
    updateWanted(state, dt, events);
    if (city) updatePickups(state, dt, city, events);
    updateParticles(state, dt, events);
    updateMission(state, dt, city, events);
    updateCamera(state, dt);

    if (state.player.health <= 0) {
      state.player.health = 0;
      state.health = 0;
      events.push({ type: 'playerDown', reason: state.wanted > 0 ? 'busted' : 'down' });
    }
    return events;
  }

  Solmar.World = {
    createState: createState,
    step: step,
    startMission: startMission,
    beginBriefedMission: beginBriefedMission
  };
})();
