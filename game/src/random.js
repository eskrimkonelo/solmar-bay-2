// Solmar Bay — a small seeded random number generator. Two generators built
// from the same seed hand out the same numbers in the same order, which is
// what makes the city and the staged screenshot scenes repeatable.
(function () {
  var root = typeof window !== 'undefined' ? window : globalThis;
  root.Solmar = root.Solmar || {};

  // Turns seed text into a 32-bit number by folding its characters together.
  function hashSeedText(text) {
    var hash = 2166136261;
    var s = String(text);
    for (var i = 0; i < s.length; i++) {
      hash ^= s.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  // A generator: keeps its state in a closure and offers the handful of
  // draws the rest of the game needs.
  function createSeededRandom(seed) {
    var state = typeof seed === 'number' ? seed >>> 0 : hashSeedText(seed);
    if (state === 0) state = 0x9e3779b9;

    function nextFloat() {
      // Mulberry-style step: scramble the state, then take its top bits.
      state = (state + 0x6d2b79f5) >>> 0;
      var t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    function nextInt(min, max) {
      // A whole number from min up to but not including max.
      return min + Math.floor(nextFloat() * (max - min));
    }

    function range(min, max) {
      return min + nextFloat() * (max - min);
    }

    function chance(probability) {
      return nextFloat() < probability;
    }

    function pick(list) {
      if (!list || list.length === 0) return undefined;
      return list[nextInt(0, list.length)];
    }

    function getState() {
      return state;
    }

    function setState(saved) {
      state = saved >>> 0;
    }

    return {
      next: nextFloat,
      nextInt: nextInt,
      range: range,
      chance: chance,
      pick: pick,
      getState: getState,
      setState: setState
    };
  }

  root.Solmar.Random = {
    create: createSeededRandom,
    hashSeedText: hashSeedText
  };
})();
