// Solmar Bay — the city. Built once from a fixed seed, so every load shows
// the same streets, blocks, and buildings. The city is a mostly regular grid
// of roads crossed by two diagonal avenues and wrapped in a ring highway,
// with a bay and a beach along the west edge, a harbor with docks in the
// south-west, tall towers downtown, and quiet residential streets to the
// east. This module also answers the questions the rest of the game asks:
// what is at a place, whether it can be driven or walked on, and which road
// is nearest to a point.
(function () {
  var root = typeof window !== 'undefined' ? window : globalThis;
  root.Solmar = root.Solmar || {};
  var Solmar = root.Solmar;

  // --- small geometry helpers ---------------------------------------------

  function clamp(value, low, high) {
    return value < low ? low : (value > high ? high : value);
  }

  function pointInRect(x, y, rect) {
    return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
  }

  // Closest point on a segment to (px, py), with the distance and the
  // fraction t along the segment (0 at the start, 1 at the end).
  function closestOnSegment(px, py, x1, y1, x2, y2) {
    var dx = x2 - x1;
    var dy = y2 - y1;
    var lenSq = dx * dx + dy * dy;
    var t = 0;
    if (lenSq > 0) {
      t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
      t = clamp(t, 0, 1);
    }
    var cx = x1 + dx * t;
    var cy = y1 + dy * t;
    var ox = px - cx;
    var oy = py - cy;
    return { x: cx, y: cy, t: t, distance: Math.sqrt(ox * ox + oy * oy) };
  }

  // --- palettes ------------------------------------------------------------

  var TOWER_COLORS = ['#7fa8c9', '#c9a37f', '#8a9ba8', '#b98a5e', '#6f8fa8', '#d0b48a'];
  var HOUSE_COLORS = ['#c96f4a', '#7fae5a', '#5a8ac9', '#d0a24a', '#9a6fb0', '#c9c9c9', '#e08a7a'];
  var BEACH_COLORS = ['#f2d8a0', '#e8b4a0', '#a0c8d8', '#f0e0c0', '#d8a0b0'];
  var CONTAINER_COLORS = ['#c0392b', '#2e86c1', '#e67e22', '#27ae60', '#8e44ad', '#f1c40f'];
  var CRANE_COLOR = '#d8a03c';

  // --- the builder ----------------------------------------------------------

  function buildCity(seed) {
    var Config = Solmar.Config;
    var rng = Solmar.Random.create(seed);
    var width = Config.cityWidth;
    var height = Config.cityHeight;
    var roadWidth = Config.roadWidth;
    var sidewalk = Config.sidewalkWidth;

    var city = {
      seed: seed,
      width: width,
      height: height,
      roads: [],
      blocks: [],
      buildings: [],
      parks: [],
      beach: { x: 384, y: 0, w: 192, h: height },
      water: [{ x: 0, y: 0, w: 384, h: height }],
      docks: [],
      districts: []
    };

    // Districts, as rectangles the block lookup tests in order.
    city.districts = [
      { name: 'Downtown', kind: 'downtown', x: 2240, y: 960, w: 1920, h: 1920 },
      { name: 'Beachfront', kind: 'beachfront', x: 576, y: 0, w: 1664, h: 3520 },
      { name: 'Harbor', kind: 'harbor', x: 576, y: 3520, w: 1664, h: 1280 },
      { name: 'Northside', kind: 'residential', x: 2240, y: 0, w: 4160, h: 960 },
      { name: 'Eastside', kind: 'residential', x: 4160, y: 960, w: 2240, h: 3840 },
      { name: 'Southside', kind: 'residential', x: 2240, y: 2880, w: 1920, h: 1920 }
    ];

    function districtAt(cx, cy) {
      for (var i = 0; i < city.districts.length; i++) {
        var d = city.districts[i];
        if (cx >= d.x && cx < d.x + d.w && cy >= d.y && cy < d.y + d.h) return d;
      }
      return { name: 'Residential', kind: 'residential', x: 0, y: 0, w: width, h: height };
    }

    // --- roads --------------------------------------------------------------

    // Grid streets: verticals at 640 + 320k, horizontals at 320 + 320j.
    var verticals = [];
    var horizontals = [];
    var k;
    var j;
    for (k = 0; k <= 17; k++) {
      var vx = 640 + k * 320;
      verticals.push(vx);
      city.roads.push({ x1: vx, y1: 320, x2: vx, y2: 4480, kind: 'street', width: roadWidth });
    }
    for (j = 0; j <= 13; j++) {
      var hy = 320 + j * 320;
      horizontals.push(hy);
      city.roads.push({ x1: 640, y1: hy, x2: 6080, y2: hy, kind: 'street', width: roadWidth });
    }

    // Two diagonal avenues, anchored on grid intersections so traffic can
    // turn onto them.
    var diagonals = [
      { x1: 640, y1: 4160, x2: 6080, y2: 960, kind: 'avenue', width: 80, name: 'Bay Avenue' },
      { x1: 960, y1: 320, x2: 5440, y2: 4480, kind: 'avenue', width: 80, name: 'Palm Diagonal' }
    ];
    for (var d = 0; d < diagonals.length; d++) city.roads.push(diagonals[d]);

    // The ring highway: a rectangular loop around the whole city.
    var highway = [
      { x1: 560, y1: 160, x2: 6240, y2: 160, kind: 'highway', width: 96, name: 'Ring Road North' },
      { x1: 6240, y1: 160, x2: 6240, y2: 4640, kind: 'highway', width: 96, name: 'Ring Road East' },
      { x1: 6240, y1: 4640, x2: 560, y2: 4640, kind: 'highway', width: 96, name: 'Ring Road South' },
      { x1: 560, y1: 4640, x2: 560, y2: 160, kind: 'highway', width: 96, name: 'Ring Road West' }
    ];
    for (var h = 0; h < highway.length; h++) city.roads.push(highway[h]);

    // --- harbor docks ---------------------------------------------------------

    // Four piers reaching west from the beach into the bay.
    var pierYs = [3840, 4000, 4160, 4320];
    for (var p = 0; p < pierYs.length; p++) {
      city.docks.push({ x: 120, y: pierYs[p], w: 456, h: 44 });
    }

    // --- blocks and buildings -------------------------------------------------

    // A block sits between two neighbouring grid roads, inset by the road
    // half-width plus the sidewalk.
    var inset = roadWidth / 2 + sidewalk;
    var blocks = [];
    for (var bi = 0; bi < verticals.length - 1; bi++) {
      for (var bj = 0; bj < horizontals.length - 1; bj++) {
        var bx = verticals[bi] + inset;
        var by = horizontals[bj] + inset;
        var bw = verticals[bi + 1] - verticals[bi] - inset * 2;
        var bh = horizontals[bj + 1] - horizontals[bj] - inset * 2;
        var cx = bx + bw / 2;
        var cy = by + bh / 2;
        var district = districtAt(cx, cy);
        blocks.push({ x: bx, y: by, w: bw, h: bh, district: district.kind, kind: 'buildings' });
      }
    }

    // The downtown block nearest the city centre becomes a plaza.
    var plaza = null;
    var plazaBest = Infinity;
    for (var q = 0; q < blocks.length; q++) {
      var b = blocks[q];
      if (b.district !== 'downtown') continue;
      var dcx = b.x + b.w / 2 - 3200;
      var dcy = b.y + b.h / 2 - 1920;
      var dd = dcx * dcx + dcy * dcy;
      if (dd < plazaBest) { plazaBest = dd; plaza = b; }
    }
    if (plaza) plaza.kind = 'plaza';

    // A handful of residential and beachfront blocks become parks.
    var parkTargets = 7;
    var parkTries = 0;
    while (parkTargets > 0 && parkTries < 200) {
      parkTries++;
      var pick = blocks[rng.nextInt(0, blocks.length)];
      if (pick.kind !== 'buildings') continue;
      if (pick.district !== 'residential' && pick.district !== 'beachfront') continue;
      pick.kind = 'park';
      parkTargets--;
    }

    city.blocks = blocks;

    // Buildings: try random spots inside each block, rejecting any that
    // would overlap a building already placed or sit on a diagonal avenue.
    function clearOfDiagonals(x, y, w, h) {
      var half = Math.max(w, h) / 2 + 50;
      for (var i = 0; i < diagonals.length; i++) {
        var seg = diagonals[i];
        var near = closestOnSegment(x + w / 2, y + h / 2, seg.x1, seg.y1, seg.x2, seg.y2);
        if (near.distance < half) return false;
      }
      return true;
    }

    function overlapsBuilding(x, y, w, h) {
      for (var i = 0; i < city.buildings.length; i++) {
        var o = city.buildings[i];
        if (x < o.x + o.w + 8 && x + w + 8 > o.x && y < o.y + o.h + 8 && y + h + 8 > o.y) return true;
      }
      return false;
    }

    function placeBuilding(block, w, h, height, color, kind) {
      for (var attempt = 0; attempt < 12; attempt++) {
        var x = block.x + 10 + rng.range(0, Math.max(1, block.w - w - 20));
        var y = block.y + 10 + rng.range(0, Math.max(1, block.h - h - 20));
        if (overlapsBuilding(x, y, w, h)) continue;
        if (!clearOfDiagonals(x, y, w, h)) continue;
        city.buildings.push({
          x: x, y: y, w: w, h: h, height: height,
          color: color, kind: kind, district: block.district
        });
        return true;
      }
      return false;
    }

    for (var bi2 = 0; bi2 < blocks.length; bi2++) {
      var block = blocks[bi2];
      if (block.kind === 'park') {
        // A park: grass with scattered trees and no buildings.
        var trees = [];
        var treeCount = rng.nextInt(6, 11);
        for (var t = 0; t < treeCount; t++) {
          trees.push({
            x: block.x + rng.range(16, block.w - 16),
            y: block.y + rng.range(16, block.h - 16),
            r: rng.range(9, 17)
          });
        }
        city.parks.push({ x: block.x, y: block.y, w: block.w, h: block.h, trees: trees });
        continue;
      }
      if (block.kind !== 'buildings') continue;

      if (block.district === 'downtown') {
        var towers = rng.chance(0.5) ? 1 : 2;
        for (var tw = 0; tw < towers; tw++) {
          var twSize = rng.range(90, 150);
          placeBuilding(block, twSize, twSize, rng.range(70, 160), rng.pick(TOWER_COLORS), 'tower');
        }
      } else if (block.district === 'beachfront') {
        var shops = rng.nextInt(2, 4);
        for (var sh = 0; sh < shops; sh++) {
          placeBuilding(block, rng.range(50, 90), rng.range(50, 90), rng.range(18, 48), rng.pick(BEACH_COLORS), 'shop');
        }
      } else if (block.district === 'harbor') {
        if (rng.chance(0.3)) {
          placeBuilding(block, 26, rng.range(80, 120), rng.range(55, 75), CRANE_COLOR, 'crane');
        } else {
          var boxes = rng.nextInt(2, 5);
          for (var bx2 = 0; bx2 < boxes; bx2++) {
            placeBuilding(block, rng.range(90, 140), rng.range(28, 40), rng.range(9, 14), rng.pick(CONTAINER_COLORS), 'container');
          }
        }
      } else {
        var houses = rng.nextInt(2, 5);
        for (var ho = 0; ho < houses; ho++) {
          placeBuilding(block, rng.range(40, 80), rng.range(40, 80), rng.range(10, 24), rng.pick(HOUSE_COLORS), 'house');
        }
      }
    }

    return city;
  }

  // --- questions about the city ----------------------------------------------

  // Which road, if any, covers this point (within its half-width).
  function roadAt(city, x, y) {
    var best = null;
    var bestD = Infinity;
    for (var i = 0; i < city.roads.length; i++) {
      var road = city.roads[i];
      var near = closestOnSegment(x, y, road.x1, road.y1, road.x2, road.y2);
      if (near.distance <= road.width / 2 && near.distance < bestD) {
        bestD = near.distance;
        best = road;
      }
    }
    return best;
  }

  function buildingAt(city, x, y) {
    for (var i = 0; i < city.buildings.length; i++) {
      var b = city.buildings[i];
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b;
    }
    return null;
  }

  function blockAt(city, x, y) {
    for (var i = 0; i < city.blocks.length; i++) {
      var b = city.blocks[i];
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b;
    }
    return null;
  }

  // What is at a place: an object with a kind and the thing it found.
  // Kinds: water, dock, beach, building, road, sidewalk, park, plaza,
  // grass. Roads carry their road; buildings carry their building.
  function at(city, x, y) {
    for (var w = 0; w < city.water.length; w++) {
      if (pointInRect(x, y, city.water[w])) {
        for (var d = 0; d < city.docks.length; d++) {
          if (pointInRect(x, y, city.docks[d])) return { kind: 'dock', dock: city.docks[d] };
        }
        return { kind: 'water' };
      }
    }
    if (pointInRect(x, y, city.beach)) return { kind: 'beach' };
    var building = buildingAt(city, x, y);
    if (building) return { kind: 'building', building: building };
    var road = roadAt(city, x, y);
    if (road) return { kind: 'road', road: road };
    // Sidewalk: the band just outside a road's edge.
    for (var i = 0; i < city.roads.length; i++) {
      var r = city.roads[i];
      var near = closestOnSegment(x, y, r.x1, r.y1, r.x2, r.y2);
      if (near.distance <= r.width / 2 + Solmar.Config.sidewalkWidth) {
        return { kind: 'sidewalk', road: r };
      }
    }
    var block = blockAt(city, x, y);
    if (block) {
      if (block.kind === 'park') return { kind: 'park', block: block };
      if (block.kind === 'plaza') return { kind: 'plaza', block: block };
      if (block.district === 'harbor') return { kind: 'dock', block: block };
      if (block.district === 'downtown') return { kind: 'sidewalk', block: block };
      return { kind: 'grass', block: block };
    }
    return { kind: 'grass' };
  }

  // Cars drive on roads (streets, avenues, and the ring highway).
  function isDrivable(city, x, y) {
    if (!city) return true;
    return roadAt(city, x, y) !== null;
  }

  // On foot almost everywhere is fine except water and buildings.
  function isWalkable(city, x, y) {
    if (!city) return true;
    var spot = at(city, x, y);
    return spot.kind !== 'water' && spot.kind !== 'building';
  }

  // The nearest road to a point, with the closest point on it.
  function nearestRoad(city, x, y) {
    var best = null;
    var bestD = Infinity;
    for (var i = 0; i < city.roads.length; i++) {
      var road = city.roads[i];
      var near = closestOnSegment(x, y, road.x1, road.y1, road.x2, road.y2);
      if (near.distance < bestD) {
        bestD = near.distance;
        best = { road: road, x: near.x, y: near.y, distance: near.distance, t: near.t };
      }
    }
    return best;
  }

  // A random point on a random road, with the road's direction as an angle.
  function pickRoadPoint(city, rng) {
    var road = rng.pick(city.roads);
    var t = rng.range(0.05, 0.95);
    var x = road.x1 + (road.x2 - road.x1) * t;
    var y = road.y1 + (road.y2 - road.y1) * t;
    var angle = Math.atan2(road.y2 - road.y1, road.x2 - road.x1);
    if (rng.chance(0.5)) angle += Math.PI;
    return { x: x, y: y, road: road, angle: angle };
  }

  // A random point on a sidewalk beside a random road.
  function pickSidewalkPoint(city, rng) {
    var road = rng.pick(city.roads);
    var t = rng.range(0.05, 0.95);
    var x = road.x1 + (road.x2 - road.x1) * t;
    var y = road.y1 + (road.y2 - road.y1) * t;
    var len = Math.sqrt((road.x2 - road.x1) * (road.x2 - road.x1) + (road.y2 - road.y1) * (road.y2 - road.y1));
    var px = -(road.y2 - road.y1) / len;
    var py = (road.x2 - road.x1) / len;
    var side = rng.chance(0.5) ? 1 : -1;
    var off = road.width / 2 + Solmar.Config.sidewalkWidth / 2;
    return { x: x + px * off * side, y: y + py * off * side, road: road };
  }

  Solmar.City = {
    build: buildCity,
    at: at,
    isDrivable: isDrivable,
    isWalkable: isWalkable,
    nearestRoad: nearestRoad,
    pickRoadPoint: pickRoadPoint,
    pickSidewalkPoint: pickSidewalkPoint
  };
})();
