// The app's api.ts imports Tauri's invoke; the videos only use its formatting helpers.
export const invoke = () => Promise.reject(new Error("not available in the video"));
