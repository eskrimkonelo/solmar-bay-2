// Solmar Bay — drawing. One frame at a time this module paints the city,
// everything moving in it, the dust and smoke they kick up, the little HUD
// that lives on the canvas itself, and the minimap in its own corner.
// It only reads the state the world module owns; it never moves anything
// except easing the camera toward the player, which is a drawing concern.
(function () {
  var root = typeof window !== 'undefined' ? window : globalThis;
  root.Solmar = root.Solmar || {};
  var Solmar = root.Solmar;

  function cfg() {
    return Solmar.Config || {};
  }

  function palette() {
    return (Solmar.Config && Solmar.Config.palette) || {};
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

  // A city entry may describe its rectangle in several shapes; normalise
  // it to {x, y, w, h} or return null when it carries nothing usable.
  function rectOf(item) {
    if (!item) return null;
    if (typeof item.x === 'number' && typeof item.y === 'number') {
      var w = item.w !== undefined ? item.w : item.width;
      var h = item.h !== undefined ? item.h : item.height;
      if (typeof w === 'number' && typeof h === 'number') {
        return { x: item.x, y: item.y, w: w, h: h };
      }
      if (typeof item.r === 'number') {
        return { x: item.x - item.r, y: item.y - item.r, w: item.r * 2, h: item.r * 2 };
      }
    }
    if (typeof item.x1 === 'number' && typeof item.y1 === 'number' &&
        typeof item.x2 === 'number' && typeof item.y2 === 'number') {
      return {
        x: Math.min(item.x1, item.x2),
        y: Math.min(item.y1, item.y2),
        w: Math.abs(item.x2 - item.x1),
        h: Math.abs(item.y2 - item.y1)
      };
    }
    if (typeof item.cx === 'number' && typeof item.cy === 'number') {
      var cw = item.w !== undefined ? item.w : item.width;
      var ch = item.h !== undefined ? item.h : item.height;
      if (typeof cw === 'number' && typeof ch === 'number') {
        return { x: item.cx - cw / 2, y: item.cy - ch / 2, w: cw, h: ch };
      }
    }
    return null;
  }

  // A road may be a rectangle or a segment between two points.
  function roadSeg(item) {
    if (!item) return null;
    if (typeof item.x1 === 'number' && typeof item.y1 === 'number' &&
        typeof item.x2 === 'number' && typeof item.y2 === 'number') {
      return {
        x1: item.x1, y1: item.y1, x2: item.x2, y2: item.y2,
        width: typeof item.width === 'number' ? item.width : (cfg().roadWidth || 64)
      };
    }
    var r = rectOf(item);
    if (r) return { rect: r };
    return null;
  }

  function overlaps(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function roundedPath(ctx, x, y, w, h, r) {
    var rad = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.lineTo(x + w - rad, y);
    ctx.arcTo(x + w, y, x + w, y + rad, rad);
    ctx.lineTo(x + w, y + h - rad);
    ctx.arcTo(x + w, y + h, x + w - rad, y + h, rad);
    ctx.lineTo(x + rad, y + h);
    ctx.arcTo(x, y + h, x, y + h - rad, rad);
    ctx.lineTo(x, y + rad);
    ctx.arcTo(x, y, x + rad, y, rad);
    ctx.closePath();
  }

  function ellipse(ctx, x, y, rx, ry) {
    ctx.beginPath();
    if (typeof ctx.ellipse === 'function') {
      ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    } else {
      ctx.arc(x, y, Math.max(rx, ry), 0, Math.PI * 2);
    }
  }

  // Ask the city what kind of ground a point is, through whichever route
  // the city module offers. Returns '' when the city cannot answer.
  function groundKind(city, x, y) {
    var City = Solmar.City;
    try {
      if (City && typeof City.at === 'function') {
        // The city's at-query takes the city first: at(city, x, y).
        var found = City.at(city, x, y);
        if (found) {
          if (typeof found === 'string') return found;
          if (typeof found.kind === 'string') return found.kind;
        }
      }
    } catch (err) { /* ground stays unknown */ }
    return '';
  }

  function groundColour(kind, pal) {
    switch (kind) {
      case 'water': return pal.water || '#2e7fb8';
      case 'beach': return pal.sand || '#e6d29a';
      case 'sand': return pal.sand || '#e6d29a';
      case 'park': return pal.park || '#6da34f';
      case 'grass': return pal.grass || '#7fae5a';
      case 'dock': return pal.dock || '#8a7a5e';
      case 'plaza': return pal.sidewalk || '#cfc4a8';
      case 'sidewalk': return pal.sidewalk || '#cfc4a8';
      case 'road': return pal.road || '#5a564e';
      case 'building': return pal.buildingRoof || '#b98a5e';
      default: return pal.grass || '#7fae5a';
    }
  }

  // ---- ground -----------------------------------------------------------

  function drawWaterAndGrass(ctx, city, view, pal) {
    ctx.fillStyle = pal.grass || '#7fae5a';
    ctx.fillRect(view.x, view.y, view.w, view.h);
    var waters = [];
    if (city) {
      if (Array.isArray(city.water)) waters = city.water;
      else if (city.water) waters = [city.water];
    }
    for (var i = 0; i < waters.length; i++) {
      var r = rectOf(waters[i]);
      if (!r || !overlaps(r, view)) continue;
      ctx.fillStyle = pal.waterDeep || '#1f5f8f';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = pal.water || '#2e7fb8';
      ctx.fillRect(r.x + 6, r.y + 6, Math.max(0, r.w - 12), Math.max(0, r.h - 12));
    }
  }

  // When the city offers no road list to draw from, paint the visible
  // ground by sampling what the city says is at each coarse cell.
  function drawSampledGround(ctx, city, view, pal) {
    var cell = 96;
    for (var gy = Math.floor(view.y / cell) * cell; gy < view.y + view.h; gy += cell) {
      for (var gx = Math.floor(view.x / cell) * cell; gx < view.x + view.w; gx += cell) {
        var kind = groundKind(city, gx + cell / 2, gy + cell / 2);
        if (!kind || kind === 'grass') continue;
        ctx.fillStyle = groundColour(kind, pal);
        ctx.fillRect(gx, gy, cell + 1, cell + 1);
      }
    }
  }

  function drawRegions(ctx, list, view, colour) {
    if (!Array.isArray(list)) return;
    ctx.fillStyle = colour;
    for (var i = 0; i < list.length; i++) {
      var r = rectOf(list[i]);
      if (!r || !overlaps(r, view)) continue;
      ctx.fillRect(r.x, r.y, r.w, r.h);
    }
  }

  function drawRoads(ctx, city, view, pal) {
    var roads = city ? city.roads : null;
    var side = cfg().sidewalkWidth || 18;
    if (!Array.isArray(roads) || roads.length === 0) return;
    for (var i = 0; i < roads.length; i++) {
      var seg = roadSeg(roads[i]);
      if (!seg) continue;
      if (seg.rect) {
        var r = seg.rect;
        if (!overlaps(r, view)) continue;
        ctx.fillStyle = pal.sidewalk || '#cfc4a8';
        ctx.fillRect(r.x - side, r.y - side, r.w + side * 2, r.h + side * 2);
        ctx.fillStyle = pal.road || '#5a564e';
        ctx.fillRect(r.x, r.y, r.w, r.h);
      } else {
        ctx.lineCap = 'round';
        ctx.strokeStyle = pal.sidewalk || '#cfc4a8';
        ctx.lineWidth = seg.width + side * 2;
        ctx.beginPath();
        ctx.moveTo(seg.x1, seg.y1);
        ctx.lineTo(seg.x2, seg.y2);
        ctx.stroke();
        ctx.strokeStyle = pal.road || '#5a564e';
        ctx.lineWidth = seg.width;
        ctx.beginPath();
        ctx.moveTo(seg.x1, seg.y1);
        ctx.lineTo(seg.x2, seg.y2);
        ctx.stroke();
        // A dashed centre line, only on long stretches, for the road feel.
        var len = distance(seg.x1, seg.y1, seg.x2, seg.y2);
        if (len > 200) {
          ctx.strokeStyle = pal.roadLine || '#e8d98a';
          ctx.lineWidth = 3;
          ctx.setLineDash([26, 30]);
          ctx.beginPath();
          ctx.moveTo(seg.x1, seg.y1);
          ctx.lineTo(seg.x2, seg.y2);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    }
  }

  function drawBuildings(ctx, city, view, pal, time) {
    var list = city ? city.buildings : null;
    if (!Array.isArray(list)) return;
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      var r = rectOf(b);
      if (!r || !overlaps(r, view)) continue;
      var height = typeof b.height === 'number' ? b.height : 30;
      var colour = typeof b.color === 'string' ? b.color
        : (typeof b.colour === 'string' ? b.colour : (pal.buildingRoof || '#b98a5e'));
      var shade = Math.min(46, 8 + height * 0.45);
      // Soft shadow thrown to the south-east, longer for taller buildings.
      ctx.fillStyle = 'rgba(20, 24, 18, 0.28)';
      ctx.fillRect(r.x + shade * 0.5, r.y + shade * 0.6, r.w, r.h);
      // Roof face, with a darker south edge to suggest the wall.
      ctx.fillStyle = colour;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
      ctx.fillRect(r.x, r.y + r.h - 6, r.w, 6);
      ctx.fillRect(r.x + r.w - 6, r.y, 6, r.h);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.20)';
      ctx.fillRect(r.x, r.y, r.w, 4);
      // Rooftop detail: a pale inset for towers, vents for low blocks.
      if (height > 60) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
        var inset = Math.min(14, Math.min(r.w, r.h) * 0.18);
        ctx.fillRect(r.x + inset, r.y + inset, r.w - inset * 2, r.h - inset * 2);
      } else if (r.w > 40 && r.h > 40) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.14)';
        ctx.fillRect(r.x + r.w * 0.3, r.y + r.h * 0.3, 10, 8);
        ctx.fillRect(r.x + r.w * 0.6, r.y + r.h * 0.55, 8, 8);
      }
      // A crane's jib, drawn as a thin arm, for harbour cranes.
      if (b.kind === 'crane') {
        ctx.strokeStyle = '#d8b25a';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(r.x + r.w / 2, r.y + r.h / 2);
        ctx.lineTo(r.x + r.w / 2 + 90, r.y + r.h / 2 - 46);
        ctx.stroke();
      }
      // Windows catch the sun on tall towers.
      if (height > 80 && r.w > 50) {
        var twinkle = 0.10 + 0.06 * Math.sin(time * 0.7 + i * 1.7);
        ctx.fillStyle = 'rgba(255, 244, 190, ' + twinkle.toFixed(3) + ')';
        ctx.fillRect(r.x + 6, r.y + 6, r.w - 12, Math.min(18, r.h - 12));
      }
    }
  }

  // ---- skid marks, pickups, particles ------------------------------------

  function drawSkids(ctx, state, view) {
    var marks = state.skidMarks || state.skids || state.skidmarks || [];
    if (!Array.isArray(marks)) return;
    ctx.strokeStyle = 'rgba(20, 20, 22, 0.45)';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    for (var i = 0; i < marks.length; i++) {
      var m = marks[i];
      if (!m) continue;
      var life = (typeof m.life === 'number' && typeof m.maxLife === 'number' && m.maxLife > 0)
        ? clamp(m.life / m.maxLife, 0, 1) : 1;
      if (life <= 0) continue;
      ctx.globalAlpha = 0.15 + 0.35 * life;
      ctx.beginPath();
      if (typeof m.x1 === 'number' && typeof m.y1 === 'number' &&
          typeof m.x2 === 'number' && typeof m.y2 === 'number') {
        ctx.moveTo(m.x1, m.y1);
        ctx.lineTo(m.x2, m.y2);
      } else if (typeof m.x === 'number' && typeof m.y === 'number') {
        var ang = typeof m.angle === 'number' ? m.angle : 0;
        var len = typeof m.length === 'number' ? m.length : 30;
        ctx.moveTo(m.x, m.y);
        ctx.lineTo(m.x + Math.cos(ang) * len, m.y + Math.sin(ang) * len);
      } else {
        continue;
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawPickups(ctx, state, view, time) {
    var list = state.pickups || [];
    if (!Array.isArray(list)) return;
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (!p || typeof p.x !== 'number' || typeof p.y !== 'number') continue;
      if (p.x < view.x - 40 || p.x > view.x + view.w + 40 ||
          p.y < view.y - 40 || p.y > view.y + view.h + 40) continue;
      var kind = p.kind || p.type || 'health';
      var bob = Math.sin(time * 3 + i * 2) * 3;
      var glow = 0.5 + 0.3 * Math.sin(time * 4 + i);
      ctx.fillStyle = 'rgba(255, 209, 102, ' + glow.toFixed(3) + ')';
      ellipse(ctx, p.x, p.y + bob, 18, 18);
      ctx.fill();
      ctx.fillStyle = kind === 'health' ? '#3fae5a' : (kind === 'ammo' ? '#c98a2e' : '#ffd166');
      ellipse(ctx, p.x, p.y + bob, 12, 12);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(kind === 'health' ? '+' : (kind === 'ammo' ? 'A' : '$'), p.x, p.y + bob + 1);
    }
  }

  function drawParticles(ctx, state, view) {
    var list = state.particles || [];
    if (!Array.isArray(list)) return;
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (!p || typeof p.x !== 'number' || typeof p.y !== 'number') continue;
      if (p.x < view.x - 60 || p.x > view.x + view.w + 60 ||
          p.y < view.y - 60 || p.y > view.y + view.h + 60) continue;
      var life = (typeof p.life === 'number' && typeof p.maxLife === 'number' && p.maxLife > 0)
        ? clamp(p.life / p.maxLife, 0, 1) : 1;
      var size = typeof p.size === 'number' ? p.size : 5;
      var kind = p.kind || p.type || 'dust';
      var colour = typeof p.color === 'string' ? p.color
        : (typeof p.colour === 'string' ? p.colour : '#cccccc');
      if (kind === 'smoke') {
        ctx.globalAlpha = 0.35 * life;
        ctx.fillStyle = colour === '#cccccc' ? '#6a6a6a' : colour;
        ellipse(ctx, p.x, p.y, size * (1.6 - life * 0.6), size * (1.6 - life * 0.6));
        ctx.fill();
      } else if (kind === 'flash' || kind === 'muzzle') {
        ctx.globalAlpha = life;
        ctx.fillStyle = '#ffe27a';
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(typeof p.angle === 'number' ? p.angle : 0);
        ctx.fillRect(-size, -size * 0.28, size * 2, size * 0.56);
        ctx.fillRect(-size * 0.28, -size, size * 0.56, size * 2);
        ctx.restore();
      } else if (kind === 'spark') {
        ctx.globalAlpha = life;
        ctx.strokeStyle = colour === '#cccccc' ? '#ffb347' : colour;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - (typeof p.vx === 'number' ? p.vx : 0) * 0.03,
                   p.y - (typeof p.vy === 'number' ? p.vy : 0) * 0.03);
        ctx.stroke();
      } else {
        ctx.globalAlpha = 0.5 * life;
        ctx.fillStyle = colour;
        ellipse(ctx, p.x, p.y, size, size);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  // ---- entities ----------------------------------------------------------

  function drawShadow(ctx, x, y, rx, ry) {
    ctx.fillStyle = 'rgba(20, 24, 18, 0.25)';
    ellipse(ctx, x + 4, y + 6, rx, ry);
    ctx.fill();
  }

  function drawCar(ctx, car, time, isPlayerCar) {
    if (!car || typeof car.x !== 'number') return;
    var C = cfg();
    var len = C.carLength || 56;
    var wid = C.carWidth || 28;
    drawShadow(ctx, car.x, car.y, len * 0.55, wid * 0.5);
    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.rotate(typeof car.angle === 'number' ? car.angle : 0);
    var colour = typeof car.color === 'string' ? car.color
      : (typeof car.colour === 'string' ? car.colour : '#888888');
    if (car.exploded) {
      ctx.fillStyle = '#2b2b2b';
      roundedPath(ctx, -len / 2, -wid / 2, len, wid, 8);
      ctx.fill();
      ctx.fillStyle = '#171717';
      roundedPath(ctx, -len / 4, -wid / 4, len / 2, wid / 2, 5);
      ctx.fill();
      ctx.restore();
      return;
    }
    ctx.fillStyle = colour;
    roundedPath(ctx, -len / 2, -wid / 2, len, wid, 9);
    ctx.fill();
    // Cabin glass and roof.
    ctx.fillStyle = 'rgba(20, 30, 44, 0.85)';
    roundedPath(ctx, -len * 0.18, -wid * 0.36, len * 0.36, wid * 0.72, 5);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.fillRect(-len * 0.16, -wid * 0.36, len * 0.10, wid * 0.72);
    // Headlights when the car is moving, taillights when braking.
    var speed = Math.abs(typeof car.speed === 'number' ? car.speed : 0);
    if (speed > 30) {
      ctx.fillStyle = 'rgba(255, 240, 170, 0.85)';
      ctx.fillRect(len / 2 - 2, -wid / 2 + 4, 4, 5);
      ctx.fillRect(len / 2 - 2, wid / 2 - 9, 4, 5);
    }
    if (car.braking) {
      ctx.fillStyle = 'rgba(255, 60, 60, 0.9)';
      ctx.fillRect(-len / 2 - 1, -wid / 2 + 4, 4, 5);
      ctx.fillRect(-len / 2 - 1, wid / 2 - 9, 4, 5);
    }
    // Police cars wear a black-and-white coat and a flashing light bar.
    if (car.isPolice || car.police) {
      ctx.fillStyle = '#f2f2f2';
      ctx.fillRect(-len * 0.1, -wid / 2, len * 0.2, wid);
      var blink = Math.sin(time * 10) > 0;
      ctx.fillStyle = blink ? '#ff3b30' : '#2f7bff';
      ctx.fillRect(-6, -wid / 2 - 2, 12, 5);
      ctx.fillStyle = blink ? '#2f7bff' : '#ff3b30';
      ctx.fillRect(-6, wid / 2 - 3, 12, 5);
    }
    ctx.restore();
    // Smoke and fire sit above the body, so they are drawn unrotated.
    if (car.burning || (typeof car.health === 'number' && car.health <= (C.carFireAt || 20))) {
      var flick = 0.6 + 0.4 * Math.sin(time * 17 + car.x);
      ctx.fillStyle = 'rgba(255, ' + Math.round(120 + 80 * flick) + ', 30, 0.85)';
      ellipse(ctx, car.x, car.y, 12 + 6 * flick, 10 + 5 * flick);
      ctx.fill();
    } else if (car.smoking || (typeof car.health === 'number' && car.health <= (C.carSmokeAt || 45))) {
      ctx.fillStyle = 'rgba(90, 90, 90, 0.55)';
      var puff = Math.sin(time * 5 + car.y) * 4;
      ellipse(ctx, car.x + puff, car.y - 8, 10, 8);
      ctx.fill();
    }
    if (isPlayerCar) {
      ctx.strokeStyle = 'rgba(255, 209, 102, 0.9)';
      ctx.lineWidth = 2;
      ellipse(ctx, car.x, car.y, len * 0.62, wid * 0.72);
      ctx.stroke();
    }
  }

  function drawPedestrian(ctx, ped, time) {
    if (!ped || typeof ped.x !== 'number') return;
    var fleeing = ped.state === 'flee' || ped.fleeing;
    drawShadow(ctx, ped.x, ped.y, 10, 5);
    var shirt = '#e67e22';
    if (typeof ped.color === 'string') shirt = ped.color;
    else if (typeof ped.shirt === 'string') shirt = ped.shirt;
    else if (typeof ped.id === 'number') {
      var paints = cfg().carPaints || [];
      shirt = paints[ped.id % paints.length] || shirt;
    }
    var bob = fleeing ? Math.sin(time * 14 + ped.x) * 2 : Math.sin(time * 6 + ped.x) * 1;
    ctx.fillStyle = shirt;
    ellipse(ctx, ped.x, ped.y + bob, 9, 9);
    ctx.fill();
    ctx.fillStyle = '#e8c39a';
    ellipse(ctx, ped.x, ped.y + bob - 2, 4.5, 4.5);
    ctx.fill();
    if (fleeing) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(ped.x - 12, ped.y);
      ctx.lineTo(ped.x - 18, ped.y - 4);
      ctx.moveTo(ped.x - 12, ped.y + 4);
      ctx.lineTo(ped.x - 18, ped.y + 8);
      ctx.stroke();
    }
  }

  function drawPolice(ctx, cop, time) {
    if (!cop || typeof cop.x !== 'number') return;
    if (cop.kind === 'car') {
      drawCar(ctx, {
        x: cop.x, y: cop.y, angle: cop.angle, speed: cop.speed,
        color: '#23272e', isPolice: true, health: cop.health
      }, time, false);
      return;
    }
    drawShadow(ctx, cop.x, cop.y, 10, 5);
    ctx.fillStyle = '#23272e';
    ellipse(ctx, cop.x, cop.y, 10, 10);
    ctx.fill();
    ctx.fillStyle = '#2f7bff';
    ellipse(ctx, cop.x, cop.y - 3, 5, 5);
    ctx.fill();
    // A foot officer reaches toward the player when close.
    var reach = typeof cop.angle === 'number' ? cop.angle : 0;
    ctx.strokeStyle = '#23272e';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cop.x, cop.y);
    ctx.lineTo(cop.x + Math.cos(reach) * 14, cop.y + Math.sin(reach) * 14);
    ctx.stroke();
  }

  function drawPlayer(ctx, player, time) {
    if (!player || typeof player.x !== 'number' || !player.onFoot) return;
    drawShadow(ctx, player.x, player.y, 12, 6);
    var ang = typeof player.angle === 'number' ? player.angle : 0;
    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.rotate(ang);
    // Jacket, shoulders, then the pistol pointing where the player aims.
    ctx.fillStyle = '#d94f3d';
    ellipse(ctx, 0, 0, 13, 11);
    ctx.fill();
    ctx.fillStyle = '#2c2c34';
    ctx.fillRect(6, -3, 16, 6);
    ctx.fillStyle = '#e8c39a';
    ellipse(ctx, 2, 0, 5, 5);
    ctx.fill();
    ctx.restore();
    // A faint ring so the player never gets lost in a crowd.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
    ctx.lineWidth = 2;
    ellipse(ctx, player.x, player.y, 17, 17);
    ctx.stroke();
  }

  // ---- mission marker -----------------------------------------------------

  function missionTarget(state) {
    if (Solmar.Missions && typeof Solmar.Missions.marker === 'function') {
      try {
        var marked = Solmar.Missions.marker(state);
        if (marked && typeof marked.x === 'number' && typeof marked.y === 'number') return marked;
      } catch (err) { /* fall through to the raw mission target */ }
    }
    var mission = state ? state.mission : null;
    if (mission && mission.target &&
        typeof mission.target.x === 'number' && typeof mission.target.y === 'number') {
      return mission.target;
    }
    return null;
  }

  function drawMissionMarker(ctx, state, view, time) {
    var target = missionTarget(state);
    if (!target) return;
    var pulse = 1 + 0.12 * Math.sin(time * 4);
    var radius = (cfg().missionMarkerRadius || 34) * pulse;
    if (target.x > view.x - 60 && target.x < view.x + view.w + 60 &&
        target.y > view.y - 60 && target.y < view.y + view.h + 60) {
      ctx.strokeStyle = 'rgba(255, 209, 102, 0.95)';
      ctx.lineWidth = 3;
      ellipse(ctx, target.x, target.y, radius, radius);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255, 209, 102, 0.20)';
      ellipse(ctx, target.x, target.y, radius, radius);
      ctx.fill();
      // A diamond pin over the ring.
      ctx.save();
      ctx.translate(target.x, target.y);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = '#ffd166';
      ctx.fillRect(-9, -9, 18, 18);
      ctx.fillStyle = '#101820';
      ctx.fillRect(-4, -4, 8, 8);
      ctx.restore();
      if (target.label) {
        ctx.fillStyle = 'rgba(12, 18, 28, 0.8)';
        ctx.font = 'bold 13px sans-serif';
        var labelWidth = ctx.measureText ? ctx.measureText(target.label).width : target.label.length * 8;
        ctx.fillRect(target.x - labelWidth / 2 - 8, target.y - radius - 30, labelWidth + 16, 22);
        ctx.fillStyle = '#ffd166';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(target.label, target.x, target.y - radius - 19);
      }
    } else {
      // Off screen: an arrow pinned to the view edge, pointing the way.
      var cx = view.x + view.w / 2;
      var cy = view.y + view.h / 2;
      var ang = Math.atan2(target.y - cy, target.x - cx);
      var ex = clamp(cx + Math.cos(ang) * (view.w / 2 - 46), view.x + 30, view.x + view.w - 30);
      var ey = clamp(cy + Math.sin(ang) * (view.h / 2 - 46), view.y + 30, view.y + view.h - 30);
      ctx.save();
      ctx.translate(ex, ey);
      ctx.rotate(ang);
      ctx.fillStyle = '#ffd166';
      ctx.beginPath();
      ctx.moveTo(16, 0);
      ctx.lineTo(-10, -11);
      ctx.lineTo(-4, 0);
      ctx.lineTo(-10, 11);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  // ---- in-canvas HUD ------------------------------------------------------

  function drawCanvasHud(ctx, state, screen) {
    var C = cfg();
    var pal = palette();
    var W = C.canvasWidth || 1280;
    var H = C.canvasHeight || 720;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (screen === 'playing' && state) {
      var mission = state.mission;
      if (mission && mission.objective) {
        var line = mission.objective;
        if (typeof mission.timer === 'number' && mission.timer > 0) {
          line += '  —  ' + Math.ceil(mission.timer) + 's';
        }
        ctx.font = '600 16px sans-serif';
        var width = ctx.measureText ? ctx.measureText(line).width : line.length * 9;
        ctx.fillStyle = pal.hudBackground || 'rgba(12, 18, 28, 0.72)';
        roundedPath(ctx, W / 2 - width / 2 - 16, H - 56, width + 32, 34, 8);
        ctx.fill();
        ctx.fillStyle = pal.hudAccent || '#ffd166';
        ctx.fillText(line, W / 2, H - 38);
      }
      var player = state.player;
      if (player && player.onFoot) {
        // Centred above the objective pill: the bottom-left corner of the
        // page already holds the mute button, so a chip there would sit
        // underneath it.
        var ammo = 'Ammo: ' + (typeof player.ammo === 'number' ? player.ammo : 0) +
          '  •  ' + (player.weapon || 'pistol');
        ctx.font = '600 14px sans-serif';
        var ammoWidth = ctx.measureText ? ctx.measureText(ammo).width : ammo.length * 8;
        ctx.fillStyle = pal.hudBackground || 'rgba(12, 18, 28, 0.72)';
        roundedPath(ctx, W / 2 - ammoWidth / 2 - 14, H - 100, ammoWidth + 28, 30, 8);
        ctx.fill();
        ctx.fillStyle = pal.hudText || '#f2ead8';
        ctx.fillText(ammo, W / 2, H - 84);
      }
    } else if (screen === 'title') {
      ctx.fillStyle = 'rgba(12, 18, 28, 0.55)';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#ffd166';
      ctx.font = 'bold 64px sans-serif';
      ctx.fillText('SOLMAR BAY', W / 2, H / 2 - 40);
      ctx.fillStyle = '#f2ead8';
      ctx.font = '20px sans-serif';
      ctx.fillText('A sun-soaked coastal city. Drive it, run it, stay out of trouble — or don\'t.', W / 2, H / 2 + 8);
    } else if (screen === 'paused') {
      ctx.fillStyle = 'rgba(12, 18, 28, 0.45)';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#f2ead8';
      ctx.font = 'bold 44px sans-serif';
      ctx.fillText('PAUSED', W / 2, H / 2);
    } else if (screen === 'gameover') {
      ctx.fillStyle = 'rgba(12, 18, 28, 0.45)';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#e05252';
      ctx.font = 'bold 48px sans-serif';
      ctx.fillText('BUSTED', W / 2, H / 2 - 20);
      ctx.fillStyle = '#f2ead8';
      ctx.font = '20px sans-serif';
      ctx.fillText('The run ends here — but the bay will wait.', W / 2, H / 2 + 24);
    }
  }

  // ---- the frame ----------------------------------------------------------

  function draw(ctx, state, city, screen) {
    var C = cfg();
    var pal = palette();
    var W = C.canvasWidth || 1280;
    var H = C.canvasHeight || 720;
    if (!ctx) return;
    ctx.save();
    if (!state) {
      ctx.fillStyle = pal.water || '#2e7fb8';
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
      return;
    }
    var time = typeof state.time === 'number' ? state.time : 0;
    var cam = state.camera || { x: C.startX || 1600, y: C.startY || 1200, zoom: 1, shake: 0 };
    var player = state.player;
    // Ease the camera toward the player; the world may already do this,
    // and easing twice only makes the follow a touch softer.
    if (player && typeof player.x === 'number') {
      var lag = C.cameraLag !== undefined ? C.cameraLag : 0.08;
      cam.x += (player.x - cam.x) * Math.min(1, lag * 4);
      cam.y += (player.y - cam.y) * Math.min(1, lag * 4);
    }
    var cityW = (city && city.width) || C.cityWidth || 6400;
    var cityH = (city && city.height) || C.cityHeight || 4800;
    cam.x = clamp(cam.x, W / 2 / (cam.zoom || 1), Math.max(W / 2, cityW - W / 2 / (cam.zoom || 1)));
    cam.y = clamp(cam.y, H / 2 / (cam.zoom || 1), Math.max(H / 2, cityH - H / 2 / (cam.zoom || 1)));
    var shake = typeof cam.shake === 'number' ? cam.shake : 0;
    var shX = shake > 0.2 ? (Math.random() - 0.5) * shake : 0;
    var shY = shake > 0.2 ? (Math.random() - 0.5) * shake : 0;
    var zoom = cam.zoom || 1;
    var view = {
      x: cam.x - W / 2 / zoom + shX,
      y: cam.y - H / 2 / zoom + shY,
      w: W / zoom,
      h: H / zoom
    };
    ctx.translate(W / 2, H / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(-cam.x + shX, -cam.y + shY);

    drawWaterAndGrass(ctx, city, view, pal);
    var hasRoads = city && Array.isArray(city.roads) && city.roads.length > 0;
    if (hasRoads) {
      drawRegions(ctx, city.beach ? (Array.isArray(city.beach) ? city.beach : [city.beach]) : [], view, pal.sand || '#e6d29a');
      drawRegions(ctx, city.parks, view, pal.park || '#6da34f');
      drawRegions(ctx, city.docks ? (Array.isArray(city.docks) ? city.docks : [city.docks]) : [], view, pal.dock || '#8a7a5e');
      drawRoads(ctx, city, view, pal);
    } else {
      drawSampledGround(ctx, city, view, pal);
    }
    drawBuildings(ctx, city, view, pal, time);
    drawSkids(ctx, state, view);
    drawPickups(ctx, state, view, time);
    drawMissionMarker(ctx, state, view, time);

    var cars = Array.isArray(state.cars) ? state.cars : [];
    for (var i = 0; i < cars.length; i++) {
      var car = cars[i];
      if (!car || typeof car.x !== 'number') continue;
      if (car.x < view.x - 120 || car.x > view.x + view.w + 120 ||
          car.y < view.y - 120 || car.y > view.y + view.h + 120) continue;
      // player.car is the car object itself, not its id, so the gold
      // ring marks the player's car only when the ids (or the object)
      // actually match.
      var isPlayerCar = !!(player && !player.onFoot && player.car &&
        (player.car === car || player.car.id === car.id));
      drawCar(ctx, car, time, isPlayerCar);
    }
    var peds = Array.isArray(state.pedestrians) ? state.pedestrians : [];
    for (var j = 0; j < peds.length; j++) {
      var ped = peds[j];
      if (!ped || typeof ped.x !== 'number') continue;
      if (ped.x < view.x - 40 || ped.x > view.x + view.w + 40 ||
          ped.y < view.y - 40 || ped.y > view.y + view.h + 40) continue;
      drawPedestrian(ctx, ped, time);
    }
    var police = Array.isArray(state.police) ? state.police : [];
    for (var k = 0; k < police.length; k++) {
      var cop = police[k];
      if (!cop || typeof cop.x !== 'number') continue;
      if (cop.x < view.x - 120 || cop.x > view.x + view.w + 120 ||
          cop.y < view.y - 120 || cop.y > view.y + view.h + 120) continue;
      drawPolice(ctx, cop, time);
    }
    if (player && player.onFoot) drawPlayer(ctx, player, time);
    drawParticles(ctx, state, view);

    ctx.restore();
    drawCanvasHud(ctx, state, screen || 'playing');
  }

  // ---- minimap ------------------------------------------------------------

  function drawMinimap(mctx, state, city) {
    var C = cfg();
    var pal = palette();
    if (!mctx) return;
    var mw = (mctx.canvas && mctx.canvas.width) || 220;
    var mh = (mctx.canvas && mctx.canvas.height) || 165;
    var cityW = (city && city.width) || C.cityWidth || 6400;
    var cityH = (city && city.height) || C.cityHeight || 4800;
    var scale = Math.min(mw / cityW, mh / cityH);
    var offX = (mw - cityW * scale) / 2;
    var offY = (mh - cityH * scale) / 2;
    function mx(x) { return offX + x * scale; }
    function my(y) { return offY + y * scale; }

    mctx.fillStyle = pal.minimapWater || '#2e7fb8';
    mctx.fillRect(0, 0, mw, mh);
    mctx.fillStyle = pal.grass || '#7fae5a';
    mctx.fillRect(offX, offY, cityW * scale, cityH * scale);
    var waters = city ? (Array.isArray(city.water) ? city.water : (city.water ? [city.water] : [])) : [];
    mctx.fillStyle = pal.minimapWater || '#2e7fb8';
    for (var w = 0; w < waters.length; w++) {
      var wr = rectOf(waters[w]);
      if (wr) mctx.fillRect(mx(wr.x), my(wr.y), Math.max(1, wr.w * scale), Math.max(1, wr.h * scale));
    }
    if (city && Array.isArray(city.parks)) {
      mctx.fillStyle = pal.park || '#6da34f';
      for (var p = 0; p < city.parks.length; p++) {
        var pr = rectOf(city.parks[p]);
        if (pr) mctx.fillRect(mx(pr.x), my(pr.y), Math.max(1, pr.w * scale), Math.max(1, pr.h * scale));
      }
    }
    if (city && Array.isArray(city.roads)) {
      mctx.strokeStyle = pal.minimapRoad || '#8a8578';
      mctx.lineCap = 'round';
      for (var r = 0; r < city.roads.length; r++) {
        var seg = roadSeg(city.roads[r]);
        if (!seg) continue;
        mctx.lineWidth = Math.max(1, (seg.width || C.roadWidth || 64) * scale);
        if (seg.rect) {
          mctx.fillStyle = pal.minimapRoad || '#8a8578';
          mctx.fillRect(mx(seg.rect.x), my(seg.rect.y),
            Math.max(1, seg.rect.w * scale), Math.max(1, seg.rect.h * scale));
        } else {
          mctx.beginPath();
          mctx.moveTo(mx(seg.x1), my(seg.y1));
          mctx.lineTo(mx(seg.x2), my(seg.y2));
          mctx.stroke();
        }
      }
    }
    if (city && Array.isArray(city.buildings)) {
      mctx.fillStyle = 'rgba(60, 50, 40, 0.55)';
      for (var b = 0; b < city.buildings.length; b++) {
        var br = rectOf(city.buildings[b]);
        if (!br) continue;
        mctx.fillRect(mx(br.x), my(br.y), Math.max(1, br.w * scale), Math.max(1, br.h * scale));
      }
    }
    // Nearby traffic, as pale dots — only cars close to the player, so the
    // map stays readable instead of turning into static.
    var player = state ? state.player : null;
    var cars = state && Array.isArray(state.cars) ? state.cars : [];
    mctx.fillStyle = pal.minimapCar || '#e8e8e8';
    for (var c = 0; c < cars.length; c++) {
      var car = cars[c];
      if (!car || typeof car.x !== 'number') continue;
      if (player && distance(player.x, player.y, car.x, car.y) > 1600) continue;
      mctx.fillRect(mx(car.x) - 1, my(car.y) - 1, 2, 2);
    }
    var police = state && Array.isArray(state.police) ? state.police : [];
    mctx.fillStyle = pal.minimapPolice || '#4a90e2';
    for (var q = 0; q < police.length; q++) {
      var cop = police[q];
      if (!cop || typeof cop.x !== 'number') continue;
      mctx.beginPath();
      mctx.arc(mx(cop.x), my(cop.y), 3, 0, Math.PI * 2);
      mctx.fill();
    }
    var target = state ? missionTarget(state) : null;
    if (target) {
      var tx = mx(target.x);
      var ty = my(target.y);
      mctx.save();
      mctx.translate(tx, ty);
      mctx.rotate(Math.PI / 4);
      mctx.fillStyle = pal.minimapMarker || '#ffd166';
      mctx.fillRect(-4, -4, 8, 8);
      mctx.restore();
      mctx.strokeStyle = 'rgba(255, 209, 102, 0.8)';
      mctx.lineWidth = 1;
      mctx.beginPath();
      mctx.arc(tx, ty, 7, 0, Math.PI * 2);
      mctx.stroke();
    }
    if (player && typeof player.x === 'number') {
      mctx.fillStyle = pal.minimapPlayer || '#ffffff';
      mctx.beginPath();
      mctx.arc(mx(player.x), my(player.y), 4, 0, Math.PI * 2);
      mctx.fill();
      mctx.strokeStyle = '#101820';
      mctx.lineWidth = 1;
      mctx.beginPath();
      mctx.arc(mx(player.x), my(player.y), 4, 0, Math.PI * 2);
      mctx.stroke();
    }
  }

  Solmar.Render = {
    draw: draw,
    drawMinimap: drawMinimap
  };
})();
