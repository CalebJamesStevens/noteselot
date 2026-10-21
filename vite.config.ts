import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    allowedHosts: ["terminal.local"],
    proxy: {
      "/api": "http://127.0.0.1:3000",
      "/collaboration": { target: "ws://127.0.0.1:3000", ws: true },
    },
  },
  build: { chunkSizeWarningLimit: 1600 },
});
