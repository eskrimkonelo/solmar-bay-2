// Solmar Bay — the mission chain. Six jobs for Rook, a courier driver new
// to the city who takes one fare too many and gets pulled into the bay's
// underworld: a fare, a package, a stolen car, a harbour deal, a chase, and
// a last stand. Each job carries its story, its objective, and its pay, and
// the update step below walks the active job forward from the live game
// state. The world module calls start once per job and update once per
// frame, and merges the events update returns.
(function () {
  var root = typeof window !== 'undefined' ? window : globalThis;
  root.Solmar = root.Solmar || {};
  var Solmar = root.Solmar;

  function cfg() {
    return Solmar.Config || {};
  }

  function rewardFor(index) {
    var rewards = cfg().missionRewards || [250, 400, 600, 900, 1400, 2200];
    return rewards[index] !== undefined ? rewards[index] : 250;
  }

  function titleFor(index) {
    var titles = cfg().missionTitles || [];
    return titles[index] || ('Mission ' + (index + 1));
  }

  // The chain, in story order. Intro text is what the briefing screen
  // shows before the job; outro text is the message on completion.
  var CHAIN = [
    {
      id: 'first-fare',
      title: 'First Fare',
      intro: 'Rook has been driving a cab in Solmar Bay for three days. A woman named Marisol flags him down at the marina and asks for a ride across town — no questions, cash up front. It pays too well to refuse.',
      outro: 'Marisol pays without counting and disappears into the crowd. "You drive like you mean it," she says. "I may have more work for you."',
      objective: 'Pick up Marisol at the marina, then drive her across town.',
      kind: 'taxi'
    },
    {
      id: 'the-package',
      title: 'The Package',
      intro: 'Marisol calls at dawn. A package is waiting at the old post office, and a buyer is waiting at the beachfront hotel. "Don\'t open it. Don\'t stop for anyone. And Rook — drive like the bay is on fire."',
      outro: 'The buyer takes the package, counts out the cash, and nods once. Rook is officially a courier now, whether he likes it or not.',
      objective: 'Collect the package at the post office, then deliver it to the beachfront hotel.',
      kind: 'deliver'
    },
    {
      id: 'hot-wheels',
      title: 'Hot Wheels',
      intro: 'A rival crew called the Vipers lifted a car full of Marisol\'s money and are joyriding it through downtown. "Get my car back," she says. "Bump it, box it in — just don\'t let it out of your sight."',
      outro: 'Rook leans on the stolen car until the driver gives up and runs. The money is still in the boot. Marisol laughs for the first time all week.',
      objective: 'Chase the stolen car downtown and stay on its tail until the driver gives up.',
      kind: 'chase'
    },
    {
      id: 'harbor-lights',
      title: 'Harbor Lights',
      intro: 'Tonight the deal happens at the docks, under the cranes. Rook has to pick up a crate from the harbour and run it to a warehouse uptown before the harbour patrol changes shift. The clock is real this time.',
      outro: 'The crate changes hands in the dark and the warehouse door rolls shut. Whatever was in it, Rook decides he is happier not knowing.',
      objective: 'Pick up the crate at the harbour docks, then deliver it uptown before time runs out.',
      kind: 'timed'
    },
    {
      id: 'the-long-chase',
      title: 'The Long Chase',
      intro: 'Somebody talked. The whole bay police force is looking for Rook\'s car, and the only safe place left is an old hideout past the ring highway. He has to lose them the only way he knows how: by out-driving them.',
      outro: 'Sirens fade behind him as Rook kills the lights and rolls into the hideout. The bay can wait. Tonight, it has to.',
      objective: 'Lose the police and reach the hideout past the ring highway before time runs out.',
      kind: 'escape'
    },
    {
      id: 'bay-showdown',
      title: 'Bay Showdown',
      intro: 'Kessler, the man who has been pulling every string in the bay, is waiting at the old plaza with his crew. Marisol stands beside Rook. "One last job," she says. "We hold this ground, and the bay is ours."',
      outro: 'When the shooting stops, Kessler\'s crew is gone and the plaza is quiet. Marisol tosses Rook the keys to a car of his own. Solmar Bay is his city now.',
      objective: 'Hold the plaza and survive the showdown until the crew gives up.',
      kind: 'survive'
    }
  ];

  function chain() {
    var out = [];
    for (var i = 0; i < CHAIN.length; i++) {
      var def = CHAIN[i];
      out.push({
        index: i,
        id: def.id,
        title: def.title || titleFor(i),
        intro: def.intro,
        outro: def.outro,
        objective: def.objective,
        reward: rewardFor(i),
        kind: def.kind
      });
    }
    return out;
  }

  function clamp(value, low, high) {
    if (value < low) return low;
    if (value > high) return high;
    return value;
  }

  function distance(ax, ay, bx, by) {
    var dx = bx - ax;
    var dy = by - ay;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // ---- finding places in the city ----------------------------------------
  // The city module answers what kind of ground a point is. Probe a spiral
  // of candidates around a centre until one matches, so a target always
  // lands on ground the player can actually reach. When the city cannot
  // answer, the centre itself is returned, clamped inside the city.

  function cityWidth(city) {
    if (city && typeof city.width === 'number') return city.width;
    return cfg().cityWidth || 6400;
  }

  function cityHeight(city) {
    if (city && typeof city.height === 'number') return city.height;
    return cfg().cityHeight || 4800;
  }

  function groundKindAt(city, x, y) {
    var City = Solmar.City;
    try {
      if (City && typeof City.at === 'function') {
        var found = City.at(city, x, y);
        if (found) {
          if (typeof found === 'string') return found;
          if (typeof found.kind === 'string') return found.kind;
        }
      }
    } catch (err) { /* treat as unknown ground */ }
    return '';
  }

  function drivableAt(city, x, y) {
    var City = Solmar.City;
    try {
      if (City && typeof City.isDrivable === 'function') return !!City.isDrivable(city, x, y);
    } catch (err) { /* fall through */ }
    var kind = groundKindAt(city, x, y);
    return kind === 'road';
  }

  function walkableAt(city, x, y) {
    var City = Solmar.City;
    try {
      if (City && typeof City.isWalkable === 'function') return !!City.isWalkable(city, x, y);
    } catch (err) { /* fall through */ }
    var kind = groundKindAt(city, x, y);
    return kind === 'road' || kind === 'sidewalk' || kind === 'park' ||
      kind === 'plaza' || kind === 'beach' || kind === 'dock' || kind === 'grass';
  }

  function matchesKind(city, kind, wanted) {
    if (wanted === 'road') return drivableAt(city, kind.x, kind.y);
    if (wanted === 'sidewalk') return walkableAt(city, kind.x, kind.y) && !drivableAt(city, kind.x, kind.y);
    if (wanted === 'dock' || wanted === 'beach' || wanted === 'park' || wanted === 'plaza') {
      return groundKindAt(city, kind.x, kind.y) === wanted;
    }
    return walkableAt(city, kind.x, kind.y);
  }

  function findSpot(city, wanted, cx, cy) {
    var w = cityWidth(city);
    var h = cityHeight(city);
    cx = clamp(cx, 80, w - 80);
    cy = clamp(cy, 80, h - 80);
    var steps = [0, 90, 180, 270, 360, 480, 640, 880, 1150, 1500];
    var angles = [0, 0.8, 1.6, 2.4, 3.2, 4.0, 4.8, 5.6];
    for (var s = 0; s < steps.length; s++) {
      for (var a = 0; a < angles.length; a++) {
        var x = clamp(cx + Math.cos(angles[a]) * steps[s], 60, w - 60);
        var y = clamp(cy + Math.sin(angles[a]) * steps[s], 60, h - 60);
        if (matchesKind(city, { x: x, y: y }, wanted)) return { x: x, y: y };
      }
    }
    // No matching ground found by probing: fall back to the nearest road
    // through the city's own helper, then to the centre itself.
    try {
      var City = Solmar.City;
      if (City && typeof City.nearestRoad === 'function') {
        var near = City.nearestRoad(city, cx, cy);
        if (near && typeof near.x === 'number' && typeof near.y === 'number') {
          return { x: near.x, y: near.y };
        }
      }
    } catch (err) { /* keep the centre */ }
    return { x: cx, y: cy };
  }

  function waterEdge(city) {
    // The bay sits along one edge of the city. Find it from the water
    // region when the city exposes one, else assume the southern edge.
    var w = cityWidth(city);
    var h = cityHeight(city);
    if (city && city.water) {
      var list = Array.isArray(city.water) ? city.water : [city.water];
      for (var i = 0; i < list.length; i++) {
        var item = list[i];
        var x = item.x !== undefined ? item.x : item.x1;
        var y = item.y !== undefined ? item.y : item.y1;
        var iw = item.w !== undefined ? item.w : item.width;
        var ih = item.h !== undefined ? item.h : item.height;
        if (typeof x === 'number' && typeof y === 'number' &&
            typeof iw === 'number' && typeof ih === 'number') {
          return { x: x + iw / 2, y: y + ih / 2, edge: y + ih < h / 2 ? 'north' : 'south' };
        }
      }
    }
    return { x: w / 2, y: h - 120, edge: 'south' };
  }

  // ---- mission objects -----------------------------------------------------

  function buildMission(state, index) {
    var defs = chain();
    var def = defs[index] || defs[0];
    var mission = {
      index: def.index,
      id: def.id,
      title: def.title,
      objective: def.objective,
      phase: 'pickup',
      target: null,
      progress: 0,
      timer: 0,
      reward: def.reward,
      kind: def.kind,
      targetCarId: null,
      _spotsSet: false
    };
    if (def.kind === 'timed') mission.timer = 180;
    if (def.kind === 'escape') mission.timer = 150;
    if (def.kind === 'survive') mission.timer = 75;
    if (def.kind === 'chase') mission.phase = 'chase';
    if (def.kind === 'survive') mission.phase = 'survive';
    if (def.kind === 'escape') mission.phase = 'escape';
    return mission;
  }

  // The world module calls this to begin a job. It returns the mission
  // object the state should carry; when the index is out of range it
  // returns nothing and the world falls back to a generic mission.
  function start(state, index) {
    if (!state) return null;
    if (typeof index !== 'number' || index < 0 || index >= CHAIN.length) return null;
    var mission = buildMission(state, index);
    state.mission = mission;
    // The escape and the showdown both start with the police already
    // looking for Rook, so raise the heat the wanted level reads from.
    if (mission.kind === 'escape' || mission.kind === 'survive') {
      var floor = mission.kind === 'escape' ? 58 : 78;
      if (typeof state.heat === 'number') state.heat = Math.max(state.heat, floor);
      else state.heat = floor;
    }
    return mission;
  }

  // Place the current leg's target once the city is available. Each leg
  // picks its own ground: roads for driving, the docks for the harbour,
  // the beach for the hotel, a plaza for the showdown.
  function resolveSpots(state, city) {
    var mission = state.mission;
    if (!mission || mission._spotsSet) return;
    var w = cityWidth(city);
    var h = cityHeight(city);
    var player = state.player || { x: w * 0.25, y: h * 0.25 };
    var bay = waterEdge(city);
    var spot;
    if (mission.kind === 'taxi') {
      spot = findSpot(city, 'road', player.x + 500, player.y + 300);
      mission.target = { x: spot.x, y: spot.y, label: 'Pick up Marisol' };
      mission._leg = { from: { x: spot.x, y: spot.y }, to: findSpot(city, 'road', w * 0.75, h * 0.3) };
    } else if (mission.kind === 'deliver') {
      spot = findSpot(city, 'sidewalk', player.x + 420, player.y - 260);
      mission.target = { x: spot.x, y: spot.y, label: 'Collect the package' };
      mission._leg = { from: { x: spot.x, y: spot.y }, to: findSpot(city, 'beach', bay.x, bay.y) };
      if (groundKindAt(city, mission._leg.to.x, mission._leg.to.y) !== 'beach') {
        mission._leg.to = findSpot(city, 'road', bay.x, Math.max(120, bay.y - 320));
      }
    } else if (mission.kind === 'chase') {
      mission.target = { x: player.x + 400, y: player.y, label: 'The stolen car' };
    } else if (mission.kind === 'timed') {
      spot = findSpot(city, 'dock', bay.x, bay.y);
      mission.target = { x: spot.x, y: spot.y, label: 'Pick up the crate' };
      mission._leg = { from: { x: spot.x, y: spot.y }, to: findSpot(city, 'road', w * 0.7, h * 0.2) };
    } else if (mission.kind === 'escape') {
      spot = findSpot(city, 'road', w * 0.85, h * 0.85);
      mission.target = { x: spot.x, y: spot.y, label: 'The hideout' };
    } else if (mission.kind === 'survive') {
      spot = findSpot(city, 'plaza', w * 0.5, h * 0.45);
      if (groundKindAt(city, spot.x, spot.y) !== 'plaza') spot = findSpot(city, 'road', w * 0.5, h * 0.45);
      mission.target = { x: spot.x, y: spot.y, label: 'Hold the plaza' };
    }
    mission._spotsSet = true;
  }

  function arrived(state) {
    var mission = state.mission;
    if (!mission || !mission.target) return false;
    var player = state.player;
    if (!player) return false;
    return distance(player.x, player.y, mission.target.x, mission.target.y) < 90;
  }

  function completeMission(state, events) {
    var mission = state.mission;
    var defs = chain();
    var def = defs[mission.index] || defs[0];
    var reward = mission.reward || rewardFor(mission.index);
    state.money = (typeof state.money === 'number' ? state.money : 0) + reward;
    if (state.stats && typeof state.stats.missionsDone === 'number') {
      state.stats.missionsDone += 1;
    }
    events.push({ type: 'message', text: def.outro });
    // awarded:true tells the world not to pay the reward a second time
    // when it merges this event.
    events.push({
      type: 'missionComplete', reward: reward,
      missionIndex: mission.index, title: mission.title, awarded: true
    });
    var next = mission.index + 1;
    if (next < CHAIN.length) {
      var following = start(state, next);
      events.push({
        type: 'message',
        text: 'New mission: ' + following.title + ' — $' + following.reward + ' on completion.'
      });
    } else {
      state.mission = null;
      events.push({ type: 'message', text: 'All six missions complete. Solmar Bay is yours, Rook.' });
    }
  }

  function failMission(state, events, reason) {
    var mission = state.mission;
    if (mission) mission.phase = 'failed';
    events.push({ type: 'missionFailed', reason: reason, missionIndex: mission ? mission.index : 0 });
    events.push({ type: 'message', text: 'Mission failed: ' + reason });
  }

  // ---- per-frame update ----------------------------------------------------

  // Called by the world once per frame. Moves the active mission forward
  // from the live state and returns the events the frame produced.
  function update(state, dt, city) {
    var events = [];
    if (!state || !state.mission) return events;
    var mission = state.mission;
    if (mission.phase === 'done' || mission.phase === 'failed') return events;
    if (typeof dt !== 'number' || dt <= 0) dt = 0.016;

    resolveSpots(state, city);

    // A countdown job fails when its clock runs out. The showdown is the
    // exception: its clock running out means Rook held the plaza, so the
    // survive branch below completes it instead of failing it.
    if (typeof mission.timer === 'number' && mission.timer > 0 &&
        (mission.kind === 'timed' || mission.kind === 'escape')) {
      mission.timer -= dt;
      if (mission.timer <= 0) {
        mission.timer = 0;
        failMission(state, events, 'Out of time.');
        return events;
      }
    }

    var player = state.player;
    if (!player) return events;

    if (mission.kind === 'chase') {
      // Keep a stolen car in sight: pick a moving traffic car and follow
      // it, replacing it if it ever vanishes from the state. The player's
      // own car is a car object on player.car, so compare by its id.
      var playerCarId = (player.car && typeof player.car.id === 'number') ? player.car.id : null;
      var targetCar = null;
      var cars = Array.isArray(state.cars) ? state.cars : [];
      for (var i = 0; i < cars.length; i++) {
        if (cars[i] && cars[i].id === mission.targetCarId) { targetCar = cars[i]; break; }
      }
      if (!targetCar) {
        for (var j = 0; j < cars.length; j++) {
          var cand = cars[j];
          if (!cand || typeof cand.x !== 'number') continue;
          if (playerCarId !== null && cand.id === playerCarId) continue;
          if (cand.parked) continue;
          if (distance(player.x, player.y, cand.x, cand.y) < 1400) { targetCar = cand; break; }
        }
        if (!targetCar && cars.length > 0) {
          for (var k = 0; k < cars.length; k++) {
            if (cars[k] && typeof cars[k].x === 'number' &&
                cars[k].id !== playerCarId) { targetCar = cars[k]; break; }
          }
        }
        if (targetCar) mission.targetCarId = targetCar.id;
      }
      if (targetCar) {
        mission.target = { x: targetCar.x, y: targetCar.y, label: 'The stolen car' };
        var gap = distance(player.x, player.y, targetCar.x, targetCar.y);
        if (!player.onFoot && gap < 95) {
          mission.progress += dt;
          mission.objective = 'Stay on the stolen car — ' + Math.ceil(2 - mission.progress) + 's to go.';
          if (mission.progress >= 2) {
            mission.phase = 'done';
            completeMission(state, events);
            return events;
          }
        } else {
          mission.progress = Math.max(0, mission.progress - dt);
          mission.objective = 'Chase the stolen car downtown and stay on its tail.';
        }
      } else {
        mission.objective = 'Find the stolen car.';
      }
      return events;
    }

    if (mission.kind === 'survive') {
      // The showdown ends when the clock runs out with Rook still
      // standing near the plaza; the timer counts down here, since the
      // shared countdown above deliberately skips this kind.
      mission.timer -= dt;
      if (mission.target && distance(player.x, player.y, mission.target.x, mission.target.y) < 260) {
        mission.objective = 'Hold the plaza — ' + Math.ceil(mission.timer) + 's left.';
      } else {
        mission.objective = 'Get back to the plaza — ' + Math.ceil(mission.timer) + 's left.';
      }
      if (mission.timer <= 0) {
        mission.phase = 'done';
        completeMission(state, events);
      }
      return events;
    }

    if (mission.phase === 'pickup' || mission.phase === 'goto') {
      if (arrived(state)) {
        if (mission._leg && mission._leg.to) {
          mission.phase = 'deliver';
          mission.target = {
            x: mission._leg.to.x, y: mission._leg.to.y,
            label: mission.kind === 'taxi' ? 'Drop off Marisol'
              : (mission.kind === 'timed' ? 'Deliver the crate' : 'Deliver the package')
          };
          mission.objective = mission.kind === 'taxi'
            ? 'Drive Marisol across town to the marked place.'
            : (mission.kind === 'timed'
              ? 'Deliver the crate uptown before time runs out.'
              : 'Deliver the package to the marked place.');
          events.push({ type: 'message', text: 'Picked up. Now deliver it.' });
        } else {
          mission.phase = 'done';
          completeMission(state, events);
        }
      }
      return events;
    }

    if (mission.phase === 'deliver' || mission.phase === 'escape') {
      if (arrived(state)) {
        mission.phase = 'done';
        completeMission(state, events);
      }
      return events;
    }

    return events;
  }

  // The marker the render module draws: the current target, or the stolen
  // car's live position while a chase is running.
  function marker(state) {
    if (!state || !state.mission) return null;
    var mission = state.mission;
    if (mission.phase === 'done' || mission.phase === 'failed') return null;
    if (mission.kind === 'chase' && mission.targetCarId !== null && mission.targetCarId !== undefined) {
      var cars = Array.isArray(state.cars) ? state.cars : [];
      for (var i = 0; i < cars.length; i++) {
        if (cars[i] && cars[i].id === mission.targetCarId) {
          return { x: cars[i].x, y: cars[i].y, label: 'The stolen car' };
        }
      }
    }
    if (mission.target && typeof mission.target.x === 'number') return mission.target;
    return null;
  }

  Solmar.Missions = {
    chain: chain,
    start: start,
    update: update,
    marker: marker,
    getMarker: marker
  };
})();
