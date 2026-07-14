import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// Vite config. OCR_API_BASE_URL is read from env at build/runtime via
// import.meta.env.VITE_OCR_API_BASE_URL (see src/config.ts).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react()],
    server: {
      port: 5173,
      host: true,
    },
    preview: {
      port: 4173,
      host: true,
    },
    define: {
      // allow VITE_OCR_API_BASE_URL fallback from non-prefixed OCR_API_BASE_URL
      "import.meta.env.VITE_OCR_API_BASE_URL": JSON.stringify(
        env.VITE_OCR_API_BASE_URL || env.OCR_API_BASE_URL || ""
      ),
    },
  };
});
