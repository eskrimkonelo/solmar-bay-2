// Solmar Bay — screenshot staging. When the page carries ?shot=<scene>
// the main module hands the live state and city to this module before the
// first frame, and it arranges a deterministic scene: where the player is,
// whether they are driving, how hot the wanted level is, which mission is
// running, and where the camera sits. Scenes: cover, chase, mission,
// title. Nothing here is random from the clock: any pick comes from a
// generator seeded with the scene name, so the same scene looks the same
// on every load.
(function () {
  var root = typeof window !== 'undefined' ? window : globalThis;
  root.Solmar = root.Solmar || {};
  var Solmar = root.Solmar;

  var SCENES = ['cover', 'chase', 'mission', 'title'];

  // The scene name: the argument the main module passes wins, otherwise
  // the page's ?shot= query parameter, otherwise the cover.
  function sceneName(given) {
    if (typeof given === 'string' && given) return given;
    try {
      var params = new URLSearchParams(window.location.search);
      var shot = params.get('shot');
      if (shot) return shot;
    } catch (err) { /* no query string available */ }
    return 'cover';
  }

  function clamp(value, low, high) {
    return value < low ? low : (value > high ? high : value);
  }

  // The index of the first road whose endpoints satisfy the test, or -1.
  function findRoad(city, test) {
    if (!city || !Array.isArray(city.roads)) return -1;
    for (var i = 0; i < city.roads.length; i++) {
      if (test(city.roads[i])) return i;
    }
    return -1;
  }

  // A road's length, for turning a distance along it into a t in [0, 1].
  function roadLength(road) {
    var dx = road.x2 - road.x1;
    var dy = road.y2 - road.y1;
    return Math.sqrt(dx * dx + dy * dy) || 1;
  }

  // Put a traffic car on a road near a point: pick the road through the
  // point's nearest grid line, then set its road position so the world
  // keeps it there instead of snapping it back to its old road.
  function placeTrafficOnRoad(state, city, car, x, y, angle) {
    if (!car || !city) return;
    var vertical = -1;
    var horizontal = -1;
    for (var i = 0; i < city.roads.length; i++) {
      var road = city.roads[i];
      if (road.x1 === road.x2 && Math.abs(road.x1 - x) < 40) vertical = i;
      if (road.y1 === road.y2 && Math.abs(road.y1 - y) < 40) horizontal = i;
    }
    var index = vertical >= 0 ? vertical : horizontal;
    if (index < 0) {
      car.x = x;
      car.y = y;
      car.angle = angle;
      return;
    }
    var chosen = city.roads[index];
    var len = roadLength(chosen);
    var t = 0.5;
    if (chosen.x1 === chosen.x2) t = clamp((y - chosen.y1) / (chosen.y2 - chosen.y1 || 1), 0.05, 0.95);
    else t = clamp((x - chosen.x1) / (chosen.x2 - chosen.x1 || 1), 0.05, 0.95);
    car.roadIndex = index;
    car.roadT = t;
    car.roadDir = 1;
    car.laneOffset = (chosen.width || 64) / 4;
    car.parked = false;
    car.driver = 'traffic';
    car.angle = angle;
    car.speed = 120;
    car.x = chosen.x1 + (chosen.x2 - chosen.x1) * t;
    car.y = chosen.y1 + (chosen.y2 - chosen.y1) * t;
    // Nudge into the right-hand lane so cars do not sit on the centreline.
    var nx = -(chosen.y2 - chosen.y1) / len;
    var ny = (chosen.x2 - chosen.x1) / len;
    car.x += nx * car.laneOffset;
    car.y += ny * car.laneOffset;
  }

  // Sit the player in a car: take the nearest parked car, or the first
  // car in the state, move it to the spot, and link it to the player.
  function putPlayerInCar(state, x, y, angle, speed) {
    var player = state.player;
    if (!player) return null;
    var best = null;
    var bestD = Infinity;
    for (var i = 0; i < state.cars.length; i++) {
      var car = state.cars[i];
      if (!car || car.health <= 0 || car.exploded) continue;
      var dx = car.x - x;
      var dy = car.y - y;
      var d = dx * dx + dy * dy;
      if (car.parked) d *= 0.5;
      if (d < bestD) { bestD = d; best = car; }
    }
    if (!best) return null;
    best.parked = false;
    best.driver = 'player';
    best.x = x;
    best.y = y;
    best.angle = angle;
    best.speed = speed || 0;
    best.steering = 0;
    player.onFoot = false;
    player.car = best;
    player.x = x;
    player.y = y;
    player.angle = angle;
    player.speed = speed || 0;
    return best;
  }

  // Stand the player on foot at a spot, out of any car.
  function putPlayerOnFoot(state, x, y, angle) {
    var player = state.player;
    if (!player) return;
    if (player.car) player.car.driver = null;
    player.car = null;
    player.onFoot = true;
    player.x = x;
    player.y = y;
    player.angle = angle || 0;
    player.speed = 0;
  }

  // Point the camera at the player and clear any shake.
  function aimCamera(state) {
    if (!state.camera || !state.player) return;
    state.camera.x = state.player.x;
    state.camera.y = state.player.y;
    state.camera.shake = 0;
    state.camera.zoom = 1;
  }

  // Clear the police list and the wanted level, for quiet scenes.
  function clearHeat(state) {
    state.wanted = 0;
    state.heat = 0;
    if (Array.isArray(state.police)) state.police.length = 0;
    state.sirenOn = false;
  }

  // Gather a few pedestrians around a point so the street reads as alive.
  function gatherPedestrians(state, cx, cy) {
    var spots = [
      [cx - 150, cy - 48], [cx + 170, cy + 52], [cx - 90, cy + 56],
      [cx + 240, cy - 44], [cx + 60, cy - 58]
    ];
    var placed = 0;
    for (var i = 0; i < state.pedestrians.length && placed < spots.length; i++) {
      var ped = state.pedestrians[i];
      if (!ped || ped.health <= 0) continue;
      ped.x = spots[placed][0];
      ped.y = spots[placed][1];
      ped.destX = spots[placed][0] + 120;
      ped.destY = spots[placed][1] + 40;
      ped.state = 'walk';
      ped.speed = 0;
      placed++;
    }
  }

  // Gather a few traffic cars onto the roads around a point.
  function gatherTraffic(state, city, spots) {
    var used = 0;
    for (var i = 0; i < state.cars.length && used < spots.length; i++) {
      var car = state.cars[i];
      if (!car || car.health <= 0 || car.exploded) continue;
      if (state.player && state.player.car === car) continue;
      if (car.driver === 'player') continue;
      placeTrafficOnRoad(state, city, car, spots[used][0], spots[used][1], spots[used][2]);
      used++;
    }
  }

  // ---- the scenes ---------------------------------------------------------

  // Cover: the player driving east down a downtown street, with traffic
  // and pedestrians around and the minimap in the corner.
  function stageCover(state, city) {
    clearHeat(state);
    state.mission = null;
    putPlayerInCar(state, 3200, 1920, 0, 150);
    gatherTraffic(state, city, [
      [2940, 1920, 0],
      [3520, 1920, Math.PI],
      [3200, 2240, Math.PI / 2],
      [2880, 1600, -Math.PI / 2]
    ]);
    gatherPedestrians(state, 3200, 1920);
    aimCamera(state);
  }

  // Chase: the player driving south with three wanted stars and three
  // police cars closing in from the roads around.
  function stageChase(state, city) {
    state.mission = null;
    putPlayerInCar(state, 3200, 2240, Math.PI / 2, 230);
    state.heat = 65;
    state.wanted = 3;
    state.sirenOn = true;
    if (Array.isArray(state.police)) state.police.length = 0;
    var Config = Solmar.Config || {};
    var spots = [
      [3200, 1920, Math.PI / 2],
      [2880, 2240, 0],
      [3520, 2560, Math.PI]
    ];
    for (var i = 0; i < spots.length; i++) {
      state.police.push({
        kind: 'car',
        x: spots[i][0],
        y: spots[i][1],
        angle: spots[i][2],
        speed: 300,
        target: state.player,
        health: Config.carHealth || 100,
        shootCooldown: 0,
        grabTime: 0,
        ramCooldown: 0
      });
    }
    gatherTraffic(state, city, [
      [3200, 2880, Math.PI / 2],
      [2560, 2240, 0]
    ]);
    gatherPedestrians(state, 3200, 2240);
    aimCamera(state);
  }

  // Mission: the first job is active, the player is driving toward the
  // pickup marker, and the objective line is on the HUD.
  function stageMission(state, city) {
    clearHeat(state);
    putPlayerInCar(state, 2560, 1600, 0, 130);
    if (Solmar.Missions && typeof Solmar.Missions.start === 'function') {
      Solmar.Missions.start(state, 0);
    }
    gatherTraffic(state, city, [
      [2240, 1600, 0],
      [2880, 1600, Math.PI],
      [2560, 1920, Math.PI / 2]
    ]);
    gatherPedestrians(state, 2560, 1600);
    aimCamera(state);
  }

  // Title: a quiet street with the player on foot, no heat, no mission —
  // the main module shows the title screen over it.
  function stageTitle(state, city) {
    clearHeat(state);
    state.mission = null;
    var Config = Solmar.Config || {};
    putPlayerOnFoot(state, Config.startX || 1600, Config.startY || 1200, 0);
    gatherPedestrians(state, Config.startX || 1600, Config.startY || 1200);
    aimCamera(state);
  }

  function stage(state, city, given) {
    if (!state) return;
    var name = sceneName(given);
    if (SCENES.indexOf(name) < 0) name = 'cover';
    // A fresh generator per scene, so any pick below is repeatable.
    if (Solmar.Random && typeof Solmar.Random.create === 'function') {
      state.shotRng = Solmar.Random.create('solmar-shot-' + name);
    }
    if (name === 'chase') stageChase(state, city);
    else if (name === 'mission') stageMission(state, city);
    else if (name === 'title') stageTitle(state, city);
    else stageCover(state, city);
    state.shotScene = name;
  }

  Solmar.Shots = {
    stage: stage,
    sceneName: sceneName,
    scenes: SCENES
  };
})();
