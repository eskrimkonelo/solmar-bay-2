// Solmar Bay — keyboard and mouse state. This module only records what the
// player is pressing and where the pointer is; it never decides what a key
// means. The world module reads this object each frame and gives the keys
// their meaning.
(function () {
  var root = typeof window !== 'undefined' ? window : globalThis;
  root.Solmar = root.Solmar || {};

  var Input = {
    // Key codes currently held down, by their code string (e.g. 'KeyW').
    keys: {},
    // Mouse position in page pixels, and in canvas pixels.
    mouseX: 0,
    mouseY: 0,
    mouseCanvasX: 0,
    mouseCanvasY: 0,
    // Whether the left mouse button is currently down.
    mouseDown: false,
    // A click that has happened and not been taken yet.
    clickPending: false,
    // The canvas the listeners are wired to.
    canvas: null
  };

  // True while the named key code is held.
  function isDown(code) {
    return !!Input.keys[code];
  }

  // True while either of two key codes is held (for WASD / arrow pairs).
  function isEitherDown(first, second) {
    return isDown(first) || isDown(second);
  }

  // Takes a waiting click exactly once; later calls return false until the
  // player clicks again.
  function takeClick() {
    if (!Input.clickPending) return false;
    Input.clickPending = false;
    return true;
  }

  function onKeyDown(event) {
    Input.keys[event.code] = true;
    // Keep the page from scrolling when the game uses arrows or space.
    if (event.code === 'Space' || event.code.indexOf('Arrow') === 0) {
      event.preventDefault();
    }
  }

  function onKeyUp(event) {
    Input.keys[event.code] = false;
  }

  function onMouseMove(event) {
    Input.mouseX = event.clientX;
    Input.mouseY = event.clientY;
    if (Input.canvas) {
      var rect = Input.canvas.getBoundingClientRect();
      Input.mouseCanvasX = event.clientX - rect.left;
      Input.mouseCanvasY = event.clientY - rect.top;
    }
  }

  function onMouseDown(event) {
    if (event.button === 0) {
      Input.mouseDown = true;
      Input.clickPending = true;
      onMouseMove(event);
    }
  }

  function onMouseUp(event) {
    if (event.button === 0) Input.mouseDown = false;
  }

  function onBlur() {
    // Losing the window clears every held key, so the player never walks
    // forever after alt-tabbing away mid-press.
    Input.keys = {};
    Input.mouseDown = false;
  }

  // Wires the listeners to the game canvas. Safe to call once; a second
  // call with the same canvas does nothing.
  function attach(canvas) {
    if (!canvas || Input.canvas === canvas) return;
    Input.canvas = canvas;
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('contextmenu', function (event) {
      event.preventDefault();
    });
  }

  Input.isDown = isDown;
  Input.isEitherDown = isEitherDown;
  Input.takeClick = takeClick;
  Input.attach = attach;

  root.Solmar.Input = Input;
})();
