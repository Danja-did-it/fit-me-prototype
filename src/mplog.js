// MediaPipe prints harmless status lines ("INFO: Created TensorFlow Lite XNNPACK delegate",
// "W0925 ... OpenGL error checking is disabled") through console.error / console.warn.
// Pass those on as info so real errors and warnings stay visible. Runs once on import.
for (const level of ['error', 'warn']) {
  const orig = console[level];
  console[level] = (...args) => {
    if (typeof args[0] === 'string' && /^(INFO:|[IW]\d{4} )/.test(args[0])) return console.info(...args);
    orig(...args);
  };
}
