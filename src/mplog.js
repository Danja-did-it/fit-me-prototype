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

// MediaPipe (tasks-vision 1.0.1) sends usage statistics to Google every minute. Photos never
// leave the device, and neither should these: answer them locally with an empty response.
// (index.html also blocks any request to other sites with a Content-Security-Policy.)
const realFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input?.url || '';
  if (url.includes('odml.pa.googleapis.com')) return Promise.resolve(new Response(null, { status: 204 }));
  return realFetch(input, init);
};
