import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // In local development the frontend calls relative /api/* paths,
    // exactly like in production on Vercel. Vite forwards them to the
    // local FastAPI server.
    proxy: {
      "/api": "http://127.0.0.1:8000",
    },
  },
});
