import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/tumonline": {
        target: "https://campus.tum.de",
        changeOrigin: true,
      },
    },
  },
});
