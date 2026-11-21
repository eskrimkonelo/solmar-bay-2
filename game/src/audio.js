// Solmar Bay — sound, all synthesized. No audio file is ever loaded: the
// engine hum, the sirens, the gunshots, the crashes, the pickup chimes and
// the music loop are all built from oscillators and filtered noise through
// the browser's WebAudio system. Everything here tolerates being called
// before the audio system exists (for example on a headless load test),
// and the music only starts once the browser has actually let sound play.
(function () {
  var root = typeof window !== 'undefined' ? window : globalThis;
  root.Solmar = root.Solmar || {};
  var Solmar = root.Solmar;

  function cfg() {
    return Solmar.Config || {};
  }

  var Audio = {
    muted: false,
    ready: false,
    ctx: null,
    master: null,
    musicOn: false,
    sirenOn: false,
    engineNode: null,
    sirenNode: null,
    musicTimer: null,
    musicStep: 0
  };

  function audioCtor() {
    if (typeof root.AudioContext === 'function') return root.AudioContext;
    if (typeof root.webkitAudioContext === 'function') return root.webkitAudioContext;
    return null;
  }

  // Build the context and the master gain. Safe to call repeatedly; the
  // second call is a no-op. Before a user gesture the browser may keep
  // the context suspended, so the first click or keypress anywhere on the
  // page resumes it and lets the music loop in — without that, a game
  // that only ever calls play() from world events could stay silent.
  function init() {
    if (Audio.ctx) return true;
    var Ctor = audioCtor();
    if (!Ctor) return false;
    try {
      Audio.ctx = new Ctor();
      Audio.master = Audio.ctx.createGain();
      Audio.master.gain.value = Audio.muted ? 0 : (cfg().masterVolume !== undefined ? cfg().masterVolume : 0.7);
      Audio.master.connect(Audio.ctx.destination);
      Audio.ready = true;
      if (typeof root.addEventListener === 'function' && !Audio._gestureWired) {
        Audio._gestureWired = true;
        var wake = function () { resume(); ensureMusic(); };
        root.addEventListener('pointerdown', wake);
        root.addEventListener('keydown', wake);
      }
      return true;
    } catch (err) {
      Audio.ctx = null;
      Audio.ready = false;
      return false;
    }
  }

  function resume() {
    if (!Audio.ctx) return;
    try {
      if (Audio.ctx.state === 'suspended' && typeof Audio.ctx.resume === 'function') {
        Audio.ctx.resume();
      }
    } catch (err) { /* sound stays suspended; play calls stay silent */ }
  }

  function now() {
    return Audio.ctx ? Audio.ctx.currentTime : 0;
  }

  function volumeOf(key, fallback) {
    var C = cfg();
    return typeof C[key] === 'number' ? C[key] : fallback;
  }

  // A short oscillator note with a quick attack and an exponential fade.
  function tone(freq, freqEnd, dur, type, vol, when) {
    if (!Audio.ctx || !Audio.master) return null;
    var t0 = (typeof when === 'number' ? when : now());
    var osc = Audio.ctx.createOscillator();
    var gain = Audio.ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(Math.max(20, freq), t0);
    if (freqEnd && freqEnd !== freq) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t0 + dur);
    }
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, vol), t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain);
    gain.connect(Audio.master);
    try {
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
    } catch (err) { /* a stopped oscillator is harmless */ }
    return osc;
  }

  // A burst of white noise through a filter: the raw material for shots,
  // crashes, explosions, and hi-hats.
  function noiseBurst(dur, vol, filterFreq, filterType, when) {
    if (!Audio.ctx || !Audio.master) return;
    var t0 = (typeof when === 'number' ? when : now());
    var length = Math.max(1, Math.floor(Audio.ctx.sampleRate * dur));
    var buffer = Audio.ctx.createBuffer(1, length, Audio.ctx.sampleRate);
    var data = buffer.getChannelData(0);
    for (var i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    var src = Audio.ctx.createBufferSource();
    src.buffer = buffer;
    var filter = Audio.ctx.createBiquadFilter();
    filter.type = filterType || 'lowpass';
    filter.frequency.value = filterFreq || 1200;
    var gain = Audio.ctx.createGain();
    gain.gain.setValueAtTime(Math.max(0.0001, vol), t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(Audio.master);
    try {
      src.start(t0);
      src.stop(t0 + dur + 0.05);
    } catch (err) { /* harmless */ }
  }

  // ---- one-shot effects ----------------------------------------------------

  function playShot() {
    var sfx = volumeOf('sfxVolume', 0.8);
    noiseBurst(0.09, 0.5 * sfx, 3200, 'highpass');
    tone(210, 70, 0.1, 'square', 0.22 * sfx);
  }

  function playExplosion() {
    var sfx = volumeOf('sfxVolume', 0.8);
    noiseBurst(0.7, 0.9 * sfx, 500, 'lowpass');
    tone(120, 28, 0.65, 'sine', 0.7 * sfx);
    noiseBurst(0.25, 0.4 * sfx, 2400, 'bandpass');
  }

  function playCrash() {
    var sfx = volumeOf('sfxVolume', 0.8);
    noiseBurst(0.22, 0.55 * sfx, 900, 'bandpass');
    tone(95, 45, 0.2, 'triangle', 0.4 * sfx);
  }

  function playPickup() {
    var sfx = volumeOf('sfxVolume', 0.8);
    var t = now();
    tone(660, 660, 0.09, 'sine', 0.3 * sfx, t);
    tone(990, 990, 0.14, 'sine', 0.3 * sfx, t + 0.08);
  }

  function playClick() {
    tone(880, 660, 0.06, 'sine', 0.25 * volumeOf('sfxVolume', 0.8));
  }

  function playMissionComplete() {
    var sfx = volumeOf('sfxVolume', 0.8);
    var t = now();
    var notes = [523, 659, 784, 1047];
    for (var i = 0; i < notes.length; i++) {
      tone(notes[i], notes[i], 0.22, 'triangle', 0.32 * sfx, t + i * 0.11);
    }
  }

  function playMissionFailed() {
    var sfx = volumeOf('sfxVolume', 0.8);
    var t = now();
    tone(392, 392, 0.25, 'sawtooth', 0.22 * sfx, t);
    tone(311, 294, 0.4, 'sawtooth', 0.22 * sfx, t + 0.22);
  }

  function playSirenBlip() {
    var sfx = volumeOf('sirenVolume', 0.35);
    var t = now();
    tone(750, 750, 0.16, 'sine', 0.3 * sfx, t);
    tone(980, 980, 0.16, 'sine', 0.3 * sfx, t + 0.18);
  }

  // Play one event by its type, with the event's facts when it carries
  // any (a crash may carry how hard it hit, for example). Unknown types
  // are ignored so a new event type never breaks the sound module.
  function play(type, event) {
    if (Audio.muted) return;
    if (!Audio.ctx) init();
    if (!Audio.ctx) return;
    resume();
    ensureMusic();
    switch (type) {
      case 'shot': playShot(); break;
      case 'explosion': playExplosion(); break;
      case 'crash': playCrash(); break;
      case 'pickup': playPickup(); break;
      case 'click': playClick(); break;
      case 'missionComplete': playMissionComplete(); break;
      case 'missionFailed': playMissionFailed(); break;
      case 'siren': playSirenBlip(); break;
      case 'message': break;
      default: break;
    }
  }

  // ---- engine hum ----------------------------------------------------------

  // Follows the driving speed the state reports: a low sawtooth through a
  // low-pass filter, its pitch and loudness rising with speed. Call with
  // the player's speed each frame, or with zero when on foot.
  function setEngine(speed, driving) {
    if (!Audio.ctx) init();
    if (!Audio.ctx || Audio.muted) {
      if (Audio.engineNode) {
        try { Audio.engineNode.gain.gain.value = 0; } catch (err) { /* ignore */ }
      }
      return;
    }
    resume();
    var sp = typeof speed === 'number' ? Math.abs(speed) : 0;
    var isDriving = driving !== undefined ? !!driving : sp > 5;
    if (!Audio.engineNode) {
      try {
        var osc = Audio.ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = 55;
        var filter = Audio.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 420;
        var gain = Audio.ctx.createGain();
        gain.gain.value = 0;
        osc.connect(filter);
        filter.connect(gain);
        gain.connect(Audio.master);
        osc.start();
        Audio.engineNode = { osc: osc, filter: filter, gain: gain };
      } catch (err) {
        return;
      }
    }
    var target = isDriving ? 0.05 + Math.min(0.3, sp / 1600) : 0.02;
    var freq = isDriving ? 55 + sp * 0.28 : 48;
    var t = now();
    try {
      Audio.engineNode.gain.gain.setTargetAtTime(target * volumeOf('engineVolume', 0.3) * 3, t, 0.08);
      Audio.engineNode.osc.frequency.setTargetAtTime(freq, t, 0.08);
      Audio.engineNode.filter.frequency.setTargetAtTime(320 + sp * 0.9, t, 0.1);
    } catch (err) { /* a missed retune is inaudible */ }
  }

  // ---- siren ---------------------------------------------------------------

  // A two-tone pursuit siren: one oscillator whose pitch is swung by a
  // slow square wave. On means the police are actively chasing.
  function setSiren(on) {
    Audio.sirenOn = !!on;
    if (!Audio.ctx) init();
    if (!Audio.ctx) return;
    resume();
    if (Audio.sirenOn && !Audio.sirenNode) {
      try {
        var osc = Audio.ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = 820;
        var lfo = Audio.ctx.createOscillator();
        lfo.type = 'square';
        lfo.frequency.value = 0.9;
        var lfoGain = Audio.ctx.createGain();
        lfoGain.gain.value = 150;
        var gain = Audio.ctx.createGain();
        gain.gain.value = volumeOf('sirenVolume', 0.35) * 0.5;
        lfo.connect(lfoGain);
        lfoGain.connect(osc.frequency);
        osc.connect(gain);
        gain.connect(Audio.master);
        osc.start();
        lfo.start();
        Audio.sirenNode = { osc: osc, lfo: lfo, gain: gain };
      } catch (err) {
        Audio.sirenNode = null;
      }
    } else if (!Audio.sirenOn && Audio.sirenNode) {
      try {
        Audio.sirenNode.gain.gain.setTargetAtTime(0, now(), 0.1);
        var node = Audio.sirenNode;
        Audio.sirenNode = null;
        setTimeout(function () {
          try { node.osc.stop(); node.lfo.stop(); } catch (err) { /* already stopped */ }
        }, 400);
      } catch (err) { /* ignore */ }
    }
    if (Audio.sirenNode && !Audio.muted) {
      try {
        Audio.sirenNode.gain.gain.value = volumeOf('sirenVolume', 0.35) * 0.5;
      } catch (err) { /* ignore */ }
    }
  }

  // ---- music ---------------------------------------------------------------

  // A simple sun-soaked loop: a minor-key bass line, a soft hat on every
  // other step, and a sparse lead that answers every fourth bar. Stepped
  // by a timer so it costs almost nothing.
  var BASS = [110, 110, 130.81, 98, 110, 110, 146.83, 164.81];
  var LEAD = [440, 0, 523.25, 0, 587.33, 0, 523.25, 440];

  function musicStep() {
    if (!Audio.ctx || Audio.muted || !Audio.musicOn) return;
    var step = Audio.musicStep % 8;
    var bar = Math.floor(Audio.musicStep / 8) % 4;
    var mv = volumeOf('musicVolume', 0.25);
    var t = now();
    tone(BASS[step], BASS[step], 0.24, 'triangle', 0.5 * mv, t);
    if (step % 2 === 1) noiseBurst(0.04, 0.12 * mv, 6000, 'highpass', t);
    if (bar === 3 && LEAD[step]) tone(LEAD[step], LEAD[step], 0.2, 'sine', 0.22 * mv, t);
    Audio.musicStep += 1;
  }

  function startMusic() {
    if (Audio.musicOn) return;
    if (!Audio.ctx) init();
    if (!Audio.ctx) return;
    resume();
    Audio.musicOn = true;
    Audio.musicStep = 0;
    if (typeof setInterval === 'function') {
      Audio.musicTimer = setInterval(musicStep, 240);
    }
  }

  function stopMusic() {
    Audio.musicOn = false;
    if (Audio.musicTimer !== null && typeof clearInterval === 'function') {
      clearInterval(Audio.musicTimer);
      Audio.musicTimer = null;
    }
  }

  // The loop starts itself on the first real sound, once the browser has
  // allowed audio; until then it stays quiet instead of throwing.
  function ensureMusic() {
    if (!Audio.musicOn && Audio.ctx && Audio.ctx.state === 'running') startMusic();
  }

  // ---- mute ------------------------------------------------------------------

  function setMuted(muted) {
    Audio.muted = !!muted;
    if (Audio.master && Audio.ctx) {
      try {
        Audio.master.gain.value = Audio.muted ? 0 : (cfg().masterVolume !== undefined ? cfg().masterVolume : 0.7);
      } catch (err) { /* ignore */ }
    }
    if (Audio.muted) {
      if (Audio.sirenNode) {
        try { Audio.sirenNode.gain.gain.value = 0; } catch (err) { /* ignore */ }
      }
      if (Audio.engineNode) {
        try { Audio.engineNode.gain.gain.value = 0; } catch (err) { /* ignore */ }
      }
    }
    return Audio.muted;
  }

  function toggleMute() {
    return setMuted(!Audio.muted);
  }

  Audio.init = init;
  Audio.play = play;
  Audio.setMuted = setMuted;
  Audio.toggleMute = toggleMute;
  Audio.setEngine = setEngine;
  Audio.setSiren = setSiren;
  Audio.startMusic = startMusic;
  Audio.stopMusic = stopMusic;
  Audio.resume = resume;

  Solmar.Audio = Audio;
})();
