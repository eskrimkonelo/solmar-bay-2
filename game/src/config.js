// Solmar Bay — tuning values. Every number the game uses lives here, as a
// named constant, so later modules read Solmar.Config and never hard-code
// a speed, a size, a colour, or a reward of their own.
(function () {
  var root = typeof window !== 'undefined' ? window : globalThis;
  root.Solmar = root.Solmar || {};

  var Config = {
    // The drawing surface the page gives the game.
    canvasWidth: 1280,
    canvasHeight: 720,

    // The city is built once from this seed, so every load shows the same city.
    citySeed: 'solmar-bay',
    cityWidth: 6400,
    cityHeight: 4800,
    blockSize: 320,
    roadWidth: 64,
    sidewalkWidth: 18,

    // The player on foot.
    walkSpeed: 150,
    runSpeed: 260,
    playerRadius: 14,
    playerHealth: 100,
    playerTurnRate: 9.0,

    // Cars.
    carLength: 56,
    carWidth: 28,
    carAccel: 320,
    carBrake: 520,
    carReverseSpeed: 120,
    carMaxSpeed: 430,
    carTurnRate: 2.4,
    carHealth: 100,
    carSmokeAt: 45,
    carFireAt: 20,
    carDamagePerHit: 12,

    // Pedestrians and traffic.
    pedestrianCount: 42,
    pedestrianSpeed: 55,
    pedestrianFleeSpeed: 150,
    trafficCount: 18,
    trafficSpeedSlow: 120,
    trafficSpeedFast: 210,

    // Wanted level: heat in [0, 100]; crossing a threshold raises a star.
    wantedThresholds: [0, 18, 38, 58, 78, 92],
    wantedDecayPerSecond: 1.6,
    wantedDecayHiddenBonus: 2.4,
    heatStealCar: 22,
    heatShoot: 16,
    heatHitPedestrian: 20,
    heatRamPolice: 30,
    heatPerSecondFleeing: 0.5,
    policePerStar: [0, 1, 2, 3, 4, 6],
    policeCarSpeed: 470,
    policeFootSpeed: 240,
    policeCatchDistance: 26,
    policeRamDamage: 8,

    // Combat.
    bulletSpeed: 720,
    bulletDamage: 25,
    bulletRange: 520,
    fireInterval: 0.22,
    pistolAmmo: 60,
    ammoPickup: 24,
    healthPickup: 35,
    pickupRadius: 20,

    // Missions: six in a chain, each paying on completion.
    missionCount: 6,
    missionRewards: [250, 400, 600, 900, 1400, 2200],
    missionTitles: [
      'First Fare',
      'The Package',
      'Hot Wheels',
      'Harbor Lights',
      'The Long Chase',
      'Bay Showdown'
    ],
    missionMarkerRadius: 34,
    missionFailDistance: 900,

    // Camera and feel.
    cameraLag: 0.08,
    cameraZoom: 1.0,
    shakeOnExplosion: 14,
    shakeOnCrash: 6,
    shakeDecay: 30,
    skidMarkLife: 6,

    // Sound volumes (0 to 1).
    masterVolume: 0.7,
    musicVolume: 0.25,
    sfxVolume: 0.8,
    sirenVolume: 0.35,
    engineVolume: 0.3,

    // Save slot in the browser's local storage.
    saveKey: 'solmar-bay-save-v1',

    // Palette: a sun-soaked coastal city.
    palette: {
      road: '#5a564e',
      roadLine: '#e8d98a',
      sidewalk: '#cfc4a8',
      grass: '#7fae5a',
      sand: '#e6d29a',
      water: '#2e7fb8',
      waterDeep: '#1f5f8f',
      buildingRoof: '#b98a5e',
      park: '#6da34f',
      dock: '#8a7a5e',
      hudBackground: 'rgba(12, 18, 28, 0.72)',
      hudText: '#f2ead8',
      hudAccent: '#ffd166',
      starOn: '#ffd166',
      starOff: '#4a4a52',
      healthGood: '#6fd06f',
      healthLow: '#e05252',
      minimapWater: '#2e7fb8',
      minimapRoad: '#8a8578',
      minimapPlayer: '#ffffff',
      minimapPolice: '#4a90e2',
      minimapMarker: '#ffd166',
      minimapCar: '#e8e8e8'
    },

    // Car paint jobs the city and traffic draw from.
    carPaints: [
      '#c0392b', '#2e86c1', '#f1c40f', '#27ae60',
      '#8e44ad', '#e67e22', '#ecf0f1', '#2c3e50',
      '#16a085', '#d35400'
    ],

    // Starting money and the player's home corner of the city.
    startMoney: 120,
    startX: 1600,
    startY: 1200
  };

  root.Solmar.Config = Config;
})();
